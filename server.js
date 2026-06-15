require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const aiRoutes = require('./routes/ai');
const employeeRoutes = require('./routes/employees');
const adminRoutes = require('./routes/admin');
const kbRoutes = require('./routes/kb');
const agentRoutes = require('./routes/agent');
const learningRoutes = require('./routes/learning');
const slaService = require('./services/sla');
const Ticket = require('./models/Ticket');
const Conversation = require('./models/Conversation');
const FixJob = require('./models/FixJob');

// ── FIX: Global crash guards Slack Socket Mode prevent disconnect from crashing ─
process.on('uncaughtException', (err) => {
 // Slack Socket Mode "server explicit disconnect" is normal ignore it
 if (err.message && err.message.includes('Unhandled event')) {
 console.warn('⚠️ Slack WebSocket disconnect (auto-reconnecting):', err.message);
 return; // do NOT exit let Bolt auto-reconnect
 }
 console.error(' Uncaught Exception:', err.message);
 // For truly unexpected errors, log but keep running
});

process.on('unhandledRejection', (reason) => {
 console.error(' Unhandled Rejection:', reason?.message || reason);
 // Never crash the process on unhandled promise rejections
});

// ── Slack client (set after bot starts) ──────────────────────────────────────
let slackClient = null;

const app = express();
const PORT = process.env.PORT || 3000;

// ── Connect Database ──────────────────────────────────────────────────────────
connectDB();

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({
 contentSecurityPolicy: {
 directives: {
 defaultSrc : ["'self'"],
 scriptSrc : ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
 scriptSrcAttr : ["'unsafe-inline'"],
 styleSrc : ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
 fontSrc : ["'self'", "https://fonts.gstatic.com"],
 imgSrc : ["'self'", "data:", "https:"],
 connectSrc : ["'self'", "https://wiom-helpdesk-production.up.railway.app", "https://web-production-ef6c1.up.railway.app"]
 }
 }
}));
app.use(cors({
 origin: process.env.ALLOWED_ORIGINS
 ? process.env.ALLOWED_ORIGINS.split(',')
 : '*',
 methods: ['GET','POST','PUT','PATCH','DELETE'],
 allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Serve Employee Portal (public/) ──────────────────────────────────────────
app.use(express.static('public'));

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
 res.json({
 status : 'ok',
 service : 'WIOM IT Helpdesk API',
 version : '1.0.0',
 portal : 'https://wiom-helpdesk-production.up.railway.app',
 time : new Date().toISOString()
 });
});

app.get('/health', (req, res) => {
 res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Fix counter desync (run once to repair ticketId sequence) ────────────────
app.get('/api/fix-counter', async (req, res) => {
 try {
   const mongoose = require('mongoose');
   const Counter = mongoose.models.Counter || mongoose.model('Counter', new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }));
   const last = await Ticket.findOne({}).sort({ ticketId: -1 }).select('ticketId').lean();
   const lastNum = last?.ticketId ? parseInt(last.ticketId.replace('WIOM-TKT-', '')) : 0;
   await Counter.findOneAndUpdate({ _id: 'ticketId' }, { $set: { seq: lastNum } }, { upsert: true });
   res.json({ success: true, message: `Counter reset to ${lastNum}`, lastTicket: last?.ticketId });
 } catch (err) {
   res.status(500).json({ success: false, error: err.message });
 }
});

// ── Test ticket creation (debug only) ────────────────────────────────────────
app.get('/api/test-ticket', async (req, res) => {
 try {
   const ticket = await Ticket.create({
     empId: 'TEST-DEBUG', empName: 'Debug Test',
     description: 'Test ticket from debug endpoint',
     category: 'Other', priority: 'Low', source: 'slack'
   });
   res.json({ success: true, ticketId: ticket.ticketId, message: 'Ticket created OK' });
 } catch (err) {
   res.status(500).json({ success: false, error: err.message });
 }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/kb', kbRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/learning', learningRoutes);

// ── WhatsApp Webhook (Twilio) ──────────────────────────────────────────────────
app.post('/api/whatsapp/incoming', async (req, res) => {
 try {
 const accountSid = process.env.TWILIO_ACCOUNT_SID;
 const authToken = process.env.TWILIO_AUTH_TOKEN;
 if (!accountSid || !authToken) return res.send('<Response></Response>');
 const twilio = require('twilio')(accountSid, authToken);
 const waSvc = require('./services/whatsapp');
 await waSvc.handleIncoming(req, res, twilio);
 } catch (err) {
 console.error('WhatsApp webhook error:', err.message);
 res.set('Content-Type', 'text/xml');
 res.send('<Response></Response>');
 }
});

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
 res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
 console.error('❌ Error:', err.message);
 res.status(err.status || 500).json({
 error : err.message || 'Internal server error',
 ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
 });
});

// ── SLA Cron: Check every 30 min ─────────────────────────────────────────────
cron.schedule('*/30 * * * *', () => {
 console.log('⏰ SLA check running...');
 slaService.checkBreaches();
});

// ── Auto-Escalation Cron: Every hour ─────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
 try {
 const adminId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 if (!slackClient || !adminId || adminId === 'FILL_KARO') return;

 const fourHoursAgo = new Date(Date.now() - 4 * 3600000);
 const stale = await Ticket.find({
 status : { $in: ['Open', 'In Progress'] },
 createdAt : { $lte: fourHoursAgo },
 escalationSent: false
 });

 for (const t of stale) {
 const hoursOld = Math.round((Date.now() - t.createdAt) / 3600000);
 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 try {
 await slackClient.chat.postMessage({
 channel: adminId,
 text: `⚠️ Escalation: ${t.ticketId} ${t.empName} (${hoursOld}h open)`,
 attachments: [{
 color: '#ef4444',
 blocks: [
 { type:'header', text:{ type:'plain_text', text:`⚠️ Escalation Alert ${t.ticketId}`, emoji:true }},
 { type:'section', fields:[
 { type:'mrkdwn', text:`* Employee*\n${t.empName} (${t.empDept||'Unknown'})` },
 { type:'mrkdwn', text:`*${priEmoji[t.priority]||''} Priority*\n${t.priority}` },
 { type:'mrkdwn', text:`*⏱ Open Since*\n${hoursOld} hours` },
 { type:'mrkdwn', text:`* Category*\n${t.category||'Other'}` }
 ]},
 { type:'section', text:{ type:'mrkdwn', text:`* Issue:*\n${t.description}` }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_Still not resolved — please check!_` }]}
 ]
 }]
 });
 t.escalationSent = true;
 await t.save();
 console.log(` Escalation sent for ${t.ticketId} (${hoursOld}h old)`);
 } catch (err) {
 // messages_tab_disabled = admin DM not allowed — silently skip (don't spam logs)
 if (!err.message?.includes('messages_tab_disabled')) {
   console.error(`Escalation DM failed for ${t.ticketId}:`, err.message);
 }
 }
 }
 if (stale.length) console.log(`⚡ Escalated ${stale.length} tickets`);
 } catch (err) {
 console.error('Escalation cron error:', err.message);
 }
});

// ── Employee Reminder Cron: Every hour ticket 4h+ open → remind employee via Slack ─
cron.schedule('30 * * * *', async () => {
 try {
 if (!slackClient) return;

 const fourHoursAgo = new Date(Date.now() - 4 * 3600000);
 const unreminded = await Ticket.find({
 status : { $in: ['Open', 'In Progress'] },
 createdAt : { $lte: fourHoursAgo },
 empReminderSent: false,
 slackUserId : { $exists: true, $ne: null }
 });

 for (const t of unreminded) {
 const hoursOld = Math.floor((Date.now() - new Date(t.createdAt)) / 3600000);
 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 try {
 await slackClient.chat.postMessage({
 channel: t.slackUserId,
 text : `⏳ Your ticket ${t.ticketId} is still open — IT team is working on it!`,
 blocks : [
 { type:'section', text:{ type:'mrkdwn', text:
 `⏳ *Your ticket is still open!*\n\n` +
 `* Ticket:* \`${t.ticketId}\`\n` +
 `*${priEmoji[t.priority]||''} Priority:* ${t.priority}\n` +
 `* Problem:* ${(t.description||'').substring(0,80)}${(t.description||'').length>80?'...':''}\n` +
 `*⏱ Open Since:* ${hoursOld} hours ago`
 }},
 { type:'context', elements:[{ type:'mrkdwn', text:
 `_IT team is working on your ticket and will resolve it soon!_\nIf urgent, please contact: *IT Helpdesk (Slack)*`
 }]}
 ]
 });
 t.empReminderSent = true;
 await t.save();
 console.log(` Reminder sent to ${t.slackUserId} for ticket ${t.ticketId} (${hoursOld}h old)`);
 } catch (err) {
 if (!err.message?.includes('messages_tab_disabled')) {
   console.error(`Reminder DM failed for ${t.ticketId}:`, err.message);
 }
 }
 }
 if (unreminded.length) console.log(` Sent ${unreminded.length} employee reminders`);
 } catch (err) {
 console.error('Employee reminder cron error:', err.message);
 }
});

// ── Auto-Close Cron: Daily 2AM Resolved 3+ days ago → Closed ───────────────
cron.schedule('0 2 * * *', async () => {
 try {
 const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600000);
 const result = await Ticket.updateMany(
 { status: 'Resolved', resolvedAt: { $lte: threeDaysAgo } },
 { $set: { status: 'Closed', closedAt: new Date() } }
 );
 if (result.modifiedCount > 0)
 console.log(` Auto-closed ${result.modifiedCount} resolved tickets`);
 } catch (err) {
 console.error('Auto-close cron error:', err.message);
 }
});

// ── Daily cleanup: delete conversations older than 7 days ────────────────────
cron.schedule('0 3 * * *', async () => {
 try {
 const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
 const del = await Conversation.deleteMany({ lastActive: { $lte: sevenDaysAgo } });
 if (del.deletedCount > 0) console.log(` Cleaned ${del.deletedCount} old conversations`);
 } catch(err) { console.error('Conversation cleanup error:', err.message); }
});

// ── Recurring Issue Alert: Every 30 min flag when 3+ employees report same problem ──
cron.schedule('*/30 * * * *', async () => {
 try {
 if (!slackClient) return;
 const adminId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 if (!adminId || adminId === 'FILL_KARO') return;

 const oneHourAgo = new Date(Date.now() - 3600000);
 // Group recent tickets by category
 const grouped = await Ticket.aggregate([
 { $match: { createdAt: { $gte: oneHourAgo }, status: { $in: ['Open','In Progress'] } } },
 { $group: { _id: '$category', count: { $sum: 1 }, employees: { $push: '$empName' } } },
 { $match: { count: { $gte: 3 } } }
 ]);

 // BUG-10/22 fix: TTL Map instead of Set — evict per-entry after 1h, no full-clear storm
 if (!global._sentRecurringAlerts) global._sentRecurringAlerts = new Map();
 const now_ms = Date.now();
 // Evict entries older than 1 hour (1-by-1, not full clear)
 for (const [k, ts] of global._sentRecurringAlerts) {
   if (now_ms - ts > 3600000) global._sentRecurringAlerts.delete(k);
 }

 for (const g of grouped) {
 const key = `recurring-alert-${g._id}`;
 if (global._sentRecurringAlerts.has(key)) continue;
 global._sentRecurringAlerts.set(key, now_ms);

 await slackClient.chat.postMessage({
 channel: adminId,
 text : `⚠️ ${g.count} employees reported the same problem: ${g._id}`,
 blocks : [
 { type:'header', text:{ type:'plain_text', text:`⚠️ Recurring Issue Alert`, emoji:true }},
 { type:'section', text:{ type:'mrkdwn', text:
 `*${g.count} employees reported the same issue in the last 1 hour!*\n\n*Category:* ${g._id}\n*Employees:* ${g.employees.slice(0,5).join(', ')}${g.count > 5 ? ` +${g.count-5} more` : ''}`
 }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_This may be a systemic problem — please investigate!_` }]}
 ]
 });
 console.log(`⚠️ Recurring issue alert sent for category: ${g._id} (${g.count} tickets)`);
 }
 } catch (err) {
 console.error('Recurring issue cron error:', err.message);
 }
});

// ── Auto-create default admin if none exists ──────────────────────────────────
// BUG-03/20 fix: use meaningful username, require ADMIN_PASSWORD env var, never log password
const ensureAdminExists = async () => {
 try {
 const Admin = require('./models/Admin');
 const count = await Admin.countDocuments();
 if (count === 0) {
 const pwd = process.env.ADMIN_PASSWORD;
 if (!pwd) {
   console.warn('⚠️  No admin exists and ADMIN_PASSWORD env var is not set.');
   console.warn('   Set ADMIN_PASSWORD in Railway env vars, then restart.');
   console.warn('   Or POST /api/auth/setup-admin with SETUP_ENABLED=true to create manually.');
   return;
 }
 await Admin.create({
   username : 'it_admin',
   passwordHash: pwd,
   name : process.env.ADMIN_NAME || 'IT',
   email : process.env.ADMIN_EMAIL || 'it@wiom.in',
   role : 'superadmin'
 });
 console.log('✅ Default admin created — username: it_admin (password from ADMIN_PASSWORD env var)');
 }
 } catch (err) {
 console.error('Admin setup error:', err.message);
 }
};

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
 console.log(`\n WIOM Helpdesk API running on port ${PORT}`);
 console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
 console.log(` Health: http://localhost:${PORT}/health\n`);

 await ensureAdminExists();

 // ── Start Slack Bot ────────────────────────────────────────────────────────
 if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_BOT_TOKEN !== 'FILL_KARO') {
 try {
 const { App } = require('@slack/bolt');
 const claudeSvc = require('./services/claude');
 const Employee = require('./models/Employee');
 const API_BASE = process.env.API_BASE_URL || `http://localhost:${PORT}`;

 const slackApp = new App({
 token : process.env.SLACK_BOT_TOKEN,
 signingSecret: process.env.SLACK_SIGNING_SECRET,
 socketMode : true,
 appToken : process.env.SLACK_APP_TOKEN
 });

 // ── Admin email — single source of truth (set in .env) ──────────────────────
 const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'sajan.kumar@wiom.in';

 // ── In-memory store for pending ticket confirmations (short-lived) ─────
 const pendingTickets  = new Map(); // slackUserId -> ticketData (with createdAt)
 const processingUsers = new Set(); // Fix 8: per-user lock — prevents race conditions
 const expandedHomeMap = new Map(); // slackUserId -> Set<categoryKey>
 const failedAttempts  = new Map(); // slackUserId -> { count, lastTime } — tracks "Nahi hua" clicks
 const unknownAttempts = new Map(); // userId → { count, lastQuery, lastTime } — unknown query escalation

 // ── Proactive cleanup: prevent memory leaks in long-running process ──────────
 setInterval(() => {
   const now = Date.now();
   const THIRTY_MIN = 30 * 60 * 1000;
   for (const [uid, data] of pendingTickets.entries()) {
     if (data.ts && (now - data.ts) > THIRTY_MIN) pendingTickets.delete(uid);
   }
   for (const [uid, data] of failedAttempts.entries()) {
     if (data.lastTime && (now - data.lastTime) > THIRTY_MIN) failedAttempts.delete(uid);
   }
   for (const [uid, data] of unknownAttempts.entries()) {
     if (data.lastTime && (now - data.lastTime) > THIRTY_MIN) unknownAttempts.delete(uid);
   }
 }, 30 * 60 * 1000); // runs every 30 minutes

 // ── Brand detection helpers ───────────────────────────────────────────
 const detectBrand = (laptopName) => {
 if (!laptopName) return 'unknown';
 const n = laptopName.toLowerCase();
 if (n.includes('macbook') || n.includes('apple') || n.includes('mac pro') || n.includes('mac mini') || n.includes('m4') || n.includes('m5')) return 'apple';
 if (n.includes('hp') || n.includes('elitebook') || n.includes('probook') || n.includes('envy') || n.includes('pavilion') || n.includes('omen') || n.includes('zbook')) return 'hp';
 if (n.includes('dell') || n.includes('latitude') || n.includes('inspiron') || n.includes('xps') || n.includes('precision') || n.includes('vostro') || n.includes('alienware')) return 'dell';
 if (n.includes('lenovo') || n.includes('thinkpad') || n.includes('ideapad') || n.includes('yoga') || n.includes('legion')) return 'lenovo';
 if (n.includes('asus') || n.includes('vivobook') || n.includes('zenbook') || n.includes('rog')) return 'asus';
 if (n.includes('acer') || n.includes('aspire') || n.includes('swift') || n.includes('nitro')) return 'acer';
 return 'unknown';
 };

 const getBrandInfo = (brand, sn) => {
 const enc = encodeURIComponent(sn || '');
 switch (brand) {
 case 'apple':
 return {
 brandLabel : ' Apple MacBook',
 warrantyUrl: `https://checkcoverage.apple.com/?sn=${enc}`,
 diagScript : null, // Mac can't run .bat
 diagLabel : null,
 appleMode : true,
 supportUrl : 'https://getsupport.apple.com'
 };
 case 'hp':
 return {
 brandLabel : '️ HP',
 warrantyUrl: `https://support.hp.com/us-en/checkwarranty`,
 diagScript : 'fix-diagnostic-hp.bat',
 diagLabel : ' HP Hardware Diagnostic Script',
 appleMode : false,
 supportUrl : 'https://support.hp.com'
 };
 case 'dell':
 return {
 brandLabel : '️ Dell',
 warrantyUrl: `https://www.dell.com/support/home/?s=BSD&ServiceTag=${enc}`,
 diagScript : 'fix-diagnostic-dell.bat',
 diagLabel : ' Dell SupportAssist Script',
 appleMode : false,
 supportUrl : 'https://www.dell.com/support'
 };
 case 'lenovo':
 return {
 brandLabel : '️ Lenovo',
 warrantyUrl: `https://pcsupport.lenovo.com/us/en/warranty-lookup`,
 diagScript : 'fix-diagnostic-lenovo.bat',
 diagLabel : ' Lenovo Vantage Diagnostic Script',
 appleMode : false,
 supportUrl : 'https://support.lenovo.com'
 };
 default:
 return {
 brandLabel : ' Laptop',
 warrantyUrl: null,
 diagScript : null,
 diagLabel : null,
 appleMode : false,
 supportUrl : null
 };
 }
 };

 // ── Category definitions (Home Tab — 8 professional categories) ───────────────────
         const CATEGORIES = [
         {
         key: 'laptop_hw', label: 'Laptop & Hardware',
         emoji: '💻', color: 'primary',
         desc: 'Slow, Won\'t Turn On, Blue Screen, Overheating, Battery, Keyboard, Camera, Audio, Screen',
         rows: [
         [
         { text:'Laptop Slow', value:'My laptop is very slow what should I do', id:'home_quick_1' },
         { text:'Won\'t Turn On', value:'My laptop is not turning on at all', id:'home_quick_2' },
         { text:'Blue Screen', value:'Getting blue screen of death BSOD error', id:'home_quick_3' },
         { text:'Overheating', value:'My laptop is overheating getting very hot', id:'home_quick_4' },
         { text:'Battery Issue', value:'Laptop battery drains quickly or not charging at all', id:'home_quick_5' }
         ],
         [
         { text:'Screen Black', value:'Laptop screen is black cannot see anything', id:'home_quick_6' },
         { text:'Keyboard Issue', value:'Laptop keyboard not working some keys not responding', id:'home_quick_7' },
         { text:'Touchpad Issue', value:'Mouse or touchpad is not working not responding', id:'home_quick_8' },
         { text:'Camera Issue', value:'Laptop camera not working in Teams Zoom or Meet', id:'home_quick_20' },
         { text:'Audio / Sound', value:'No sound coming from laptop speakers audio not working', id:'home_quick_9' }
         ],
         [
         { text:'Screen Issue', value:'Laptop screen is flickering blinking or flashing', id:'home_quick_39' },
         { text:'Charger Issue', value:'Laptop charger not working or not charging properly', id:'home_quick_10' },
         { text:'Fan Noise', value:'Laptop fan is making very loud noise constantly', id:'home_quick_38' },
         { text:'Sleep / Wake', value:'Laptop not waking up from sleep screen stays black', id:'home_quick_64' },
         { text:'Freezing / Hang', value:'Laptop is hanging freezing not responding at all', id:'home_quick_21' }
         ]
         ]
         },
         {
         key: 'network', label: 'Network & Internet',
         emoji: '🌐', color: 'primary',
         desc: 'WiFi Not Working, Slow Internet, LAN Issue, Network Drive, Website Blocked',
         rows: [
         [
         { text:'WiFi Not Working', value:'WiFi not working no internet connection', id:'home_quick_11' },
         { text:'Slow Internet', value:'Internet speed is very slow browsing not working properly', id:'home_quick_29' },
         { text:'LAN Issue', value:'Wired LAN ethernet not working no network connection', id:'home_new_01' },
         { text:'Network Drive', value:'Network shared drive not accessible cannot connect', id:'home_new_02' },
         { text:'Website Blocked', value:'Website not opening showing blocked or access denied', id:'home_quick_43' }
         ]
         ]
         },
         {
         key: 'ms_office', label: 'Microsoft Office',
         emoji: '📊', color: 'primary',
         desc: 'Excel Issue, Word Issue, PowerPoint Issue, Office Activation, File Corrupted',
         rows: [
         [
         { text:'Excel Issue', value:'Microsoft Excel not opening or showing error', id:'home_quick_23' },
         { text:'Word Issue', value:'Microsoft Word not opening or showing error', id:'home_new_03' },
         { text:'PowerPoint Issue', value:'Microsoft PowerPoint not opening or showing error', id:'home_new_04' },
         { text:'Office Activation', value:'Microsoft Office activation error or license expired', id:'home_new_05' },
         { text:'File Corrupted', value:'Office file is corrupted cannot open document', id:'home_new_06' }
         ]
         ]
         },
         {
         key: 'browser_apps', label: 'Browser & Apps',
         emoji: '🌍', color: 'primary',
         desc: 'Chrome Not Opening, Browser Slow, Website Not Loading, Teams Issue, Zoom Issue',
         rows: [
         [
         { text:'Chrome Not Opening', value:'Chrome browser not opening or crashing', id:'home_quick_31' },
         { text:'Browser Slow', value:'Browser is very slow or freezing Chrome Firefox Edge', id:'home_new_07' },
         { text:'Website Not Loading', value:'Website not loading or showing error in browser', id:'home_new_08' },
         { text:'Teams Issue', value:'Microsoft Teams not working call dropping or not opening', id:'home_quick_13' },
         { text:'Zoom Issue', value:'Zoom not working cannot join meeting or Zoom crashing', id:'home_quick_27' }
         ]
         ]
         },
         {
         key: 'email_comm', label: 'Email & Communication',
         emoji: '📧', color: 'primary',
         desc: 'Gmail Issue, Email Password, Calendar Sync, Email Not Sending',
         rows: [
         [
         { text:'Gmail Issue', value:'Gmail not opening or cannot send receive emails in Chrome', id:'home_quick_50' },
         { text:'Email Password', value:'Forgot email account password need to reset it', id:'home_quick_59' },
         { text:'Calendar Sync', value:'Google Calendar not syncing or showing wrong events', id:'home_new_09' },
         { text:'Email Not Sending', value:'Email not sending or stuck in outbox cannot send mail', id:'home_new_10' }
         ]
         ]
         },
         {
         key: 'printer', label: 'Printer & Peripherals',
         emoji: '🖨️', color: 'primary',
         desc: 'Printer Offline, Print Not Working, External Monitor, Scanner Issue',
         rows: [
         [
         { text:'Printer Offline', value:'Printer showing offline cannot print', id:'home_quick_54' },
         { text:'Print Not Working', value:'Printer connected but printing not working', id:'home_new_11' },
         { text:'External Monitor', value:'External monitor not detected screen not showing on it', id:'home_quick_17' },
         { text:'Scanner Issue', value:'Scanner not working or not detected by computer', id:'home_new_12' }
         ]
         ]
         },
         {
         key: 'access', label: 'Access & Password',
         emoji: '🔐', color: 'primary',
         desc: 'Password Reset, Account Locked, Shared Folder Access, Software Access',
         rows: [
         [
         { text:'Password Reset', value:'Forgot password need to reset it', id:'home_quick_55b' },
         { text:'Account Locked', value:'Account is locked cannot login to Windows or any account', id:'home_quick_55' },
         { text:'Shared Folder Access', value:'Need access to shared folder or network drive', id:'home_new_13' },
         { text:'Software Access', value:'Need access to a software or application', id:'home_quick_74' }
         ]
         ]
         },
         {
         key: 'asset_req', label: 'Asset Requests',
         emoji: '📦', color: 'primary',
         desc: 'New Laptop, New Charger, New Mouse, New Keyboard, Headphone Request',
         rows: [
         [
         { text:'New Laptop', value:'Need a new laptop request for replacement or new joiner', id:'home_quick_75' },
         { text:'New Charger', value:'Need a new charger for laptop charger damaged or lost', id:'home_new_14' },
         { text:'New Mouse', value:'Need a new mouse old one damaged or not working', id:'home_quick_60' },
         { text:'New Keyboard', value:'Need a new keyboard old one damaged or not working', id:'home_quick_61' },
         { text:'Headphone Request', value:'Need headphones for work calls and meetings', id:'home_new_15' }
         ]
         ]
         }
         ];

         // ── Legacy categories kept for dm_cat_* action handlers (backward compat) ──────────────────
         const LEGACY_CATEGORIES = [
         {
         key: 'laptop', label: 'Laptop & Display',
         emoji: '🔵', color: 'primary',
         desc: 'Slow, Screen, Keyboard, Audio, Camera, USB, Bluetooth',
         rows: [
         [
         { text:'Laptop Slow', value:'My laptop is very slow what should I do', id:'home_quick_1' },
         { text:'Won\'t Turn On', value:'My laptop is not turning on at all', id:'home_quick_2' },
         { text:'Blue Screen', value:'Getting blue screen of death BSOD error', id:'home_quick_3' },
         { text:'Overheating', value:'My laptop is overheating getting very hot', id:'home_quick_4' },
         { text:'Battery Issue', value:'Laptop battery drains quickly or not charging at all', id:'home_quick_5' }
         ],
         [
         { text:'Screen Black', value:'Laptop screen is black cannot see anything', id:'home_quick_6' },
         { text:'Keyboard Issue', value:'Laptop keyboard not working some keys not responding', id:'home_quick_7' },
         { text:'Touchpad Issue', value:'Mouse or touchpad is not working not responding', id:'home_quick_8' },
         { text:'Freezing / Hanging', value:'Laptop is hanging freezing not responding at all', id:'home_quick_21' },
         { text:'Sudden Shutdown', value:'Laptop shuts down suddenly without any warning', id:'home_quick_30' }
         ],
         [
         { text:'No Sound', value:'No sound coming from laptop speakers audio not working', id:'home_quick_9' },
         { text:'Mic Not Working', value:'Microphone not working voice not going in Teams or calls', id:'home_quick_16' },
         { text:'Camera Issue', value:'Laptop camera not working in Teams Zoom or Meet', id:'home_quick_20' },
         { text:'Headphone Issue', value:'Headphone or earphone not connecting or no sound', id:'home_quick_46' },
         { text:'External Monitor', value:'External monitor not detected screen not showing on it', id:'home_quick_17' }
         ],
         [
         { text:'Screen Flickering', value:'Laptop screen is flickering blinking or flashing', id:'home_quick_39' },
         { text:'Bluetooth Issue', value:'Laptop bluetooth not working cannot connect any device', id:'home_quick_40' },
         { text:'USB Not Working', value:'USB port not working pendrive or device not detected', id:'home_quick_63' },
         { text:'Sleep / Wake Issue', value:'Laptop not waking up from sleep screen stays black', id:'home_quick_64' },
         { text:'Fan Noise', value:'Laptop fan is making very loud noise constantly', id:'home_quick_38' }
         ],
         [
         { text:'Liquid Damage', value:'Liquid or water spilled on laptop needs immediate attention', id:'home_quick_70' },
         { text:'Stuck Restarting', value:'Laptop is stuck in restart loop keeps restarting again and again', id:'home_quick_33' },
         { text:'Boot Error', value:'Laptop not starting getting boot error Windows not loading', id:'home_quick_65' },
         { text:'Caps Lock Stuck', value:'Caps Lock always stays on or keyboard keys are stuck', id:'home_quick_72' },
         { text:'Slow After Update', value:'Laptop became very slow after a Windows update', id:'home_quick_71' }
         ]
         ]
         },
         {
         key: 'network_legacy', label: 'Network & Internet',
         emoji: '🟢', color: 'primary',
         desc: 'WiFi, Internet slow, Website blocked, Disconnecting',
         rows: [
         [
         { text:'WiFi Not Working', value:'WiFi not working no internet connection', id:'home_quick_11' },
         { text:'Internet Very Slow', value:'Internet speed is very slow browsing not working properly', id:'home_quick_29' },
         { text:'WiFi Password', value:'Need WiFi password or forgot WiFi password', id:'home_quick_32' },
         { text:'Website Not Opening', value:'Website not opening showing blocked or access denied', id:'home_quick_43' },
         { text:'WiFi Disconnecting', value:'WiFi keeps disconnecting again and again dropping connection', id:'home_quick_44' }
         ]
         ]
         },
         {
         key: 'software', label: 'Software, Apps & Account',
         emoji: '🟡', color: 'primary',
         desc: 'Teams, Zoom, Gmail, Password reset, OneDrive',
         rows: [
         [
         { text:'Teams Issue', value:'Microsoft Teams not working call dropping or not opening', id:'home_quick_13' },
         { text:'Zoom Issue', value:'Zoom not working cannot join meeting or Zoom crashing', id:'home_quick_27' },
         { text:'Gmail Issue', value:'Gmail not opening or cannot send receive emails in Chrome', id:'home_quick_50' },
         { text:'Browser Issue', value:'Browser is slow crashing or freezing Chrome Firefox Edge', id:'home_quick_31' },
         { text:'Word / Excel Issue', value:'Microsoft Word or Excel not opening showing error', id:'home_quick_23' }
         ],
         [
         { text:'OneDrive Sync Issue', value:'OneDrive not syncing files not going to cloud', id:'home_quick_51' },
         { text:'Windows Update Issue', value:'Windows update not installing stuck or causing issues', id:'home_quick_24' },
         { text:'PDF Not Opening', value:'PDF file not opening PDF reader not working', id:'home_quick_52' },
         { text:'App Crashing', value:'Application keeps crashing or closing suddenly', id:'home_quick_53' },
         { text:'Copy Paste Issue', value:'Copy paste not working Ctrl+C Ctrl+V not responding', id:'home_quick_34' }
         ],
         [
         { text:'Password Reset', value:'Forgot password need to reset it', id:'home_quick_14' },
         { text:'Email Password', value:'Forgot email account password need to reset it', id:'home_quick_59' },
         { text:'Storage Full', value:'Laptop storage full C drive is full cannot save files', id:'home_quick_18' },
         { text:'Virus Suspected', value:'Laptop may have virus showing ads or behaving strangely', id:'home_quick_19' },
         { text:'Account Locked', value:'Account is locked cannot login to Windows or any account', id:'home_quick_55' }
         ],
         [
         { text:'2FA / OTP Issue', value:'Two factor authentication OTP not coming cannot login', id:'home_quick_56' },
         { text:'Antivirus Alert', value:'Antivirus showing alert or has blocked something', id:'home_quick_57' },
         { text:'OneDrive Full', value:'OneDrive storage is full files not syncing', id:'home_quick_58' },
         { text:'Wrong Date / Time', value:'Laptop showing wrong date or time needs to be corrected', id:'home_quick_35' }
         ]
         ]
         },
         {
         key: 'replacement', label: 'Replacement / Upgrade',
         emoji: '📦', color: 'primary',
         desc: 'Hardware/Software request, Upgrade, New setup',
         rows: [
         [
         { text:'Laptop Replacement', value:'Laptop needs replacement old one is damaged or not working', id:'home_quick_37' },
         { text:'Mouse Replacement', value:'Mouse is damaged need a replacement', id:'home_quick_60' },
         { text:'Keyboard Replacement', value:'Keyboard is damaged need a replacement', id:'home_quick_61' },
         { text:'New Monitor Request', value:'Need a new monitor or monitor replacement', id:'home_quick_62' }
         ]
         ]
         },
         {
         key: 'access_legacy', label: 'Access & Permissions',
         emoji: '🔒', color: 'primary',
         desc: 'System access, App access, Account Locked',
         rows: [
         [
         { text:'🔑 Access Request', value:'Need access to a system software or application', id:'home_quick_74' },
         { text:'Account Locked', value:'Account is locked cannot login to Windows or any account', id:'home_quick_55b' }
         ]
         ]
         },
         {
         key: 'printer_legacy', label: 'Printer & Peripheral',
         emoji: '🖨️', color: 'primary',
         desc: 'Printer, Mouse, Keyboard, USB, External devices',
         rows: [
         [
         { text:'Mouse Issue', value:'Mouse not working cursor not moving properly', id:'home_quick_77' },
         { text:'Keyboard Issue', value:'Laptop keyboard not working some keys not responding', id:'home_quick_7b' },
         { text:'USB Not Working', value:'USB port not working pendrive or device not detected', id:'home_quick_63b' }
         ]
         ]
         }
         ];

         // ── Auto-Fix mapping: which buttons can be auto-fixed on laptop ──────
 const AUTO_FIX_MAP = {
 // ── Performance ────────────────────────────────────────────────────────
 'home_quick_1' : { fixType: ['kill_heavy', 'clean_temp'], label: 'Laptop Speed Fix' },
 'home_quick_21': { fixType: ['kill_heavy'], label: 'Freezing Fix' },
 'home_quick_71': { fixType: ['kill_heavy', 'clean_temp'], label: 'Post-Update Fix' },
 'home_quick_4' : { fixType: ['fix_overheating'], label: '️ Overheating Fix' },
 'home_quick_38': { fixType: ['fix_overheating'], label: 'Fan/Heat Fix' },
 // ── Network ────────────────────────────────────────────────────────────
 'home_quick_11': { fixType: ['fix_wifi'], label: 'WiFi Reset' },
 'home_quick_44': { fixType: ['fix_wifi'], label: 'WiFi Reconnect Fix' },
 'home_quick_29': { fixType: ['fix_wifi'], label: 'Internet Speed Fix' },
 // ── Audio & Display ────────────────────────────────────────────────────
 'home_quick_9' : { fixType: ['fix_sound'], label: 'Sound Fix' },
 'home_quick_28': { fixType: ['fix_sound'], label: 'Speaker Fix' },
 'home_quick_46': { fixType: ['fix_sound'], label: 'Headphone Fix' },
 'home_quick_39': { fixType: ['fix_screen_flicker'], label: 'Screen Flicker Fix' },
 // ── Input Devices ──────────────────────────────────────────────────────
 'home_quick_7' : { fixType: ['fix_keyboard'], label: '⌨️ Keyboard Fix' },
 'home_quick_7b': { fixType: ['fix_keyboard'], label: '⌨️ Keyboard Fix' },
 'home_quick_72': { fixType: ['fix_keyboard'], label: 'Caps Lock Fix' },
 'home_quick_8' : { fixType: ['fix_touchpad'], label: '️ Touchpad Fix' },
 'home_quick_40': { fixType: ['fix_bluetooth'], label: 'Bluetooth Fix' },
 'home_quick_63': { fixType: ['fix_usb'], label: 'USB Fix' },
 'home_quick_63b': { fixType: ['fix_usb'], label: 'USB Fix' },
 // ── Camera & Mic ───────────────────────────────────────────────────────
 'home_quick_16': { fixType: ['fix_mic'], label: 'Microphone Fix' },
 'home_quick_20': { fixType: ['fix_camera'], label: 'Camera Fix' },
 // ── Software ───────────────────────────────────────────────────────────
 'home_quick_13': { fixType: ['fix_teams'], label: 'Teams Fix' },
 'home_quick_27': { fixType: ['fix_zoom'], label: '️ Zoom Fix' },
 'home_quick_31': { fixType: ['fix_browser'], label: 'Browser Fix' },
 'home_quick_53': { fixType: ['fix_browser'], label: 'App Crash Fix' },
 'home_quick_51': { fixType: ['fix_onedrive'], label: '☁️ OneDrive Fix' },
 'home_quick_58': { fixType: ['fix_onedrive'], label: '☁️ OneDrive Storage Fix' },
 'home_quick_54': { fixType: ['fix_printer'], label: '️ Printer Fix' },
 // ── Productivity ───────────────────────────────────────────────────────
 'home_quick_34': { fixType: ['fix_clipboard'], label: 'Copy-Paste Fix' },
 'home_quick_35': { fixType: ['fix_datetime'], label: 'Date/Time Fix' },
 'home_quick_30': { fixType: ['fix_sleep'], label: '⚡ Shutdown Fix' },
 'home_quick_64': { fixType: ['fix_sleep'], label: 'Sleep Fix' },
 // ── Security & Storage ─────────────────────────────────────────────────
 'home_quick_18': { fixType: ['clean_disk', 'clean_temp'], label: 'Storage Cleanup' },
 'home_quick_19': { fixType: ['fix_virus_scan'], label: 'Virus Scan' },
 'home_quick_57': { fixType: ['fix_virus_scan'], label: '️ Antivirus Fix' },
 };

 // ── Download Script mapping: 1-click .bat scripts hosted on server ───
 const PORTAL = process.env.API_BASE_URL || 'https://wiom-helpdesk-production.up.railway.app';
 const SCRIPT_MAP = {
 // ── Laptop Hardware & Performance ─────────────────────────────────────
 'home_quick_1' : { file: 'fix-slow-laptop.bat', label: 'Slow Laptop Fix' },
 'home_quick_3' : { file: 'fix-bluescreen.bat', label: 'Blue Screen Fix' },
 'home_quick_4' : { file: 'fix-overheating.bat', label: '️ Overheating Fix' },
 'home_quick_6' : { file: 'fix-black-screen.bat', label: '️ Black Screen Fix' },
 'home_quick_7' : { file: 'fix-keyboard.bat', label: '⌨️ Keyboard Fix' },
 'home_quick_7b': { file: 'fix-keyboard.bat', label: '⌨️ Keyboard Fix' },
 'home_quick_8' : { file: 'fix-touchpad.bat', label: '️ Touchpad Fix' },
 'home_quick_21': { file: 'fix-freezing.bat', label: '❄️ Freezing Fix' },
 'home_quick_30': { file: 'fix-sudden-shutdown.bat', label: '⚡ Sudden Shutdown Fix' },
 'home_quick_33': { file: 'fix-bluescreen.bat', label: 'Restart Loop Fix' },
 'home_quick_38': { file: 'fix-fan-noise.bat', label: 'Fan Noise Fix' },
 'home_quick_39': { file: 'fix-screen-flicker.bat', label: 'Screen Flicker Fix' },
 'home_quick_40': { file: 'fix-bluetooth.bat', label: 'Bluetooth Fix' },
 'home_quick_63': { file: 'fix-usb.bat', label: 'USB Fix' },
 'home_quick_63b': { file: 'fix-usb.bat', label: 'USB Fix' },
 'home_quick_64': { file: 'fix-sleep-wake.bat', label: 'Sleep/Wake Fix' },
 'home_quick_65': { file: 'fix-bluescreen.bat', label: 'Boot Error Fix' },
 'home_quick_66': { file: 'fix-touchscreen.bat', label: 'Touchscreen Fix' },
 'home_quick_67': { file: 'fix-hdmi.bat', label: '️ HDMI Fix' },
 'home_quick_68': { file: 'fix-sdcard.bat', label: 'SD Card Fix' },
 'home_quick_69': { file: 'fix-fingerprint.bat', label: 'Fingerprint Fix' },
 'home_quick_71': { file: 'fix-slow-laptop.bat', label: 'Post-Update Speed Fix' },
 'home_quick_72': { file: 'fix-capslock.bat', label: 'Caps Lock Fix' },
 // ── Internet & Network ────────────────────────────────────────────────
 'home_quick_11': { file: 'fix-wifi.bat', label: 'WiFi Fix' },
 'home_quick_26': { file: 'fix-wifi.bat', label: 'Hotspot Fix' },
 'home_quick_29': { file: 'fix-wifi.bat', label: 'Internet Speed Fix' },
 'home_quick_44': { file: 'fix-wifi.bat', label: 'WiFi Disconnect Fix' },
 'home_quick_45': { file: 'fix-browser.bat', label: 'Gmail Fix' },
 // ── Audio & Display ───────────────────────────────────────────────────
 'home_quick_9' : { file: 'fix-sound.bat', label: 'Sound Fix' },
 'home_quick_16': { file: 'fix-mic.bat', label: 'Microphone Fix' },
 'home_quick_17': { file: 'fix-hdmi.bat', label: '️ External Monitor Fix' },
 'home_quick_20': { file: 'fix-camera.bat', label: 'Camera Fix' },
 'home_quick_28': { file: 'fix-sound.bat', label: 'Speaker Fix' },
 'home_quick_46': { file: 'fix-headphone.bat', label: 'Headphone Fix' },
 'home_quick_47': { file: 'fix-projector.bat', label: '️ Projector Fix' },
 'home_quick_48': { file: 'fix-resolution.bat', label: '️ Resolution Fix' },
 'home_quick_49': { file: 'fix-video-call.bat', label: 'Video Call Fix' },
 // ── Software & Apps ───────────────────────────────────────────────────
 'home_quick_13': { file: 'fix-teams.bat', label: 'Teams Fix' },
 'home_quick_23': { file: 'fix-word-excel.bat', label: 'Word/Excel Fix' },
 'home_quick_24': { file: 'fix-windows-update.bat', label: 'Windows Update Fix' },
 'home_quick_27': { file: 'fix-zoom.bat', label: '️ Zoom Fix' },
 'home_quick_31': { file: 'fix-browser.bat', label: 'Browser Fix' },
 'home_quick_34': { file: 'fix-clipboard.bat', label: 'Copy-Paste Fix' },
 'home_quick_35': { file: 'fix-datetime.bat', label: 'Date/Time Fix' },
 'home_quick_51': { file: 'fix-onedrive.bat', label: '☁️ OneDrive Fix' },
 'home_quick_52': { file: 'fix-pdf.bat', label: 'PDF Fix' },
 'home_quick_53': { file: 'fix-app-crash.bat', label: 'App Crash Fix' },
 'home_quick_54': { file: 'fix-printer.bat', label: '️ Printer Fix' },
 // ── Security & Storage ────────────────────────────────────────────────
 'home_quick_18': { file: 'fix-storage.bat', label: 'Storage Cleanup' },
 'home_quick_19': { file: 'fix-virus-scan.bat', label: 'Virus Scan' },
 'home_quick_57': { file: 'fix-virus-scan.bat', label: '️ Antivirus Fix' },
 'home_quick_58': { file: 'fix-onedrive.bat', label: '☁️ OneDrive Storage Fix' },
 // ── Power & Boot ─────────────────────────────────────────────────────
 // home_quick_2 (Won't Turn On) intentionally excluded — can't run script on dead laptop
 'home_quick_5' : { file: 'fix-battery.bat', label: 'Battery Fix' },
 'home_quick_10': { file: 'fix-battery.bat', label: 'Charging Fix' },
 // ── WiFi Password & Website ───────────────────────────────────────────
 'home_quick_32': { file: 'fix-wifi-password.bat', label: 'WiFi Password Fix' },
 'home_quick_43': { file: 'fix-website-blocked.bat', label: 'Website Fix' },
 };

 // ── INTENT CLASSIFIER — classify before matching any script ─────────────────
 // Returns: { intent: 'incident'|'request'|'information'|'access'|'asset'|'security'|'unknown', confidence: 50|70|90 }
 // Auto-Fix scripts are ONLY shown for 'incident' intent with confidence >= 60
 const classifyIntent = (text) => {
   const t = text.toLowerCase();
   const words = t.trim().split(/\s+/).filter(Boolean);

   // SECURITY — virus, malware, phishing, spam email (receiving), fake/scam email, data theft, unauthorized, hacked
   // Note: "email spam mein ja rha" = email going to spam folder (incident, not security)
   if (/\b(virus|malware|phishing|phising|ransomware|data\s*leak|data\s*theft|suspicious|unauthorized|hacked|hack\s*ho|hack\s*gaya|credential|breach|fake\s*email|scam\s*email|someone\s*using|koi\s*aur.*use|account.*hack|hack.*account)\b/i.test(t))
     return { intent: 'security', confidence: 90 };
   // SECURITY — spam email received (not "email going to spam folder")
   if (/\bspam\s*email\b|\bemail.*spam.*aa|\bspam.*aa\s*rh/i.test(t) && !/\b(ja\s*rh|jata\s*h|going|folder)\b/i.test(t))
     return { intent: 'security', confidence: 90 };
   // SECURITY — "urgent security" keyword combo
   if (/\burgent\s+security\b|\bsecurity\s+urgent\b|\bsecurity\s+(issue|warning|alert)\b/i.test(t))
     return { intent: 'security', confidence: 90 };

   // ACCESS — check BEFORE request because "X access chahiye" is access, not generic request
   if (/\b(access\s*chahiye|access\s*de|permission\s*chahiye|role\s*chahiye|account\s*bana|account\s*banana|create\s*account|user\s*banana)\b/i.test(t))
     return { intent: 'access', confidence: 90 };
   // ACCESS — "X access chahiye" pattern (any app/system name before "access")
   if (/\b\w+\s+access\s+(chahiye|de|do|milega|lena|chahte)\b/i.test(t))
     return { intent: 'access', confidence: 90 };
   // ACCESS — admin rights
   if (/\b(admin\s*rights|admin\s*access|rights\s*chahiye|rights\s*de)\b/i.test(t))
     return { intent: 'access', confidence: 90 };

   // INFORMATION / HOW-TO — covers kaise/kise/kese/kase typos + "banana hai" = how-to
   if (/\b(kya\s*hai|kaise|kise|kese|kase|kaisey|kaise\s*karu|kaise\s*karte|kaise\s*hota|how\s*to|how\s*do|how\s*can|kaise\s*karein|batao|bataiye|password\s*kya|kya\s*hoga|samjhao|explain|tell\s*me|steps|process|guide|banana\s*hai|filter\s*banana)\b/i.test(t))
     return { intent: 'information', confidence: 90 };
   // INFORMATION — setup/scan karna hai for non-antivirus contexts (printer scan, vpn setup etc.)
   if (/\b(setup\s*karna\s*hai|scan\s*karna\s*hai)\b/i.test(t) && !/\b(antivirus|virus|malware|windows\s*security)\b/i.test(t))
     return { intent: 'information', confidence: 90 };

   // REQUEST — chahiye / need / install karna hai → never show Auto-Fix
   if (/\b(chahiye|ki\s*need|mangwana|de\s*do|milega|kharidna|buy|new\s*\w+\s*chahiye|naya\s*\w+\s*chahiye|lena\s*hai|request|order\s*karna|ki\s*zarurat|install\s*karna\s*hai|install\s*karo)\b/i.test(t))
     return { intent: 'request', confidence: 90 };

   // ASSET — replace/return/upgrade asset → never show Auto-Fix
   if (/\b(replace|upgrade|wapas\s*karna|wapas\s*do|return|asset\s*return|exit\s*me|transfer\s*karna|jama\s*karna)\b/i.test(t))
     return { intent: 'asset', confidence: 90 };

   // UNKNOWN — single-word with no specific IT keyword → too vague
   // Also covers common typos for detection
   const hasSpecificIT = /\b(wifi|wiffi|laptop|leptop|lptop|latop|laptoop|laotop|internet|bluetooth|bluetoth|bluethooth|keyboard|keybord|keyborad|keybrd|touchpad|mouse|screen|sceern|scren|scrren|display|camera|camra|webcam|mic|microfone|microphne|microphone|speaker|speakr|speeker|audio|printer|printe|printr|teams|tims|zoom|chrome|chrmo|chorme|crome|browser|password|passwrod|paswrod|windows|excel|word|onedrive|usb|battery|battry|battey|batr|charger|network|slow|hang|crash|virus|malware|headphone|headfone|projector|projekter|projetor|hdmi|monitor|monitr|moniter|fan|fingerprint|fingerpint|num\s*lock|numlock|caps\s*lock|capslock|scroll\s*lock|blurry|pixelated|laggy|application|antivirus)\b/i.test(t);
   if (words.length <= 1 && !hasSpecificIT)
     return { intent: 'unknown', confidence: 50 };
   if (words.length <= 3 && !hasSpecificIT)
     return { intent: 'unknown', confidence: 70 };

   // INCIDENT — specific IT problem with clear symptoms
   const hasSymptom = /\b(nahi\s*chal|nahi\s*khul|kaam\s*nahi|work\s*nahi|not\s*work|not\s*respond|not\s*responding|issue|problem|error|crash|slow|hang|band|kharab|nahi\s*ho|chal\s*nahi|boot\s*nahi|stuck|freeze|flickering|damage|blurry|pixelated|laggy)\b/i.test(t);
   if (hasSpecificIT && hasSymptom)
     return { intent: 'incident', confidence: 90 };
   if (hasSpecificIT)
     return { intent: 'incident', confidence: 70 };

   // Default: incident at medium confidence
   return { intent: 'incident', confidence: 70 };
 };

 // ── DM Script detector: Auto-Fix disabled ────────────────────────────
 const getScriptForText = (text) => null; // Auto-Fix disabled

 // ── DEAD CODE BLOCK REMOVED ── (was: 4-step intent-first pipeline)

 // ── Category color config ─────────────────────────────────────────────
 const CAT_COLORS = {
   laptop:      { icon: '🔵 💻', label: 'Laptop & Display',        desc: 'Screen · Battery · Keyboard · Audio · Camera and more' },
   network:     { icon: '🟢 🌐', label: 'Network & Internet',       desc: 'Wi-Fi · Internet Slow · Website and more' },
   software:    { icon: '🟣 ⚙️',  label: 'Software, Apps & Account', desc: 'Teams · Gmail · Password · Virus · Storage and more' },
   replacement: { icon: '🟠 🔄', label: 'Replacement / Upgrade',    desc: 'Laptop · Mouse · Keyboard · Monitor replacement' },
   access:      { icon: '🔴 🔒', label: 'Access & Permissions',     desc: 'Access Request · Account Locked' },
   printer:     { icon: '🩵 🖨️', label: 'Printer & Peripheral',    desc: 'Mouse · Keyboard · USB devices' },
 };

 // ── Build Home Tab blocks — Advanced Design ──────────────────────────────────
 const IT_TIPS = [
   '💡 Restart your laptop every week — it improves speed and reduces crashes.',
   '💡 Never share your password — every employee should have their own unique password.',
   '💡 WiFi slow? Move closer to the router — distance weakens the signal.',
   '💡 Browser running slow? Press Ctrl+Shift+Del to clear the cache — it will speed up significantly.',
   '💡 When charging, keep your laptop on a hard surface — soft surfaces cause the battery to overheat.',
   '💡 Do not click links in suspicious emails — report them to IT first.',
   '💡 Camera not working? Go to Settings → Privacy → Camera and turn it ON.',
   '💡 To install any software, raise a ticket with IT — admin rights are required.',
   '💡 Laptop screen too dim? Use Fn+F5 or Fn+F6 to increase brightness.',
   '💡 PDF not opening? Drag and drop it into Chrome — it will open directly.',
   '💡 Excel running slow? Go to File → Options → Add-ins → COM Add-ins → uncheck all.',
   '💡 Printer offline? Restart the printer first, then restart your laptop.',
   '💡 WIOM WiFi password: spartans500  |  Saket office: Password@12345',
   '💡 Laptop overheating? Place it on a hard flat surface — do not block the ventilation holes.',
   '💡 Google Calendar sync issue? Clear Chrome cache — press Ctrl+Shift+Del.',
 ];

 const buildHomeBlocks = (emp, myTickets, expandedSet, stats = {}) => {
   const blocks = [];
   const firstName = (emp?.name || emp?.empName || 'there').split(' ')[0];

   const istMins = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes()) + 330;
   const istHour = Math.floor(istMins / 60) % 24;
   const greeting = istHour < 12 ? 'Good morning' : istHour < 17 ? 'Good afternoon' : 'Good evening';

   const tickets = myTickets || [];
   const openCount    = tickets.filter(t => t.status === 'Open').length;
   const pendingCount = tickets.filter(t => ['In Progress','Waiting'].includes(t.status)).length;

   // ── 1. Header ─────────────────────────────────────────────────────────
   blocks.push({
     type: 'section',
     text: { type: 'mrkdwn', text: `*${greeting}, ${firstName}! 👋*\n_Welcome to WIOM IT Helpdesk — Get instant support._` },
   });

   // ── 5. Quick Actions ──────────────────────────────────────────────────
   blocks.push({ type: 'divider' });
   blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*⚡ Quick Actions*' } });
   blocks.push({ type: 'actions', elements: [
     { type: 'button', text: { type: 'plain_text', text: '🎫 Raise Ticket', emoji: true }, action_id: 'vague_pick_create_ticket', value: 'create ticket', style: 'primary' },
     { type: 'button', text: { type: 'plain_text', text: '📶 WiFi Fix', emoji: true }, action_id: 'home_quick_11', value: 'WiFi not working no internet connection' },
   ]});
   blocks.push({ type: 'actions', elements: [
     { type: 'button', text: { type: 'plain_text', text: '🐢 Laptop Slow', emoji: true }, action_id: 'home_quick_1', value: 'My laptop is very slow what should I do' },
     { type: 'button', text: { type: 'plain_text', text: '📶 WiFi Password', emoji: true }, action_id: 'home_quick_wifi_pwd_quick', value: 'wifi_password' },
   ]});

   // ── 6. All Categories ─────────────────────────────────────────────────
   blocks.push({ type: 'divider' });
   blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*📂 All Categories*' } });
   blocks.push({ type: 'actions', elements: [
     { type: 'button', text: { type: 'plain_text', text: '🚨 Emergency', emoji: true }, action_id: 'cat_emergency', value: 'emergency', style: 'danger' },
     { type: 'button', text: { type: 'plain_text', text: '📦 Asset Requests', emoji: true }, action_id: 'cat_asset', value: 'asset', style: 'primary' },
     { type: 'button', text: { type: 'plain_text', text: '💻 Device & Hardware', emoji: true }, action_id: 'cat_laptop', value: 'laptop' },
   ]});
   blocks.push({ type: 'actions', elements: [
     { type: 'button', text: { type: 'plain_text', text: '🌐 Network & Internet', emoji: true }, action_id: 'cat_network', value: 'network' },
     { type: 'button', text: { type: 'plain_text', text: '📊 Microsoft Office', emoji: true }, action_id: 'cat_msoffice', value: 'office' },
     { type: 'button', text: { type: 'plain_text', text: '🌍 Browser & Apps', emoji: true }, action_id: 'cat_browser', value: 'browser' },
   ]});
   blocks.push({ type: 'actions', elements: [
     { type: 'button', text: { type: 'plain_text', text: '📧 Email & Comm', emoji: true }, action_id: 'cat_email', value: 'email' },
     { type: 'button', text: { type: 'plain_text', text: '🔐 Access & Identity', emoji: true }, action_id: 'cat_access', value: 'access' },
     { type: 'button', text: { type: 'plain_text', text: '☁️ Cloud & Storage', emoji: true }, action_id: 'cat_cloud', value: 'cloud' },
   ]});

   // ── 7. Recent Tickets ─────────────────────────────────────────────────
   if (tickets.length > 0) {
     blocks.push({ type: 'divider' });
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🎫 Recent Tickets*` } });
     const statEmoji = { 'Open': '🔴', 'In Progress': '🟡', 'Waiting': '🟠', 'Resolved': '✅', 'Closed': '⚫' };
     for (const t of tickets.slice(0, 3)) {
       const hrs     = Math.floor((Date.now() - new Date(t.createdAt)) / 3600000);
       const timeStr = hrs < 24 ? hrs + 'h ago' : Math.floor(hrs / 24) + 'd ago';
       blocks.push({
         type: 'section',
         text: { type: 'mrkdwn', text: `\`${t.ticketId}\`  ${statEmoji[t.status]||'🔵'} *${t.status}*\n_${(t.description||'').substring(0,65)}_\n📅 ${timeStr}` }
       });
     }
   }

   // ── 8. Announcements ──────────────────────────────────────────────────
   const announcement = process.env.IT_ANNOUNCEMENT;
   if (announcement) {
     blocks.push({ type: 'divider' });
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*📢 Announcements*` } });
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: announcement } });
   }

   // ── 9. IT Tip ─────────────────────────────────────────────────────────
   const tipOfDay = IT_TIPS?.length > 0 ? IT_TIPS[Math.floor(Date.now() / 86400000) % IT_TIPS.length] : null;
   if (tipOfDay) {
     blocks.push({ type: 'divider' });
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*📚 IT Tip of the Day*\n${tipOfDay}` } });
   }

   // ── 10. Admin Tools (only visible to IT Admin) ────────────────────────
   if (emp?.slackUserId === process.env.ADMIN_SLACK_USER_ID) {
     blocks.push({ type: 'divider' });
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*🔧 Admin Tools*' } });
     blocks.push({ type: 'actions', elements: [
       { type: 'button', text: { type: 'plain_text', text: '👥 Set Employee Manager', emoji: true }, action_id: 'admin_set_manager_open', value: 'open' },
       { type: 'button', text: { type: 'plain_text', text: '📢 Ask All for Manager Info', emoji: true }, action_id: 'admin_blast_manager_ask', value: 'blast', style: 'primary' },
     ]});
   }

   return blocks;
 };

         // ── FEATURE 5: Office hours check (IST = UTC+5:30) ────────────────────
 const isOfficeHours = () => {
 const now = new Date();
 const istMins = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
 const istHour = Math.floor(istMins / 60) % 24;
 return istHour >= 9 && istHour < 19; // 9AM7PM IST
 };

 // ── Shared greeting blocks — same on Home Tab DM and DM greeting ────────────
 // Used everywhere: app_home_opened, hi/hello, home_open_dm, home_chat_ai
 const buildGreetingBlocks = (firstName = 'there') => ([
   {
     type: 'section',
     text: { type: 'mrkdwn', text: `*Hey ${firstName}! 👋*\n\n*WIOM IT Helpdesk*\nLaptop, WiFi, software, password — tell me your problem and I'll help you right away!\n\n_Select a category below 👇_` },
    },
   { type: 'divider' },
   {
     type: 'actions',
     elements: [
       { type: 'button', text: { type: 'plain_text', text: '💻  Laptop', emoji: true }, action_id: 'dm_cat_laptop', value: 'laptop', style: 'primary' },
       { type: 'button', text: { type: 'plain_text', text: '📶  WiFi / Net', emoji: true }, action_id: 'dm_cat_network', value: 'network' },
       { type: 'button', text: { type: 'plain_text', text: '⚙️  Software', emoji: true }, action_id: 'dm_cat_software', value: 'software' },
       { type: 'button', text: { type: 'plain_text', text: '🔑  Password', emoji: true }, action_id: 'dm_cat_access', value: 'access' },
     ]
   },
   {
     type: 'actions',
     elements: [
       { type: 'button', text: { type: 'plain_text', text: '📦  Replacement', emoji: true }, action_id: 'dm_cat_replacement', value: 'replacement' },
       { type: 'button', text: { type: 'plain_text', text: '📋  My Tickets', emoji: true }, action_id: 'dm_my_tickets', value: 'my_tickets' },
       { type: 'button', text: { type: 'plain_text', text: '📞  Contact IT', emoji: true }, action_id: 'home_contact_it', value: 'contact_it' },
     ]
   },
   { type: 'context', elements: [{ type: 'mrkdwn', text: '_24/7 available — Anytime, Anywhere_' }] }
 ]);

 // ── Shared: "Issue Resolved" modal view — same for every problem ────────────
 const resolvedModalView = () => ({
   type: 'modal',
   title: { type: 'plain_text', text: 'Issue Resolved!', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [{
     type: 'section',
     text: { type: 'mrkdwn', text:
       '✅ *Great! Issue resolved!*\n\n' +
       '_You can close this window. For any other IT problem, go to the Home tab._'
     }
   }]
 });

 // ── Shared: "Creating Ticket" loading modal ──────────────────────────────────
 const creatingTicketModalView = () => ({
   type: 'modal',
   title: { type: 'plain_text', text: 'Creating Ticket...', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '_Creating your ticket — one moment..._' }}]
 });

 // ── Shared: Notes form before ticket creation ─────────────────────────────────
 const ticketNotesFormView = (description, priority) => ({
   type: 'modal',
   callback_id: 'quick_ticket_notes_modal',
   private_metadata: JSON.stringify({ description: description || 'IT support needed', priority: priority || 'Medium' }),
   title: { type: 'plain_text', text: '🎫 Create Ticket', emoji: true },
   submit: { type: 'plain_text', text: 'Submit Ticket', emoji: true },
   close: { type: 'plain_text', text: 'Cancel', emoji: true },
   blocks: [
     // Issue summary — shown as context chip
     { type: 'section', text: { type: 'mrkdwn', text: `*📋 Issue Detected:*\n>${(description||'IT support needed').substring(0, 120)}` }},
     { type: 'divider' },
     // Optional notes
     { type: 'input', block_id: 'notes_block',
       optional: true,
       label: { type: 'plain_text', text: '📝 Additional Details (Optional)', emoji: true },
       hint: { type: 'plain_text', text: 'More details = faster resolution!', emoji: true },
       element: { type: 'plain_text_input', action_id: 'notes_input', multiline: true,
         placeholder: { type: 'plain_text', text: 'How long has this been happening? Any error message? Which app/device?' }
       }
     },
   ]
 });

 // ── Shared: "Ticket Created" success modal — same for every problem ──────────
 const ticketCreatedModalView = (result) => ({
   type: 'modal',
   title: { type: 'plain_text', text: 'Ticket Created!', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [{
     type: 'section',
     text: { type: 'mrkdwn', text:
       '*IT Ticket Created!*\n\n' +
       `*Ticket ID:* \`${result.ticketId}\`\n\n` +
       'The IT team will reach out to you shortly.\n_You can close this window._'
     }
   }]
 });

 // ── Shared: "Resolved" DM message — same for every problem ──────────────────
 const resolvedDMBlocks = () => ([
   { type: 'section', text: { type: 'mrkdwn', text:
     '✅ *Great! Issue resolved!*\n\n' +
     '_For any other IT problem, go to the Home tab and select a category._'
   }},
   { type: 'actions', elements: [
     { type: 'button', text: { type: 'plain_text', text: '🏠 Home', emoji: true }, action_id: 'go_home_btn', value: 'home', style: 'primary' }
   ]}
 ]);

 // ── FEATURE 2: Format reply for Slack mrkdwn ─────────────────────────
 const formatForSlack = (text) => {
   if (!text) return '';
   return text
     .replace(/\*\*(.*?)\*\*/g, '*$1*')          // **bold** → *bold* (markdown → Slack)
     .replace(/^#{1,3}\s+(.+)$/gm, '*$1*')        // ### Header → *Header*
     .replace(/\bStep (\d+):\s*/gi, '\n$1. ')     // "Step 1:" → "1." numbered format
     .replace(/^[\n\s]+/, '')                      // Remove leading whitespace
     .replace(/\n{3,}/g, '\n\n')                  // Max 2 blank lines
     .slice(0, 2900)                               // Slack section block limit safety
     .trim();
 };

 // ── Detect reply mode — decides which buttons to show ───────────────────────
 // 'ticket' → AI wants user to confirm ticket (only IT Ticket button)
 // 'steps'  → AI gave fix steps OR any other reply (Ho gaya + IT Ticket both show)
 // NOTE: 'question' mode REMOVED — Messages Tab is OFF so users can't type replies.
 //       Showing no buttons = user completely stuck. Always show action buttons.
 const detectReplyMode = (reply, shouldCreateTicket) => {
   const lines = reply.trim().split('\n').filter(l => l.trim());
   const hasNumberedSteps = /^\d+[\.\)]\s/m.test(reply);
   const hasBullets = /^[•\-\*]\s/m.test(reply);
   const hasRealSteps = hasNumberedSteps || hasBullets;

   // Real numbered/bulleted steps → 'steps'
   if (hasRealSteps) return 'steps';

   // No real steps but ticket ask → 'ticket' only (physical damage, installation, etc.)
   if (shouldCreateTicket) return 'ticket';

   // Everything else → 'steps' (always show both buttons — user must be able to act)
   // Previously returned 'question' here which showed NO buttons — fatal UX bug
   return 'steps';
 };

 // ── Build DM response blocks — smart: no buttons for questions, buttons for steps ──
 const buildDMBlocks = (problemText, formattedAnswer, urgency = 'Medium', mode = 'steps') => {
   const blocks = [];

   // 1️⃣ ANSWER TEXT
   blocks.push({ type: 'section', text: { type: 'mrkdwn', text: formattedAnswer } });

   // 2️⃣ SCRIPT BUTTON — only for steps mode (not for questions or ticket confirms)
   if (mode === 'steps') {
     const script = getScriptForText(problemText);
     if (script) {
       blocks.push({
         type: 'actions',
         elements: [{
           type: 'button',
           text: { type: 'plain_text', text: `⬇️ ${script.label}`, emoji: true },
           url: `${PORTAL}/scripts/${script.file}`,
           action_id: 'script_download_btn',
           style: 'primary',
           value: (problemText || '').substring(0, 100)
         }]
       });
     }
   }

   // 3️⃣ ACTION BUTTONS — based on mode
   // NOTE: 'question' mode removed — Messages Tab OFF = users cannot type, always show buttons

   blocks.push({ type: 'divider' });

   if (mode === 'ticket') {
     // Only ticket confirm button
     blocks.push({
       type: 'actions',
       elements: [{
         type: 'button',
         text: { type: 'plain_text', text: '🎫  Create IT Ticket', emoji: true },
         action_id: 'quick_ticket_btn',
         style: 'danger',
         value: urgency,
         confirm: {
           title: { type: 'plain_text', text: 'Create Ticket?' },
           text: { type: 'mrkdwn', text: '_IT team will be alerted — they will fix it directly._' },
           confirm: { type: 'plain_text', text: '✅ Yes, Create!' },
           deny: { type: 'plain_text', text: 'Cancel' }
         }
       }]
     });
   } else {
     // Steps mode — Done + Ticket + Wrong Answer feedback
     blocks.push({
       type: 'actions',
       elements: [
         {
           type: 'button',
           text: { type: 'plain_text', text: '✅  Done!', emoji: true },
           action_id: 'resolved_yes_btn',
           style: 'primary',
           value: urgency
         },
         {
           type: 'button',
           text: { type: 'plain_text', text: '🎫  Create IT Ticket', emoji: true },
           action_id: 'quick_ticket_btn',
           style: 'danger',
           value: urgency,
           confirm: {
             title: { type: 'plain_text', text: 'Create Ticket?' },
             text: { type: 'mrkdwn', text: '_IT team will be alerted — they will fix it directly._' },
             confirm: { type: 'plain_text', text: '✅ Yes, Create!' },
             deny: { type: 'plain_text', text: 'Cancel' }
           }
         },
         {
           type: 'button',
           text: { type: 'plain_text', text: "❌  Didn't Work", emoji: true },
           action_id: 'wrong_answer_btn',
           value: problemText || ''
         }
       ]
     });
   }

   return blocks;
 };

 // ── Build ticket-only prompt blocks (after 2+ failures) ─────────────────────
 const buildAutoTicketBlocks = (msg) => ([
   { type: 'section', text: { type: 'mrkdwn', text: msg }},
   { type: 'divider' },
   { type: 'actions', elements: [
     {
       type: 'button',
       text: { type: 'plain_text', text: '🎫  Create IT Ticket', emoji: true },
       action_id: 'quick_ticket_btn',
       style: 'danger',
       confirm: {
         title: { type: 'plain_text', text: 'Create Ticket?' },
         text: { type: 'mrkdwn', text: '_IT team will come to you directly — they will personally fix it._' },
         confirm: { type: 'plain_text', text: '✅ Yes, Create!' },
         deny: { type: 'plain_text', text: 'Cancel' }
       }
     },
     {
       type: 'button',
       text: { type: 'plain_text', text: '🔄  Try Again', emoji: true },
       action_id: 'not_resolved_btn',
       value: 'retry'
     }
   ]}
 ]);

 // ── FEATURE 1: Load/create MongoDB conversation session ───────────────
 const getSlackSession = async (slackUserId, emp) => {
 const cutoff = new Date(Date.now() - 24 * 3600000); // 24h window
 let conv = await Conversation.findOne({
 slackUserId,
 source : 'slack',
 resolved: false,
 lastActive: { $gte: cutoff }
 }).sort({ lastActive: -1 });

 if (!conv) {
 conv = new Conversation({
 sessionId: `slack-${slackUserId}-${Date.now()}`,
 empId : emp.empId,
 empName : emp.empName,
 source : 'slack',
 slackUserId,
 messages : []
 });
 }
 return conv;
 };

 // ── Employee cache (5 min TTL) — avoids repeated MongoDB calls ────────
 const empCache = new Map();
 const EMP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

 const lookupEmployee = async (slackUserId, client) => {
 // Serve from cache if fresh
 const cached = empCache.get(slackUserId);
 if (cached && (Date.now() - cached.ts) < EMP_CACHE_TTL) return cached.data;

 try {
 let dbEmp = await Employee.findOne({ slackUserId }).lean();
 if (dbEmp) {
 const data = { empId: dbEmp.empId, empName: dbEmp.name, email: dbEmp.email,
 dept: dbEmp.department, floor: dbEmp.floor,
 laptop: dbEmp.laptop, laptopSN: dbEmp.laptopSN };
 empCache.set(slackUserId, { data, ts: Date.now() });
 return data;
 }
 const profile = await client.users.info({ user: slackUserId });
 const email = profile.user?.profile?.email;
 const name = profile.user?.profile?.real_name || profile.user?.name;
 if (email) dbEmp = await Employee.findOne({ email: email.toLowerCase() }).lean();
 if (!dbEmp && name) dbEmp = await Employee.findOne({ name: { $regex: name.split(' ')[0], $options: 'i' } }).lean();
 if (dbEmp && !dbEmp.slackUserId) {
 Employee.findByIdAndUpdate(dbEmp._id, { slackUserId }).catch(() => {});
 }
 const data = dbEmp
 ? { empId: dbEmp.empId, empName: dbEmp.name, email: dbEmp.email,
 dept: dbEmp.department, floor: dbEmp.floor,
 laptop: dbEmp.laptop, laptopSN: dbEmp.laptopSN }
 : { empId: slackUserId, empName: name || 'Employee', email, dept: 'Unknown' };
 // Prevent memory leak: cap empCache at 500 entries
 if (empCache.size >= 500) { const old = [...empCache.keys()].slice(0, 100); old.forEach(k => empCache.delete(k)); }
 empCache.set(slackUserId, { data, ts: Date.now() });
 return data;
 } catch {
 return { empId: slackUserId, empName: 'Employee', email: null, dept: 'Unknown' };
 }
 };

 // ── Notify admin ──────────────────────────────────────────────────────
 const notifyAdmin = async (client, ticket, emp) => {
 try {
 const adminId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 if (!adminId || adminId === 'FILL_KARO') return;
 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 const priColor = { Critical:'#ef4444', High:'#f59e0b', Medium:'#3b82f6', Low:'#10b981' };
 await client.chat.postMessage({
 channel: adminId,
 text: `${priEmoji[ticket.priority]||''} New Ticket: ${ticket.ticketId} ${emp.empName}`,
 attachments: [{
 color: priColor[ticket.priority] || '#3b82f6',
 blocks: [
 { type:'section', fields:[
 { type:'mrkdwn', text:`* Ticket ID*\n\`${ticket.ticketId}\`` },
 { type:'mrkdwn', text:`* Employee*\n${emp.empName}` },
 { type:'mrkdwn', text:`*${priEmoji[ticket.priority]||''} Priority*\n${ticket.priority}` },
 { type:'mrkdwn', text:`* Category*\n${ticket.category||'Other'}` }
 ]},
 { type:'section', text:{ type:'mrkdwn', text:`* Issue:*\n${ticket.description}` }},
 { type:'context', elements:[{ type:'mrkdwn', text:`Category: ${ticket.category} | ${emp.dept||'Unknown Dept'}` }]}
 ]
 }]
 });
 } catch (err) {
 console.error('Admin DM error:', err.message);
 }
 };

 // ── Create ticket directly in MongoDB (no HTTP call needed) ──────────────
 const SAJAN_ID = (process.env.ADMIN_SLACK_USER_ID || '').trim() || 'U08K2LXAN5Q';

 const createTicketSlack = async (data) => {
 try {
   const { empId, empName, empEmail, empDept, empFloor, laptop,
           category, priority, description, source, slackUserId,
           skipDuplicateCheck } = data;

   if (!empId || !description) {
     console.error('[createTicketSlack] missing empId or description');
     return null;
   }

   if (!skipDuplicateCheck) {
     const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
     const existing = await Ticket.findOne({
       empId : empId.toString().toUpperCase(),
       status: { $in: ['Open', 'In Progress'] },
       createdAt: { $gte: thirtyMinAgo }
     });
     if (existing) {
       console.log('[createTicketSlack] duplicate found:', existing.ticketId);
       return { _duplicate: true, ticket: existing, message: 'Duplicate ticket' };
     }
   }

   const validSources = ['slack','slack-emergency','web','whatsapp','manual'];
   const ticket = await Ticket.create({
     empId      : empId.toString().toUpperCase(),
     empName    : empName || empId.toString(),
     empEmail, empDept, empFloor, laptop,
     category   : category || 'Other',
     priority   : priority || 'Medium',
     description,
     source     : validSources.includes(source) ? source : 'slack',
     slackUserId,
     aiTried    : true
   });

   Employee.findOneAndUpdate(
     { empId: empId.toString().toUpperCase() },
     { $inc: { totalTickets: 1 }, lastTicket: new Date() }
   ).catch(() => {});

   console.log('[createTicketSlack] ✅ created:', ticket.ticketId, '| empId:', empId, '| cat:', ticket.category);
   return ticket;
 } catch (err) {
   console.error('[createTicketSlack] ❌ error:', err.message, '| empId:', data.empId, '| cat:', data.category, '| src:', data.source);
   slackApp.client.chat.postMessage({ channel: SAJAN_ID, text: `❌ *Ticket create FAIL*\nError: \`${err.message}\`\nempId: ${data.empId} | category: ${data.category} | source: ${data.source}` }).catch(()=>{});
   return null;
 }
 };

 // ── /helpdesk command ─────────────────────────────────────────────────
 slackApp.command('/helpdesk', async ({ command, ack, respond, client }) => {
 await ack();
 const userId = command.user_id;
 const text = command.text?.trim() || '';

 if (!text) {
 await respond({ response_type: 'ephemeral', blocks:[
 { type:'section', text:{ type:'mrkdwn', text:'* WIOM IT Helpdesk*\nDescribe your IT problem!\n\n*Examples:*\n `/helpdesk wifi not working`\n `/helpdesk laptop is slow`\n `/helpdesk gmail not opening`\n\n_To view your tickets:_ `/helpdesk status`' }}
 ], text:'WIOM IT Helpdesk — describe your problem' });
 return;
 }

 // ── /helpdesk status ────────────────────────────────────────────────
 if (text.toLowerCase() === 'status' || text.toLowerCase() === 'my tickets') {
 const emp = await lookupEmployee(userId, client);
 const tickets = await Ticket.find({
 $or: [{ empId: emp.empId }, { slackUserId: userId }],
 status: { $nin: ['Closed'] }
 }).sort({ createdAt: -1 }).limit(5);

 if (!tickets.length) {
 await respond({ response_type: 'ephemeral', text: 'No open tickets! Everything looks good.' });
 return;
 }

 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 const statEmoji = { Open:'⏳', 'In Progress':'', Waiting:'⏸', Resolved:'✅', Closed:'' };
 const blocks = [
 { type:'section', text:{ type:'mrkdwn', text:`* Your Tickets (${tickets.length})*` }},
 { type:'divider' }
 ];
 tickets.forEach(t => {
 const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
 blocks.push({ type:'section', fields:[
 { type:'mrkdwn', text:`*\`${t.ticketId}\`*\n${priEmoji[t.priority]||''} ${t.priority}` },
 { type:'mrkdwn', text:`*${statEmoji[t.status]||'⏳'} ${t.status}*\n${hrs}h ago` }
 ]});
 blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`_${(t.description||'').substring(0,70)}..._` }]});
 });
 await respond({ response_type: 'ephemeral', text: `Your ${tickets.length} ticket(s)`, blocks });
 return;
 }

 await respond({ text: '_Thinking..._ one moment!', response_type: 'ephemeral' });

 const emp = await lookupEmployee(userId, client);
 const conv = await getSlackSession(userId, emp);
 conv.messages.push({ role: 'user', content: text });

 try {
 const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(
 conv.messages,
 { empId: emp.empId, empName: emp.empName, source: 'slack',
 laptop: emp.laptop, laptopSN: emp.laptopSN, dept: emp.dept, floor: emp.floor }
 );
 conv.messages.push({ role: 'assistant', content: reply });
 await conv.save();

 const formattedReply = formatForSlack(reply);
 const blocks = [{ type:'section', text:{ type:'mrkdwn', text: formattedReply }}];

 if (shouldCreateTicket && ticketData) {
 const result = await createTicketSlack({
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
 empDept: emp.dept, empFloor: emp.floor,
 laptop: emp.laptop, laptopSN: emp.laptopSN,
 ...ticketData, description: ticketData.description || text,
 source: 'slack', slackUserId: userId
 });
 if (result?._duplicate) {
 blocks.push({ type:'divider' });
 blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`⚠️ ${result.message}` }]});
 } else if (result) {
 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 blocks.push({ type:'divider' });
 blocks.push({ type:'section', fields:[
 { type:'mrkdwn', text:`*✅ Ticket Created:*\n\`${result.ticketId}\`` },
 { type:'mrkdwn', text:`*${priEmoji[result.priority]||''} Priority:*\n${result.priority}` }
 ]});
 blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team has been alerted ` }]});
 await notifyAdmin(client, result, emp);
 }
 }

 await respond({ response_type: 'ephemeral', text: reply, blocks });
 } catch (err) {
 console.error('Slack /helpdesk error:', err.message);
 await respond({ text: '❌ An error occurred. Please try again later.', response_type: 'ephemeral' });
 }
 });

 // ── /ticket command Quick modal ticket creation ─────────────────────
 slackApp.command('/ticket', async ({ command, ack, client }) => {
 await ack();
 try {
 await client.views.open({
 trigger_id: command.trigger_id,
 view: {
 type : 'modal',
 callback_id: 'ticket_modal',
 title : { type:'plain_text', text:'New IT Ticket', emoji:true },
 submit : { type:'plain_text', text:'Submit Ticket ✅', emoji:true },
 close : { type:'plain_text', text:'Cancel', emoji:true },
 blocks : [
 {
 type : 'input',
 block_id: 'description_block',
 label : { type:'plain_text', text:'Describe your problem:', emoji:true },
 element : {
 type : 'plain_text_input',
 action_id : 'description_input',
 multiline : true,
 min_length : 10,
 placeholder: { type:'plain_text', text:'e.g. Laptop not turning on, WiFi not working, Forgot password...' }
 }
 },
 {
 type : 'input',
 block_id: 'category_block',
 label : { type:'plain_text', text:'Category', emoji:true },
 element : {
 type : 'static_select',
 action_id : 'category_input',
 placeholder: { type:'plain_text', text:'Select a category' },
 options : [
 { text:{ type:'plain_text', text:'Hardware - Laptop, keyboard, mouse, screen' }, value:'Hardware' },
 { text:{ type:'plain_text', text:'Software - App, Windows, Office' }, value:'Software' },
 { text:{ type:'plain_text', text:'Network - WiFi, internet' }, value:'Network' },
 { text:{ type:'plain_text', text:'Account - Password, login, email' }, value:'Account' },
 { text:{ type:'plain_text', text:'Purchase - New equipment request' }, value:'Purchase' },
 { text:{ type:'plain_text', text:'❓ Other - Something else' }, value:'Other' }
 ]
 }
 },
 ]
 }
 });
 } catch (err) {
 console.error('/ticket modal open error:', err.message);
 }
 });

 // ── /ticket modal submission ───────────────────────────────────────────
 slackApp.view('ticket_modal', async ({ ack, body, view, client }) => {
 await ack();
 const userId = body.user.id;
 try {
 const vals = view.state.values;
 const description = vals.description_block.description_input.value;
 const category = vals.category_block.category_input.selected_option?.value || 'Other';
 const priority = 'Medium';

 const emp = await lookupEmployee(userId, client);

 const result = await createTicketSlack({
 empId : emp.empId, empName : emp.empName, empEmail: emp.email,
 empDept: emp.dept, empFloor: emp.floor,
 laptop : emp.laptop, laptopSN: emp.laptopSN,
 description, category, priority,
 source: 'slack', slackUserId: userId
 });

 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };

 if (result?._duplicate) {
 await client.chat.postMessage({
 channel: userId,
 text : `⚠️ ${result.message}`
 });
 } else if (result) {
 await client.chat.postMessage({
 channel: userId,
 text : `Ticket ${result.ticketId} created!`,
 blocks : [
 { type:'header', text:{ type:'plain_text', text:'✅ Ticket Created Successfully!', emoji:true }},
 { type:'section', fields:[
 { type:'mrkdwn', text:`*Ticket ID:*\n\`${result.ticketId}\`` },
 { type:'mrkdwn', text:`*${priEmoji[result.priority]||''} Priority:*\n${result.priority}` },
 { type:'mrkdwn', text:`*Category:*\n${result.category}` },
 { type:'mrkdwn', text:`*Status:*\nOpen` }
 ]},
 { type:'section', text:{ type:'mrkdwn', text:`*Problem:*\n${description}` }},
 { type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team has been notified | Track: type *my tickets*` }]}
 ]
 });
 await notifyAdmin(client, result, emp);
 console.log(`Ticket ${result.ticketId} created via /ticket modal by ${emp.empName}`);
 } else {
 await client.chat.postMessage({
 channel: userId,
 text : '❌ There was a problem creating your ticket. Please try again or contact IT directly.'
 });
 }
 } catch (err) {
 console.error('/ticket modal submit error:', err.message);
 try {
 await client.chat.postMessage({
 channel: userId,
 text : '❌ Error creating ticket. Please try again or contact IT Helpdesk.'
 });
 } catch {}
 }
 });

 // ── /broadcast — Admin sends message to all employees ─────────────────────
 slackApp.command('/broadcast', async ({ command, ack, client }) => {
 await ack();
 const adminId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 // BUG-06 fix: deny if adminId not configured OR user is not the admin
 // Flipped logic — default is DENY, not allow
 if (!adminId || adminId === 'FILL_KARO' || command.user_id !== adminId) {
 await client.chat.postEphemeral({
 channel: command.channel_id, user: command.user_id,
 text: '❌ Only IT admin can send broadcasts!'
 });
 return;
 }
 // Open modal to compose broadcast
 await client.views.open({
 trigger_id: command.trigger_id,
 view: {
 type: 'modal',
 callback_id: 'broadcast_modal',
 title: { type: 'plain_text', text: '📢 Broadcast Message' },
 submit: { type: 'plain_text', text: 'Send to All' },
 close: { type: 'plain_text', text: 'Cancel' },
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: '*This message will be sent to ALL employees via Slack DM!* 📢' }},
 { type: 'input', block_id: 'msg_block', label: { type: 'plain_text', text: 'Message' },
 element: { type: 'plain_text_input', action_id: 'msg_input', multiline: true,
 placeholder: { type: 'plain_text', text: 'e.g. Server maintenance tonight 11pm-1am. Save your work!' }}},
 { type: 'input', block_id: 'type_block', label: { type: 'plain_text', text: 'Type' }, optional: true,
 element: { type: 'static_select', action_id: 'type_input',
 options: [
 { text: { type: 'plain_text', text: '📢 Announcement' }, value: 'announcement' },
 { text: { type: 'plain_text', text: '⚠️ Warning/Alert' }, value: 'warning' },
 { text: { type: 'plain_text', text: '🔧 Maintenance' }, value: 'maintenance' },
 { text: { type: 'plain_text', text: '✅ IT Update' }, value: 'update' },
 ]
 }
 }
 ]
 }
 });
 });

 // Broadcast modal submit
 slackApp.view('broadcast_modal', async ({ body, ack, client }) => {
 await ack();
 const vals = body.view.state.values;
 const message = vals.msg_block.msg_input.value;
 const msgType = vals.type_block?.type_input?.selected_option?.value || 'announcement';
 const typeEmoji = { announcement: '📢', warning: '⚠️', maintenance: '🔧', update: '✅' };
 const emoji = typeEmoji[msgType] || '📢';
 const typeLabel = { announcement: 'Announcement', warning: 'Alert', maintenance: 'Maintenance', update: 'IT Update' };

 try {
 const Employee = require('./models/Employee');
 const employees = await Employee.find({ slackUserId: { $exists: true, $nin: [null, ''] } }).lean();
 let sent = 0, failed = 0;
 for (const emp of employees) {
 try {
 await client.chat.postMessage({
 channel: emp.slackUserId,
 text: `${emoji} IT ${typeLabel[msgType]}: ${message}`,
 blocks: [
 { type: 'header', text: { type: 'plain_text', text: `${emoji} IT ${typeLabel[msgType]}`, emoji: true }},
 { type: 'section', text: { type: 'mrkdwn', text: message }},
 { type: 'context', elements: [{ type: 'mrkdwn',
 text: `_From: WIOM IT Team | ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}_`
 }]}
 ]
 });
 sent++;
 } catch { failed++; }
 }
 // Confirm to admin
 await client.chat.postMessage({
 channel: body.user.id,
 text: `✅ Broadcast sent! ${sent} employees received the message. ${failed > 0 ? `(${failed} failed)` : ''}`,
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: `*✅ Broadcast Complete!*\n\n*Message:* ${message}\n*Delivered:* ${sent} employees\n${failed > 0 ? `*Failed:* ${failed}` : '*All delivered!* 🎉'}` }}
 ]
 });
 console.log(`📢 Broadcast sent to ${sent} employees by ${body.user.id}`);
 } catch (err) {
 console.error('Broadcast error:', err.message);
 await client.chat.postMessage({ channel: body.user.id, text: `❌ Broadcast failed: ${err.message}` });
 }
 });

 // ── Back to categories (DM) — uses same shared greeting ─────────────────
 slackApp.action('dm_back_to_categories', async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const channelId = body.channel?.id || userId;
 const msgTs = body.message?.ts;
 try {
 const emp = await lookupEmployee(userId, client);
 const firstName = (emp?.empName || 'there').split(' ')[0];
 const catBlocks = buildGreetingBlocks(firstName);
 if (msgTs) {
   await client.chat.update({ channel: channelId, ts: msgTs, text: `Hey ${firstName}!`, blocks: catBlocks });
 } else {
   await client.chat.postMessage({ channel: userId, text: `Hey ${firstName}!`, blocks: catBlocks });
 }
 } catch (err) {
 console.error('dm_back_to_categories error:', err.message);
 try { await client.chat.postMessage({ channel: userId, text: 'Categories', blocks: buildGreetingBlocks() }); } catch {}
 }
 });


 // ── Home Category button handlers (cat_laptop, cat_network, etc.) ────────────
 slackApp.action(/^cat_/, async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const channelId = body.channel?.id || body.container?.channel_id || userId;
   const actionId = body.actions[0].action_id;

   const categoryMenus = {
     cat_laptop: {
       label: '💻 Device & Hardware', desc: 'Select your specific issue:',
       issues: [
         { text: '🐢 Laptop Slow',            val: 'laptop_slow' },
         { text: '❌ Laptop Not Starting',     val: 'wont_turn_on' },
         { text: '💙 Blue Screen',            val: 'blue_screen' },
         { text: '🌡️ Overheating',           val: 'overheat' },
         { text: '🔋 Battery Issue',          val: 'battery_issue' },
         { text: '🔌 Charger Issue',          val: 'charger_issue_menu' },
         { text: '🔋 Battery Not Charging',   val: 'battery_not_charging' },
         { text: '⌨️ Keyboard Issue',         val: 'keys_not_working' },
         { text: '🖱️ Touchpad Issue',         val: 'touchpad_issue' },
         { text: '📷 Camera Issue',           val: 'camera_issue' },
         { text: '🎤 Microphone Issue',       val: 'mic_issue' },
         { text: '🔊 Speaker / Audio',        val: 'sound_none' },
         { text: '🖥️ Screen Black',           val: 'screen_black' },
         { text: '🌊 Screen Flickering',      val: 'screen_flicker' },
         { text: '🖵 External Monitor',       val: 'external_monitor' },
         { text: '📹 Projector / HDMI',       val: 'projector_issue' },
         { text: '🔌 USB Port Issue',         val: 'usb_issue' },
         { text: '🌀 Fan Noise',              val: 'fan_noise' },
         { text: '💥 Physical/Liquid Damage', val: 'physical_damage' },
       ]
     },
     cat_network: {
       label: '🌐 Network & Internet', desc: 'Select your specific issue:',
       issues: [
         { text: '📵 WiFi Not Working',       val: 'wifi_not_connect' },
         { text: '🌐 No Internet',            val: 'no_internet' },
         { text: '🐌 Slow Internet',          val: 'internet_slow' },
         { text: '🔌 LAN Issue',              val: 'lan_issue' },
         { text: '💾 Network Drive Issue',    val: 'network_drive' },
         { text: '❌ Website Not Opening',    val: 'website_blocked' },
         { text: '🔄 Frequent Disconnect',    val: 'frequent_disconnect' },
       ]
     },
     cat_msoffice: {
       label: '📊 Microsoft Office', desc: 'Select your specific issue:',
       issues: [
         { text: '📊 Excel Not Opening',      val: 'excel_issue' },
         { text: '📝 Word Not Opening',        val: 'word_issue' },
         { text: '📊 PowerPoint Not Opening', val: 'ppt_issue' },
         { text: '🔑 Office Activation',      val: 'office_activation' },
         { text: '📁 File Not Opening',       val: 'file_corrupted' },
         { text: '📊 Excel Slow',             val: 'excel_slow' },
       ]
     },
     cat_browser: {
       label: '🌍 Browser & Applications', desc: 'Select your specific issue:',
       issues: [
         { text: '🌐 Chrome Not Opening',     val: 'chrome_issue' },
         { text: '🌐 Edge Not Opening',       val: 'edge_issue' },
         { text: '🐌 Browser Slow',           val: 'browser_slow' },
         { text: '❌ Website Not Loading',    val: 'website_blocked' },
         { text: '📄 Adobe PDF Issue',        val: 'pdf_issue' },
         { text: '❌ Application Crash',      val: 'app_crash' },
         // Teams/Zoom removed — they are communication tools, already in 📧 Email & Comm
       ]
     },
     cat_email: {
       label: '📧 Email & Communication', desc: 'Select your specific issue:',
       issues: [
         { text: '📧 Gmail Issue',            val: 'gmail_issue' },
         { text: '🔐 Email Login',            val: 'email_login' },
         { text: '📤 Email Not Sending',      val: 'email_not_sending' },
         { text: '📥 Email Not Receiving',    val: 'email_not_receiving' },
         { text: '💬 Slack Issue',            val: 'slack_issue' },
         { text: '📹 Teams Issue',            val: 'teams_issue' },
         { text: '📅 Calendar Issue',         val: 'calendar_sync' },
       ]
     },
     cat_access: {
       label: '🔐 Access & Identity', desc: 'Select your specific issue:',
       issues: [
         { text: '🔑 Password Reset',         val: 'password_reset' },
         { text: '🔒 Account Locked',         val: 'account_locked' },
         { text: '📧 Email Access',           val: 'email_access' },
         { text: '🚪 Door Access Card',       val: 'door_access' },
       ]
     },
     cat_asset: {
       label: '📦 Asset Requests', desc: 'What do you need?',
       issues: [
         { text: '💻 New Laptop',    val: 'new_laptop' },
         { text: '🔌 Charger',       val: 'charger_asset_menu' },
         { text: '🖱️ Mouse',        val: 'new_mouse' },
         { text: '⌨️ Keyboard',     val: 'new_keyboard' },
         { text: '🎧 Headphone',     val: 'new_headphone' },
         { text: '🖵 Monitor',       val: 'new_monitor' },
         { text: '💿 Software',      val: 'software_asset_request' },
       ]
     },
     cat_mobile: {
       label: '📱 Mobile & SIM (Company Phone)', desc: 'Company phones only:',
       issues: [
         { text: '📱 Phone Not Working',      val: 'mobile_not_working' },
         { text: '📡 SIM Not Working',        val: 'sim_not_working' },
         { text: '🌐 Mobile Internet Issue',  val: 'mobile_internet' },
         { text: '📧 Email on Phone Setup',   val: 'email_mobile' },
         { text: '📲 Mobile App Issue',       val: 'mobile_app' },
         { text: '🔋 Phone Charging Issue',   val: 'mobile_charging' },
         { text: '🖥️ Phone Screen Damage',   val: 'mobile_screen_damage' },
       ]
     },
     cat_cloud: {
       label: '☁️ Cloud & Storage', desc: 'Select your specific issue:',
       issues: [
         { text: '☁️ Google Drive Issue',     val: 'google_drive_issue' },
         { text: '🔗 Shared Drive Issue',     val: 'shared_drive_issue' },
         { text: '🔄 File Sync Issue',        val: 'file_sync_issue' },
         { text: '💾 Storage Full',           val: 'storage_full' },
       ]
     },
     // cat_security: button removed from Home Tab — all security issues moved to 🚨 Emergency Support
     // Handler kept here for backward compatibility with old Slack messages that still have Security buttons
     cat_security: {
       label: '🔒 Security Issues', desc: '⚠️ These are emergency issues — IT team will respond urgently:',
       issues: [
         { text: '🎣 Phishing Email',         val: 'phishing_email' },
         { text: '🔓 Suspicious Login',       val: 'suspicious_login' },
         { text: '🚨 Security Alert',         val: 'security_alert' },
         // Virus/Malware and Account Hacked removed (duplicates) — both are in 🚨 Emergency Support
       ]
     },
     cat_emergency: {
       label: '🚨 Emergency Support', desc: '⚠️ Select your emergency — IT team will respond urgently:',
       issues: [
         // Hardware Emergencies
         { text: '💧 Water/Liquid Damage',    val: 'liquid_damage' },
         { text: '🔥 Burning Smell / Smoke',  val: 'burning_smell' },
         { text: '🔋 Battery Swelling',       val: 'battery_swelling' },
         // Security Emergencies (moved from 🔒 Security — that button removed from home)
         { text: '🦠 Virus / Malware',        val: 'virus_malware' },
         { text: '💀 Account Hacked',         val: 'account_hacked' },
         { text: '🎣 Phishing Email',         val: 'phishing_email' },
         { text: '🔓 Suspicious Login',       val: 'suspicious_login' },
         // Other Emergencies
         { text: '📱 Device Lost/Stolen',     val: 'device_lost' },
         { text: '💾 Data Loss',              val: 'data_loss' },
       ]
     },
   }
   const menu = categoryMenus[actionId];
   if (!menu) return;

   const rows = [];
   for (let i = 0; i < menu.issues.length; i += 3) {
     rows.push(menu.issues.slice(i, i + 3));
   }

   const blocks = [
     { type: 'section', text: { type: 'mrkdwn', text: '*' + menu.label + '*\n' + menu.desc } },
     { type: 'divider' },
   ];

   rows.forEach(row => {
     blocks.push({
       type: 'actions',
       elements: row.map(issue => ({
         type: 'button',
         text: { type: 'plain_text', text: issue.text, emoji: true },
         action_id: 'vague_pick_' + issue.val,
         value: issue.val
       }))
     });
   });

   // Navigation buttons
   blocks.push({ type: 'divider' });
   blocks.push({
     type: 'actions',
     elements: [
       { type: 'button', text: { type: 'plain_text', text: '🏠 Home', emoji: true }, action_id: 'go_home_btn', value: 'home' },
       { type: 'button', text: { type: 'plain_text', text: '🎫 Create Ticket', emoji: true }, action_id: 'vague_pick_create_ticket', value: 'create ticket', style: 'danger' },
     ]
   });

   // Open as MODAL (popup) — works even when Messages Tab is disabled
   const triggerId = body.trigger_id;
   try {
     if (triggerId) {
       await client.views.open({
         trigger_id: triggerId,
         view: {
           type: 'modal',
           title: { type: 'plain_text', text: menu.label, emoji: true },
           close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true },
           blocks
         }
       });
     } else {
       // Fallback: update home tab with sub-issues
       await client.chat.postMessage({ channel: userId, text: menu.label, blocks });
     }
   } catch (err) {
     console.error('cat_ handler error:', err.message);
     // Last resort: DM
     try { await client.chat.postMessage({ channel: userId, text: menu.label, blocks }); } catch {}
   }
 });

 // ── Go Home navigation button ─────────────────────────────────────────────────
 // ── Charger Issue (Hardware) — 2 options ────────────────────────────────────
 slackApp.action('vague_pick_charger_issue_menu', async ({ body, ack, client }) => {
   await ack();
   const triggerId = body.trigger_id;
   if (!triggerId) return;
   await client.views.push({
     trigger_id: triggerId,
     view: {
       type: 'modal',
       title: { type: 'plain_text', text: '🔌 Charger Issue', emoji: true },
       close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true },
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: '*🔌 Charger Issue*\n\nWhat is the problem?' }},
         { type: 'divider' },
         { type: 'actions', elements: [
           { type: 'button', text: { type: 'plain_text', text: '💥 Charger Physically Damaged', emoji: true }, action_id: 'vague_pick_charger_damaged', value: 'charger_damaged', style: 'danger' },
           { type: 'button', text: { type: 'plain_text', text: '❌ Charger Not Working', emoji: true }, action_id: 'vague_pick_battery_not_charging', value: 'battery_not_charging' },
         ]},
       ]
     }
   });
 });

 // ── Ticket Details Modal ─────────────────────────────────────────────────────
 slackApp.action('view_ticket_details', async ({ body, ack, client }) => {
   await ack();
   const ticketId = body.actions[0].value;
   const triggerId = body.trigger_id;
   if (!triggerId) return;
   try {
     const t = await Ticket.findOne({ ticketId }).lean();
     if (!t) {
       await client.views.open({ trigger_id: triggerId, view: {
         type: 'modal', title: { type: 'plain_text', text: 'Ticket Not Found' },
         close: { type: 'plain_text', text: 'Close' },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Ticket `' + ticketId + '` not found.' }}]
       }});
       return;
     }
     const statEmoji = { 'Open': '🔴', 'In Progress': '🟡', 'Waiting': '🟠', 'Resolved': '🟢', 'Closed': '⚪' };
     const priEmoji = { 'Critical': '🔴', 'High': '🟠', 'Medium': '🟡', 'Low': '🟢' };
     const hrs = Math.floor((Date.now() - new Date(t.createdAt)) / 3600000);
     const timeStr = hrs < 24 ? hrs + ' hours ago' : Math.floor(hrs/24) + ' days ago';
     await client.views.open({ trigger_id: triggerId, view: {
       type: 'modal',
       title: { type: 'plain_text', text: ticketId, emoji: true },
       close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [
         { type: 'section', fields: [
           { type: 'mrkdwn', text: '*Status:*\n' + (statEmoji[t.status]||'🔵') + ' ' + t.status },
           { type: 'mrkdwn', text: '*Priority:*\n' + (priEmoji[t.priority]||'🟡') + ' ' + t.priority },
           { type: 'mrkdwn', text: '*Category:*\n' + (t.category||'Other') },
           { type: 'mrkdwn', text: '*Created:*\n' + timeStr },
         ]},
         { type: 'divider' },
         { type: 'section', text: { type: 'mrkdwn', text: '*Issue Description:*\n' + (t.description||'No description') }},
         { type: 'context', elements: [{ type: 'mrkdwn', text: `IT team working on this. Contact: ${ADMIN_EMAIL}` }]}
       ]
     }});
   } catch(err) { console.error('view_ticket_details error:', err.message); }
 });

 // ── Charger Damaged → IT Ticket ───────────────────────────────────────────────
 slackApp.action('vague_pick_charger_damaged', async ({ body, ack, client }) => {
   await ack();
   const triggerId = body.trigger_id;
   if (!triggerId) return;
   await client.views.push({
     trigger_id: triggerId,
     view: {
       type: 'modal',
       title: { type: 'plain_text', text: '💥 Charger Damaged', emoji: true },
       close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true },
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: '💥 *Charger is physically damaged*\n\nIT team will arrange a replacement. Please raise a ticket below:' }},
         { type: 'divider' },
         { type: 'actions', elements: [
           { type: 'button', text: { type: 'plain_text', text: '🎫 Raise IT Ticket', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: 'Charger physically damaged - replacement needed' },
         ]},
       ]
     }
   });
 });

 // ── Charger Asset Request — 2 options ─────────────────────────────────────────
 slackApp.action('vague_pick_charger_asset_menu', async ({ body, ack, client }) => {
   await ack();
   const triggerId = body.trigger_id;
   if (!triggerId) return;
   await client.views.push({
     trigger_id: triggerId,
     view: {
       type: 'modal',
       title: { type: 'plain_text', text: '🔌 Charger Request', emoji: true },
       close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true },
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: '*🔌 Charger Request*\n\nWhat is the problem?' }},
         { type: 'divider' },
         { type: 'actions', elements: [
           { type: 'button', text: { type: 'plain_text', text: '💥 Charger Physically Damaged', emoji: true }, action_id: 'vague_pick_charger_damaged', value: 'charger_damaged', style: 'danger' },
           { type: 'button', text: { type: 'plain_text', text: '❌ Charger Not Working', emoji: true }, action_id: 'vague_pick_battery_not_charging', value: 'battery_not_charging' },
         ]},
       ]
     }
   });
 });

 slackApp.action('go_home_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   try {
     const emp = await lookupEmployee(userId, client).catch(() => null);
     const myTickets = emp?.empId
       ? await Ticket.find({ empId: emp.empId, status: { $in: ['Open', 'In Progress', 'Waiting'] } }).sort({ createdAt: -1 }).limit(3).lean()
       : [];
     const blocks = buildHomeBlocks(emp, myTickets, new Set());
     await client.views.publish({ user_id: userId, view: { type: 'home', blocks } });
     // If called from inside a modal — update modal to guide user to Home tab
     if (body.view?.id) {
       await client.views.update({ view_id: body.view.id, view: {
         type: 'modal', title: { type: 'plain_text', text: 'Home Tab', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Home tab refreshed!\n\n*Close this window* and click on the *Home* tab above.' }}]
       }}).catch(() => {});
     }
   } catch (err) { console.error('go_home_btn error:', err.message); }
 });

 // ── New ticket button after close notification ───────────────────────
 slackApp.action('new_ticket_after_close', async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 try {
 await client.views.open({
 trigger_id: body.trigger_id,
 view: {
 type : 'modal',
 callback_id: 'ticket_modal',
 title : { type:'plain_text', text:'New IT Ticket', emoji:true },
 submit : { type:'plain_text', text:'Submit Ticket', emoji:true },
 close : { type:'plain_text', text:'Cancel', emoji:true },
 blocks : [
 { type:'input', block_id:'description_block',
 label:{ type:'plain_text', text:'Describe your problem:' },
 element:{ type:'plain_text_input', action_id:'description_input', multiline:true, min_length:10,
 placeholder:{ type:'plain_text', text:'e.g. Laptop not turning on, WiFi not working...' }}},
 { type:'input', block_id:'category_block',
 label:{ type:'plain_text', text:'Category' },
 element:{ type:'static_select', action_id:'category_input',
 placeholder:{ type:'plain_text', text:'Select a category' },
 options:[
 { text:{ type:'plain_text', text:'Hardware - Laptop, keyboard, screen' }, value:'Hardware' },
 { text:{ type:'plain_text', text:'Software - App, Windows, Office' }, value:'Software' },
 { text:{ type:'plain_text', text:'Network - WiFi, internet' }, value:'Network' },
 { text:{ type:'plain_text', text:'Account - Password, login, email' }, value:'Account' },
 { text:{ type:'plain_text', text:'Purchase - New equipment request' }, value:'Purchase' },
 { text:{ type:'plain_text', text:'Other' }, value:'Other' }
 ]}},
 ]
 }
 });
 } catch (err) {
 console.error('new_ticket_after_close error:', err.message);
 }
 });

 // ── Vague pick button handler (quick problem selection from DM) ─────

 // ── LAPTOP SLOW — Auto Fix Page (improved UI) ────────────────────────────────
 slackApp.action('vague_pick_laptop_slow', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const isFromModal = body.view?.type === 'modal'; // Home Tab has body.view too (type:'home') — must check type
   const triggerId = body.trigger_id;
   const PORTAL = process.env.API_BASE_URL || 'https://wiom-helpdesk-production.up.railway.app';

   const blocks = [
     { type: 'section', text: { type: 'mrkdwn', text:
       `*🐢 Laptop Slow/Hang*\n\nTry these 3 steps first:\n\n` +
       `1. *Task Manager* → Ctrl+Shift+Esc → CPU column → heavy app → End Task\n` +
       `2. *Browser tabs* → close extra Chrome/Edge tabs\n` +
       `3. *Restart* → Properly shut down (restart, not sleep)`
     }},
     { type: 'divider' },
     { type: 'section', text: { type: 'mrkdwn', text:
       `*⚡ Auto Fix*\n\nThis script will automatically:\n\n` +
       `✓ Clear temporary files\n` +
       `✓ Refresh performance settings\n` +
       `✓ Restart Windows Explorer\n` +
       `✓ Clean junk files\n\n` +
       `*Estimated Time:* 2 minutes\n` +
       `*Success Rate:* 85%\n\n` +
       `_Safe to run — no data will be deleted_`
     }},
     { type: 'actions', elements: [
       { type: 'button', text: { type: 'plain_text', text: '🔧 Download & Run Auto Fix', emoji: true }, style: 'primary', url: `${PORTAL}/scripts/fix-slow-laptop.bat`, action_id: 'dl_slow_laptop' }
     ]},
     { type: 'divider' },
     { type: 'section', text: { type: 'mrkdwn', text: '*After running Auto Fix — is it resolved?*' }},
     { type: 'actions', elements: [
       { type: 'button', text: { type: 'plain_text', text: '🟢 Yes, Fixed!', emoji: true }, action_id: 'laptop_slow_fixed', style: 'primary', value: 'laptop_slow' },
       { type: 'button', text: { type: 'plain_text', text: '🔴 No, Still Issue', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: 'Laptop still slow — Auto Fix did not resolve it, RAM or SSD check needed' },
     ]}
   ];

   const modalView = { type: 'modal', title: { type: 'plain_text', text: '🐢 Laptop Slow', emoji: true }, close: { type: 'plain_text', text: '⬅ Back', emoji: true }, blocks };

   if (isFromModal && triggerId) {
     try { await client.views.push({ trigger_id: triggerId, view: modalView }); }
     catch(e) { await client.chat.postMessage({ channel: userId, text: 'Laptop Slow - Auto Fix', blocks }); }
   } else {
     await client.chat.postMessage({ channel: userId, text: 'Laptop Slow - Auto Fix', blocks });
   }
 });

 // ── Laptop Slow Fixed → uses shared resolvedModalView ───────────────────────
 slackApp.action('laptop_slow_fixed', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const viewId = body.view?.id;
   const channelId = body.channel?.id || body.container?.channel_id || userId;
   if (viewId) {
     await client.views.update({ view_id: viewId, view: resolvedModalView() })
       .catch(e => console.error('laptop_slow_fixed modal err:', e.message));
   } else {
     await client.chat.postMessage({ channel: channelId, text: 'Issue Resolved!', blocks: resolvedDMBlocks() });
   }
 });

 // ── Won't Turn On — Special handler with exact steps ─────────────────────────
 slackApp.action('vague_pick_wont_turn_on', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const isFromModal = body.view?.type === 'modal'; // Home Tab has body.view too (type:'home') — must check type
   const triggerId = body.trigger_id;

   const blocks = [
     { type: 'section', text: { type: 'mrkdwn', text:
       `❌ *Laptop Not Starting* — try these steps:\n\n` +
       `1. *Check charger* — is the charger properly connected? Try a different socket\n` +
       `2. *10 second hold* — hold power button 10 sec → release → wait 30 sec → try again\n` +
       `3. *Try without charger* — remove charger → hold power button 30 sec → plug charger back → turn on\n\n` +
       `If none of these work — laptop has a hardware issue, IT will physically inspect it.`
     }},
     { type: 'divider' },
     { type: 'actions', elements: [
       { type: 'button', text: { type: 'plain_text', text: '✅ Yes, Started!', emoji: true }, action_id: 'resolved_yes_btn', style: 'primary', value: 'High' },
       { type: 'button', text: { type: 'plain_text', text: '🎫 Create Ticket (HIGH)', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: 'Laptop won\'t turn on at all — hardware issue' },
     ]}
   ];

   const modalView = { type: 'modal', title: { type: 'plain_text', text: '❌ Laptop Not Starting', emoji: true }, close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true }, blocks };

   if (isFromModal && triggerId) {
     try { await client.views.push({ trigger_id: triggerId, view: modalView }); }
     catch(e) { await client.chat.postMessage({ channel: userId, text: 'Laptop Not Starting steps', blocks }); }
   } else {
     await client.chat.postMessage({ channel: userId, text: 'Laptop Not Starting steps', blocks });
   }
 });

 // ── Asset Requests — Email Process Handler ────────────────────────────────────
 // ── Asset Request Modal builder ────────────────────────────────────────────────
 const ASSET_ITEM_NAMES = {
   new_laptop: '💻 New Laptop', new_mouse: '🖱️ New Mouse', new_keyboard: '⌨️ New Keyboard',
   new_headphone: '🎧 Headphone', new_monitor: '🖥️ New Monitor', new_charger: '🔌 New Charger',
 };
 const buildAssetRequestModal = (itemKey) => {
   const itemName = ASSET_ITEM_NAMES[itemKey] || '📦 Equipment';
   return {
     type: 'modal',
     callback_id: 'asset_request_submit',
     private_metadata: itemKey,
     title: { type: 'plain_text', text: '📦 Asset Request', emoji: true },
     submit: { type: 'plain_text', text: '📩 Submit Request', emoji: true },
     close: { type: 'plain_text', text: 'Close', emoji: true },
     blocks: [
       { type: 'section', text: { type: 'mrkdwn', text: `*${itemName} Request*\n\nYour request will go to your *reporting manager* for approval. Once approved, IT will arrange it.` }},
       { type: 'divider' },
       { type: 'input', block_id: 'asset_reason_block', optional: true,
         label: { type: 'plain_text', text: 'Reason (optional):', emoji: true },
         element: { type: 'plain_text_input', action_id: 'asset_reason',
           placeholder: { type: 'plain_text', text: 'e.g. My current laptop is very slow...' }, max_length: 300 }
       },
     ]
   };
 };

 slackApp.action(/^vague_pick_(new_laptop|new_mouse|new_keyboard|new_headphone|new_monitor|new_charger)$/, async ({ body, ack, client }) => {
   await ack();
   const rawKey = body.actions[0].value;
   const triggerId = body.trigger_id;
   if (!triggerId) return;
   try {
     if (body.view?.type === 'modal') {
       await client.views.push({ trigger_id: triggerId, view: buildAssetRequestModal(rawKey) });
     } else {
       await client.views.open({ trigger_id: triggerId, view: buildAssetRequestModal(rawKey) });
     }
   } catch(e) { console.error(`asset modal open error (${rawKey}):`, e.message); }
 });

 // ── Asset request submitted — send to manager for approval ────────────────────
 slackApp.view('asset_request_submit', async ({ body, ack, view, client }) => {
   await ack({ response_action: 'update', view: { type: 'modal', title: { type: 'plain_text', text: '📦 Asset Request', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '⏳ *Sending to your manager for approval...*' }}] }});

   const userId  = body.user.id;
   const itemKey = view.private_metadata || 'equipment';
   const reason  = view.state.values?.asset_reason_block?.asset_reason?.value || '';
   const itemName = (ASSET_ITEM_NAMES[itemKey] || '📦 Equipment').replace(/^\S+\s/, ''); // strip emoji

   try {
     const emp = await Employee.findOne({ slackUserId: userId }).select('empId name empName dept floor empEmail managerSlackId managerName').lean().catch(() => null);
     const empId      = emp?.empId   || userId;
     const empName    = emp?.name    || emp?.empName || 'Employee';
     const mgrSlackId = emp?.managerSlackId;
     const mgrName    = emp?.managerName || 'Manager';

     const desc = `Asset Request: ${itemName}${reason ? `\nReason: ${reason}` : ''}`;
     const rawTicket = await createTicketSlack({ empId, empName, empDept: emp?.dept, empFloor: emp?.floor, empEmail: emp?.empEmail, description: desc, category: 'Asset Request', priority: 'Low', source: 'slack', skipDuplicateCheck: true });
     const ticket = rawTicket?._duplicate ? rawTicket.ticket : rawTicket;
     const ticketId = ticket?.ticketId || 'N/A';

     const payload = JSON.stringify({ ticketId, userId, empName, empId, itemKey, itemName, reason: reason || '' });

     if (mgrSlackId) {
       const mgrDm = await client.conversations.open({ users: mgrSlackId });
       await client.chat.postMessage({
         channel: mgrDm.channel.id,
         text: `📦 Asset Request from ${empName} — Approval needed`,
         blocks: [
           { type: 'header', text: { type: 'plain_text', text: '📦 Asset Request — Approval Needed', emoji: true }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${empName} (${empId})\n*Dept/Floor:* ${emp?.dept || 'N/A'} — Floor ${emp?.floor || 'N/A'}` }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Item Requested:* ${ASSET_ITEM_NAMES[itemKey] || itemName}${reason ? `\n*Reason:* ${reason}` : ''}` }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Ticket:* \`${ticketId}\`` }},
           { type: 'divider' },
           { type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '✅ Approve', emoji: true }, style: 'primary', action_id: 'asset_req_approve', value: payload },
             { type: 'button', text: { type: 'plain_text', text: '❌ Reject',  emoji: true }, style: 'danger',   action_id: 'asset_req_reject',  value: payload },
           ]},
         ]
       });

       const empDm = await client.conversations.open({ users: userId });
       await client.chat.postMessage({
         channel: empDm.channel.id,
         text: `📨 Your ${itemName} request has been sent to ${mgrName} for approval.`,
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `*📨 Request Sent for Approval*\n\nYour *${itemName}* request has been sent to *${mgrName}* for approval.\n\n*Ticket ID:* \`${ticketId}\`\n\nYou will receive a Slack message once your manager responds.` }},
         ]
       });

     } else {
       // No manager — send directly to IT admin
       const adminId = (process.env.ADMIN_SLACK_USER_ID || '').trim() || (process.env.ADMIN_EMAIL_SLACK_ID || '').trim() || 'U08K2LXAN5Q';
       if (adminId) {
         const adminDm = await client.conversations.open({ users: adminId });
         await client.chat.postMessage({
           channel: adminDm.channel.id,
           text: `📦 Asset Request: ${empName} — ${itemName} (no manager configured)`,
           blocks: [
             { type: 'header', text: { type: 'plain_text', text: '📦 Asset Request', emoji: true }},
             { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${empName} (${empId})\n*Dept/Floor:* ${emp?.dept || 'N/A'} — Floor ${emp?.floor || 'N/A'}\n⚠️ _No reporting manager set._` }},
             { type: 'section', text: { type: 'mrkdwn', text: `*Item Requested:* ${ASSET_ITEM_NAMES[itemKey] || itemName}${reason ? `\n*Reason:* ${reason}` : ''}` }},
             { type: 'section', text: { type: 'mrkdwn', text: `*Ticket:* \`${ticketId}\`` }},
           ]
         });
       }
       const empDm = await client.conversations.open({ users: userId });
       await client.chat.postMessage({
         channel: empDm.channel.id,
         text: `✅ ${itemName} request submitted — Ticket \`${ticketId}\``,
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `*✅ Request Submitted!*\n\n*Item:* ${ASSET_ITEM_NAMES[itemKey] || itemName}\n*Ticket ID:* \`${ticketId}\`\n\nIT team will be in touch shortly.` }},
         ]
       });
     }
   } catch (err) { console.error('asset_request_submit error:', err.message); }
 });

 // ── Manager approves asset request ────────────────────────────────────────────
 slackApp.action('asset_req_approve', async ({ body, ack, client }) => {
   await ack();
   try {
     const { ticketId, userId, empName, empId, itemKey, itemName, reason } = JSON.parse(body.actions[0].value);
     const mgrName = body.user.name || 'Your manager';

     await client.chat.update({
       channel: body.channel.id, ts: body.message.ts,
       text: `✅ Approved by ${mgrName} — ${empName}'s ${itemName} request`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*✅ Approved* by *${mgrName}*\n\n*Employee:* ${empName} (${empId})\n*Item:* ${ASSET_ITEM_NAMES[itemKey] || itemName}\n*Ticket:* \`${ticketId}\`` }},
         { type: 'context', elements: [{ type: 'mrkdwn', text: '_IT team has been notified to arrange._' }]}
       ]
     });

     const adminId = (process.env.ADMIN_SLACK_USER_ID || '').trim() || (process.env.ADMIN_EMAIL_SLACK_ID || '').trim() || 'U08K2LXAN5Q';
     if (adminId) {
       const adminDm = await client.conversations.open({ users: adminId });
       await client.chat.postMessage({
         channel: adminDm.channel.id,
         text: `✅ Asset Request APPROVED — ${empName} needs ${itemName}`,
         blocks: [
           { type: 'header', text: { type: 'plain_text', text: '✅ Asset Request Approved — Action Required', emoji: true }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${empName} (${empId})\n*Approved by:* ${mgrName}` }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Item to Provide:* ${ASSET_ITEM_NAMES[itemKey] || itemName}${reason ? `\n*Reason:* ${reason}` : ''}` }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Ticket:* \`${ticketId}\`` }},
         ]
       });
     }

     const empDm = await client.conversations.open({ users: userId });
     await client.chat.postMessage({
       channel: empDm.channel.id,
       text: `✅ Your ${itemName} request was approved by ${mgrName}!`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*✅ Request Approved!*\n\nYour manager *${mgrName}* approved your *${ASSET_ITEM_NAMES[itemKey] || itemName}* request.\n\n*Ticket:* \`${ticketId}\`\n\nIT team will arrange it soon — you will receive a message when it is ready.` }},
       ]
     });
   } catch (err) { console.error('asset_req_approve error:', err.message); }
 });

 // ── Manager rejects asset request ─────────────────────────────────────────────
 slackApp.action('asset_req_reject', async ({ body, ack, client }) => {
   await ack();
   try {
     const { ticketId, userId, empName, empId, itemKey, itemName } = JSON.parse(body.actions[0].value);
     const mgrName = body.user.name || 'Your manager';

     await client.chat.update({
       channel: body.channel.id, ts: body.message.ts,
       text: `❌ Rejected by ${mgrName} — ${empName}'s ${itemName} request`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*❌ Rejected* by *${mgrName}*\n\n*Employee:* ${empName} (${empId})\n*Item:* ${ASSET_ITEM_NAMES[itemKey] || itemName}\n*Ticket:* \`${ticketId}\`` }},
         { type: 'context', elements: [{ type: 'mrkdwn', text: '_Request has been declined._' }]}
       ]
     });

     const empDm = await client.conversations.open({ users: userId });
     await client.chat.postMessage({
       channel: empDm.channel.id,
       text: `❌ Your ${itemName} request was not approved by ${mgrName}.`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*❌ Request Not Approved*\n\nYour manager *${mgrName}* did not approve your *${ASSET_ITEM_NAMES[itemKey] || itemName}* request.\n\n*Ticket:* \`${ticketId}\`\n\nFor queries, please speak to your manager directly.` }},
       ]
     });
   } catch (err) { console.error('asset_req_reject error:', err.message); }
 });

 slackApp.action(/^vague_pick_/, async ({ body, ack, client, say }) => {
 await ack();
 const userId = body.user.id;
 const actionId = body.actions[0].action_id;
 const rawKey = body.actions[0].value;

 // Asset request keys — handled by dedicated asset handler above, skip here to avoid duplicate/race
 const ASSET_KEYS = ['new_laptop', 'new_mouse', 'new_keyboard', 'new_headphone', 'new_monitor', 'new_charger'];
 if (ASSET_KEYS.includes(rawKey)) return;

 // Keys with dedicated action handlers — skip to avoid race condition (both fire in Bolt)
 const DEDICATED_ACTION_IDS = new Set([
   'vague_pick_laptop_slow',       // dedicated handler shows auto-fix page
   'vague_pick_wont_turn_on',      // dedicated handler shows won't turn on modal
   'vague_pick_charger_issue_menu',// dedicated handler shows charger submenu
   'vague_pick_charger_damaged',   // dedicated handler shows damaged charger steps
   'vague_pick_charger_asset_menu',// dedicated handler shows charger asset request
 ]);
 if (DEDICATED_ACTION_IDS.has(actionId)) return;

 // Create Ticket button — show ticket notes form, not AI response
 if (actionId === 'vague_pick_create_ticket') {
   if (body.trigger_id) {
     const isInsideModal = body.view?.type === 'modal';
     try {
       if (isInsideModal) {
         await client.views.push({ trigger_id: body.trigger_id, view: ticketNotesFormView('', 'Medium') });
       } else {
         await client.views.open({ trigger_id: body.trigger_id, view: ticketNotesFormView('', 'Medium') });
       }
     } catch(e) {
       console.error('vague_pick_create_ticket modal open error:', e.message);
       // Fallback: send DM if modal fails
       await client.chat.postMessage({ channel: userId, text: `🎫 To create a ticket, please describe your issue and raise it via the Create Ticket button. Or email IT directly: ${ADMIN_EMAIL}` })
         .catch(dmErr => console.error('create_ticket fallback DM error:', dmErr.message));
     }
   }
   return;
 }

 const KEY_TO_PROBLEM = {
   laptop_slow: 'laptop is very slow and hanging', excel_slow: 'Microsoft Excel is very slow hanging and freezing',
   blue_screen: 'blue screen BSOD error appearing',
   overheat: 'laptop overheating getting very hot', battery_issue: 'battery issue charging problem',
   battery_not_charging: 'battery not charging charger not working',
   keys_not_working: 'keyboard not working', touchpad_issue: 'touchpad not working cursor stuck',
   camera_issue: 'laptop webcam camera not working in video calls — black screen or camera not detected, Privacy settings or driver issue', mic_issue: 'laptop built-in microphone not working — voice not going through in video calls, mic may be off in Privacy settings',
   sound_none: 'no sound from laptop speakers at all — volume is correct but still silent', screen_black: 'screen went black cannot see anything',
   external_monitor: 'external monitor connected via HDMI but not detected second screen not showing', scanner_issue: 'office scanner or printer scanner mode not working not detected on PC',
   wont_turn_on: "laptop won't turn on won't start",
  wifi_not_connect: 'wifi not working cannot connect', no_internet: 'internet not working at all laptop is connected but pages not loading',
  internet_slow: 'internet very slow',
   lan_issue: 'LAN cable not working ethernet issue', network_drive: 'network shared drive missing — mapped drive Z: or shared folder not accessible, needs reconnect',
   excel_issue: 'Excel not opening or crashing', word_issue: 'Word not opening or crashing',
   ppt_issue: 'PowerPoint not opening', office_activation: 'MS Office activation error — employees cannot activate themselves, raise IT ticket',
   file_corrupted: 'Word Excel PPT or any file not opening — software missing or error opening file', chrome_issue: 'Google Chrome not opening or crashing — end Chrome from Task Manager and reopen',
   edge_issue: 'Edge browser not opening or crashing — close from Task Manager and reopen', browser_slow: 'Google Chrome or Edge browser very slow pages loading slowly or freezing',
   website_blocked: 'specific website not opening not loading in browser — other websites work fine', teams_issue: 'Teams app not opening or call dropping or messages not coming — Quit from system tray and reopen',
   zoom_issue: 'Zoom app not opening or cannot join meeting or call quality issue — close Zoom and reopen', pdf_issue: 'PDF file not opening Adobe Acrobat or Reader not working or error opening PDF',
   app_crash: 'application software not opening or crashing — end process from Task Manager and reopen, restart', gmail_issue: 'Gmail not opening or emails not coming — open gmail.com directly in Chrome, try incognito',
   outlook_email: 'gmail email issue', email_login: 'gmail login not working cannot access email',
  slack_issue: 'Slack app not opening or messages not coming or notifications off — Quit from system tray, reopen, if still not working clear cache',
   email_not_sending: 'Gmail email not sending — error appearing or email stuck in outbox', email_not_receiving: 'Gmail inbox not receiving emails — expected emails missing or inbox empty',
   calendar_sync: 'Google Calendar sync issue — meetings and events not showing or problem opening Google Calendar', password_reset: 'forgot password need to reset it',
   account_locked: 'account locked cannot login', shared_folder: 'shared folder access not available',
   email_access: 'Gmail account access needed — new account or problem with existing account', software_access: 'need access to a software — install needed or permission required, IT will handle',
   new_laptop: 'need a new laptop request', new_mouse: 'need a new mouse',
   new_keyboard: 'need a new keyboard', new_headphone: 'need headphones',
   new_monitor: 'need a new monitor', new_charger: 'need a new charger',
   screen_flicker: 'laptop screen flickering blinking',
   projector_issue: 'projector or HDMI not connecting in conference room',
   usb_issue: 'USB port not working device not detected',
   fan_noise: 'laptop fan making very loud noise or not spinning',
   physical_damage: 'laptop physically damaged cracked or dropped',
   liquid_damage: 'liquid or water spilled on laptop water damage EMERGENCY',
   frequent_disconnect: 'WiFi keeps disconnecting frequently unstable',
   door_access: 'office door access card not working or need a new card',
   mobile_not_working: 'company phone not working will not turn on',
   sim_not_working: 'company SIM not working no network signal',
   mobile_internet: 'internet not working on company phone',
   email_mobile: 'need to set up Gmail email on company phone',
   mobile_app: 'app not working or crashing on company phone',
   mobile_charging: 'company phone not charging',
   mobile_screen_damage: 'company phone screen cracked damaged',
   google_drive_issue: 'Google Drive files not opening or not syncing',
   shared_drive_issue: 'shared Google Drive folder access not available files missing',
   file_sync_issue: 'files not syncing in Google Drive shared folder',
   storage_full: 'laptop storage full C drive full cannot save files',
   phishing_email: 'suspicious phishing email received that looks fake',
   virus_malware: 'laptop has virus or malware suspicious activity',
   suspicious_login: 'someone else used my account suspicious login alert',
   security_alert: 'security alert appearing on laptop or account suspicious',
   account_hacked: 'my account was hacked password not working EMERGENCY',
   burning_smell: 'burning smell or smoke coming from laptop EMERGENCY',
   battery_swelling: 'laptop battery is swollen bloated EMERGENCY',
   data_loss: 'important files deleted data missing',
   device_lost: 'laptop or device is lost or stolen',
 };

 const isFromModal = body.view?.type === 'modal'; // Home Tab has body.view too (type:'home') — must check type
 const triggerId = body.trigger_id;
 let loadingViewId = null;

 // ── Auto-Fix scripts map — rawKey → { script filename, label } ──────────────
 const PORTAL = process.env.API_BASE_URL || 'https://wiom-helpdesk-production.up.railway.app';
 const AUTO_FIX = {
   laptop_slow:         { file: 'fix-slow-laptop.bat',   label: 'Laptop Speed Fix' },
   overheat:            { file: 'fix-overheating.bat',   label: 'Overheating Fix' },
   wifi_not_connect:    { file: 'fix-wifi.bat',          label: 'WiFi Fix' },
   no_internet:         { file: 'fix-wifi.bat',          label: 'Network Reset' },
   internet_slow:       { file: 'fix-wifi.bat',          label: 'WiFi Speed Fix' },
   keys_not_working:    { file: 'fix-keyboard.bat',      label: 'Keyboard Fix' },
   touchpad_issue:      { file: 'fix-touchpad.bat',      label: 'Touchpad Fix' },
   camera_issue:        { file: 'fix-camera.bat',        label: 'Camera Fix' },
   mic_issue:           { file: 'fix-mic.bat',           label: 'Microphone Fix' },
   sound_none:          { file: 'fix-sound.bat',         label: 'Audio Fix' },
   screen_black:        { file: 'fix-black-screen.bat',  label: 'Screen Fix' },
   blue_screen:         { file: 'fix-bluescreen.bat',    label: 'Blue Screen Fix' },
   external_monitor:    { file: 'fix-hdmi.bat',          label: 'HDMI/Monitor Fix' },
   browser_slow:        { file: 'fix-browser.bat',       label: 'Browser Fix' },
   pdf_issue:           { file: 'fix-pdf.bat',           label: 'PDF Fix' },
   teams_issue:         { file: 'fix-teams.bat',         label: 'Teams Fix' },
   zoom_issue:          { file: 'fix-zoom.bat',          label: 'Zoom Fix' },
   printer_issue:       { file: 'fix-printer.bat',       label: 'Printer Fix' },
 };

 const ISSUE_TITLES = {
   blue_screen: '💙 Blue Screen', overheat: '🌡️ Overheating', battery_issue: '🔋 Battery Issue',
   battery_not_charging: '🔌 Charging Issue', keys_not_working: '⌨️ Keyboard Issue',
   touchpad_issue: '🖱️ Touchpad Issue', camera_issue: '📷 Camera Issue', mic_issue: '🎤 Mic Issue',
   sound_none: '🔊 Sound Issue', screen_black: '🖥️ Screen Issue',
   external_monitor: '🖵 Monitor Issue', scanner_issue: '🖨️ Scanner Issue',
   wifi_not_connect: '📶 WiFi Issue', no_internet: '🌐 No Internet',
   internet_slow: '🐌 Slow Internet', lan_issue: '🔌 LAN Issue', network_drive: '💾 Network Drive',
   excel_issue: '📊 Excel Issue', excel_slow: '📊 Excel Slow', word_issue: '📝 Word Issue', ppt_issue: '📊 PowerPoint Issue',
   office_activation: '🔑 Office Activation', file_corrupted: '📁 File Issue',
   chrome_issue: '🌐 Chrome Issue', edge_issue: '🌐 Edge Issue', browser_slow: '🐌 Browser Slow',
   website_blocked: '❌ Website Issue', teams_issue: '📹 Teams Issue', zoom_issue: '🎥 Zoom Issue',
   pdf_issue: '📄 PDF Issue', app_crash: '💥 App Issue',
   gmail_issue: '📧 Gmail Issue', email_login: '🔐 Email Login', slack_issue: '💬 Slack Issue',
   email_not_sending: '📤 Email Sending', email_not_receiving: '📥 Email Receiving', calendar_sync: '📅 Calendar Issue',
   password_reset: '🔑 Password Reset', account_locked: '🔒 Account Locked',
   shared_folder: '📁 Folder Access', email_access: '📧 Email Access', software_access: '💾 App Access',
   screen_flicker: '🌊 Screen Flicker', projector_issue: '📹 Projector/HDMI',
   usb_issue: '🔌 USB Issue', fan_noise: '🌀 Fan Noise',
   physical_damage: '💥 Physical Damage', liquid_damage: '💧 Liquid Damage',
   frequent_disconnect: '🔄 WiFi Disconnect', door_access: '🚪 Door Access',
   mobile_not_working: '📱 Phone Issue', sim_not_working: '📡 SIM Issue',
   mobile_internet: '🌐 Mobile Internet', email_mobile: '📧 Email on Phone',
   mobile_app: '📲 Mobile App', mobile_charging: '🔋 Phone Charging',
   mobile_screen_damage: '🖥️ Phone Screen', google_drive_issue: '☁️ Google Drive',
   shared_drive_issue: '🔗 Shared Drive', file_sync_issue: '🔄 File Sync',
   storage_full: '💾 Storage Full', phishing_email: '🎣 Phishing',
   virus_malware: '🦠 Virus/Malware', suspicious_login: '🔓 Suspicious Login',
   security_alert: '🚨 Security Alert', account_hacked: '💀 Account Hacked',
   burning_smell: '🔥 EMERGENCY', battery_swelling: '🔋 EMERGENCY',
   data_loss: '💾 Data Loss', device_lost: '📱 Device Lost',
 };
 const modalTitle = ISSUE_TITLES[rawKey] || '🛠 IT Help';

 // Show loading immediately
 if (isFromModal && triggerId) {
   try {
     const lr = await client.views.push({
       trigger_id: triggerId,
       view: { type: 'modal', title: { type: 'plain_text', text: modalTitle, emoji: true }, close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '⏳ _Checking..._' }}] }
     });
     loadingViewId = lr?.view?.id;
   } catch(e) {}
 }

 try {
   const naturalProblem = KEY_TO_PROBLEM[rawKey] || rawKey;
   const emp = await lookupEmployee(userId, client).catch(() => ({ empId: userId, empName: 'User' }));

   // ── Emergency Alert — instant Slack DM to admin + show confirmation modal ──
   const EMERGENCY_KEYS = new Set(['liquid_damage','burning_smell','battery_swelling','virus_malware','account_hacked','phishing_email','suspicious_login','device_lost','data_loss','security_alert']);
   if (EMERGENCY_KEYS.has(rawKey)) {
     // Sajan's Slack User ID — hardcoded so DM always works
     const SAJAN_USER_ID = (process.env.ADMIN_SLACK_USER_ID || '').trim()
       || (process.env.ADMIN_EMAIL_SLACK_ID || '').trim()
       || 'U08K2LXAN5Q';
     const issueTitle = ISSUE_TITLES[rawKey] || rawKey;
     const empName = emp?.empName || emp?.name || '';
     const empId   = emp?.empId || '-';
     const empDept = emp?.dept || emp?.department || '-';
     const empFloor = emp?.floor || '-';

     console.log(`[EMERGENCY] key=${rawKey} user=${userId} sending to ${SAJAN_USER_ID}`);

     const emergencyBlocks = [
       { type: 'header', text: { type: 'plain_text', text: '🚨 EMERGENCY — Immediate Action Needed!', emoji: true }},
       { type: 'section', text: { type: 'mrkdwn', text: `*Emp ID:* ${empId}\n*Dept:* ${empDept}\n*Floor:* ${empFloor}` }},
       { type: 'section', text: { type: 'mrkdwn', text: `*Issue:* 🔴 *${issueTitle}*` }},
       { type: 'divider' },
       { type: 'context', elements: [{ type: 'mrkdwn', text: `_Respond immediately — employee is waiting for IT support_` }]}
     ];

     // Try sending DM — attempt 1: direct user ID
     let dmSent = false;
     let dmError1 = '', dmError2 = '';
     try {
       await client.chat.postMessage({ channel: SAJAN_USER_ID, text: `🚨 EMERGENCY: ${issueTitle} — Floor ${empFloor}`, blocks: emergencyBlocks });
       dmSent = true;
       console.log(`[EMERGENCY] DM sent via user ID ${SAJAN_USER_ID}`);
     } catch(e) {
       dmError1 = e.message;
       console.error(`[EMERGENCY] attempt1 failed (${SAJAN_USER_ID}):`, e.message);
     }

     // Attempt 2: known DM channel ID fallback
     if (!dmSent) {
       try {
         await client.chat.postMessage({ channel: 'D08K2LXF9M0', text: `🚨 EMERGENCY: ${issueTitle} — Floor ${empFloor}`, blocks: emergencyBlocks });
         dmSent = true;
         console.log(`[EMERGENCY] DM sent via channel D08K2LXF9M0`);
       } catch(e) {
         dmError2 = e.message;
         console.error(`[EMERGENCY] attempt2 failed (D08K2LXF9M0):`, e.message);
       }
     }

     // Auto-create Critical ticket for record keeping in admin panel
     createTicketSlack({
       empId: empId, empName: empName, empEmail: emp?.email || '',
       empDept: empDept, empFloor: empFloor,
       description: `🚨 EMERGENCY: ${issueTitle}`,
       category: 'Emergency', priority: 'Critical',
       source: 'slack-emergency', slackUserId: userId,
       skipDuplicateCheck: true
     }).catch(e => console.error('[EMERGENCY] ticket create error:', e.message));

     // Per-issue first-aid instructions shown to user immediately
     const EMERGENCY_STEPS = {
       liquid_damage:    '1. *TURN OFF IMMEDIATELY* — Hold power button\n2. *UNPLUG CHARGER*\n3. *TURN UPSIDE DOWN* — Let liquid drain\n4. *Do NOT use a hairdryer*\n5. Stay at your desk — IT is coming',
       burning_smell:    '1. *SHUT DOWN IMMEDIATELY*\n2. *UNPLUG from power*\n3. *Do NOT use the laptop*\n4. Move to a safe distance\n5. Stay at your desk — IT is coming',
       battery_swelling: '1. *STOP USING immediately*\n2. *UNPLUG charger*\n3. *Do NOT press on the battery*\n4. Place on flat surface\n5. Stay at your desk — IT is coming',
       virus_malware:    '1. *Disconnect from WiFi* (turn off)\n2. *Do NOT open any files or emails*\n3. *Do NOT restart the laptop*\n4. Leave it on and wait\n5. IT has been alerted and is responding',
       account_hacked:   '1. *Change your password immediately* from another device\n2. *Log out of all sessions*\n3. *Do NOT click any suspicious links*\n4. IT has been alerted\n5. Check your email for any unauthorized activity',
       phishing_email:   '1. *Do NOT click any links*\n2. *Do NOT download any attachments*\n3. *Do NOT reply to the email*\n4. Mark as spam/phishing\n5. IT has been alerted — they will investigate',
       suspicious_login: '1. *Change your password immediately*\n2. *Check active sessions* and log out all\n3. *Enable 2FA* if not already done\n4. IT has been alerted\n5. Do not access sensitive data until cleared',
       device_lost:      '1. *Note the last known location*\n2. *Change all passwords* from another device\n3. *Log out of Google/Microsoft* account remotely\n4. IT has been alerted\n5. File a complaint if stolen',
       data_loss:        '1. *STOP all work immediately*\n2. *Do NOT save anything* — you may overwrite data\n3. *Do NOT restart*\n4. IT has been alerted\n5. Stay at your desk — IT is coming',
       security_alert:   '1. *Do NOT dismiss the alert*\n2. *Disconnect from internet* if prompted\n3. *Do NOT install anything*\n4. IT has been alerted\n5. Wait for IT response before proceeding',
     };
     const steps = EMERGENCY_STEPS[rawKey] || '1. Stay calm\n2. Do not restart your device\n3. IT has been alerted\n4. Wait for IT support';

     const emergencyModal = {
       type: 'modal',
       title: { type: 'plain_text', text: '🚨 IT Alerted!', emoji: true },
       close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true },
       blocks: [
         { type: 'header', text: { type: 'plain_text', text: '✅ IT Has Been Notified', emoji: true }},
         { type: 'section', text: { type: 'mrkdwn', text: `IT team ko turant alert bhej diya gaya hai.\n\n*IT support is on the way.*` }},
         { type: 'divider' },
         { type: 'section', text: { type: 'mrkdwn', text: `*⚡ Abhi ye karo:*\n\n${steps}` }},
         { type: 'divider' },
         { type: 'context', elements: [{ type: 'mrkdwn', text: `_Alert sent to IT_` }]}
       ]
     };

     if (loadingViewId) {
       try { await client.views.update({ view_id: loadingViewId, view: emergencyModal }); } catch(e) {}
     } else if (isFromModal && triggerId) {
       try { await client.views.push({ trigger_id: triggerId, view: emergencyModal }); } catch(e) {}
     }
     return; // Stop here — no KB/AI response, no ticket button
   }

   // ── KB-FIRST: Use direct KB answer if available (no AI call needed) ──────
   // Guarantees correct answer even when Groq is rate-limited
   let reply = claudeSvc.DIRECT_KB?.[rawKey] || null;

   if (!reply) {
     // No direct KB — call AI
     const aiPrompt = `Employee selected this issue from IT Helpdesk: "${naturalProblem}"\n\nGive direct troubleshooting steps. Do not ask questions. Max 3-4 simple steps. End with: "If not resolved → *Create Ticket* button dabao."`;
     const messages = [{ role: 'user', content: aiPrompt }];
     const result = await claudeSvc.chat(messages, { empId: emp.empId, empName: emp.empName, source: 'slack' });
     reply = result.reply;
   }

   // Strip any residual "type karo ha" instructions — Messages Tab is disabled, users can only click buttons
   reply = reply
     .replace(/type\s+karo\s+\*?ha\*?[,\s—–]*[^.\n]*[🎫]?/gi, '')
     .replace(/type\s+karein\s+\*?ha\*?[,\s—–]*[^.\n]*[🎫]?/gi, '')
     .replace(/Agar\s+theek\s+nahi\s+hua[,—–\s]+type\s+karo[^.]*\./gi, '')
     .replace(/type\s+karo\s+ha[^.]*\./gi, '')
     .replace(/\n{3,}/g, '\n\n')
     .trim();

   const formattedReply = formatForSlack(reply);
   // IT-only issues — no "Yes Fixed!" button (user can't self-fix these)
   const itOnlyIssues = ['password_reset','account_locked','email_access','software_access','office_activation','shared_folder','new_laptop','new_mouse','new_keyboard','new_headphone','new_monitor','new_charger','door_access','mobile_not_working','sim_not_working','mobile_internet','email_mobile','mobile_app','mobile_charging','mobile_screen_damage','google_drive_issue','shared_drive_issue','file_sync_issue','phishing_email','suspicious_login','security_alert','account_hacked','burning_smell','battery_swelling','data_loss','physical_damage','liquid_damage','storage_full'];
   const isItOnly = itOnlyIssues.includes(rawKey);
   const blocks = [
     { type: 'section', text: { type: 'mrkdwn', text: formattedReply }},
     { type: 'divider' },
   ];

   // ── Auto-Fix section — laptop_slow style for ALL auto-fix issues ─────────
   const autoFix = AUTO_FIX[rawKey];
   // Per-issue descriptions for what each script does
   const AUTO_FIX_STEPS = {
     laptop_slow:      '✓ Clear temporary files\n✓ Refresh performance settings\n✓ Restart Windows Explorer\n✓ Clean junk files',
     overheat:         '✓ Check CPU/GPU load\n✓ Disable background processes\n✓ Reset power settings\n✓ Clean temp files',
     wifi_not_connect: '✓ Reset network adapter\n✓ Flush DNS cache\n✓ Renew IP address\n✓ Restart WiFi service',
     no_internet:      '✓ Reset network adapter\n✓ Flush DNS cache\n✓ Renew IP address\n✓ Restart network stack',
     internet_slow:    '✓ Flush DNS cache\n✓ Reset TCP/IP stack\n✓ Clear browser cache\n✓ Optimize network settings',
     keys_not_working: '✓ Reset keyboard driver\n✓ Check filter keys settings\n✓ Restart HID service\n✓ Clear key buffer',
     touchpad_issue:   '✓ Re-enable touchpad\n✓ Reset touchpad driver\n✓ Check accessibility settings\n✓ Restart HID service',
     camera_issue:     '✓ Reset camera driver\n✓ Check privacy settings\n✓ Restart camera service\n✓ Re-register camera device',
     mic_issue:        '✓ Reset microphone driver\n✓ Check privacy/permissions\n✓ Set default recording device\n✓ Restart audio service',
     sound_none:       '✓ Reset audio driver\n✓ Set default playback device\n✓ Restart Windows Audio\n✓ Check volume mixer',
     screen_black:     '✓ Refresh display driver\n✓ Reset screen resolution\n✓ Restart explorer.exe\n✓ Check display settings',
     blue_screen:      '✓ Clear crash dump files\n✓ Check disk errors\n✓ Repair system files (SFC)\n✓ Reset driver settings',
     external_monitor: '✓ Refresh display settings\n✓ Restart display driver\n✓ Detect external displays\n✓ Reset HDMI/DisplayPort',
     browser_slow:     '✓ Clear browser cache\n✓ Remove temp files\n✓ Disable problematic extensions\n✓ Reset browser settings',
     pdf_issue:        '✓ Repair PDF reader\n✓ Clear PDF cache\n✓ Reset file associations\n✓ Restart PDF service',
     teams_issue:      '✓ Clear Teams cache\n✓ Restart Teams service\n✓ Reset Teams settings\n✓ Re-register Teams app',
     zoom_issue:       '✓ Clear Zoom cache\n✓ Reset Zoom audio/video\n✓ Repair Zoom install\n✓ Restart Zoom service',
     printer_issue:    '✓ Restart print spooler\n✓ Clear print queue\n✓ Re-detect printer\n✓ Reset printer driver',
   };

   if (autoFix) {
     const steps = AUTO_FIX_STEPS[rawKey] || '✓ Diagnose issue\n✓ Reset settings\n✓ Refresh driver/service\n✓ Clean temporary files';
     blocks.push({
       type: 'section',
       text: { type: 'mrkdwn', text: `*⚡ Auto Fix*\n\nThis script will automatically:\n\n${steps}\n\n*Estimated Time:* 1-2 minutes\n*Success Rate:* 80%+\n\n_Safe to run — no data will be deleted_` }
     });
     blocks.push({ type: 'actions', elements: [{
       type: 'button',
       text: { type: 'plain_text', text: `🔧 Download & Run Auto Fix`, emoji: true },
       style: 'primary',
       url: `${PORTAL}/scripts/${autoFix.file}`,
       action_id: `dl_autofix_${rawKey}`
     }]});
     blocks.push({ type: 'divider' });
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*After running Auto Fix — is it resolved?*' }});
     blocks.push({ type: 'actions', elements: [
       { type: 'button', text: { type: 'plain_text', text: '🟢 Yes, Fixed!', emoji: true }, action_id: 'resolved_yes_btn', style: 'primary', value: 'Medium' },
       { type: 'button', text: { type: 'plain_text', text: '🔴 No, Still Issue', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: naturalProblem },
     ]});
   } else {
     // No auto-fix available — show simple resolved/ticket buttons
     const actionElements = [];
     if (!isItOnly) actionElements.push({ type: 'button', text: { type: 'plain_text', text: '✅ Yes, Fixed!', emoji: true }, action_id: 'resolved_yes_btn', style: 'primary', value: 'Medium' });
     actionElements.push({ type: 'button', text: { type: 'plain_text', text: '🎫 Create Ticket', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: naturalProblem });
     blocks.push({ type: 'actions', elements: actionElements });
   }

   const modalView = { type: 'modal', title: { type: 'plain_text', text: modalTitle, emoji: true }, close: { type: 'plain_text', text: '⬅ Previous Menu', emoji: true }, blocks };

   if (loadingViewId) {
     try { await client.views.update({ view_id: loadingViewId, view: modalView }); } catch(e) {}
   } else if (isFromModal && triggerId) {
     try { await client.views.push({ trigger_id: triggerId, view: modalView }); } catch(e) {}
   } else {
     await client.chat.postMessage({ channel: userId, text: reply, blocks });
   }
 } catch(err) {
   console.error('vague_pick error:', rawKey, err.message);
   if (loadingViewId) {
     try { await client.views.update({ view_id: loadingViewId, view: { type: 'modal', title: { type: 'plain_text', text: 'Error' }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Something went wrong. Please try again.' }}] }}); } catch(e) {}
   } else {
     // No modal open (Home Tab context) — send fallback DM
     await client.chat.postMessage({ channel: userId, text: `❌ Something went wrong. Please try again or email IT: ${ADMIN_EMAIL}` })
       .catch(e => console.error('vague_pick fallback DM error:', e.message));
   }
 }
 });

 // ── FEATURE 8: Rating action handler ─────────────────────────────────
 slackApp.action('rate_ticket', async ({ body, ack, client }) => {
 await ack();
 try {
 const value = body.actions[0].value; // "WIOM-TKT-0001:4"
 const [ticketId, ratingStr] = value.split(':');
 const rating = parseInt(ratingStr);
 const userId = body.user.id;

 await Ticket.findOneAndUpdate(
 { ticketId },
 { userRating: rating, userFeedback: `${rating}/5 stars via Slack` }
 );

 const stars = '⭐'.repeat(rating);
 const ratingMsg = rating >= 4 ? 'Thank you! Great feedback received '
 : rating >= 3 ? 'Thank you! We will keep improving '
 : 'Thank you! We will use this feedback to improve ';

 await client.chat.update({
 channel: body.channel?.id || body.container?.channel_id,
 ts : body.message.ts,
 text : `✅ Ticket ${ticketId} Rating: ${stars}`,
 blocks : [
 { type:'section', text:{ type:'mrkdwn', text:
 `✅ *Ticket \`${ticketId}\` has been resolved!*\n\n*Your Rating:* ${stars} (${rating}/5)\n${ratingMsg}`
 }},
 { type:'context', elements:[{ type:'mrkdwn', text:`IT Helpdesk: IT Helpdesk (Slack) | Let us know if you need more help!` }]}
 ]
 });
 console.log(`⭐ Rating ${rating}/5 saved for ${ticketId}`);
 } catch (err) {
 console.error('Rating action error:', err.message);
 }
 });

 // ── APP HOME TAB ─────────────────────────────────────────────────────
 // Track who got the greeting DM already (so it only sends once per session)
 const greetedUsers = new Set();
 // Clear greetedUsers every 6 hours to prevent memory leak
 setInterval(() => greetedUsers.clear(), 6 * 60 * 60 * 1000);

 slackApp.event('app_home_opened', async ({ event, client }) => {
 try {
   const userId = event.user;
   const emp = await Employee.findOne({ $or: [{ slackUserId: userId }, { empId: userId }] });
   let myTickets = [], resolvedCount = 0, avgHrs = 0;
   if (emp?.empId) {
     const [openTickets, resolvedTickets] = await Promise.all([
       Ticket.find({ empId: emp.empId, status: { $in: ['Open', 'In Progress', 'Waiting'] } }).sort({ createdAt: -1 }).limit(3).lean(),
       Ticket.find({ empId: emp.empId, status: { $in: ['Resolved', 'Closed'] }, resolvedAt: { $exists: true } }).select('resolvedAt createdAt').lean()
     ]);
     myTickets = openTickets;
     resolvedCount = resolvedTickets.length;
     if (resolvedCount > 0) {
       const totalHrs = resolvedTickets.reduce((sum, t) => sum + (new Date(t.resolvedAt) - new Date(t.createdAt)) / 3600000, 0);
       avgHrs = Math.round(totalHrs / resolvedCount);
     }
   }
   const expandedSet = expandedHomeMap.get(userId) || new Set();
   const blocks = buildHomeBlocks(emp, myTickets, expandedSet, { resolvedCount, avgHrs });
   await client.views.publish({ user_id: userId, view: { type: 'home', blocks } });
 } catch (err) {
   console.error('App Home error:', err.message);
 }
 });

 // ── Category toggle handlers (Home Tab accordion) ─────────────────────
 LEGACY_CATEGORIES.forEach(cat => {
 slackApp.action(`cat_toggle_${cat.key}`, async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 if (!expandedHomeMap.has(userId)) expandedHomeMap.set(userId, new Set());
 const userExpanded = expandedHomeMap.get(userId);
 if (userExpanded.has(cat.key)) userExpanded.delete(cat.key);
 else userExpanded.add(cat.key);

 try {
 const emp = await Employee.findOne({ $or: [{ slackUserId: userId }, { empId: userId }] });
 let myTickets = [];
 if (emp?.empId) myTickets = await Ticket.find({ empId: emp.empId, status: { $in: ['Open', 'In Progress', 'Waiting'] } }).sort({ createdAt: -1 }).limit(3).lean();
 const blocks = buildHomeBlocks(emp, myTickets, userExpanded);
 await client.views.publish({ user_id: userId, view: { type: 'home', blocks } });
 } catch (err) {
 console.error('cat_toggle error:', err.message);
 }
 });
 });

 // ── Home Tab "Search / Message Zivon" button ──────────────────────────
 slackApp.action('home_open_dm', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   try {
     const dm = await client.conversations.open({ users: userId });
     const emp = await lookupEmployee(userId, client).catch(() => null);
     const firstName = (emp?.empName || 'there').split(' ')[0];
     await client.chat.postMessage({ channel: dm.channel.id, text: `👋 ${firstName}! Apni problem type karo — main turant help karunga.` });
   } catch (err) { console.error('home_open_dm error:', err.message); }
 });

 // ── My Tickets button — show pending tickets with IT urgency message ────────
 slackApp.action('dm_my_tickets', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   // From Home Tab, body.channel is null — use conversations.open to get real DM channel ID
   let channelId = body.channel?.id;
   if (!channelId) {
     try {
       const dm = await client.conversations.open({ users: userId });
       channelId = dm.channel.id;
     } catch (e) {
       channelId = userId; // last-resort fallback
       console.error('dm_my_tickets conversations.open error:', e.message);
     }
   }
   try {
     const emp = await lookupEmployee(userId, client);
     const tickets = await Ticket.find({
       $or: [{ empId: emp.empId }, { slackUserId: userId }],
       status: { $nin: ['Closed', 'Resolved'] }
     }).sort({ createdAt: -1 }).limit(5);

     if (!tickets.length) {
       await client.chat.postMessage({
         channel: channelId,
         text: 'No pending tickets!',
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `✅ *No pending tickets!*\n\nAll clear — if you have a new problem, just select a category from the Home tab! 😊` } },
           { type: 'context', elements: [{ type: 'mrkdwn', text: '_WIOM IT Helpdesk — Available 24/7 ✦_' }] }
         ]
       });
       return;
     }

     const priEmoji = { Critical: '🔴', High: '🟠', Medium: '🟡', Low: '🟢' };
     const statEmoji = { Open: '⏳', 'In Progress': '🔧', Waiting: '⏸️', Resolved: '✅' };

     // Build blocks with per-ticket action buttons (Cancel / Escalate / Add Update)
     const ticketBlocks = [];
     ticketBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*📋 Your Pending Tickets (${tickets.length}):*` }});
     ticketBlocks.push({ type: 'divider' });

     tickets.forEach(t => {
       const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
       const age = hrs >= 24 ? `${Math.floor(hrs/24)}d ${hrs%24}h` : `${hrs}h`;
       ticketBlocks.push({ type: 'section', text: { type: 'mrkdwn', text:
         `${priEmoji[t.priority] || '🟡'} *\`${t.ticketId}\`*  ${statEmoji[t.status] || '⏳'} *${t.status}*  _${age} ago_\n` +
         `> ${(t.description || '').replace(/\n/g, ' ').substring(0, 80)}`
       }});
       // Action buttons per ticket
       const actionBtns = [];
       if (['Open', 'Waiting'].includes(t.status)) {
         actionBtns.push({ type: 'button', text: { type: 'plain_text', text: '❌ Cancel', emoji: true }, style: 'danger', action_id: `cancel_ticket_${t.ticketId}`, value: t.ticketId });
       }
       if (!['Resolved','Closed'].includes(t.status) && t.priority !== 'Critical') {
         actionBtns.push({ type: 'button', text: { type: 'plain_text', text: '⬆️ Escalate', emoji: true }, action_id: `bump_priority_${t.ticketId}`, value: t.ticketId });
       }
       actionBtns.push({ type: 'button', text: { type: 'plain_text', text: '💬 Add Update', emoji: true }, style: 'primary', action_id: `add_comment_ticket_${t.ticketId}`, value: t.ticketId });
       if (actionBtns.length) ticketBlocks.push({ type: 'actions', elements: actionBtns });
       ticketBlocks.push({ type: 'divider' });
     });

     const hasCritical = tickets.some(t => t.priority === 'Critical' || t.priority === 'High');
     const urgencyMsg = hasCritical
       ? `_🚨 You have a *High/Critical* ticket — IT team is looking into it urgently!_`
       : `_IT team will resolve these shortly — use ⬆️ Escalate if it becomes urgent!_`;
     ticketBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: urgencyMsg }] });

     await client.chat.postMessage({
       channel: channelId,
       text: `Your ${tickets.length} pending ticket(s)`,
       blocks: ticketBlocks
     });
   } catch (err) {
     console.error('dm_my_tickets error:', err.message);
     await client.chat.postMessage({ channel: channelId, text: '❌ Could not load tickets. Please try again.' });
   }
 });

 // ── Contact IT button → show phone number modal ──────────────────────
 // ── "Chat with AI" button → open DM with category picker ────────────
 slackApp.action('home_chat_ai', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   try {
     const emp = await lookupEmployee(userId, client).catch(() => null);
     const firstName = (emp?.empName || 'there').split(' ')[0];
     await client.chat.postMessage({ channel: userId, text: `👋 ${firstName}! Apni problem type karo — main turant help karunga.` });
   } catch (err) { console.error('home_chat_ai error:', err.message); }
 });

 // ═══════════════════════════════════════════════════════════════════════
 // ASK ZIVON AI — Modal chatbot on Home Tab
 // ═══════════════════════════════════════════════════════════════════════

 const buildAskZivonInputModal = () => ({
   type: 'modal',
   callback_id: 'zivon_modal_submit',
   title: { type: 'plain_text', text: '🤖 Ask IT Assistant', emoji: true },
   submit: { type: 'plain_text', text: '🔍 Get Answer', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [
     {
       type: 'section',
       text: { type: 'mrkdwn', text: 'WiFi, laptop, software, password — *ask any IT question!* WIOM IT Assistant will answer instantly. 🚀' }
     },
     {
       type: 'input',
       block_id: 'zivon_q_block',
       label: { type: 'plain_text', text: 'Type your IT question:', emoji: true },
       element: {
         type: 'plain_text_input',
         action_id: 'zivon_q_input',
         placeholder: { type: 'plain_text', text: 'e.g. WiFi not working, laptop slow, forgot password...' },
         multiline: true,
         min_length: 5,
         max_length: 400
       }
     }
   ]
 });

 const buildZivonLoadingModal = () => ({
   type: 'modal',
   callback_id: 'zivon_modal_loading',
   title: { type: 'plain_text', text: '🤖 WIOM IT Assistant', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [{
     type: 'section',
     text: { type: 'mrkdwn', text: '*Thinking...* ⏳\n\n_Finding the answer to your question..._\n_Just a moment — your answer will be ready in seconds!_ ✨' }
   }]
 });

 const buildZivonAnswerModal = (question, answer) => ({
   type: 'modal',
   callback_id: 'zivon_modal_answer',
   title: { type: 'plain_text', text: '🤖 WIOM IT Assistant', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [
     {
       type: 'section',
       text: { type: 'mrkdwn', text: `*Question:*\n_${question.substring(0, 120).replace(/[*_`]/g, '')}_` }
     },
     { type: 'divider' },
     {
       type: 'section',
       text: { type: 'mrkdwn', text: answer.substring(0, 2900) }
     },
     { type: 'divider' },
     {
       type: 'section',
       text: { type: 'mrkdwn', text: '_Problem not solved? Raise a ticket — IT team will personally help you._' }
     },
     {
       type: 'actions',
       elements: [
         {
           type: 'button',
           text: { type: 'plain_text', text: '🔄 Ask More', emoji: true },
           action_id: 'zivon_modal_more',
           value: 'ask_more'
         },
         {
           type: 'button',
           text: { type: 'plain_text', text: '🎫 Raise Ticket', emoji: true },
           action_id: 'vague_pick_create_ticket',
           value: 'create ticket',
           style: 'primary'
         }
       ]
     }
   ]
 });

 const buildZivonErrorModal = () => ({
   type: 'modal',
   callback_id: 'zivon_modal_error',
   title: { type: 'plain_text', text: '🤖 WIOM IT Assistant', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [
     {
       type: 'section',
       text: { type: 'mrkdwn', text: '⚠️ *A technical issue occurred.*\n\nPlease try again — or raise a ticket, the IT team will help you directly! 🎫' }
     },
     {
       type: 'actions',
       elements: [
         {
           type: 'button',
           text: { type: 'plain_text', text: '🔄 Try Again', emoji: true },
           action_id: 'zivon_modal_more',
           value: 'ask_more'
         },
         {
           type: 'button',
           text: { type: 'plain_text', text: '🎫 Create Ticket', emoji: true },
           action_id: 'vague_pick_create_ticket',
           value: 'create ticket',
           style: 'primary'
         }
       ]
     }
   ]
 });

 // ── Button click on Home Tab → open input modal ──────────────────────────
 slackApp.action('zivon_modal_ask', async ({ body, ack, client }) => {
   await ack();
   try {
     await client.views.open({ trigger_id: body.trigger_id, view: buildAskZivonInputModal() });
   } catch (err) {
     console.error('zivon_modal_ask open error:', err.message);
   }
 });

 // ════════════════════════════════════════════════════════════════════════
 // DIAGNOSE MY LAPTOP
 // ════════════════════════════════════════════════════════════════════════

 const SCRIPTS_URL = process.env.API_BASE_URL || 'https://wiom-helpdesk-production.up.railway.app';
 const DIAGNOSE_SYMPTOMS = {
   slow:    { label: '🐢 Laptop slow / hanging',          fix: '• Restart your laptop\n• Open Task Manager *(Ctrl+Shift+Esc)* and close heavy apps\n• Close extra Chrome tabs',                           bat: `${SCRIPTS_URL}/scripts/fix-slow-laptop.bat`,   batLabel: '⬇️ Slow Laptop Fix Script' },
   disk:    { label: '💾 Storage / disk space low',       fix: '• Delete old files from the Downloads folder\n• Empty the Recycle Bin (right-click → Empty)\n• Remove unnecessary files from Desktop',   bat: `${SCRIPTS_URL}/scripts/fix-storage.bat`,       batLabel: '⬇️ Storage Cleanup Script' },
   internet:{ label: '📶 Internet not working',           fix: '• Click WiFi icon in taskbar → turn off then on\n• Check that Airplane mode is OFF\n• Restart your laptop',                               bat: `${SCRIPTS_URL}/scripts/fix-wifi.bat`,          batLabel: '⬇️ WiFi Fix Script',       autoVal: 'WiFi not working no internet connection' },
   teams:   { label: '👥 Teams not working / crashing',   fix: '• Close Teams from Task Manager *(Ctrl+Shift+Esc → Teams → End Task)*\n• Reopen Teams\n• Check internet connection',                     bat: `${SCRIPTS_URL}/scripts/fix-teams.bat`,         batLabel: '⬇️ Teams Fix Script',      autoVal: 'Microsoft Teams not working call dropping or not opening' },
   outlook: { label: '📧 Outlook / Gmail not opening',    fix: '• Close the application and reopen it\n• Check your internet connection\n• Try opening Gmail.com in browser',                            bat: `${SCRIPTS_URL}/scripts/fix-outlook.bat`,       batLabel: '⬇️ Outlook Fix Script' },
   camera:  { label: '📷 Camera not working',             fix: '• Go to Windows Settings → Privacy → Camera → turn Allow ON\n• Check camera permission in Teams/Zoom\n• Restart your laptop',            bat: `${SCRIPTS_URL}/scripts/fix-camera.bat`,        batLabel: '⬇️ Camera Fix Script',     autoVal: 'Laptop camera not working in Teams Zoom or Meet' },
   sound:   { label: '🔇 Sound / speakers not working',   fix: '• Check speaker icon in taskbar — is it muted?\n• Plug/unplug headphones\n• Check volume is not at zero',                                bat: `${SCRIPTS_URL}/scripts/fix-sound.bat`,         batLabel: '⬇️ Sound Fix Script',      autoVal: 'No sound coming from laptop speakers audio not working' },
   heat:    { label: '🔥 Laptop hot / fan very loud',     fix: '• Place laptop on a hard flat surface\n• Do not block the fan area\n• Close heavy apps and let it rest for 5 min',                       bat: `${SCRIPTS_URL}/scripts/fix-overheating.bat`,   batLabel: '⬇️ Overheating Fix Script' },
   battery: { label: '🔋 Battery drains quickly',         fix: '• Lower screen brightness (taskbar)\n• Turn on Battery Saver mode (taskbar battery icon)\n• Close background apps',                     bat: `${SCRIPTS_URL}/scripts/fix-battery.bat`,       batLabel: '⬇️ Battery Fix Script' },
   screen:  { label: '💻 Screen / display issue',         fix: '• Press *Win+P* → check display mode\n• Check external monitor cable\n• Check brightness settings',                                      bat: `${SCRIPTS_URL}/scripts/fix-screen-flicker.bat`,batLabel: '⬇️ Screen Fix Script',     autoVal: 'Laptop screen is flickering blinking or flashing' },
 };

 const buildDiagnoseInputModal = () => ({
   type: 'modal',
   callback_id: 'diagnose_laptop_submit',
   title: { type: 'plain_text', text: '🔍 Diagnose My Laptop', emoji: true },
   submit: { type: 'plain_text', text: '🔍 Diagnose', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [
     { type: 'section', text: { type: 'mrkdwn', text: '*What is happening with your laptop?*\nSelect all problems below 👇' } },
     { type: 'divider' },
     { type: 'input', block_id: 'diagnose_block',
       label: { type: 'plain_text', text: 'Select problems:', emoji: true },
       element: { type: 'checkboxes', action_id: 'symptoms_select',
         options: Object.entries(DIAGNOSE_SYMPTOMS).map(([val, s]) => ({
           text: { type: 'plain_text', text: s.label, emoji: true }, value: val
         }))
       }
     }
   ]
 });

 const buildDiagnoseResultModal = (symptoms) => {
   const blocks = [];
   if (!symptoms.length) {
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '✅ *No major issue detected!*\nYour laptop looks fine. For a specific problem, ask IT Assistant.' } });
     return { type: 'modal', title: { type: 'plain_text', text: '🔍 Diagnosis Result', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true }, blocks };
   }
   blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🔍 Diagnosis Complete — ${symptoms.length} problem${symptoms.length > 1 ? 's' : ''} found*\nFix steps are below 👇` } });
   for (const key of symptoms) {
     const s = DIAGNOSE_SYMPTOMS[key];
     if (!s) continue;
     blocks.push({ type: 'divider' });
     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${s.label}*\n\n${s.fix}` } });
     const btnElements = [];
     if (s.bat) btnElements.push({ type: 'button', text: { type: 'plain_text', text: s.batLabel, emoji: true }, url: s.bat, action_id: `bat_dl_${key}` });
     if (s.autoVal) btnElements.push({ type: 'button', text: { type: 'plain_text', text: '🤖 Ask AI', emoji: true }, action_id: 'diagnose_auto_fix', value: s.autoVal });
     if (btnElements.length) blocks.push({ type: 'actions', elements: btnElements });
   }
   blocks.push({ type: 'divider' });
   blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Still having issues after the steps? Raise a ticket._' } });
   blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '🎫 Raise Ticket', emoji: true }, action_id: 'vague_pick_create_ticket', value: 'create ticket', style: 'danger' }]});
   return { type: 'modal', callback_id: 'diagnose_laptop_result', title: { type: 'plain_text', text: '🔍 Diagnosis Result', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true }, blocks };
 };

 // ── Diagnose submit ───────────────────────────────────────────────────────
 slackApp.view('diagnose_laptop_submit', async ({ ack, view }) => {
   const selected = view.state.values?.diagnose_block?.symptoms_select?.selected_options || [];
   await ack({ response_action: 'update', view: buildDiagnoseResultModal(selected.map(o => o.value)) });
 });

 // ── Fix Automatically → KB answer as DM ──────────────────────────────────
 slackApp.action('diagnose_auto_fix', async ({ body, ack, client }) => {
   await ack();
   const userId  = body.user.id;
   const problem = body.actions[0].value;
   const viewId  = body.view?.id;

   try {
     const kbAnswer = claudeSvc.getKBFallback ? claudeSvc.getKBFallback(problem) : null;
     const dmRes = await client.conversations.open({ users: userId });
     await client.chat.postMessage({
       channel: dmRes.channel.id,
       text: '🔧 Auto-Fix Steps',
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: '*🔧 Auto-Fix Steps — Follow these:*' } },
         { type: 'divider' },
         { type: 'section', text: { type: 'mrkdwn', text: kbAnswer || 'Restart your laptop. If it still does not work, raise a ticket.' } },
         { type: 'divider' },
         { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '🎫 Raise Ticket', emoji: true }, action_id: 'vague_pick_create_ticket', value: 'create ticket', style: 'primary' }]}
       ]
     });
   } catch (err) { console.error('diagnose_auto_fix DM:', err.message); }

   try {
     if (viewId) await client.views.update({ view_id: viewId, view: { type: 'modal', title: { type: 'plain_text', text: '🔧 Fix Steps', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '✅ *Fix steps sent to your Slack DM!*\nCheck your DM and follow the steps.\n\n_Still having issues? Raise a ticket._' } }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '🎫 Raise Ticket', emoji: true }, action_id: 'vague_pick_create_ticket', value: 'create ticket', style: 'primary' }]}] } });
   } catch { /* modal closed */ }
 });

 // ── "Aur Puchho" button → reset back to fresh input form ────────────────
 slackApp.action('zivon_modal_more', async ({ body, ack, client }) => {
   await ack();
   try {
     await client.views.update({ view_id: body.view.id, view: buildAskZivonInputModal() });
   } catch (err) {
     console.error('zivon_modal_more error:', err.message);
   }
 });

 // ── Modal submit → loading → KB/AI → answer ──────────────────────────────
 slackApp.view('zivon_modal_submit', async ({ body, ack, view, client }) => {
   const question = (view.state.values?.zivon_q_block?.zivon_q_input?.value || '').trim();
   const userId = body.user.id;
   const viewId = view.id;

   // Short query guard
   if (question.length < 5) {
     await ack({ response_action: 'errors', errors: { zivon_q_block: 'Please provide more detail (min 5 characters)' } });
     return;
   }

   // Double-click protection BEFORE ack — prevents stuck loading modal on race
   if (processingUsers.has(userId)) {
     await ack({ response_action: 'update', view: buildZivonLoadingModal() });
     return;
   }
   processingUsers.add(userId);

   // Show loading modal immediately
   await ack({ response_action: 'update', view: buildZivonLoadingModal() });

   try {
     const emp = await Employee.findOne({ slackUserId: userId })
       .select('empId name empName laptop laptopSN dept floor').lean().catch(() => null);

     // KB pre-check first — instant, no AI call if answer is found
     const KB_GENERIC = 'Please provide more details about your problem';
     const kbAnswer = claudeSvc.getKBFallback ? claudeSvc.getKBFallback(question) : null;
     let answer;

     if (kbAnswer && !kbAnswer.startsWith(KB_GENERIC) && kbAnswer.length > 30) {
       answer = kbAnswer;
     } else {
       // AI call with 20-second hard timeout — prevents stuck loading modal
       const aiCall = claudeSvc.chat(
         [{ role: 'user', content: question }],
         {
           empId   : emp?.empId    || userId,
           empName : emp?.name     || emp?.empName || 'Employee',
           laptop  : emp?.laptop   || null,
           laptopSN: emp?.laptopSN || null,
           source  : 'modal'
         }
       );
       const timeout = new Promise((_, reject) =>
         setTimeout(() => reject(new Error('AI_TIMEOUT')), 20000)
       );
       const result = await Promise.race([aiCall, timeout]);
       answer = result?.reply || 'Sorry, could not get an answer. Please raise a ticket — IT team will help you! 🎫';
     }

     if (answer.length > 2900) answer = answer.substring(0, 2897) + '...';

     await client.views.update({ view_id: viewId, view: buildZivonAnswerModal(question, answer) });

   } catch (err) {
     console.error('zivon_modal_submit error:', err.message);
     try {
       await client.views.update({ view_id: viewId, view: buildZivonErrorModal() });
     } catch { /* user closed modal — ignore */ }
   } finally {
     processingUsers.delete(userId);
   }
 });

 // ── Office Net Down — DEDICATED standalone handler (also in forEach for backup) ──
slackApp.action('home_quick_office_net_down', async ({ body, ack, client }) => {
  await ack();
  const userId = body.user.id;
  console.log('OFFICE_NET_DOWN STANDALONE FIRED userId:', userId);
  try {
    await client.views.publish({
      user_id: userId,
      view: {
        type: 'home',
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: '*🌐 Office Internet Down*\nWhich floor is affected? Click a button below 👇' } },
          { type: 'divider' },
          { type: 'actions', elements: [
            { type: 'button', text: { type: 'plain_text', text: '🏢 Ground Floor', emoji: true }, action_id: 'office_net_floor_select', value: 'Ground Floor', style: 'danger' },
            { type: 'button', text: { type: 'plain_text', text: '🏢 3rd Floor', emoji: true }, action_id: 'office_net_floor_select', value: '3rd Floor', style: 'danger' },
          ]},
          { type: 'divider' },
          { type: 'actions', elements: [
            { type: 'button', text: { type: 'plain_text', text: '← Go Back', emoji: true }, action_id: 'go_home_btn', value: 'home' },
          ]}
        ]
      }
    });
  } catch(e) { console.error('OFFICE_NET_DOWN PUBLISH ERR:', e.message); }
});

 // ── Office Net Down — floor selected → update Home Tab with confirmation ──
slackApp.action('office_net_floor_select', async ({ body, ack, client }) => {
  await ack();
  const userId = body.user.id;
  const floor  = body.actions[0].value;

  // Update Home Tab with confirmation (views.publish — no trigger_id/DM needed)
  try {
    await client.views.publish({
      user_id: userId,
      view: {
        type: 'home',
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `✅ *${floor} — Reported!*\n\nIT team has been alerted.` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: `*What to do now:*\n• 📶 WiFi disconnected → reconnect to WiFi\n• 🔌 Using LAN cable → check the cable\n• ⏳ IT team is working on it — please wait` } },
          { type: 'divider' },
          { type: 'actions', elements: [
            { type: 'button', text: { type: 'plain_text', text: '🎫 Raise Ticket', emoji: true }, action_id: 'vague_pick_create_ticket', value: 'create ticket', style: 'primary' },
            { type: 'button', text: { type: 'plain_text', text: '🏠 Back to Home', emoji: true }, action_id: 'go_home_btn', value: 'home' },
          ]}
        ]
      }
    });
  } catch (err) { console.error('office_net_floor_select publish error:', err.message); }

  // Auto-create ticket for IT dashboard
  try {
    const emp = await Employee.findOne({ slackUserId: userId });
    if (emp?.empId) {
      await createTicketSlack({
        empId: emp.empId, empName: emp.name || emp.empName,
        empEmail: emp.email || 'unknown@wiom.in',
        empDept: emp.department, empFloor: emp.floor,
        description: `🌐 Office Internet Down — ${floor} floor. Reported via WIOM IT bot.`,
        category: 'Network', priority: 'High',
        source: 'slack', slackUserId: userId
      });
    }
  } catch (err) { console.error('office_net_floor_select ticket error:', err.message); }
});

slackApp.action('home_contact_it', async ({ body, ack, client }) => {
 await ack();
 try {
 await client.views.open({
 trigger_id: body.trigger_id,
 view: {
 type: 'modal',
 title: { type: 'plain_text', text: '📞 Contact IT', emoji: true },
 close: { type: 'plain_text', text: 'Close', emoji: true },
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: '*Contact IT directly:*' }},
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: '💬 *Slack:*\nSend a DM to Sajan Kumar on Slack' }},
 { type: 'section', text: { type: 'mrkdwn', text: `📧 *Email:*\n${ADMIN_EMAIL}` }},
 ]
 }
 });
 } catch (err) {
 console.error('home_contact_it error:', err.message);
 }
 });

 // ── SOS Issue selected → show confirmation in modal + alert admin + auto-ticket
 // FIX: Was sending DM (invisible with Messages Tab OFF). Now updates the SOS modal directly.
 slackApp.action('sos_issue', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const issueType = body.actions[0].value;
   const viewId = body.view?.id; // SOS modal is already open
   try {
     const emp = await Employee.findOne({ slackUserId: userId });
     const name = emp?.name?.split(' ')[0] || 'Employee';

     const isSecurity = /virus|ransomware|hack|data lost/i.test(issueType);
     const isNetwork  = /internet|vpn|network/i.test(issueType);
     const category   = isSecurity ? 'Software' : isNetwork ? 'Network' : 'Hardware';
     const priority   = /water|liquid|virus|ransomware|data lost|dead/i.test(issueType) ? 'Critical' : 'High';

     // Auto-create ticket
     let ticketId = null;
     if (emp?.empId) {
       try {
         const result = await createTicketSlack({
           empId: emp.empId, empName: emp.empName || emp.name, empEmail: emp.email,
           empDept: emp.dept, empFloor: emp.floor,
           laptop: emp.laptop, laptopSN: emp.laptopSN,
           description: `🆘 SOS: ${issueType}`,
           category, priority,
           source: 'slack-sos', slackUserId: userId
         });
         if (result && !result._duplicate) {
           ticketId = result.ticketId;
           await notifyAdmin(client, result, emp);
         }
       } catch (ticketErr) {
         console.error('SOS ticket error:', ticketErr.message);
       }
     }

     // Show confirmation INSIDE the modal (visible regardless of Messages Tab setting)
     if (viewId) {
       await client.views.update({ view_id: viewId, view: {
         type: 'modal',
         title: { type: 'plain_text', text: '🆘 SOS Registered!', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text:
             `🆘 *${name}, your emergency has been registered!*\n\n` +
             `*Issue:* ${issueType.split(' — ')[0]}\n` +
             `*Priority:* 🔴 ${priority}\n\n` +
             (ticketId ? `✅ *Ticket Created:* \`${ticketId}\`` : '✅ *IT team has been alerted!*')
           }},
           { type: 'divider' },
           { type: 'context', elements: [{ type: 'mrkdwn', text: `📧 IT Direct: ${ADMIN_EMAIL} | 💬 Slack: DM Sajan Kumar` }]}
         ]
       }}).catch(e => console.error('sos modal update error:', e.message));
     }

     // Emergency alert to admin — instant Slack DM to Sajan
     const adminId = process.env.ADMIN_SLACK_USER_ID || process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID;
     if (adminId) {
       await client.chat.postMessage({
         channel: adminId,
         text: `🚨 EMERGENCY from ${emp?.name || userId}: ${issueType.split(' — ')[0]}`,
         blocks: [
           { type: 'header', text: { type: 'plain_text', text: '🚨 EMERGENCY ALERT — Immediate Action Needed!', emoji: true }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${emp?.name || userId}\n*Emp ID:* ${emp?.empId || '-'}\n*Dept:* ${emp?.department || '-'}\n*Floor:* ${emp?.floor || '-'}` }},
           { type: 'section', text: { type: 'mrkdwn', text: `*Issue:* 🔴 *${issueType.split(' — ')[0]}*\n*Details:* ${issueType.split(' — ')[1] || '-'}` }},
           { type: 'section', text: { type: 'mrkdwn', text: ticketId ? `*Ticket:* \`${ticketId}\` | Priority: *${priority}*` : `⚠️ _Ticket auto-create failed — create manually_` }},
           { type: 'divider' },
           { type: 'context', elements: [{ type: 'mrkdwn', text: `_Respond immediately — employee is waiting for IT support_` }]}
         ]
       }).catch(e => console.error('sos admin alert error:', e.message));
     }
   } catch (err) {
     console.error('sos_issue error:', err.message);
     if (viewId) {
       await client.views.update({ view_id: viewId, view: {
         type: 'modal', title: { type: 'plain_text', text: 'Error', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ SOS registration failed. Contact IT directly: ${ADMIN_EMAIL}` }}]
       }}).catch(() => {});
     }
   }
 });

 // ── DM category expand handlers — UPDATE message (no duplicate) ──────
 LEGACY_CATEGORIES.forEach(cat => {
 slackApp.action(`dm_cat_${cat.key}`, async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const channelId = body.channel?.id || userId;
 const msgTs = body.message?.ts;
 try {
 const catBlocks = [
 { type:'section', text:{ type:'mrkdwn', text:`*${cat.label}* — select your issue:` }},
 ];
 for (const row of cat.rows) {
 catBlocks.push({
 type: 'actions',
 elements: row.map(btn => ({
 type : 'button',
 text : { type: 'plain_text', text: btn.text, emoji: true },
 value : btn.value,
 action_id: btn.id
 }))
 });
 }

 // UPDATE existing message instead of posting new one (prevents duplicates)
 if (msgTs) {
 try {
 await client.chat.update({ channel: channelId, ts: msgTs, text: cat.label, blocks: catBlocks });
 } catch {
 await client.chat.postMessage({ channel: userId, text: cat.label, blocks: catBlocks });
 }
 } else {
 await client.chat.postMessage({ channel: userId, text: cat.label, blocks: catBlocks });
 }
 } catch (err) {
 console.error('dm_cat action error:', err.message);
 }
 });
 });

 // ── FIX: dm_cat_network + dm_cat_access — greeting DM buttons had no handlers ─
 // LEGACY_CATEGORIES loop registers dm_cat_network_legacy and dm_cat_access_legacy
 // but the greeting DM buttons use dm_cat_network and dm_cat_access (without _legacy suffix).
 // Adding dedicated handlers here to route to the correct LEGACY_CATEGORIES entry.
 ['dm_cat_network', 'dm_cat_access'].forEach(actionId => {
   const legacyKey = actionId === 'dm_cat_network' ? 'network_legacy' : 'access_legacy';
   slackApp.action(actionId, async ({ body, ack, client }) => {
     await ack();
     const userId = body.user.id;
     const channelId = body.channel?.id || userId;
     const msgTs = body.message?.ts;
     try {
       const cat = LEGACY_CATEGORIES.find(c => c.key === legacyKey);
       if (!cat) return;
       const catBlocks = [
         { type: 'section', text: { type: 'mrkdwn', text: `*${cat.label}* — select your issue:` }},
       ];
       for (const row of cat.rows) {
         catBlocks.push({
           type: 'actions',
           elements: row.map(btn => ({
             type: 'button',
             text: { type: 'plain_text', text: btn.text, emoji: true },
             value: btn.value,
             action_id: btn.id
           }))
         });
       }
       if (msgTs) {
         try {
           await client.chat.update({ channel: channelId, ts: msgTs, text: cat.label, blocks: catBlocks });
         } catch {
           await client.chat.postMessage({ channel: userId, text: cat.label, blocks: catBlocks });
         }
       } else {
         await client.chat.postMessage({ channel: userId, text: cat.label, blocks: catBlocks });
       }
     } catch (err) {
       console.error(`${actionId} handler error:`, err.message);
     }
   });
 });

 // ── Hardware Replacement / Emergency special IDs ─────────────────────
 const HARDWARE_SPECIAL_IDS = new Set(['home_quick_37','home_quick_60','home_quick_61','home_quick_62','home_quick_70']);

 const buildHardwareBlocks = (actionId, emp) => {
 const isLiquid = actionId === 'home_quick_70';
 const isNewMonitor = actionId === 'home_quick_62';
 const blocks = [];

 // ── Emergency alert (liquid damage) unchanged ────────────────────
 if (isLiquid) {
 blocks.push({
 type: 'section',
 text: { type: 'mrkdwn', text:
 ' *EMERGENCY — Do this immediately:*\n' +
 '1. *IMMEDIATELY SHUT DOWN* — hold power button 10 sec\n' +
 '2. Remove charger and all USB devices\n' +
 '3. *Flip laptop upside down* (keyboard facing down)\n' +
 '4. *Do NOT turn it on* — circuit damage will occur\n' +
 '5. Contact IT: *IT Helpdesk (Slack)*'
 }
 });
 return blocks;
 }

 // ── New Monitor / New Equipment Functional Head approval needed ──
 if (isNewMonitor) {
 blocks.push({
 type: 'section',
 text: { type: 'mrkdwn', text:
 `*️ New Monitor Request*\n\nNew equipment requires *Functional Head approval*.\n\n*Steps:*\n1. Email your *Reporting Manager*\n2. CC both:\n *${ADMIN_EMAIL}*\n Your *Functional Head*\n3. Explain in the email why the item is needed\n\n*Timeline: 4 working days after Functional Head approval*`
 }
 });
 return blocks;
 }

 // ── Replacement (Laptop / Mouse / Keyboard) ────────────────────────
 const itemMap = {
 'home_quick_37': ' Laptop',
 'home_quick_60': '️ Mouse',
 'home_quick_61': '⌨️ Keyboard'
 };
 const item = itemMap[actionId] || ' Equipment';

 blocks.push({
 type: 'section',
 text: { type: 'mrkdwn', text:
 `*${item} Replacement Request*\n\n*Steps:*\n1. Email your *Reporting Manager*\n2. CC: *${ADMIN_EMAIL}*\n3. Describe the problem and why a replacement is needed\n\n*Timeline: 2 working days*`
 }
 });

 return blocks;
 };

 // ════════════════════════════════════════════════════════════════════════
 // SOFTWARE REQUEST FLOW
 // ════════════════════════════════════════════════════════════════════════

 const SOFTWARE_LIST = [
   { label: '🎨 Figma',                 value: 'Figma' },
   { label: '📊 Microsoft Office',      value: 'Microsoft Office (Word/Excel/PPT)' },
   { label: '🎯 Jira',                  value: 'Jira' },
   { label: '🤖 Claude (Anthropic AI)', value: 'Claude (Anthropic AI)' },
   { label: '🔍 Google Chrome',         value: 'Google Chrome' },
   { label: '📹 Zoom',                  value: 'Zoom' },
   { label: '👥 Microsoft Teams',       value: 'Microsoft Teams' },
   { label: '📄 Adobe Acrobat Reader',  value: 'Adobe Acrobat Reader' },
   { label: '📦 7-Zip / WinRAR',        value: '7-Zip / WinRAR' },
   { label: '📝 Notepad++',             value: 'Notepad++' },
 ];

 const buildSoftwareRequestModal = () => ({
   type: 'modal',
   callback_id: 'software_request_submit',
   title: { type: 'plain_text', text: '💿 Software Request', emoji: true },
   submit: { type: 'plain_text', text: '📩 Submit Request', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [
     { type: 'section', text: { type: 'mrkdwn', text: '*Which software do you need?*\nSelect below 👇\n_Note: IT will install after manager approval._' } },
     { type: 'divider' },
     { type: 'input', block_id: 'software_block',
       label: { type: 'plain_text', text: 'Select software:', emoji: true },
       element: { type: 'checkboxes', action_id: 'software_select',
         options: SOFTWARE_LIST.map(s => ({ text: { type: 'plain_text', text: s.label, emoji: true }, value: s.value }))
       }
     },
     { type: 'input', block_id: 'software_other_block', optional: true,
       label: { type: 'plain_text', text: 'Other software (enter name):', emoji: true },
       element: { type: 'plain_text_input', action_id: 'software_other', placeholder: { type: 'plain_text', text: 'e.g. Figma, Postman, VS Code...' }, max_length: 200 }
     },
     { type: 'input', block_id: 'software_reason_block', optional: true,
       label: { type: 'plain_text', text: 'Why do you need it? (optional):', emoji: true },
       element: { type: 'plain_text_input', action_id: 'software_reason', placeholder: { type: 'plain_text', text: 'e.g. Required for a project...' }, max_length: 300 }
     }
   ]
 });

 // Opens software modal from Home Tab quick action OR from Asset Requests category menu
 slackApp.action(/^(home_software_request|vague_pick_software_asset_request)$/, async ({ body, ack, client }) => {
   await ack();
   try {
     if (body.view?.type === 'modal') {
       await client.views.push({ trigger_id: body.trigger_id, view: buildSoftwareRequestModal() });
     } else {
       await client.views.open({ trigger_id: body.trigger_id, view: buildSoftwareRequestModal() });
     }
   } catch (err) { console.error('software_request open error:', err.message); }
 });

 slackApp.view('software_request_submit', async ({ body, ack, view, client }) => {
   await ack({ response_action: 'update', view: { type: 'modal', title: { type: 'plain_text', text: '💿 Software Request', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '⏳ *Sending to your manager for approval...*' } }] } });

   const userId   = body.user.id;
   const selected = view.state.values?.software_block?.software_select?.selected_options || [];
   const other    = view.state.values?.software_other_block?.software_other?.value || '';
   const reason   = view.state.values?.software_reason_block?.software_reason?.value || '';

   const softwareList = [...selected.map(o => o.value), ...(other ? [other] : [])];
   if (!softwareList.length) return;

   try {
     const emp = await Employee.findOne({ slackUserId: userId }).select('empId name empName dept floor empEmail managerSlackId managerName').lean().catch(() => null);
     const empId      = emp?.empId   || userId;
     const empName    = emp?.name    || emp?.empName || 'Employee';
     const mgrSlackId = emp?.managerSlackId;
     const mgrName    = emp?.managerName || 'Manager';

     const desc = `Software Request:\n• ${softwareList.join('\n• ')}${reason ? `\n\nReason: ${reason}` : ''}`;
     const ticket = await createTicketSlack({ empId, empName, empDept: emp?.dept, empFloor: emp?.floor, empEmail: emp?.empEmail, description: desc, category: 'Software Request', priority: 'Low', source: 'slack' });
     const ticketId = ticket?.ticketId || 'N/A';

     // Button value payload (max 2000 chars — keep compact)
     const payload = JSON.stringify({ ticketId, userId, empName, empId, software: softwareList, reason: reason || '' });

     if (mgrSlackId) {
       // ── Send approval request to manager ──────────────────────────────────
       const mgrDm = await client.conversations.open({ users: mgrSlackId });
       await client.chat.postMessage({
         channel: mgrDm.channel.id,
         text: `💿 Software Request from ${empName} — Approval needed`,
         blocks: [
           { type: 'header', text: { type: 'plain_text', text: '💿 Software Request — Approval Needed', emoji: true } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${empName} (${empId})\n*Dept/Floor:* ${emp?.dept || 'N/A'} — Floor ${emp?.floor || 'N/A'}` } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Software Requested:*\n• ${softwareList.join('\n• ')}${reason ? `\n\n*Reason:* ${reason}` : ''}` } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Ticket:* \`${ticketId}\`` } },
           { type: 'divider' },
           { type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '✅ Approve', emoji: true }, style: 'primary', action_id: 'software_req_approve', value: payload },
             { type: 'button', text: { type: 'plain_text', text: '❌ Reject',  emoji: true }, style: 'danger',   action_id: 'software_req_reject',  value: payload },
           ]},
         ]
       });

       // ── Notify employee that request was sent to manager ───────────────────
       const empDm = await client.conversations.open({ users: userId });
       await client.chat.postMessage({
         channel: empDm.channel.id,
         text: `📨 Your software request has been sent to ${mgrName} for approval.`,
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `*📨 Request Sent for Approval*\n\nYour software request has been sent to *${mgrName}* for approval.\n\n*Software Requested:*\n• ${softwareList.join('\n• ')}` } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Ticket ID:* \`${ticketId}\`\n\nYou will receive a Slack message once your manager responds.` } },
         ]
       });

     } else {
       // ── No manager configured — go directly to IT admin ───────────────────
       const adminId = process.env.ADMIN_SLACK_USER_ID || userId;
       const adminDm = await client.conversations.open({ users: adminId });
       await client.chat.postMessage({
         channel: adminDm.channel.id,
         text: `💿 Software Request: ${empName} (no manager configured)`,
         blocks: [
           { type: 'header', text: { type: 'plain_text', text: '💿 Software Request', emoji: true } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${empName} (${empId})\n*Dept/Floor:* ${emp?.dept || 'N/A'} — Floor ${emp?.floor || 'N/A'}\n⚠️ _No reporting manager set for this employee._` } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Software Requested:*\n• ${softwareList.join('\n• ')}${reason ? `\n\n*Reason:* ${reason}` : ''}` } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Ticket:* \`${ticketId}\`` } },
         ]
       });

       const empDm = await client.conversations.open({ users: userId });
       await client.chat.postMessage({
         channel: empDm.channel.id,
         text: `✅ Software request submitted — Ticket \`${ticketId}\``,
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `*✅ Software Request Submitted!*\n\n*Software Requested:*\n• ${softwareList.join('\n• ')}\n\n*Ticket ID:* \`${ticketId}\`\n\nIT team will be in touch shortly.` } },
         ]
       });
     }
   } catch (err) { console.error('software_request_submit error:', err.message); }
 });

 // ── Manager approves software request ─────────────────────────────────────────
 slackApp.action('software_req_approve', async ({ body, ack, client }) => {
   await ack();
   try {
     const { ticketId, userId, empName, empId, software, reason } = JSON.parse(body.actions[0].value);
     const mgrName = body.user.name || 'Your manager';

     // Update message to show approved
     await client.chat.update({
       channel: body.channel.id,
       ts: body.message.ts,
       text: `✅ Approved by ${mgrName} — ${empName}'s software request`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*✅ Approved* by *${mgrName}*\n\n*Employee:* ${empName} (${empId})\n*Software:* ${software.join(', ')}\n*Ticket:* \`${ticketId}\`` } },
         { type: 'context', elements: [{ type: 'mrkdwn', text: '_IT team has been notified to install._' }] }
       ]
     });

     // Notify IT admin
     const adminId = (process.env.ADMIN_SLACK_USER_ID || '').trim() || (process.env.ADMIN_EMAIL_SLACK_ID || '').trim() || 'U08K2LXAN5Q';
     if (adminId) {
       const adminDm = await client.conversations.open({ users: adminId });
       await client.chat.postMessage({
         channel: adminDm.channel.id,
         text: `✅ Software Request APPROVED — ${empName}`,
         blocks: [
           { type: 'header', text: { type: 'plain_text', text: '✅ Software Request Approved — Install Required', emoji: true } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${empName} (${empId})\n*Approved by:* ${mgrName}` } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Software to Install:*\n• ${software.join('\n• ')}${reason ? `\n\n*Reason:* ${reason}` : ''}` } },
           { type: 'section', text: { type: 'mrkdwn', text: `*Ticket:* \`${ticketId}\`` } },
         ]
       });
     }

     // Notify employee
     const empDm = await client.conversations.open({ users: userId });
     await client.chat.postMessage({
       channel: empDm.channel.id,
       text: `✅ Your software request was approved by ${mgrName}!`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*✅ Software Request Approved!*\n\nYour manager *${mgrName}* approved your request.\n\n*Software:* ${software.join(', ')}\n*Ticket:* \`${ticketId}\`\n\nIT team will install it soon — you will receive a message when it is ready.` } },
       ]
     });
   } catch (err) { console.error('software_req_approve error:', err.message); }
 });

 // ── Manager rejects software request ──────────────────────────────────────────
 slackApp.action('software_req_reject', async ({ body, ack, client }) => {
   await ack();
   try {
     const { ticketId, userId, empName, empId, software } = JSON.parse(body.actions[0].value);
     const mgrName = body.user.name || 'Your manager';

     // Update message to show rejected
     await client.chat.update({
       channel: body.channel.id,
       ts: body.message.ts,
       text: `❌ Rejected by ${mgrName} — ${empName}'s software request`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*❌ Rejected* by *${mgrName}*\n\n*Employee:* ${empName} (${empId})\n*Software:* ${software.join(', ')}\n*Ticket:* \`${ticketId}\`` } },
         { type: 'context', elements: [{ type: 'mrkdwn', text: '_Request has been declined._' }] }
       ]
     });

     // Notify employee
     const empDm = await client.conversations.open({ users: userId });
     await client.chat.postMessage({
       channel: empDm.channel.id,
       text: `❌ Your software request was not approved by ${mgrName}.`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*❌ Software Request Not Approved*\n\nYour manager *${mgrName}* did not approve this request.\n\n*Software:* ${software.join(', ')}\n*Ticket:* \`${ticketId}\`\n\nFor queries, please speak to your manager directly.` } },
       ]
     });
   } catch (err) { console.error('software_req_reject error:', err.message); }
 });

 // ── Admin: Set Employee Manager ───────────────────────────────────────────────
 slackApp.action('admin_set_manager_open', async ({ body, ack, client }) => {
   await ack();
   try {
     await client.views.open({
       trigger_id: body.trigger_id,
       view: {
         type: 'modal',
         callback_id: 'admin_set_manager_submit',
         title: { type: 'plain_text', text: '👥 Set Employee Manager', emoji: true },
         submit: { type: 'plain_text', text: '💾 Save', emoji: true },
         close: { type: 'plain_text', text: 'Cancel', emoji: true },
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: '*Assign a reporting manager to an employee.*\nType the name to search 👇' } },
           { type: 'divider' },
           {
             type: 'input', block_id: 'emp_block',
             label: { type: 'plain_text', text: 'Employee:', emoji: true },
             element: {
               type: 'external_select',
               action_id: 'emp_select',
               placeholder: { type: 'plain_text', text: 'Search employee name...' },
               min_query_length: 1,
             }
           },
           {
             type: 'input', block_id: 'mgr_block',
             label: { type: 'plain_text', text: 'Reporting Manager:', emoji: true },
             element: {
               type: 'external_select',
               action_id: 'mgr_select',
               placeholder: { type: 'plain_text', text: 'Search manager name...' },
               min_query_length: 1,
             }
           },
         ]
       }
     });
   } catch (err) { console.error('admin_set_manager_open error:', err.message); }
 });

 // ── External select options — search employees ────────────────────────────────
 slackApp.options(/^(emp_select|mgr_select|mgr_self_select)$/, async ({ payload, options, ack }) => {
   try {
     const q = options?.value || payload?.value || '';
     const emps = await Employee.find({
       isActive: true,
       $or: [
         { name : { $regex: q, $options: 'i' } },
         { empId: { $regex: q, $options: 'i' } },
       ]
     }).limit(20).select('empId name slackUserId').lean();

     await ack({
       options: emps.map(e => ({
         text : { type: 'plain_text', text: `${e.name} (${e.empId})` },
         value: JSON.stringify({ slackId: e.slackUserId || '', name: e.name, empId: e.empId }),
       }))
     });
   } catch (err) { console.error('external_select options error:', err.message); await ack({ options: [] }); }
 });

 // ── Admin: Save manager assignment ────────────────────────────────────────────
 slackApp.view('admin_set_manager_submit', async ({ body, ack, view, client }) => {
   await ack();
   try {
     const empVal = view.state.values?.emp_block?.emp_select?.selected_option?.value;
     const mgrVal = view.state.values?.mgr_block?.mgr_select?.selected_option?.value;
     if (!empVal || !mgrVal) return;

     const emp = JSON.parse(empVal);
     const mgr = JSON.parse(mgrVal);

     await Employee.findOneAndUpdate(
       { empId: emp.empId },
       { managerSlackId: mgr.slackId, managerName: mgr.name }
     );

     // Confirm to admin via DM
     const adminId = body.user.id;
     const dm = await client.conversations.open({ users: adminId });
     await client.chat.postMessage({
       channel: dm.channel.id,
       text: `✅ Manager set for ${emp.name}`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*✅ Manager Assigned*\n\n*Employee:* ${emp.name} (${emp.empId})\n*Reporting Manager:* ${mgr.name}\n\n_Software requests from ${emp.name} will now go to ${mgr.name} for approval._` } }
       ]
     });
   } catch (err) { console.error('admin_set_manager_submit error:', err.message); }
 });

 // ── Admin: Blast message — ask ALL employees to select their manager ──────────
 slackApp.action('admin_blast_manager_ask', async ({ body, ack, client }) => {
   await ack();
   const adminId = body.user.id;
   try {
     // Fetch all active employees who have a Slack ID but no manager set
     const employees = await Employee.find({
       isActive: true,
       slackUserId: { $exists: true, $ne: '' },
       $or: [{ managerSlackId: { $exists: false } }, { managerSlackId: '' }, { managerSlackId: null }]
     }).select('empId name slackUserId').lean();

     if (!employees.length) {
       const dm = await client.conversations.open({ users: adminId });
       await client.chat.postMessage({ channel: dm.channel.id, text: '✅ All employees already have managers assigned!' });
       return;
     }

     let sent = 0, failed = 0;
     for (const emp of employees) {
       try {
         const dm = await client.conversations.open({ users: emp.slackUserId });
         await client.chat.postMessage({
           channel: dm.channel.id,
           text: `Hi ${emp.name.split(' ')[0]}! Please select your reporting manager 👇`,
           blocks: [
             { type: 'section', text: { type: 'mrkdwn', text: `*Hi ${emp.name.split(' ')[0]}! 👋*\n\nWIOM IT Helpdesk needs to know your *reporting manager* to process software requests.\n\nPlease click below to select your manager:` } },
             { type: 'actions', elements: [
               { type: 'button', text: { type: 'plain_text', text: '👤 Select My Manager', emoji: true }, style: 'primary', action_id: 'emp_self_select_manager', value: JSON.stringify({ empId: emp.empId, empName: emp.name }) },
             ]}
           ]
         });
         sent++;
         // Small delay to avoid Slack rate limits
         await new Promise(r => setTimeout(r, 200));
       } catch (e) { failed++; console.error(`blast DM failed for ${emp.empId}:`, e.message); }
     }

     // Report back to admin
     const adminDm = await client.conversations.open({ users: adminId });
     await client.chat.postMessage({
       channel: adminDm.channel.id,
       text: `📢 Blast sent! ${sent} employees messaged, ${failed} failed.`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `*📢 Manager Request Blast Complete*\n\n✅ *Sent:* ${sent} employees\n❌ *Failed:* ${failed}\n\nEmployees will see a button to select their manager. As they respond, it auto-saves.` } }
       ]
     });
   } catch (err) { console.error('admin_blast_manager_ask error:', err.message); }
 });

 // ── Employee: select their own manager (from blast message) ───────────────────
 slackApp.action('emp_self_select_manager', async ({ body, ack, client }) => {
   await ack();
   try {
     const { empId, empName } = JSON.parse(body.actions[0].value);
     await client.views.open({
       trigger_id: body.trigger_id,
       view: {
         type: 'modal',
         callback_id: 'emp_manager_select_submit',
         private_metadata: JSON.stringify({ empId, empName, msgTs: body.message?.ts, channelId: body.channel?.id }),
         title: { type: 'plain_text', text: '👤 Select Your Manager', emoji: true },
         submit: { type: 'plain_text', text: '✅ Confirm', emoji: true },
         close: { type: 'plain_text', text: 'Cancel', emoji: true },
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `*Hi ${empName.split(' ')[0]}!*\nSearch and select your reporting manager below 👇` } },
           { type: 'divider' },
           {
             type: 'input', block_id: 'mgr_self_block',
             label: { type: 'plain_text', text: 'My Reporting Manager:', emoji: true },
             element: {
               type: 'external_select',
               action_id: 'mgr_self_select',
               placeholder: { type: 'plain_text', text: 'Type manager name...' },
               min_query_length: 1,
             }
           }
         ]
       }
     });
   } catch (err) { console.error('emp_self_select_manager error:', err.message); }
 });

 // ── Employee: save self-selected manager ──────────────────────────────────────
 slackApp.view('emp_manager_select_submit', async ({ body, ack, view, client }) => {
   await ack();
   try {
     const { empId, empName, msgTs, channelId } = JSON.parse(view.private_metadata || '{}');
     const mgrVal = view.state.values?.mgr_self_block?.mgr_self_select?.selected_option?.value;
     if (!mgrVal) return;

     const mgr = JSON.parse(mgrVal);
     await Employee.findOneAndUpdate({ empId }, { managerSlackId: mgr.slackId, managerName: mgr.name });

     // Update original blast message to show done
     if (channelId && msgTs) {
       await client.chat.update({
         channel: channelId, ts: msgTs,
         text: `✅ Manager set: ${mgr.name}`,
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*✅ Manager Set!*\n\nYour reporting manager has been saved as *${mgr.name}*.\n\nSoftware requests will now go to them for approval.` } }]
       }).catch(() => {});
     }

     // Confirm to employee via DM
     const userId = body.user.id;
     const dm = await client.conversations.open({ users: userId });
     await client.chat.postMessage({
       channel: dm.channel.id,
       text: `✅ Manager saved: ${mgr.name}`,
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*✅ Done!*\nYour reporting manager *${mgr.name}* has been saved. Any software requests you make will go to them for approval.` } }]
     });

     // Notify admin
     const adminId = process.env.ADMIN_SLACK_USER_ID;
     if (adminId) {
       const adminDm = await client.conversations.open({ users: adminId });
       await client.chat.postMessage({ channel: adminDm.channel.id, text: `✅ ${empName} → Manager: ${mgr.name}` });
     }
   } catch (err) { console.error('emp_manager_select_submit error:', err.message); }
 });

 // ── Quick Action buttons from Home tab ────────────────────────────────
 // homeQuickActions: ONLY home_quick_* and home_new_* and home_sos buttons.
 // cat_*, go_home_btn, dm_my_tickets, and all vague_pick_* are handled by their OWN dedicated
 // handlers or regex handlers. DO NOT add them here — it causes both handlers to fire (race condition).
 const homeQuickActions = [
   'home_quick_wifi_pwd_quick',
   'home_quick_office_net_down',
   'home_quick_diagnose_laptop',
   'home_quick_1','home_quick_2','home_quick_3','home_quick_4','home_quick_5',
   'home_quick_6','home_quick_7','home_quick_7b','home_quick_8','home_quick_9',
   'home_quick_10','home_quick_11','home_quick_12','home_quick_13','home_quick_14',
   'home_quick_15','home_quick_16','home_quick_17','home_quick_18','home_quick_19',
   'home_quick_20','home_quick_21','home_quick_22','home_quick_23','home_quick_24',
   'home_quick_25','home_quick_26','home_quick_27','home_quick_28','home_quick_29',
   'home_quick_30','home_quick_31','home_quick_32','home_quick_33','home_quick_34',
   'home_quick_35','home_quick_36','home_quick_37','home_quick_38','home_quick_39',
   'home_quick_40','home_quick_41','home_quick_42','home_quick_43','home_quick_44',
   'home_quick_45','home_quick_46','home_quick_47','home_quick_48','home_quick_49',
   'home_quick_50','home_quick_51','home_quick_52','home_quick_53','home_quick_54',
   'home_quick_55','home_quick_55b','home_quick_56','home_quick_57','home_quick_58',
   'home_quick_59','home_quick_60','home_quick_61','home_quick_62','home_quick_63',
   'home_quick_63b','home_quick_64','home_quick_65','home_quick_66','home_quick_67',
   'home_quick_68','home_quick_69','home_quick_70','home_quick_71','home_quick_72',
   'home_quick_73','home_quick_74','home_quick_75','home_quick_76','home_quick_77',
   'home_sos',
   'home_new_01','home_new_02','home_new_03','home_new_04','home_new_05',
   'home_new_06','home_new_07','home_new_08','home_new_09','home_new_10',
   'home_new_11','home_new_12','home_new_13','home_new_14','home_new_15',
 ];
 homeQuickActions.forEach(actionId => {
 slackApp.action(actionId, async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const problem = body.actions[0].value;
 const triggerId = body.trigger_id;
 let loadingViewId = null; // captured after views.open so catch block can update it
 try {
 // ── FIX: Open modals IMMEDIATELY before any DB call ───────────
 // Slack trigger_id expires in 3 seconds — DB calls can push past that

 // ── WiFi Password — show directly, no AI needed ───────────────
 if (actionId === 'home_quick_wifi_pwd_quick') {
 await client.views.open({
   trigger_id: triggerId,
   view: {
     type: 'modal',
     title: { type: 'plain_text', text: '📶 WiFi Password', emoji: true },
     close: { type: 'plain_text', text: 'Close', emoji: true },
     blocks: [
       { type: 'section', text: { type: 'mrkdwn', text: `*WIOM Office WiFi Password:*\n\n🔑 Network: *Wiom office*\n🔐 Password: \`${process.env.WIFI_PASSWORD || 'spartans500'}\`` }},
       { type: 'divider' },
       { type: 'section', text: { type: 'mrkdwn', text: `*Saket Office WiFi:*\n🔑 Network: *Wiomnet-Saket*\n🔐 Password: \`${process.env.WIFI_PASSWORD_SAKET || 'Password@12345'}\`` }},
       { type: 'divider' },
       { type: 'context', elements: [{ type: 'mrkdwn', text: '_WiFi not connecting? Click the 📶 WiFi Fix button — IT steps will appear._' }]}
     ]
   }
 });
 return;
 }

 // ── Office Net Down — update Home Tab directly (no trigger_id/DM needed) ─
 if (actionId === 'home_quick_office_net_down') {
   await client.views.publish({
     user_id: userId,
     view: {
       type: 'home',
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: '*🌐 Office Internet Down*\nWhich floor is affected? Click a button below 👇' } },
         { type: 'divider' },
         { type: 'actions', elements: [
           { type: 'button', text: { type: 'plain_text', text: '🏢 Ground Floor', emoji: true }, action_id: 'office_net_floor_select', value: 'Ground Floor', style: 'danger' },
           { type: 'button', text: { type: 'plain_text', text: '🏢 3rd Floor', emoji: true }, action_id: 'office_net_floor_select', value: '3rd Floor', style: 'danger' },
         ]},
         { type: 'divider' },
         { type: 'actions', elements: [
           { type: 'button', text: { type: 'plain_text', text: '← Wapas Jao', emoji: true }, action_id: 'go_home_btn', value: 'home' },
         ]}
       ]
     }
   });
   return;
 }

 // ── Diagnose My Laptop — open symptom selector modal ─────────
 if (actionId === 'home_quick_diagnose_laptop') {
   await client.views.open({ trigger_id: triggerId, view: buildDiagnoseInputModal() });
   return;
 }

 // ── Email Password Reset modal ────────────────────────────────
 if (actionId === 'home_quick_59') {
 await client.views.open({
 trigger_id: triggerId,
 view: {
 type: 'modal',
 title: { type: 'plain_text', text: 'Password Reset', emoji: true },
 close: { type: 'plain_text', text: 'Close', emoji: true },
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text:
 '*Email / Google Account Password Reset*\n\nWIOM company Gmail account password can *only be reset by IT* — employees cannot reset it themselves.\n\n_IT team will reset your password quickly. Please raise a ticket below:_'
 }},
 { type: 'divider' },
 { type: 'actions', elements: [{
 type: 'button',
 text: { type: 'plain_text', text: 'Raise Ticket - Need IT Help', emoji: true },
 style: 'danger',
 action_id: 'raise_ticket_email_pwd',
 value: 'email_password_reset'
 }]}
 ]
 }
 });
 return;
 }

 // ── SOS Emergency — show issue type selector (NO DB call needed) ─
 if (actionId === 'home_sos') {
 await client.views.open({
 trigger_id: triggerId,
 view: {
 type: 'modal',
 title: { type: 'plain_text', text: '🆘 SOS IT Emergency', emoji: true },
 close: { type: 'plain_text', text: 'Close', emoji: true },
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: '*Select your emergency issue type — IT will be alerted immediately:*' }},
 { type: 'divider' },
 {
 type: 'actions',
 elements: [
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '💻 Laptop Not Turning On', emoji: true }, action_id: 'sos_issue', value: 'Laptop Not Turning On — laptop is completely dead, not starting at all' },
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '📶 WiFi Not Working', emoji: true }, action_id: 'sos_issue', value: 'WiFi Not Working — no internet, cannot connect to WiFi at all' }
 ]
 },
 {
 type: 'actions',
 elements: [
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🔐 Account Locked', emoji: true }, action_id: 'sos_issue', value: 'Account Locked — cannot login to account or system' },
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '💻 Blue Screen', emoji: true }, action_id: 'sos_issue', value: 'Blue Screen — BSOD blue screen of death error' }
 ]
 },
 {
 type: 'actions',
 elements: [
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '💧 Water Damage', emoji: true }, action_id: 'sos_issue', value: 'Water/Liquid Damage — liquid spilled on laptop, shut down immediately' },
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🔥 Overheating', emoji: true }, action_id: 'sos_issue', value: 'Overheating Emergency — laptop very hot, fan not working, risk of damage' }
 ]
 },
 {
 type: 'actions',
 elements: [
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🦠 Virus/Ransomware', emoji: true }, action_id: 'sos_issue', value: 'Virus/Ransomware Attack — suspicious activity or files encrypted, disconnect internet now' },
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '📁 Data Lost', emoji: true }, action_id: 'sos_issue', value: 'Critical Data Lost — important files accidentally deleted or missing' }
 ]
 },
 {
 type: 'actions',
 elements: [
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🖥️ Projector Down', emoji: true }, action_id: 'sos_issue', value: 'Projector/Screen Share Down — presentation or meeting screen not working' },
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🖨️ Printer Down', emoji: true }, action_id: 'sos_issue', value: 'Printer Down — office printer not working urgent print needed' }
 ]
 },
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: `📧 *IT Direct:*  ${ADMIN_EMAIL}  |  💬 Slack: Sajan Kumar` }}
 ]
 }
 });
 return;
 }

 // ── Hardware Replacement / Emergency modal — BEFORE DB CALL ──────
 // buildHardwareBlocks doesn't use emp, so open modal immediately
 if (HARDWARE_SPECIAL_IDS.has(actionId)) {
 const hwBlocks = buildHardwareBlocks(actionId, null);
 await client.views.open({
 trigger_id: triggerId,
 view: {
 type: 'modal',
 title: { type: 'plain_text', text: 'Hardware Request', emoji: true },
 close: { type: 'plain_text', text: 'Close', emoji: true },
 blocks: hwBlocks
 }
 });
 // Auto-create ticket ONLY for liquid damage — async, don't block modal
 if (actionId === 'home_quick_70') {
 Employee.findOne({ slackUserId: userId }).then(async emp => {
   if (emp?.empId) {
     const result = await createTicketSlack({
       empId: emp.empId, empName: emp.name, empEmail: emp.email || 'unknown@wiom.in',
       empDept: emp.department, empFloor: emp.floor,
       laptop: emp.laptop, laptopSN: emp.laptopSN,
       description: `EMERGENCY: Liquid/Water Damage ${emp.laptop || 'Laptop'} (S/N: ${emp.laptopSN || 'Unknown'})`,
       category: 'Hardware', priority: 'Critical',
       source: 'slack', slackUserId: userId
     });
     if (result && !result._duplicate) await notifyAdmin(client, result, emp);
   }
 }).catch(e => console.error('Liquid damage ticket error:', e.message));
 }
 return;
 }

 // ── Special case: Won't Turn On — open modal FIRST (trigger_id expires in 3s) ──
 if (actionId === 'home_quick_2') {
 // FIX: views.open BEFORE any DB call — trigger_id expires in 3 seconds
 await client.views.open({
   trigger_id: triggerId,
   view: {
     type: 'modal',
     title: { type: 'plain_text', text: '💀 Laptop Won\'t Turn On', emoji: true },
     close: { type: 'plain_text', text: 'Close', emoji: true },
     blocks: [
       { type: 'section', text: { type: 'mrkdwn', text:
         `⚠️ *Try these manual steps first:*\n\n` +
         `1. *Check power adapter* — is the cable properly plugged in?\n` +
         `2. *Check adapter LED* — is the light on in the adapter?\n` +
         `3. *Hold power button 10 seconds* — this will force reset\n` +
         `4. *Is adapter plugged in both sides?* — check laptop and socket firmly\n` +
         `5. *Try a different power socket*\n\n` +
         `_If the laptop still does not turn on after all this — IT team will come to you._`
       }},
       { type: 'divider' },
       { type: 'section', text: { type: 'mrkdwn', text: '*Need IT team to come? Raise a HIGH Priority ticket:*' }},
       { type: 'actions', elements: [
         { type: 'button', text: { type: 'plain_text', text: '🎫 Raise IT Ticket (HIGH)', emoji: true },
           style: 'danger', action_id: 'quick_ticket_btn', value: "Laptop won't turn on at all" }
       ]},
       { type: 'context', elements: [{ type: 'mrkdwn', text: '_For any other IT problem, go to the Home tab and choose a category._' }]}
     ]
   }
 });
 // DB call AFTER modal — set pendingTicket in background
 Employee.findOne({ slackUserId: userId }).then(empWon => {
   if (empWon?.empId) pendingTickets.set(userId, {
     empId: empWon.empId, empName: empWon.name, empEmail: empWon.email || 'unknown@wiom.in',
     empDept: empWon.department, empFloor: empWon.floor,
     laptop: empWon.laptop, laptopSN: empWon.laptopSN,
     category: 'Hardware', priority: 'High',
     description: "Laptop won't turn on at all",
     source: 'slack', slackUserId: userId, createdAt: Date.now()
   });
 }).catch(() => {});
 return;
 }

 // ── Now load employee data (needed for AI + loading modal) ────
 const emp = await Employee.findOne({ slackUserId: userId });
 const empInfo = {
 empId : emp?.empId || userId,
 empName: emp?.name || 'Employee',
 source : 'slack',
 laptop : emp?.laptop,
 laptopSN: emp?.laptopSN,
 dept : emp?.department,
 floor : emp?.floor
 };

 // ── Open loading modal immediately (trigger_id valid only 3 sec) ──
 const loadingView = await client.views.open({
 trigger_id: triggerId,
 view: {
 type: 'modal',
 title: { type: 'plain_text', text: 'IT Help', emoji: true },
 close: { type: 'plain_text', text: 'Close', emoji: true },
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: '_Analyzing your problem... please wait a moment._' }}
 ]
 }
 });
 loadingViewId = loadingView?.view?.id || null; // capture for catch block

 // ── Get AI response — try KB first (instant), then AI ───────────
 // Run DB cleanup in background (don't await — saves ~200ms)
 Conversation.updateMany(
 { slackUserId: userId, source: 'slack', resolved: false },
 { resolved: true }
 ).catch(() => {});

 const claudeSvc = require('./services/claude');

 // Try static KB first — instant, no API call needed
 let reply = claudeSvc.getKBAnswer ? claudeSvc.getKBAnswer(problem) : null;

 // Try MongoDB KB as second-level lookup before calling AI
 if (!reply && claudeSvc.getKBAnswerDB) {
   reply = await claudeSvc.getKBAnswerDB(problem).catch(() => null);
 }

 if (!reply) {
 // KB miss → call AI with minimal context (no session history for speed)
 const quickMessages = [{ role: 'user', content: problem }];
 const result = await claudeSvc.chat(quickMessages, empInfo);
 reply = result.reply;

 // Save session in background (don't block)
 getSlackSession(userId, empInfo).then(conv => {
 conv.messages.push({ role: 'user', content: problem });
 conv.messages.push({ role: 'assistant', content: reply });
 if (conv.messages.length > 20) conv.messages = conv.messages.slice(-20);
 conv.save().catch(() => {});
 }).catch(() => {});
 }

 const formattedReply = formatForSlack(reply);

 // ── Build response blocks for modal ─────────────────────────────
 const modalBlocks = [
 { type: 'section', text: { type: 'mrkdwn', text: formattedReply }}
 ];

 const scriptConfig = SCRIPT_MAP[actionId];
 if (scriptConfig) {
 const scriptUrl = `${PORTAL}/scripts/${scriptConfig.file}`;
 modalBlocks.push({ type: 'divider' });
 modalBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*⚡ Auto-Fix Available:*\n_This script will: Clear temp files, reset network adapter, and restart relevant services._\n\n⚠️ Safe to run — no data will be deleted.' }});
 modalBlocks.push({
 type: 'actions',
 elements: [{
 type: 'button',
 text: { type: 'plain_text', text: `⚡ Run Auto-Fix: ${scriptConfig.label}`, emoji: true },
 style: 'primary',
 url: scriptUrl,
 action_id: `dl_${actionId}`
 }]
 });
 }

 const fixConfig = AUTO_FIX_MAP[actionId];
 if (fixConfig && emp?.laptopSN && emp?.agentRegistered) {
 const isOnline = emp.agentLastSeen && (Date.now() - new Date(emp.agentLastSeen)) < 120000;
 if (isOnline) {
 const fixValue = `${fixConfig.fixType.join(',')}|${fixConfig.label}|${emp.laptopSN}`;
 modalBlocks.push({
 type: 'actions',
 elements: [{
 type: 'button',
 text: { type: 'plain_text', text: '⚡ IT Agent Auto-Fix', emoji: true },
 action_id: 'autofix_request',
 value: fixValue,
 confirm: {
 title: { type: 'plain_text', text: 'Auto-Fix Confirm?' },
 text: { type: 'mrkdwn', text: `*${fixConfig.label}* will run automatically on your laptop.\nResult in ~30 seconds!` },
 confirm: { type: 'plain_text', text: 'Yes, Fix It!' },
 deny: { type: 'plain_text', text: 'Cancel' }
 }
 }]
 });
 }
 }

          modalBlocks.push({ type: 'divider' });
         modalBlocks.push({
           type: 'actions',
           elements: [
             {
               type: 'button',
               text: { type: 'plain_text', text: '✅ Yes, Fixed!', emoji: true },
               action_id: 'resolved_yes_btn',
               style: 'primary',
               value: 'Medium'
             },
             {
               type: 'button',
               text: { type: 'plain_text', text: '🎫 Create Ticket', emoji: true },
               action_id: 'quick_ticket_btn',
               style: 'danger',
               value: (problem || 'IT support needed').substring(0, 200)
             }
           ]
         });

         // ── Update modal with actual response ───────────────────────────
 await client.views.update({
 view_id: loadingView.view.id,
 view: {
 type: 'modal',
 title: { type: 'plain_text', text: 'IT Help', emoji: true },
 close: { type: 'plain_text', text: 'Close', emoji: true },
 blocks: modalBlocks
 }
 });

 } catch (err) {
 console.error('Home quick action error:', err.message);
 // Try to update loading modal with fallback — DM nahi (messages_tab_disabled)
 try {
   // loadingViewId captured before try block — not from error object
   const fallbackView = {
     type: 'modal',
     title: { type: 'plain_text', text: 'IT Help', emoji: true },
     close: { type: 'plain_text', text: 'Close', emoji: true },
     blocks: [
       { type: 'section', text: { type: 'mrkdwn', text: '*Something went wrong — please try again.*\n\nOr raise a ticket directly — IT team will help you.' }},
       { type: 'divider' },
       { type: 'actions', elements: [
         { type: 'button', text: { type: 'plain_text', text: 'Create Ticket', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: problem || 'IT support needed' }
       ]}
     ]
   };
   if (loadingViewId) await client.views.update({ view_id: loadingViewId, view: fallbackView }).catch(() => {});
 } catch (msgErr) {
   console.error('Fallback update failed:', msgErr.message);
 }
 }
 });
 });

 // ── Download script button clicks just ack, URL opens in browser ──
 slackApp.action(/^dl_/, async ({ ack }) => { await ack(); });

 // ── Email password reset ticket button ────────────────────────────────
 slackApp.action('raise_ticket_email_pwd', async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const viewId = body.view?.id;
 const triggerId = body.trigger_id;
 // Show loading in modal immediately
 if (viewId) {
   await client.views.update({ view_id: viewId, view: {
     type: 'modal', title: { type: 'plain_text', text: 'Creating Ticket...', emoji: true },
     close: { type: 'plain_text', text: 'Close', emoji: true },
     blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '_Creating your ticket... please wait._' }}]
   }}).catch(() => {});
 }
 try {
 const emp = await lookupEmployee(userId, client);
 const result = await createTicketSlack({
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
 empDept: emp.dept, empFloor: emp.floor,
 laptop: emp.laptop, laptopSN: emp.laptopSN,
 description: 'Email / Google Account password reset — self-service steps tried, did not work',
 category: 'Account', priority: 'High',
 source: 'slack', slackUserId: userId
 });
 const successView = result && !result._duplicate ? {
   type: 'modal', title: { type: 'plain_text', text: '✅ Ticket Created!', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [
     { type: 'section', fields: [
       { type: 'mrkdwn', text: `*🎫 Ticket:*\n\`${result.ticketId}\`` },
       { type: 'mrkdwn', text: `*🔴 Priority:*\nHigh` }
     ]},
     { type: 'context', elements: [{ type: 'mrkdwn', text: '✅ IT team will reset your password — they will respond shortly.' }]}
   ]
 } : {
   type: 'modal', title: { type: 'plain_text', text: result?._duplicate ? '⚠️ Already Exists' : '❌ Error', emoji: true },
   close: { type: 'plain_text', text: 'Close', emoji: true },
   blocks: [{ type: 'section', text: { type: 'mrkdwn', text: result?._duplicate ? `⚠️ ${result.message}` : `❌ Could not create ticket. Email IT at: ${ADMIN_EMAIL}` }}]
 };
 if (viewId) {
   await client.views.update({ view_id: viewId, view: successView }).catch(() => {});
 } else if (triggerId) {
   await client.views.open({ trigger_id: triggerId, view: successView }).catch(() => {});
 }
 if (result && !result._duplicate) await notifyAdmin(client, result, emp);
 } catch (err) {
 console.error('Email pwd ticket error:', err.message);
 if (viewId) {
   await client.views.update({ view_id: viewId, view: {
     type: 'modal', title: { type: 'plain_text', text: 'Error' },
     close: { type: 'plain_text', text: 'Close' },
     blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ Could not create ticket. Email IT at: ${ADMIN_EMAIL}` }}]
   }}).catch(() => {});
 }
 }
 });
 // ── Warranty / diagnostic / support link buttons just ack ──────────
 slackApp.action(/^(warranty_|apple_support_|diag_dl_)/, async ({ ack }) => { await ack(); });

 // ── Auto-Fix request handler ──────────────────────────────────────────
 slackApp.action('autofix_request', async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const value = body.actions[0].value; // "fix_teams,fix_outlook| Teams Fix|SN123"

 try {
 const [typesPart, label, laptopSN] = value.split('|');
 const fixType = typesPart.split(',').filter(Boolean);

 if (!laptopSN || !fixType.length) {
 await client.chat.postMessage({
 channel: userId,
 text : '❌ Auto-fix configuration issue. Please try the steps manually.'
 });
 return;
 }

 const emp = await Employee.findOne({ slackUserId: userId });
 if (!emp) {
 await client.chat.postMessage({
 channel: userId,
 text : '❌ Employee record not found. Contact IT: IT Helpdesk (Slack)'
 });
 return;
 }

 // Create FixJob in DB
 const job = await FixJob.create({
 empId : emp.empId,
 empName : emp.name,
 laptopSN,
 fixType,
 fixLabel : label || 'Auto Fix',
 status : 'pending',
 slackUserId: userId
 });

 console.log(`⚡ Auto-fix job created: ${job._id} → ${fixType.join(',')} for ${emp.empId} (SN:${laptopSN})`);

 await client.chat.postMessage({
 channel: userId,
 text : `⚡ ${label} is starting...`,
 blocks : [
 { type: 'header', text: { type: 'plain_text', text: '⚡ Auto-Fix Started!', emoji: true }},
 { type: 'section', text: { type: 'mrkdwn', text:
 `*${label}* is running automatically on your laptop!\n\n` +
 `_You don't need to do anything — IT Agent is working on your laptop..._\n\n` +
 `⏳ *~30 seconds and you'll have your result!*`
 }},
 { type: 'context', elements: [{ type: 'mrkdwn', text: `_Job ID: \`${job._id}\` | Laptop: \`${laptopSN}\`_` }]}
 ]
 });

 } catch (err) {
 console.error('autofix_request error:', err.message);
 try {
 await client.chat.postMessage({
 channel: userId,
 text : '❌ Auto-fix could not start. Try the steps manually or raise a ticket.'
 });
 } catch {}
 }
 });

 // ── /appoint — Book IT appointment ────────────────────────────────────
 slackApp.command('/appoint', async ({ command, ack, client }) => {
 await ack();
 const userId = command.user_id;
 // Generate next 5 working days slots
 const slots = [];
 const d = new Date();
 d.setHours(0,0,0,0);
 let daysAdded = 0;
 while (daysAdded < 5) {
 d.setDate(d.getDate() + 1);
 if (d.getDay() !== 0 && d.getDay() !== 6) { // Skip weekends
 const dateStr = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
 const dateVal = d.toISOString().split('T')[0];
 ['10:00 AM','11:00 AM','12:00 PM','2:00 PM','3:00 PM','4:00 PM'].forEach(t => {
 slots.push({ label: `${dateStr} ${t}`, value: `${dateVal}|${t}` });
 });
 daysAdded++;
 }
 }
 await client.views.open({
 trigger_id: command.trigger_id,
 view: {
 type: 'modal',
 callback_id: 'appointment_modal',
 title: { type: 'plain_text', text: '📅 IT Appointment' },
 submit: { type: 'plain_text', text: 'Book Slot' },
 close: { type: 'plain_text', text: 'Cancel' },
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: '*Book a slot to meet IT!* 📅\nIT team will personally fix your problem.' }},
 { type: 'input', block_id: 'slot_block', label: { type: 'plain_text', text: 'Date & Time' },
 element: { type: 'static_select', action_id: 'slot_input',
 placeholder: { type: 'plain_text', text: 'Select a time slot' },
 options: slots.slice(0, 20).map(s => ({ text: { type: 'plain_text', text: s.label }, value: s.value }))
 }},
 { type: 'input', block_id: 'reason_block', label: { type: 'plain_text', text: 'What is the problem?' },
 element: { type: 'plain_text_input', action_id: 'reason_input', multiline: true,
 placeholder: { type: 'plain_text', text: 'Brief description — laptop slow, setup needed, etc.' }}}
 ]
 }
 });
 });

 // Appointment modal submit
 slackApp.view('appointment_modal', async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const vals = body.view.state.values;
 const slotVal = vals.slot_block.slot_input.selected_option?.value;
 const reason = vals.reason_block.reason_input.value;
 if (!slotVal) return;
 const [dateVal, timeSlot] = slotVal.split('|');
 try {
 const Appointment = require('./models/Appointment');
 const emp = await lookupEmployee(userId, client);
 const appt = await Appointment.create({
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
 slackUserId: userId, date: dateVal, timeSlot, reason, status: 'Pending'
 });
 const dateDisplay = new Date(dateVal).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
 // Confirm to employee
 await client.chat.postMessage({
 channel: userId,
 text: `✅ Appointment booked! ${dateDisplay} ${timeSlot}`,
 blocks: [
 { type: 'header', text: { type: 'plain_text', text: '📅 Appointment Booked!', emoji: true }},
 { type: 'section', fields: [
 { type: 'mrkdwn', text: `*Date:*\n${dateDisplay}` },
 { type: 'mrkdwn', text: `*Time:*\n${timeSlot}` },
 { type: 'mrkdwn', text: `*Problem:*\n${reason.substring(0,60)}` },
 { type: 'mrkdwn', text: `*Status:*\n⏳ Pending Confirmation` }
 ]},
 { type: 'context', elements: [{ type: 'mrkdwn', text: '_IT team will confirm — you will receive a message from IT! 😊_' }]}
 ]
 });
 // Notify admin
 const adminId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 if (adminId && adminId !== 'FILL_KARO' && slackClient) {
 slackClient.chat.postMessage({
 channel: adminId,
 text: `📅 New IT Appointment: ${emp.empName} — ${dateDisplay} ${timeSlot}`,
 blocks: [
 { type: 'header', text: { type: 'plain_text', text: '📅 New Appointment Request', emoji: true }},
 { type: 'section', fields: [
 { type: 'mrkdwn', text: `*Employee:*\n${emp.empName} (${emp.empId})` },
 { type: 'mrkdwn', text: `*Date/Time:*\n${dateDisplay} ${timeSlot}` },
 { type: 'mrkdwn', text: `*Problem:*\n${reason}` }
 ]},
 { type: 'actions', elements: [
 { type: 'button', text: { type: 'plain_text', text: '✅ Confirm', emoji: true }, style: 'primary',
 action_id: 'appt_confirm', value: `${appt._id}|${userId}` },
 { type: 'button', text: { type: 'plain_text', text: '❌ Cancel', emoji: true }, style: 'danger',
 action_id: 'appt_cancel', value: `${appt._id}|${userId}` }
 ]}
 ]
 }).catch(() => {});
 }
 console.log(`📅 Appointment booked: ${emp.empName} → ${dateVal} ${timeSlot}`);
 } catch (err) {
 console.error('Appointment booking error:', err.message);
 await client.chat.postMessage({ channel: userId, text: '❌ There was a problem with your booking. Please try again or use /ticket.' });
 }
 });

 // Appointment confirm/cancel by admin
 slackApp.action('appt_confirm', async ({ body, ack, client }) => {
 await ack();
 const [apptId, empSlackId] = body.actions[0].value.split('|');
 try {
 const Appointment = require('./models/Appointment');
 const appt = await Appointment.findByIdAndUpdate(apptId, { status: 'Confirmed' }, { new: true });
 if (appt) {
 const dateDisplay = new Date(appt.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
 await client.chat.postMessage({
 channel: empSlackId,
 text: `✅ IT Appointment Confirmed! ${dateDisplay} ${appt.timeSlot}`,
 blocks: [
 { type: 'header', text: { type: 'plain_text', text: '✅ Appointment Confirmed!', emoji: true }},
 { type: 'section', text: { type: 'mrkdwn', text: `*${dateDisplay} ${appt.timeSlot}* — IT team will meet you! 😊\n\nProblem: ${appt.reason}\n\nLocation: IT Helpdesk Desk (IT team will share floor details)` }},
 { type: 'context', elements: [{ type: 'mrkdwn', text: '_To cancel, send a DM to IT on Slack_' }]}
 ]
 });
 await client.chat.update({ channel: body.channel?.id || body.container?.channel_id, ts: body.message.ts,
 text: `✅ Appointment confirmed: ${appt.empName} → ${dateDisplay} ${appt.timeSlot}`,
 blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ *Confirmed:* ${appt.empName} | ${dateDisplay} ${appt.timeSlot}` }}]
 });
 }
 } catch (err) { console.error('Appt confirm error:', err.message); }
 });

 slackApp.action('appt_cancel', async ({ body, ack, client }) => {
 await ack();
 const [apptId, empSlackId] = body.actions[0].value.split('|');
 try {
 const Appointment = require('./models/Appointment');
 const appt = await Appointment.findByIdAndUpdate(apptId, { status: 'Cancelled' }, { new: true });
 if (appt) {
 await client.chat.postMessage({
 channel: empSlackId,
 text: `❌ Appointment cancelled. Book a new slot: /appoint`,
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: `❌ *Your Appointment has been Cancelled.*\n\nTo book a new slot: \`/appoint\`\nFor immediate help: \`/ticket\`` }}
 ]
 });
 await client.chat.update({ channel: body.channel?.id || body.container?.channel_id, ts: body.message.ts,
 text: `❌ Appointment cancelled: ${appt?.empName}`,
 blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ *Cancelled:* ${appt?.empName}` }}]
 });
 }
 } catch (err) { console.error('Appt cancel error:', err.message); }
 });

 // ── DM Handler ────────────────────────────────────────────────────────
 // NOTE: Messages Tab is disabled in Slack App settings.
 // This handler still processes messages in case someone DMs directly.
 // Redirect users to Home tab for better experience.
 slackApp.message(async ({ message, client, say }) => {
 if (message.bot_id) return;

 // If message tab is disabled but someone still messages → redirect to Home tab
 const isDirectMessage = message.channel_type === 'im';
 if (isDirectMessage && message.text && !message.subtype) {
   // Still process the message normally — Home tab is main but DM still works
   // as fallback. This ensures no functionality is lost.
 }
 // Handle file/image uploads (screenshot diagnosis)
 if (message.subtype === 'file_share' && message.files && message.files.length > 0) {
 const userId = message.user;
 const file = message.files[0];
 if (file.mimetype?.startsWith('image/')) {
 try {
 await say({ text: '📸 Analyzing screenshot...' });
 const emp = await lookupEmployee(userId, client);
 let diagnosis = null;

 // ── Download image from Slack ─────────────────────────────────────────
 const fileInfo = await client.files.info({ file: file.id });
 const imgUrl = fileInfo.file?.url_private;
 if (imgUrl) {
   const https = require('https');
   const imgBuffer = await new Promise((resolve, reject) => {
     const chunks = [];
     const req = https.get(imgUrl, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }, (res) => {
       res.on('data', c => chunks.push(c));
       res.on('end', () => resolve(Buffer.concat(chunks)));
     });
     req.on('error', reject);
     req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
   });
   const base64 = imgBuffer.toString('base64');
   const ext = (file.name || '').split('.').pop()?.toLowerCase();
   const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';

   const visionPrompt = `You are WIOM IT helpdesk assistant. An employee sent this screenshot of their laptop/screen showing an IT problem.

Analyze the screenshot carefully and:
1. Identify exactly what error/issue is visible
2. Give 2-3 simple steps to fix it (non-technical employee, no CMD, no Device Manager)
3. If it needs IT help → suggest clicking the IT Ticket button below

Reply in English. Be specific about what you see. Max 5 lines. No "common issue" opener.`;

   // ── PRIMARY: Gemini Vision (already connected) ────────────────────────
   if (process.env.GEMINI_API_KEY) {
     try {
       const { GoogleGenerativeAI } = require('@google/generative-ai');
       const gai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
       const model = gai.getGenerativeModel({ model: 'gemini-1.5-flash' });
       const result = await model.generateContent([
         visionPrompt,
         { inlineData: { data: base64, mimeType: mediaType } }
       ]);
       diagnosis = result.response.text()?.trim();
     } catch (gemErr) {
       console.error('Gemini vision error:', gemErr.message);
     }
   }

   // ── FALLBACK: Claude Vision ───────────────────────────────────────────
   if (!diagnosis && process.env.ANTHROPIC_API_KEY) {
     try {
       const Anthropic = require('@anthropic-ai/sdk');
       const ant = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
       const resp = await ant.messages.create({
         model: 'claude-3-5-haiku-20241022', max_tokens: 400,
         messages: [{ role: 'user', content: [
           { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 }},
           { type: 'text', text: visionPrompt }
         ]}]
       });
       diagnosis = resp.content[0]?.text;
     } catch (antErr) {
       console.error('Claude vision error:', antErr.message);
     }
   }
 }

 if (diagnosis) {
   // Apply same phone number filter
   diagnosis = diagnosis.replace(/📞?\s*9654244281/g, '').replace(/\b9654244281\b/g, '').trim();
   const formatted = formatForSlack(diagnosis);
   await say({ text: diagnosis, blocks: [
     { type: 'section', text: { type: 'mrkdwn', text: `📸 *Screenshot Analysis:*\n\n${formatted}` }},
     { type: 'context', elements: [{ type: 'mrkdwn', text: '_AI Vision — Not resolved? Click the IT Ticket button below._' }]}
   ]});
 } else {
   await say({ text: 'Screenshot received! Share the error message clearly, or click the *Create Ticket* button — IT team will help you directly.' });
 }
 } catch (err) {
 console.error('Photo diagnosis error:', err.message);
 await say({ text: 'Screenshot received! Share the error message clearly, or click the *Create Ticket* button — IT team will help you directly.' });
 }
 } else {
 await say({ text: `File received (${file.name})! What help do you need with this? 😊` });
 }
 return;
 }
 if (message.subtype) return;
 const userId = message.user;
 const text = message.text?.trim();
 if (!text) return;

 // Fix 8: Per-user lock — if a message is already being processed, skip duplicate
 if (processingUsers.has(userId)) return;
 processingUsers.add(userId);

 try {
 const emp = await lookupEmployee(userId, client);

 // ── FEATURE 4: Reset command ──────────────────────────────────────
 const isReset = /^(reset|nayi baat|new problem|naya|shuru karo|start over|naya topic|clear|naya sawal)$/i.test(text.trim());
 if (isReset) {
 await Conversation.updateMany(
 { slackUserId: userId, source: 'slack', resolved: false },
 { resolved: true }
 );
 pendingTickets.delete(userId);
 failedAttempts.delete(userId); // reset failure count on new topic
 const firstName = (emp.empName || 'there').split(' ')[0];
 await say({ text: ` Got it, ${firstName}! Starting fresh. What is your new IT problem?` });
 return;
 }

 // ── FEATURE 7: Meri tickets command ──────────────────────────────
 const isTicketCheck = /^(my tickets|my tickets|tickets dikhao|ticket status|mera ticket|open tickets|meri ticket)$/i.test(text.trim());
 if (isTicketCheck) {
 const tickets = await Ticket.find({
 $or: [{ empId: emp.empId }, { slackUserId: userId }],
 status: { $nin: ['Closed'] }
 }).sort({ createdAt: -1 }).limit(5);

 if (!tickets.length) {
 await say({ text: '*No open tickets!* Everything looks good.' });
 return;
 }

 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 const statEmoji = { Open:'⏳', 'In Progress':'', Waiting:'⏸', Resolved:'✅', Closed:'' };
 let ticketText = `*Your Open Tickets (${tickets.length}):*\n\n`;
 tickets.forEach(t => {
 const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
 ticketText += `${priEmoji[t.priority]||''} *\`${t.ticketId}\`* ${statEmoji[t.status]||'⏳'} ${t.status} ${hrs}h ago\n`;
 ticketText += `> ${(t.description||'').substring(0,60)}...\n\n`;
 });
 await say({ blocks:[
 { type:'section', text:{ type:'mrkdwn', text: ticketText }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_Need more help? Contact IT Helpdesk (Slack)_` }]}
 ], text: `Your ${tickets.length} open ticket(s)` });
 return;
 }

 // ── Greeting ──────────────────────────────────────────────────────
 const isGreeting = /^(hello|hi|hey|namaste|hlo|hii|namaskar|good morning|good afternoon|good evening|salam|sup|helo|helllo)$/i.test(text.trim());
 if (isGreeting) {
 await Conversation.updateMany(
 { slackUserId: userId, source: 'slack', resolved: false },
 { resolved: true }
 );
 pendingTickets.delete(userId);
 failedAttempts.delete(userId);
 const firstName = (emp.empName || 'there').split(' ')[0];
 await say({ text: `👋 ${firstName}! Apni problem type karo — main turant help karunga.\n_Ya Home Tab pe jao categories ke liye._` });
 return;
 }

 // ── Laptop info query ─────────────────────────────────────────────
 const isLaptopQuery = /^(my laptop|laptop model|laptop serial|serial no|serial number|asset tag|device info)$/i.test(text.trim());
 if (isLaptopQuery) {
 const empRec = await Employee.findOne({ slackUserId: userId });
 const model = empRec?.laptop || emp.laptop || null;
 const sn = empRec?.laptopSN || emp.laptopSN || null;
 if (model || sn) {
 await say({
 text: `Your Laptop: ${model||''} | SN: ${sn||''}`,
 blocks: [
 { type:'section', fields:[
 { type:'mrkdwn', text:`*Laptop Model:*\n${model||'N/A'}` },
 { type:'mrkdwn', text:`*Serial No:*\n\`${sn||'N/A'}\`` }
 ]}
 ]
 });
 return;
 }
 }

 // ── Vague message → show issue sub-category picker ──────────────────────────
 const vaguePatterns = [
   // Screen / Display issues — catches blinking, biling (typo), flickering, black etc.
   { regex: /screen\s*(biling|blink|flicker|jhal|kaamp|vibrat|problem|issue|nahi|black|kali|dim|dark|line)|display\s*(problem|issue|nahi|flicker|blink)|monitor\s*(issue|problem|nahi)/i, type: 'screen' },
   // Laptop general
   { regex: /^(laptop\s*(not\s*working|kharab|kaam\s*nahi|issue|problem|hang|slow|band|on\s*nahi|nahi\s*chal|theek\s*nahi|kuch\s*ho\s*gaya|bhot\s*slow|dead|crash)|laptop$)/i, type: 'laptop' },
   // WiFi / Internet
   { regex: /^(wifi\s*(nahi|not|issue|problem|kharab|kaam\s*nahi|nahi\s*chal|disconnect)|internet\s*(nahi|not|slow|issue|kharab)|network\s*(issue|problem|nahi))/i, type: 'wifi' },
   // Audio / Sound
   { regex: /sound\s*(nahi|not|issue|band|kaam\s*nahi)|audio\s*(nahi|not|issue)|speaker\s*(nahi|issue|problem)|awaaz\s*(nahi|band|problem)|headphone\s*(nahi|issue)/i, type: 'audio' },
   // Battery / Charging
   { regex: /batter[yi]?\s*(nahi|not|issue|drain|low|khatam|problem)|charg\s*(nahi|not|issue|stuck)|laptop\s*(charg|battery)/i, type: 'battery' },
   // Keyboard / Mouse
   { regex: /keyboard\s*(nahi|not|issue|kaam\s*nahi)|keys?\s*(nahi|stuck|issue)|typing\s*(nahi|issue)|mouse\s*(nahi|not|issue|stuck)|touchpad\s*(nahi|issue)/i, type: 'keyboard' },
   // Software / Apps
   { regex: /^(software\s*(issue|problem|nahi|not)|app\s*(crash|not|nahi|issue)|teams\s*(nahi|not|issue)|outlook\s*(nahi|not|issue)|windows\s*(issue|problem))/i, type: 'software' },
   // Account / Password
   { regex: /^(password\s*(bhool|forgot|reset|issue|nahi\s*pata)|account\s*(locked|issue|nahi)|login\s*(nahi|issue|problem))/i, type: 'account' },
   // Printer — "printer problem", "printer issue", "print nahi ho rha"
   { regex: /^printer\s*(problem|issue|nahi|not|kaam\s*nahi|offline|chal\s*nahi)?$|^print\s*(nahi|issue|problem|nahi\s*ho\s*rha)?$/i, type: 'printer' },
   // Email — "email issue", "gmail problem", "mail nahi aa rha" (vague)
   { regex: /^(email|gmail|mail)\s*(issue|problem|nahi|not)?$|^mail\s*(nahi\s*aa|problem|issue)$/i, type: 'email_vague' },
   // Generic vague — "problem hai", "issue hai", "kuch nahi chal rha"
   { regex: /^(problem\s*hai|issue\s*hai|kuch\s*nahi\s*chal|kuch\s*problem|koi\s*issue|help\s*chahiye|help\s*karo|madad\s*karo|issue)$/i, type: 'generic' },
 ];

 const vagueMatch = vaguePatterns.find(p => p.regex.test(text.trim()));

 if (vagueMatch) {
   const quickButtons = {
     screen: [
       { text: '📺 Screen Black', val: 'screen_black' },
       { text: '💫 Blinking/Flickering', val: 'screen_flicker' },
       { text: '🔆 Too Dark/Dim', val: 'screen_dim' },
       { text: '🌈 Color/Lines Issue', val: 'screen_color' },
       { text: '🖥️ No Display at All', val: 'screen_no_display' },
       { text: '💙 Blue Screen Error', val: 'blue_screen' },
     ],
     laptop: [
       { text: "💀 Won't Turn On", val: 'wont_turn_on' },
       { text: '🐢 Very Slow', val: 'laptop_slow' },
       { text: '📺 Screen Black', val: 'screen_black' },
       { text: '💙 Blue Screen', val: 'blue_screen' },
       { text: '🧊 Freezing/Hanging', val: 'freezing' },
       { text: '🔋 Battery Issue', val: 'battery_issue' },
       { text: '🌡️ Overheating', val: 'overheat' },
       { text: '❓ Something Else', val: 'laptop_other' },
     ],
     wifi: [
       { text: '📵 Not Connecting', val: 'wifi_not_connect' },
       { text: '🐌 Very Slow', val: 'internet_slow' },
       { text: '🔄 Keeps Dropping', val: 'wifi_drop' },
       { text: '🔒 Website Blocked', val: 'website_blocked' },
     ],
     audio: [
       { text: '🔇 No Sound at All', val: 'sound_none' },
       { text: '🎧 Headphone Issue', val: 'sound_headphone' },
       { text: '🎤 Mic Not Working', val: 'mic_issue' },
       { text: '📢 Sound Distorted', val: 'sound_distorted' },
     ],
     battery: [
       { text: '🔌 Not Charging', val: 'battery_not_charging' },
       { text: '⚡ Draining Fast', val: 'battery_drain' },
       { text: '0️⃣ Stuck at 0%', val: 'battery_stuck' },
       { text: '🔋 Battery Dead', val: 'battery_dead' },
     ],
     keyboard: [
       { text: '⌨️ Keys Not Working', val: 'keys_not_working' },
       { text: '🔠 Wrong Characters', val: 'keys_wrong' },
       { text: '🖱️ Mouse/Touchpad Issue', val: 'touchpad_issue' },
       { text: '🔢 NumLock Issue', val: 'numlock_issue' },
     ],
     software: [
       { text: '📹 Teams Not Working', val: 'teams_issue' },
       { text: '📧 Gmail Issue', val: 'gmail_issue' },
       { text: '💥 App Crashing', val: 'app_crash' },
       { text: '🔄 Windows Update', val: 'windows_update' },
       { text: '❓ Something Else', val: 'software_other' },
     ],
     account: [
       { text: '🔑 Forgot Password', val: 'password_reset' },
       { text: '🔒 Account Locked', val: 'account_locked' },
       { text: '📧 Email Password', val: 'email_password' },
       { text: '📱 2FA / OTP Issue', val: 'otp_issue' },
     ],
     printer: [
       { text: '🖨️ Not Printing', val: 'printer_not_printing' },
       { text: '📴 Printer Offline', val: 'printer_offline' },
       { text: '🔍 Not Detected', val: 'printer_not_detected' },
       { text: '🖼️ Print Quality Issue', val: 'printer_quality' },
     ],
     email_vague: [
       { text: '🔑 Login Issue', val: 'email_password' },
       { text: '📥 Not Receiving Emails', val: 'email_not_receiving' },
       { text: '📤 Cannot Send Email', val: 'email_not_sending' },
       { text: '💾 Mailbox Full', val: 'email_mailbox_full' },
     ],
     generic: [
       { text: '💻 Laptop Issue', val: 'laptop_other' },
       { text: '📶 WiFi / Internet', val: 'wifi_not_connect' },
       { text: '🔑 Password / Login', val: 'password_reset' },
       { text: '⚙️ Software / App', val: 'software_other' },
     ],
   };

   // vagueAIMap: value used as button VALUE when shown from DM sub-picker.
   // NO DUPLICATES — last key wins in JS objects, so only one entry per key.
   const vagueAIMap = {
     // Screen / Display
     screen_black: 'laptop screen completely black not showing anything',
     screen_flicker: 'screen blinking flickering constantly',
     screen_dim: 'screen too dark dim cannot see properly',
     screen_color: 'screen showing wrong colors or lines',
     screen_no_display: 'screen shows nothing no display at all',
     // Laptop
     wont_turn_on: "laptop won't turn on at all",
     laptop_slow: 'laptop very slow hanging',
     blue_screen: 'laptop blue screen BSOD error',
     freezing: 'laptop freezing and hanging',
     overheat: 'laptop overheating getting very hot',
     laptop_other: 'laptop hardware issue not specified',
     // Battery / Charging
     battery_issue: 'laptop battery or charging issue',
     battery_not_charging: 'laptop battery not charging at all',
     battery_drain: 'laptop battery draining too fast backup very low',
     battery_stuck: 'laptop battery stuck at 0 percent not charging',
     battery_dead: 'laptop battery completely dead not working',
     charger_issue_menu: 'charger not working or not charging properly',
     charger_asset_menu: 'charger replacement or new charger needed',
     charger_damaged: 'charger physically damaged broken needs replacement',
     // Network
     wifi_not_connect: 'wifi not connecting at all',
     internet_slow: 'internet very slow speed problem',
     wifi_drop: 'wifi keeps disconnecting dropping frequently',
     website_blocked: 'website not opening blocked',
     lan_issue: 'LAN cable ethernet internet not working',
     network_drive: 'network drive not accessible shared folder',
     dns_issue: 'DNS error internet not working',
     // Audio / Peripherals
     sound_none: 'no sound at all from speakers',
     sound_headphone: 'headphone not working no audio in headphone',
     mic_issue: 'microphone not working in Teams Zoom',
     sound_distorted: 'sound is distorted crackling bad quality',
     // Keyboard / Input
     keys_not_working: 'keyboard keys not working not typing',
     keys_wrong: 'keyboard typing wrong characters',
     touchpad_issue: 'mouse touchpad not working cursor stuck',
     numlock_issue: 'numlock numpad not working',
     // Software / Apps
     teams_issue: 'Microsoft Teams not working crashing',
     zoom_issue: 'Zoom not working cannot join meeting',
     slack_issue: 'Slack not working notification issue',
     outlook_issue: 'Gmail not working email issue',
     app_crash: 'app crashing not opening',
     windows_update: 'windows update stuck failing',
     software_other: 'software app issue not specified',
     // Browser
     chrome_issue: 'Chrome browser not opening or crashing',
     edge_issue: 'Edge browser not opening',
     browser_slow: 'browser slow laggy',
     pdf_issue: 'PDF file not opening',
     // Office
     excel_issue: 'Microsoft Excel not opening or crashing',
     word_issue: 'Microsoft Word not opening or crashing',
     ppt_issue: 'PowerPoint not opening or crashing',
     office_activation: 'Microsoft Office activation issue license error',
     file_corrupted: 'file is corrupted cannot open',
     // Email / Calendar
     gmail_issue: 'Gmail not opening email issue',
     email_not_sending: 'cannot send email Gmail not working',
     email_not_receiving: 'email not receiving emails not coming in gmail',
     email_mailbox_full: 'gmail mailbox storage full cannot receive',
     email_password: 'email Google account password reset',
     calendar_sync: 'Google Calendar not syncing',
     outlook_sync: 'Gmail email sync issue',
     outlook_email: 'Gmail email issue',
     email_access: 'email Gmail access needed',
     email_login: 'gmail login not working cannot access email',
     // Account / Password
     password_reset: 'forgot laptop Windows password',
     account_locked: 'account locked cannot login',
     otp_issue: '2FA OTP not received',
     // Access
     shared_folder: 'shared folder access needed',
     software_access: 'software application access needed',
     vpn_issue: 'vpn issue — WIOM does not use VPN',
     vpn_access: 'VPN access — WIOM does not use VPN',
     // Hardware / Peripherals
     camera_issue: 'camera not working black screen',
     external_monitor: 'external monitor not detected HDMI issue',
     scanner_issue: 'scanner not working not detected',
     printer_issue: 'printer not working offline',
     printer_not_printing: 'printer not printing document stuck in queue',
     printer_offline: 'printer showing offline cannot print',
     printer_not_detected: 'printer not detected not showing in devices',
     printer_quality: 'print quality issue faded blurry printing',
     // Asset Requests
     new_laptop: 'new laptop request',
     new_charger: 'charger replacement request',
     new_mouse: 'new mouse request',
     new_keyboard: 'new keyboard request',
     new_headphone: 'headphone request',
     new_monitor: 'new monitor request',
   };

   const categoryLabels = {
     screen: '🖥️ Screen/Display',
     laptop: '💻 Laptop',
     wifi: '📶 WiFi / Internet',
     audio: '🔊 Sound / Audio',
     battery: '🔋 Battery / Charging',
     keyboard: '⌨️ Keyboard / Mouse',
     software: '⚙️ Software / App',
     account: '🔑 Account / Password',
     printer: '🖨️ Printer',
     email_vague: '📧 Email / Gmail',
     generic: '🤔 IT Issue',
   };

   const btns = quickButtons[vagueMatch.type] || [];
   const rows = [];
   for (let i = 0; i < btns.length; i += 4) rows.push(btns.slice(i, i + 4));

   const label = categoryLabels[vagueMatch.type] || 'Issue';
   // Script hint only for categories where scripts actually help (not power/boot issues)
   const canScript = vagueMatch.type !== 'laptop' || true; // label is generic — no script promise
   const subLabel = `_Select below — IT Assistant will help you 👇_`;
   const blocks = [
     { type: 'section', text: { type: 'mrkdwn', text: `*${label} — select your exact problem:*\n${subLabel}` } },
   ];
   rows.forEach(row => {
     blocks.push({
       type: 'actions',
       elements: row.map(b => ({
         type: 'button',
         text: { type: 'plain_text', text: b.text, emoji: true },
         action_id: `vague_pick_${b.val}`,
         value: vagueAIMap[b.val] || b.text,
       }))
     });
   });

   await say({ text: `${label} — select your exact problem:`, blocks });
   return;
 }

 // ── Catch-all: completely vague short messages → show category buttons ──
 const isCatchAllVague = text.trim().split(/\s+/).length <= 4 &&
 /^(help|problem|issue|kuch|kuch\s*nahi|kuch\s*ho\s*gaya|nahi\s*chal|kaam\s*nahi|help\s*karo|kuch\s*hua|ajeeb|theek\s*nahi|dekho|sun|ek\s*problem|problem\s*hai|issue\s*hai|ek\s*issue|dikkat|dikkat\s*hai)/i.test(text.trim());
 if (isCatchAllVague) {
 await say({
 text: 'What is the problem? Select below:',
 blocks: [
 { type:'section', text:{ type:'mrkdwn', text:`*🤔 Can you tell me a bit more?*\nWhat is the issue with:` }},
 { type:'actions', elements: [
 { type:'button', text:{ type:'plain_text', text:'💻 Laptop', emoji:true }, action_id:'vague_pick_laptop_other', value:'laptop hardware issue' },
 { type:'button', text:{ type:'plain_text', text:'📶 WiFi / Internet', emoji:true }, action_id:'vague_pick_wifi_not_connect', value:'wifi not connecting' },
 { type:'button', text:{ type:'plain_text', text:'🔑 Password / Login', emoji:true }, action_id:'vague_pick_password_reset', value:'forgot laptop password' },
 { type:'button', text:{ type:'plain_text', text:'💿 Software / App', emoji:true }, action_id:'vague_pick_software_other', value:'software issue' },
 ]},
 { type:'actions', elements: [
 { type:'button', text:{ type:'plain_text', text:'🖨️ Printer', emoji:true }, action_id:'vague_pick_printer', value:'printer not working' },
 { type:'button', text:{ type:'plain_text', text:'📧 Email / Gmail', emoji:true }, action_id:'vague_pick_gmail_issue', value:'Gmail not working email issue' },
 { type:'button', text:{ type:'plain_text', text:'📹 Teams / Zoom', emoji:true }, action_id:'vague_pick_teams_issue', value:'Microsoft Teams not working' },
 { type:'button', text:{ type:'plain_text', text:'🎫 Create Ticket', emoji:true }, style:'primary', action_id:'vague_pick_create_ticket', value:'create ticket' },
 ]},
 { type:'context', elements:[{ type:'mrkdwn', text:`_24/7 available — Anytime, Anywhere_` }]}
 ]
 });
 return;
 }

 // ── "Ticket bana do" instant creation ──────────────────────────
 const isTicketNow = /ticket\s*(bana\s*do|banao|raise\s*karo|create|chahiye|do|bana|raise)/i.test(text.trim())
 || /^(ticket|raise ticket|create ticket|bana do ticket)$/i.test(text.trim());
 if (isTicketNow) {
 const pending = pendingTickets.get(userId);
 if (pending) {
 // Pending context exists → create immediately, no Ha/Nahi needed
 pendingTickets.delete(userId);
 const result = await createTicketSlack(pending);
 if (result?._duplicate) {
 await say({ text: `⚠️ ${result.message}` });
 } else if (result) {
 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 await say({
 text: `Ticket ${result.ticketId} created!`,
 blocks: [
 { type:'header', text:{ type:'plain_text', text:'✅ Ticket Created!', emoji:true }},
 { type:'section', fields:[
 { type:'mrkdwn', text:`*Ticket ID:*\n\`${result.ticketId}\`` },
 { type:'mrkdwn', text:`*${priEmoji[result.priority]||''} Priority:*\n${result.priority}` },
 { type:'mrkdwn', text:`*Category:*\n${result.category||'Other'}` },
 { type:'mrkdwn', text:`*Status:*\nOpen` }
 ]},
 { type:'section', text:{ type:'mrkdwn', text:`*Problem:*\n${(result.description||'').substring(0,100)}` }},
 { type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team has been notified | Track: type *my tickets*` }]}
 ]
 });
 await notifyAdmin(client, result, emp);
 } else {
 await say({ text: '❌ Could not create ticket. Please use the `/ticket` command.' });
 }
 } else {
 // No context → open /ticket modal instructions
 await say({
 text: 'Use the `/ticket` command to create a ticket!',
 blocks: [
 { type:'section', text:{ type:'mrkdwn', text:`*Need to Create a Ticket?*\n\nType \`/ticket\` → fill the form → ticket instantly created ✅\n\nOr describe your problem first — AI will help then suggest a ticket automatically.` }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_Urgent? Call IT Helpdesk directly._` }]}
 ]
 });
 }
 return;
 }

 // ── Pending ticket confirmation check ─────────────────────────────
 let pending = pendingTickets.get(userId);
 // Fix 3: Auto-expire pendingTickets after 30 minutes (in-memory TTL)
 if (pending && (Date.now() - (pending.createdAt || 0) > 30 * 60 * 1000)) {
   pendingTickets.delete(userId);
   pending = null;
 }
 if (pending) {
 // IMPORTANT: Must be exact short responses "NAHI HUAA" must NOT trigger isNo
 // "nahi huaa", "nahi chala", "kaam nahi kiya" = failed attempt → goes to AI
 // "nahi", "na", "no" alone = user declining ticket → isNo
 const isYes = /^(ha|haan|haa|han|hna|yes|bilkul|ok|okay|bana do|create|kar do|ho jaye|done)\s*[!।.,]?\s*$/i.test(text.trim());
 // Fix 4: Added nhai/nha (real user typos for "nahi") to isNo
 const isNo = /^(nahi|nhai|nha|na|no|nope|mat|chodo|rehne do|band karo|mt)\s*[!।.,]?\s*$/i.test(text.trim());

 if (isYes) {
 pendingTickets.delete(userId);
 const result = await createTicketSlack(pending);
 if (result?._duplicate) {
 await say({ text: `⚠️ ${result.message}` });
 } else if (result) {
 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 await say({
 text: `Ticket ${result.ticketId} has been created!`,
 blocks: [
 { type:'header', text:{ type:'plain_text', text:'✅ Ticket Created!', emoji:true }},
 { type:'section', fields:[
 { type:'mrkdwn', text:`*Ticket ID:*\n\`${result.ticketId}\`` },
 { type:'mrkdwn', text:`*${priEmoji[result.priority]||''} Priority:*\n${result.priority}` },
 { type:'mrkdwn', text:`*Category:*\n${result.category||'Other'}` },
 { type:'mrkdwn', text:`*Status:*\nOpen` }
 ]},
 { type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team has been notified | Track: type *my tickets*` }]}
 ]
 });
 await notifyAdmin(client, result, emp);
 } else {
 await say({ text: '❌ Could not create ticket. Please try `/ticket` or contact IT directly.' });
 }
 return;
 }

 if (isNo) {
 pendingTickets.delete(userId);
 await say({ text: 'No problem! Let us know if you need any help.' });
 return;
 }
 }

 // ── "Aap karo" / "You do it" detection ─────────────────────────
 const isAapKaro = /\b(aap\s*(he|hi|karo|kar|kardo|krdo|khud|chalao|run|open)|tum\s*karo|khud\s*kar|agent\s*(se|karo|chalao)|auto.*fix|you\s*do\s*it|do\s*it\s*yourself|khud\s*(karo|kare|chalao))\b/i.test(text);
 if (isAapKaro) {
 const brand = detectBrand(emp?.laptop);
 const brandInfo = getBrandInfo(brand, emp?.laptopSN);
 const isOnline = emp?.agentRegistered && emp?.agentLastSeen
 && (Date.now() - new Date(emp.agentLastSeen)) < 120000;

 const aapKaroBlocks = [];

 if (isOnline && emp?.laptopSN) {
 // Agent online → create a FixJob for diagnostic
 const diagFixMap = { hp: 'run_hp_diag', dell: 'run_dell_diag', lenovo: 'run_lenovo_diag' };
 const diagFix = diagFixMap[brand] || 'kill_heavy';
 const diagLabel = brandInfo.diagScript
 ? ` ${brandInfo.brandLabel} Diagnostic`
 : ' Auto Cleanup';
 await FixJob.create({
 empId: emp.empId, empName: emp.empName, laptopSN: emp.laptopSN,
 fixType: [diagFix], fixLabel: diagLabel,
 status: 'pending', slackUserId: userId
 });
 aapKaroBlocks.push({
 type: 'section',
 text: { type: 'mrkdwn', text:
 `⚡ *On it!* Agent is running *${diagLabel}* on your laptop.\n_Result in 30-60 seconds — please wait!_ `
 }
 });
 } else {
 // Agent offline → show download script
 aapKaroBlocks.push({
 type: 'section',
 text: { type: 'mrkdwn', text:
 ` *Download the script → double-click it → it will run automatically!*\n_IT safe script — works in one click._`
 }
 });
 if (brandInfo.diagScript) {
 aapKaroBlocks.push({ type: 'divider' });
 aapKaroBlocks.push({
 type: 'actions',
 elements: [{
 type: 'button',
 text: { type: 'plain_text', text: `⬇️ ${brandInfo.diagLabel}`, emoji: true },
 style: 'primary',
 url: `${PORTAL}/scripts/${brandInfo.diagScript}`,
 action_id: 'diag_dl_dm'
 }]
 });
 } else {
 aapKaroBlocks.push({
 type: 'context',
 elements: [{ type: 'mrkdwn', text: '_No specific script for this problem — raise a ticket or try the steps manually._' }]
 });
 }
 }

 await say({ text: 'Auto-fix is running!', blocks: aapKaroBlocks });
 return;
 }

 // ── Normal AI chat ────────────────────────────────────────────────

 // Typing indicator — ChatGPT style, shows user's issue being analyzed
 const shortIssue = text.length > 55 ? text.substring(0, 52) + '...' : text;
 const thinkingMsg = await say({
   text: 'WIOM IT is thinking...',
   blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: `_✦  WIOM IT: "${shortIssue}" — looking into this..._` }] }]
 });

 // ── SPEED: Try KB first — instant answer, no API call ─────────────
 const kbReply = claudeSvc.getKBAnswer ? claudeSvc.getKBAnswer(text) : null;
 if (kbReply) {
   const formattedKB = formatForSlack(kbReply);

   // isInfoOnly = informational reply, no troubleshooting → NO buttons shown
   // IMPORTANT: if KB reply says "type karo *ha*" it needs pendingTickets → NOT info-only
   const kbHasTicketAsk = /type\s*karo[:\s]*\*?ha(an|a|n)?\*?/i.test(kbReply);
   const isInfoOnly = !kbHasTicketAsk && (
     // Greetings, identity, thanks
     /spartans|kaun\s*hoon|IT|sajan kumar|khushi hui|koi baat nahi|theek hoon|IT problems mein help|Hello.*Kya IT|Theek hoon/i.test(kbReply) ||
     // Ticket status replies — no buttons needed, user just wanted info
     /IT team ke paas hai|my tickets|Status dekhne|ticket.*resolve|same day resolve|priority mark/i.test(kbReply) ||
     // Resolved confirm
     /Khushi hui.*resolve|resolve ho gaya|Great.*resolve/i.test(kbReply) ||
     // Short informational replies with no steps (1-2 lines, ends with emoji, no ticket mention)
     (!kbHasTicketAsk && kbReply.split('\n').filter(l => l.trim()).length <= 2 && !/\d+\.\s/.test(kbReply))
   );
   if (!isInfoOnly) {
     pendingTickets.set(userId, {
       empId: emp.empId, empName: emp.empName, empEmail: emp.email || 'unknown@wiom.in',
       empDept: emp.dept, empFloor: emp.floor,
       laptop: emp.laptop, laptopSN: emp.laptopSN,
       category: 'Other', priority: 'Medium',
       description: text, source: 'slack', slackUserId: userId,
       createdAt: Date.now()
     });
   }

   // Build blocks: script FIRST → answer → ticket button ALWAYS
   const kbMode = detectReplyMode(kbReply, kbHasTicketAsk);
   const kbBlocks = isInfoOnly
     ? [{ type:'section', text:{ type:'mrkdwn', text: formattedKB }}]
     : buildDMBlocks(text, formattedKB, 'Medium', kbMode);

   // Update "Checking..." → actual KB answer (delete first if update fails to avoid double message)
   try {
     await client.chat.update({ channel: thinkingMsg.channel, ts: thinkingMsg.ts, text: kbReply, blocks: kbBlocks });
   } catch {
     try { await client.chat.delete({ channel: thinkingMsg.channel, ts: thinkingMsg.ts }); } catch {}
     await say({ text: kbReply, blocks: kbBlocks });
   }

   // Fix 2: Save KB reply into conv history so AI doesn't repeat same steps next message
   getSlackSession(userId, emp).then(kbConv => {
     kbConv.messages.push({ role: 'user', content: text });
     kbConv.messages.push({ role: 'assistant', content: kbReply });
     if (kbConv.messages.length > 30) kbConv.messages = kbConv.messages.slice(-30);
     kbConv.save().catch(e => console.error('KB conv save error:', e.message));
   }).catch(e => console.error('KB session get error:', e.message));
   return;
 }

 // KB miss → AI call (thinkingMsg already showing)
 const convPromise = getSlackSession(userId, emp);

 const conv = await convPromise;
 conv.messages.push({ role: 'user', content: text });
 if (conv.messages.length > 30) conv.messages = conv.messages.slice(-30);

 // Run DB save and AI call in parallel for speed
 // Fix 5: Use allSettled so conv.save() failure doesn't silently kill the AI response
 const [saveResult, chatResult] = await Promise.allSettled([
 conv.save(),
 claudeSvc.chat(
 conv.messages,
 { empId: emp.empId, empName: emp.empName, source: 'slack',
 laptop: emp.laptop, laptopSN: emp.laptopSN, dept: emp.dept, floor: emp.floor }
 )
 ]);
 if (saveResult.status === 'rejected') console.error('⚠️ conv.save() failed:', saveResult.reason?.message);
 if (chatResult.status === 'rejected') throw chatResult.reason;
 const { reply, shouldCreateTicket, ticketData } = chatResult.value;

 conv.messages.push({ role: 'assistant', content: reply });
 await conv.save();

 // ── LEARNING QUEUE: Save AI answer for admin review (never auto-approve) ──
 if (!kbReply && reply && reply.length > 20) {
   try {
     const LearningQueue = require('./models/LearningQueue');
     const { intent: lqIntent, confidence: lqConf, category: lqCat } =
       claudeSvc.detectQueryIntent ? claudeSvc.detectQueryIntent(text) : { intent: 'unknown', confidence: 50, category: 'unknown' };

     const normalizedQ = text.toLowerCase().trim().substring(0, 150);
     const existing = await LearningQueue.findOne({ normalizedQuery: normalizedQ });

     if (existing) {
       await LearningQueue.findByIdAndUpdate(existing._id, {
         $inc: { occurrences: 1 },
         $addToSet: { empIds: emp.empId }
       });
     } else if (lqConf < 80) {
       const newEntry = await LearningQueue.create({
         query: text,
         normalizedQuery: normalizedQ,
         aiAnswer: reply,
         category: lqCat || 'unknown',
         intent: lqIntent || 'unknown',
         confidence: lqConf || 50,
         empIds: [emp.empId],
         occurrences: 1,
         status: 'pending'
       });

       // ── NOTIFY ADMIN ON SLACK with Approve/Reject buttons ──────────────
       const adminSlackId = process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID;
       if (adminSlackId && adminSlackId !== 'FILL_KARO' && slackClient) {
         const shortAnswer = reply.substring(0, 300) + (reply.length > 300 ? '...' : '');
         slackClient.chat.postMessage({
           channel: adminSlackId,
           text: '🧠 New Learning Queue item — review needed',
           blocks: [
             { type: 'header', text: { type: 'plain_text', text: '🧠 Learning Queue — Review Needed', emoji: true }},
             { type: 'section', text: { type: 'mrkdwn', text: `*Employee query:*\n_"${text.substring(0, 150)}"_\n\n*AI Answer:*\n${formatForSlack(shortAnswer)}` }},
             { type: 'context', elements: [{ type: 'mrkdwn', text: `Category: ${lqCat} | Confidence: ${lqConf}% | Asked by: ${emp.empName || emp.empId}` }]},
             { type: 'actions', elements: [
               { type: 'button', text: { type: 'plain_text', text: '✅ Approve', emoji: true },
                 style: 'primary', action_id: 'lq_approve', value: String(newEntry._id) },
               { type: 'button', text: { type: 'plain_text', text: '❌ Reject', emoji: true },
                 style: 'danger', action_id: 'lq_reject', value: String(newEntry._id) }
             ]}
           ]
         }).catch(() => {});
       }
     }
   } catch(e) { /* never crash bot */ }
 }

 // ── LOG UNKNOWN QUERIES to MongoDB for weekly review ──────────────────────
 try {
   const { intent: qi, confidence: qc, category: qcat } = claudeSvc.detectQueryIntent
     ? claudeSvc.detectQueryIntent(text)
     : { intent: 'unknown', confidence: 50, category: 'unknown' };

   if (!kbReply && (qc < 70 || qi === 'unknown')) {
     const UnknownQuery = require('./models/UnknownQuery');
     await UnknownQuery.findOneAndUpdate(
       { normalizedQuery: text.toLowerCase().trim().substring(0, 100) },
       {
         $set: { query: text, detectedIntent: qi, detectedCategory: qcat, confidence: qc, empId: emp.empId, empName: emp.empName, source: 'slack' },
         $inc: { attempts: 1 }
       },
       { upsert: true }
     ).catch(() => {}); // Never crash bot for logging
   }
 } catch(e) { /* ignore logging errors */ }

 // ── 2-ATTEMPT ESCALATION for unknown queries ──────────────────────────────
 if (!kbReply && reply) {
   const isGenericOrFallback = /thoda\s*aur\s*batao|yeh\s*issue\s*meri\s*knowledge|kb\s*miss|main.*identify.*nahi/i.test(reply);
   if (isGenericOrFallback) {
     const prev = unknownAttempts.get(userId) || { count: 0, lastTime: 0 };
     const isRecent = Date.now() - prev.lastTime < 30 * 60 * 1000; // 30 min window
     const newCount = isRecent ? prev.count + 1 : 1;
     unknownAttempts.set(userId, { count: newCount, lastTime: Date.now() });

     // After 2 attempts → auto-escalate
     if (newCount >= 2) {
       unknownAttempts.delete(userId);
       await say({
         text: 'Raising IT Support ticket',
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `⚡ *Could not identify the issue after 2 attempts.*\n\nIT team will handle it directly. Raise a ticket below:` }},
           { type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '🎫 Raise IT Ticket', emoji: true },
               style: 'danger', action_id: 'quick_ticket_btn', value: text }
           ]}
         ]
       });
       processingUsers.delete(userId);
       return;
     }
   }
 }

 // ── Format reply + build blocks ───────────────────────────────────
 const formattedReply = formatForSlack(reply);
 const recentUserText = conv.messages.filter(m=>m.role==='user').slice(-2).map(m=>m.content).join(' ');

 // ── Auto-detect ticket context from conversation ──────────────────
 const allUserText = conv.messages.filter(m=>m.role==='user').map(m=>m.content).join(' ').toLowerCase();
 let autoCategory = 'Other';
 if (/wifi|internet|network|connection|hotspot|broadband|\bnet\b/i.test(allUserText)) autoCategory = 'Network';
 else if (/teams|zoom|outlook|email|browser|chrome|word|excel|office|app|software|windows|update|onedrive|pdf|virus|storage|2fa|otp|antivirus/i.test(allUserText)) autoCategory = 'Software';
 else if (/laptop|screen|keyboard|mouse|battery|charg|touchpad|usb|bluetooth|camera|mic|headphone|sound|speaker|display|monitor|fan|overheat|blue screen|bsod|freeze|hang|slow|boot|startup/i.test(allUserText)) autoCategory = 'Hardware';
 else if (/password|account|login|locked|access|2fa|otp|email.*reset|reset.*email/i.test(allUserText)) autoCategory = 'Account';
 else if (/replace|replacement|new mouse|new keyboard|new monitor|new laptop/i.test(allUserText)) autoCategory = 'Purchase';
 else if (/chori|stolen|theft|gum\s*ho|gum\s*gaya|missing|kho\s*gaya/i.test(allUserText)) autoCategory = 'Theft/Loss';

 let autoPriority = 'Medium';
 // Water/liquid damage = ALWAYS Critical (data + hardware at risk)
 if (/\b(water|liquid|paani|chai|coffee|juice|drink|spill|bhig|wet|geela)\b/i.test(allUserText) &&
     /\b(laptop|keyboard|device|screen)\b/i.test(allUserText)) autoPriority = 'Critical';
 // Theft/loss = ALWAYS High priority
 else if (/chori|cori|stolen|theft|gum\s*ho|gum\s*gaya|missing|kho\s*gaya|kho\s*gayi/i.test(allUserText)) autoPriority = 'High';
 else if (/urgent|critical|emergency|immediately|stop.*work|can.*t work|completely|floor down/i.test(allUserText)) autoPriority = 'High';
 else if (/minor|small|little|low|whenever/i.test(allUserText)) autoPriority = 'Low';

 const lastUserMsg = conv.messages.filter(m=>m.role==='user').slice(-3).map(m=>m.content).join('; ');

 // Build blocks: script FIRST → answer → ticket button ALWAYS
 // Use current message (text) for script detection — NOT recentUserText (avoids old WiFi context bleeding in)
 // Info-only = informational, no troubleshooting → NO buttons
 // NEVER info-only if shouldCreateTicket = true (user must confirm with "ha")
 const replyLines = reply.trim().split('\n').filter(l => l.trim());
 const hasNumberedSteps = /^\d+[\.\)]\s/m.test(reply);
 const isInfoOnly = !shouldCreateTicket && (
   // Greeting / identity / thanks
   /khushi hui|koi baat nahi|theek hoon|aur koi.*IT help|IT problems mein help|koi aur cheez|Kya IT problem/i.test(reply) ||
   // Ticket status / info queries
   /IT team ke paas|my tickets|Status dekhne|ticket.*resolve|same day|priority mark/i.test(reply) ||
   // Resolved celebrations
   /resolve ho gaya|Great.*resolve|sahi ho gaya.*Koi aur/i.test(reply) ||
   // Short factual/how-to answer — 1-2 lines, no numbered steps, no ticket ask
   // e.g. "wallpaper kaise change karu", "wifi password kya hai", "screenshot kaise lu"
   (replyLines.length <= 2 && !hasNumberedSteps && !/type\s*karo.*\*?ha\*?/i.test(reply))
 );

 // Only set pendingTickets for actionable replies (avoid stale ticket context for greetings/facts)
 if (!isInfoOnly) {
   pendingTickets.set(userId, {
     empId: emp.empId, empName: emp.empName, empEmail: emp.email || 'unknown@wiom.in',
     empDept: emp.dept, empFloor: emp.floor,
     laptop: emp.laptop, laptopSN: emp.laptopSN,
     category: ticketData?.category || autoCategory,
     priority: ticketData?.priority || autoPriority,
     description: ticketData?.description || lastUserMsg || text,
     source: 'slack', slackUserId: userId,
     createdAt: Date.now()
   });
 }
 const replyMode = detectReplyMode(reply, shouldCreateTicket);
 const blocks = isInfoOnly
   ? [{ type:'section', text:{ type:'mrkdwn', text: formattedReply }}]
   : buildDMBlocks(text, formattedReply, ticketData?.priority || autoPriority, replyMode);

 // Replace "Checking issue..." with actual reply (delete first if update fails to avoid double message)
 try {
   await client.chat.update({
     channel: thinkingMsg.channel,
     ts: thinkingMsg.ts,
     text: reply,
     blocks
   });
 } catch {
   try { await client.chat.delete({ channel: thinkingMsg.channel, ts: thinkingMsg.ts }); } catch {}
   await say({ text: reply, blocks });
 }

 } catch (err) {
 console.error('❌ DM handler error:', err.message);
 try {
 await say({ text: '❌ A technical problem occurred. Please wait a moment and try again.' });
 } catch (sayErr) {
 console.error('❌ Could not send error message:', sayErr.message);
 }
 } finally {
 // Fix 8: Always release lock when processing finishes
 processingUsers.delete(userId);
 }
 });

 // ── ✅ Resolved — uses shared resolvedModalView / resolvedDMBlocks ──────────
 slackApp.action('resolved_yes_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const viewId = body.view?.id;
   const viewType = body.view?.type; // 'modal', 'home', or undefined (message context)
   const triggerId = body.trigger_id;
   console.log(`✅ resolved_yes_btn: userId=${userId} viewType=${viewType} viewId=${viewId}`);
   failedAttempts.delete(userId);
   pendingTickets.delete(userId);

   if (viewType === 'modal' && viewId) {
     // Inside a modal — update it in-place
     await client.views.update({ view_id: viewId, view: resolvedModalView() })
       .then(() => console.log('✅ resolved modal updated OK'))
       .catch(e => console.error('resolved_yes_btn modal update err:', e.message));
   } else if (triggerId) {
     // From Home Tab or message — open a new confirmation modal
     // (Messages Tab OFF means chat.postMessage is invisible — modal is always visible)
     await client.views.open({ trigger_id: triggerId, view: resolvedModalView() })
       .then(() => console.log('✅ resolved modal opened OK'))
       .catch(e => console.error('resolved_yes_btn modal open err:', e.message));
   }
   // No fallback DM — Messages Tab is OFF, DMs are invisible to users
 });

 // ── ❌ Kaam Nahi Aaya — auto-learn: generate better answer + save to DB ────────
 slackApp.action('wrong_answer_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const channelId = body.channel?.id || body.container?.channel_id;
   const question = body.actions?.[0]?.value || '';

   try {
     const emp = await lookupEmployee(userId, client).catch(() => null);
     const empName = emp?.empName || emp?.name || userId;

     // 1. Tell employee immediately
     await client.chat.postMessage({
       channel: channelId,
       text: 'Got it — working on it.',
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text:
         `🔧 *Got it — working on it.*\n\nNeed an IT ticket right now? Click the IT Ticket button below:`
       }}]
     });

     // 2. Auto-generate better answer using AI + send immediately
     if (question && question.length > 3) {
       const claudeSvc = require('./services/claude');

       // Try KB first (static), then MongoDB KB, then AI
       let reply = claudeSvc.getKBAnswer ? claudeSvc.getKBAnswer(question) : null;
       if (!reply && claudeSvc.getKBAnswerDB) reply = await claudeSvc.getKBAnswerDB(question).catch(() => null);
       if (!reply) {
         const fixMessages = [{ role: 'user', content: question }];
         const empInfo = { empId: emp?.empId || userId, empName: empName, source: 'slack',
           laptop: emp?.laptop, dept: emp?.dept, floor: emp?.floor };
         const result = await claudeSvc.chat(fixMessages, empInfo).catch(() => ({ reply: null }));
         reply = result?.reply;
       }

       // Save to Conversation DB for future reference
       if (reply) {
         Conversation.findOneAndUpdate(
           { sessionId: `feedback-${question.substring(0,40).replace(/\s+/g,'-')}` },
           { $set: { sessionId: `feedback-${question.substring(0,40).replace(/\s+/g,'-')}`,
               empId: emp?.empId || 'unknown', empName, source: 'feedback',
               messages: [{ role: 'user', content: question }, { role: 'assistant', content: reply }],
               lastActive: new Date() }},
           { upsert: true }
         ).catch(e => console.error('Feedback save error:', e.message));
         console.log(`🧠 Auto-answered: "${question.substring(0,60)}"`);
       }

       // Send better answer to employee right now
       if (reply) {
         const formatted = formatForSlack(reply);
         await client.chat.postMessage({
           channel: channelId,
           text: 'Try this:',
           blocks: [
             { type: 'section', text: { type: 'mrkdwn', text: `✅ *Try this:*\n\n${formatted}` }},
             { type: 'actions', elements: [
               { type: 'button', text: { type: 'plain_text', text: '✅ Done!', emoji: true },
                 action_id: 'resolved_yes_btn', style: 'primary', value: 'Medium' },
               { type: 'button', text: { type: 'plain_text', text: '🎫 IT Ticket Banao', emoji: true },
                 action_id: 'quick_ticket_btn', style: 'danger', value: 'Medium' }
             ]}
           ]
         });
       }
     }

     // 3. Notify admin
     const adminId = process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID;
     if (adminId && adminId !== 'FILL_KARO') {
       await client.chat.postMessage({
         channel: adminId,
         text: `❌ Bot answer flagged — auto-fixed`,
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text:
             `❌ *Bot answer did not work*\n*Employee:* ${empName}\n*Question:* _${question.substring(0, 150)}_\n\n🔧 Bot automatically generated a better answer and sent it to the employee.`
           }}
         ]
       });
     }
     console.log(`👎 Wrong answer flagged by ${empName}: "${question.substring(0, 100)}"`);
   } catch (err) {
     console.error('wrong_answer_btn error:', err.message);
   }
 });

 // ── 🧠 Learning Queue — Approve from Slack ───────────────────────────────────
 slackApp.action('lq_approve', async ({ body, ack, client }) => {
   await ack();
   const lqId = body.actions?.[0]?.value;
   const channelId = body.channel?.id || body.container?.channel_id;
   const messageTs = body.message?.ts;
   try {
     const LearningQueue = require('./models/LearningQueue');
     await LearningQueue.findByIdAndUpdate(lqId, {
       status: 'approved',
       reviewedBy: body.user?.name || 'admin',
       reviewedAt: new Date(),
       reviewNote: 'Approved via Slack'
     });
     // Update the Slack message to show approved
     if (messageTs) {
       await client.chat.update({
         channel: channelId, ts: messageTs,
         text: '✅ Learning Queue item approved',
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `✅ *Approved!* Answer saved for KB reference.\n_Reviewed by ${body.user?.real_name || body.user?.name}_` }}
         ]
       });
     }
     console.log(`✅ LQ approved: ${lqId} by ${body.user?.name}`);
   } catch(err) { console.error('lq_approve error:', err.message); }
 });

 // ── 🧠 Learning Queue — Reject from Slack ────────────────────────────────────
 slackApp.action('lq_reject', async ({ body, ack, client }) => {
   await ack();
   const lqId = body.actions?.[0]?.value;
   const channelId = body.channel?.id || body.container?.channel_id;
   const messageTs = body.message?.ts;
   try {
     const LearningQueue = require('./models/LearningQueue');
     await LearningQueue.findByIdAndUpdate(lqId, {
       status: 'rejected',
       reviewedBy: body.user?.name || 'admin',
       reviewedAt: new Date(),
       reviewNote: 'Rejected via Slack'
     });
     if (messageTs) {
       await client.chat.update({
         channel: channelId, ts: messageTs,
         text: '❌ Learning Queue item rejected',
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `❌ *Rejected.* Answer discarded.\n_Reviewed by ${body.user?.real_name || body.user?.name}_` }}
         ]
       });
     }
     console.log(`❌ LQ rejected: ${lqId} by ${body.user?.name}`);
   } catch(err) { console.error('lq_reject error:', err.message); }
 });

 // ── ❌ Not resolved — give next steps, escalate on 2nd failure ───────────────
 slackApp.action('not_resolved_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const viewId = body.view?.id; // modal context check
   const channelId = body.channel?.id || body.container?.channel_id || userId;

   // Track failure count
   const prev = failedAttempts.get(userId) || { count: 0, lastTime: 0 };
   const isStale = Date.now() - prev.lastTime > 30 * 60 * 1000;
   const count = isStale ? 1 : prev.count + 1;
   failedAttempts.set(userId, { count, lastTime: Date.now() });

   // ── After 2 failures → auto ticket ─────────────────────────────────────────
   if (count >= 2) {
     failedAttempts.delete(userId);
     const escalateBlocks = [
       { type: 'section', text: { type: 'mrkdwn', text: '*Steps did not resolve the issue — sending to IT team.*\n\nIT team will come personally and fix it.' } },
       { type: 'actions', elements: [
         { type: 'button', text: { type: 'plain_text', text: 'Create Ticket', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: 'Medium',
           confirm: { title: { type: 'plain_text', text: 'Create Ticket?' }, text: { type: 'mrkdwn', text: '_IT team will be alerted._' }, confirm: { type: 'plain_text', text: 'Yes, Create!' }, deny: { type: 'plain_text', text: 'Cancel' } }
         },
         { type: 'button', text: { type: 'plain_text', text: '🏠 Home', emoji: true }, action_id: 'go_home_btn', value: 'home' }
       ]}
     ];
     if (viewId) {
       await client.views.update({ view_id: viewId, view: {
         type: 'modal', title: { type: 'plain_text', text: 'IT Support', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true }, blocks: escalateBlocks
       }}).catch(e => console.error('not_resolved escalate modal err:', e.message));
     } else {
       await client.chat.postMessage({ channel: channelId, text: 'Steps did not resolve the issue.', blocks: escalateBlocks });
     }
     return;
   }

   // ── First failure → AI gives next different step ────────────────────────────
   // In modal context: update modal to loading first
   if (viewId) {
     await client.views.update({ view_id: viewId, view: {
       type: 'modal', title: { type: 'plain_text', text: 'Trying Again...', emoji: true },
       close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '_Looking for a different approach..._' }}]
     }}).catch(() => {});
   }
   const thinkMsg = viewId ? null : await client.chat.postMessage({
     channel: channelId,
     text: 'WIOM IT is trying a different approach...',
     blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: '_✦  WIOM IT: Looking for a different approach..._' }] }]
   });

   try {
     const emp = await lookupEmployee(userId, client).catch(() => null);
     const empInfo = {
       empId: emp?.empId || userId, empName: emp?.empName || 'User',
       source: 'slack', laptop: emp?.laptop, laptopSN: emp?.laptopSN,
       dept: emp?.dept, floor: emp?.floor
     };

     const conv = await getSlackSession(userId, emp || { empId: userId, empName: 'User' });
     // Tell AI explicitly what was tried and that it didn't work
     conv.messages.push({ role: 'user', content: 'tried the steps but the problem is still the same. please suggest a different method — do not repeat what was already suggested.' });
     if (conv.messages.length > 20) conv.messages = conv.messages.slice(-20);

     const { reply } = await claudeSvc.chat(conv.messages, empInfo);
     conv.messages.push({ role: 'assistant', content: reply });
     conv.save().catch(e => console.error('conv save error:', e.message));

     const formattedReply = formatForSlack(reply);
     const btnValue = body.actions?.[0]?.value || '';
     const originalIssue = pendingTickets.get(userId)?.description
       || (btnValue.length > 10 && !/^(Critical|High|Medium|Low|script)$/.test(btnValue) ? btnValue : null)
       || conv.messages.filter(m => m.role === 'user').find(m => !/(nahi hua|try kiye|same hai)/i.test(m.content))?.content
       || '';

     if (viewId) {
       // Modal context — update modal with new AI steps + buttons
       await client.views.update({
         view_id: viewId,
         view: {
           type: 'modal',
           title: { type: 'plain_text', text: 'Try This Instead', emoji: true },
           close: { type: 'plain_text', text: 'Close', emoji: true },
           blocks: [
             { type: 'section', text: { type: 'mrkdwn', text: formattedReply }},
             { type: 'divider' },
             { type: 'actions', elements: [
               { type: 'button', text: { type: 'plain_text', text: 'Yes, Fixed!', emoji: true }, action_id: 'resolved_yes_btn', style: 'primary', value: 'Medium' },
               { type: 'button', text: { type: 'plain_text', text: 'Create Ticket', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: originalIssue || 'IT support needed' }
             ]}
           ]
         }
       }).catch(e => console.error('not_resolved modal AI update error:', e.message));
     } else {
       const nextMode = detectReplyMode(reply, false);
       const nextBlocks = buildDMBlocks(originalIssue, formattedReply, 'Medium', nextMode);
       await client.chat.update({
         channel: thinkMsg.channel, ts: thinkMsg.ts, text: reply, blocks: nextBlocks
       });
     }
   } catch(err) {
     console.error('not_resolved_btn AI error:', err.message);
     const fallbackText = 'Restart your laptop and check again. If still not resolved — click the Create Ticket button.';
     if (viewId) {
       await client.views.update({ view_id: viewId, view: {
         type: 'modal', title: { type: 'plain_text', text: 'Try This', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: fallbackText }},
           { type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: 'Create Ticket', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: 'IT support needed' }
           ]}
         ]
       }}).catch(() => {});
     } else if (thinkMsg) {
       try {
         await client.chat.update({
           channel: thinkMsg.channel, ts: thinkMsg.ts, text: fallbackText,
           blocks: buildDMBlocks('', fallbackText)
         });
       } catch {
         await client.chat.postMessage({ channel: channelId, text: fallbackText }).catch(() => {});
       }
     } else if (channelId) {
       await client.chat.postMessage({ channel: channelId, text: fallbackText }).catch(() => {});
     }
   }
 });

 // ── ⚡ Script Download — track that user downloaded script ───────────────────
 slackApp.action('script_download_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const channelId = body.channel?.id || body.container?.channel_id;
   const problemText = body.actions?.[0]?.value || '';

   // Small delay then ask if script worked
   setTimeout(async () => {
     try {
       await client.chat.postMessage({
         channel: channelId,
         text: '⚡ Script Downloaded!',
         blocks: [
           { type:'section', text:{ type:'mrkdwn',
             text:`⚡ *Script Downloaded!*\n\nRun the script (Double-click or run as Administrator) and wait 1-2 minutes.\n\n_Was it resolved? Let us know 👇_` }},
           { type:'actions', elements: [
             { type:'button', text:{ type:'plain_text', text:'✅ Yes, Fixed by Script!', emoji:true },
               action_id:'resolved_yes_btn', style:'primary', value:'script' },
             { type:'button', text:{ type:'plain_text', text:'❌ No, Still Not Fixed', emoji:true },
               action_id:'not_resolved_btn', value:'script' }
           ]}
         ]
       });
     } catch(e) { console.error('script followup error:', e.message); }
   }, 8000); // 8 sec delay — give user time to download
 });

 // ── 🎫 Quick Ticket Button — shown at bottom of every DM answer ──────
 slackApp.action('quick_ticket_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const viewId = body.view?.id;
   const triggerId = body.trigger_id;
   const channelId = body.channel?.id || body.container?.channel_id || userId;
   const btnValue = body.actions?.[0]?.value || '';
   const description = (btnValue.length > 5 && !/^(Critical|High|Medium|Low|script|Medium|create ticket)$/i.test(btnValue))
     ? btnValue : (pendingTickets.get(userId)?.description || 'IT support needed');

   // ── Show notes form FIRST — user can add details before ticket is created ──
   try {
     if (viewId) {
       // Inside modal → update modal to show notes form
       await client.views.update({ view_id: viewId, view: ticketNotesFormView(description, 'Medium') })
         .catch(e => console.error('notes form update err:', e.message));
       return;
     } else if (triggerId) {
       // DM context → open new modal with notes form
       await client.views.open({ trigger_id: triggerId, view: ticketNotesFormView(description, 'Medium') })
         .catch(e => console.error('notes form open err:', e.message));
       return;
     }
   } catch(e) { console.error('quick_ticket notes form err:', e.message); }

   // Fallback: create ticket directly (if no modal/trigger available)
   try {
     const emp = await lookupEmployee(userId, client);

     // Get pendingTickets data (set by KB/AI path) or fallback to button value / conversation
     let pending = pendingTickets.get(userId);
     if (!pending) {
       // BUG-18 fix: conversations use slackUserId not sessionId; sort by lastActive for most recent
       const btnValue = body.actions?.[0]?.value || '';
       const conv = await Conversation.findOne({ slackUserId: userId }).sort({ lastActive: -1 }).lean().catch(() => null);
       const firstUserMsg = conv?.messages?.filter(m => m.role === 'user')?.[0]?.content || '';
       const problemText = (btnValue.length > 10 && !/^(Critical|High|Medium|Low|script)$/.test(btnValue))
         ? btnValue
         : (firstUserMsg || 'IT support required');
       pending = {
         empId: emp.empId, empName: emp.empName, empEmail: emp.email || 'unknown@wiom.in',
         empDept: emp.dept, empFloor: emp.floor,
         laptop: emp.laptop, laptopSN: emp.laptopSN,
         category: 'Other', priority: 'Medium',
         description: problemText.replace(/[*_`]/g, '').substring(0, 200),
         source: 'slack', slackUserId: userId,
         createdAt: Date.now()
       };
     }

     const result = await createTicketSlack(pending);
     if (result?._duplicate) {
       if (viewId) {
         await client.views.update({ view_id: viewId, view: {
           type: 'modal', title: { type: 'plain_text', text: 'Already Open', emoji: true },
           close: { type: 'plain_text', text: 'Close', emoji: true },
           blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⚠️ ${result.message}` }}]
         }}).catch(() => {});
       } else {
         await client.chat.postEphemeral({ channel: channelId, user: userId, text: `⚠️ ${result.message}` });
       }
     } else if (result) {
       pendingTickets.delete(userId);
       if (viewId) {
         // Modal context — use shared ticketCreatedModalView
         await client.views.update({ view_id: viewId, view: ticketCreatedModalView(result) })
           .catch(e => console.error('ticket modal update error:', e.message));
       } else {
         await client.chat.postMessage({
           channel: channelId,
           text: `Ticket Created: ${result.ticketId}`,
           blocks: [
             { type: 'section', text: { type: 'mrkdwn', text:
               `*IT Ticket Create Ho Gaya!*\n\n` +
               `*Ticket ID:* \`${result.ticketId}\`\n` +
               `*Priority:* ${result.priority}\n` +
               `*Category:* ${result.category}\n\n` +
               `IT team will help you as soon as possible.`
             }},
             { type: 'actions', elements: [
               { type: 'button', text: { type: 'plain_text', text: '🏠 Home', emoji: true }, action_id: 'go_home_btn', value: 'home', style: 'primary' }
             ]}
           ]
         });
       }
       await notifyAdmin(client, result, emp);
     }
   } catch(err) {
     console.error('quick_ticket_btn error:', err.message);
     if (viewId) {
       await client.views.update({ view_id: viewId, view: {
         type: 'modal', title: { type: 'plain_text', text: 'Error', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Could not create ticket. Email IT at: ${ADMIN_EMAIL}` }}]
       }}).catch(() => {});
     } else {
       await client.chat.postEphemeral({ channel: channelId, user: userId,
         text: `Could not create ticket. Email IT at: ${ADMIN_EMAIL}` });
     }
   }
 }); // end quick_ticket_btn

 // ── Ticket Notes Form Submission ─────────────────────────────────────────────
 // CRITICAL FIX: ack() called FIRST — before any async DB/API calls.
 // Slack requires ack within 3 seconds. DB + API easily exceeds that.
 // After ack(), use views.update to show result in the existing modal.
 slackApp.view('quick_ticket_notes_modal', async ({ body, ack, client, view }) => {
   await ack(); // ← MUST be first line — Slack 3-sec timeout

   const userId = body.user.id;
   const viewId = body.view?.id;
   const notes = view.state.values?.notes_block?.notes_input?.value || '';
   let metadata = {};
   try { metadata = JSON.parse(view.private_metadata || '{}'); } catch {}

   const baseDesc = metadata.description || 'IT support needed';
   const fullDesc = baseDesc + (notes.trim() ? '\n\nEmployee Notes: ' + notes.trim() : '');

   // Show loading state immediately so user sees something while we hit DB
   if (viewId) {
     await client.views.update({ view_id: viewId, view: creatingTicketModalView() }).catch(() => {});
   }

   try {
     const emp = await lookupEmployee(userId, client).catch(() => ({ empId: userId, empName: 'User', email: 'unknown@wiom.in' }));
     const pending = pendingTickets.get(userId) || {};
     const result = await createTicketSlack({
       empId: emp.empId, empName: emp.empName, empEmail: emp.email || 'unknown@wiom.in',
       empDept: emp.dept, empFloor: emp.floor,
       laptop: emp.laptop, laptopSN: emp.laptopSN,
       category: pending.category || 'Other', priority: pending.priority || metadata.priority || 'Medium',
       description: fullDesc.replace(/[*_`]/g, '').substring(0, 500),
       source: 'slack', slackUserId: userId
     });

     if (result?._duplicate) {
       if (viewId) await client.views.update({ view_id: viewId, view: {
         type: 'modal', title: { type: 'plain_text', text: 'Already Open', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⚠️ ${result.message}` }}]
       }}).catch(() => {});
     } else if (result) {
       pendingTickets.delete(userId);
       if (viewId) await client.views.update({ view_id: viewId, view: ticketCreatedModalView(result) }).catch(() => {});
       await notifyAdmin(client, result, emp);
     } else {
       if (viewId) await client.views.update({ view_id: viewId, view: {
         type: 'modal', title: { type: 'plain_text', text: 'Error', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ Could not create ticket. Email IT at: ${ADMIN_EMAIL}` }}]
       }}).catch(() => {});
     }
   } catch(err) {
     console.error('quick_ticket_notes_modal submission error:', err.message);
     if (viewId) await client.views.update({ view_id: viewId, view: {
       type: 'modal', title: { type: 'plain_text', text: 'Error', emoji: true },
       close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ Could not create ticket. Email IT at: ${ADMIN_EMAIL}` }}]
     }}).catch(() => {});
   }
 });

 // ── NEW FEATURE: Cancel Ticket — employee cancels their own open ticket ────────
 slackApp.action(/^cancel_ticket_/, async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const ticketId = body.actions[0].value;
   const viewId = body.view?.id;
   const triggerId = body.trigger_id;
   const showModal = async (view) => {
     if (viewId) await client.views.update({ view_id: viewId, view }).catch(() => {});
     else if (triggerId) await client.views.open({ trigger_id: triggerId, view }).catch(() => {});
   };
   try {
     const ticket = await Ticket.findOne({ ticketId });
     if (!ticket) {
       return showModal({ type: 'modal', title: { type: 'plain_text', text: 'Not Found' }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ Ticket \`${ticketId}\` not found.` }}] });
     }
     if (['Resolved','Closed'].includes(ticket.status)) {
       return showModal({ type: 'modal', title: { type: 'plain_text', text: 'Already Closed' }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Ticket \`${ticketId}\` is already ${ticket.status}.` }}] });
     }
     await Ticket.findOneAndUpdate({ ticketId }, { status: 'Closed', resolvedAt: new Date(), closedReason: 'Cancelled by employee via Slack' });
     await showModal({ type: 'modal', title: { type: 'plain_text', text: '✅ Ticket Cancelled', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ Ticket \`${ticketId}\` has been cancelled.\n\nIf the issue comes back, create a new ticket from the Home tab.` }}]
     });
   } catch(err) { console.error('cancel_ticket error:', err.message); }
 });

 // ── NEW FEATURE: Reopen Ticket — employee reopens a recently resolved ticket ──
 slackApp.action(/^reopen_ticket_/, async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const ticketId = body.actions[0].value;
   const viewId = body.view?.id;
   const triggerId = body.trigger_id;
   const showModal = async (view) => {
     if (viewId) await client.views.update({ view_id: viewId, view }).catch(() => {});
     else if (triggerId) await client.views.open({ trigger_id: triggerId, view }).catch(() => {});
   };
   try {
     const ticket = await Ticket.findOne({ ticketId });
     if (!ticket || !['Resolved','Closed'].includes(ticket.status)) {
       return showModal({ type: 'modal', title: { type: 'plain_text', text: 'Cannot Reopen' }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'This ticket is not closed/resolved or was not found.' }}] });
     }
     await Ticket.findOneAndUpdate({ ticketId }, { status: 'Open', resolvedAt: null, closedReason: null, reopenedAt: new Date(), reopenedBy: userId });
     await showModal({ type: 'modal', title: { type: 'plain_text', text: '🔄 Ticket Reopened', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🔄 Ticket \`${ticketId}\` has been reopened.\n\nIT team has been notified and will follow up shortly.` }}]
     });
     const adminId = process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID;
     if (adminId && adminId !== 'FILL_KARO') await client.chat.postMessage({ channel: adminId, text: `🔄 Ticket \`${ticketId}\` reopened by employee (<@${userId}>)` }).catch(() => {});
   } catch(err) { console.error('reopen_ticket error:', err.message); }
 });

 // ── NEW FEATURE: Bump Priority — employee escalates their ticket priority ──────
 slackApp.action(/^bump_priority_/, async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const ticketId = body.actions[0].value;
   const viewId = body.view?.id;
   const triggerId = body.trigger_id;
   const showModal = async (view) => {
     if (viewId) await client.views.update({ view_id: viewId, view }).catch(() => {});
     else if (triggerId) await client.views.open({ trigger_id: triggerId, view }).catch(() => {});
   };
   try {
     const ticket = await Ticket.findOne({ ticketId });
     if (!ticket || ['Resolved','Closed'].includes(ticket.status)) {
       return showModal({ type: 'modal', title: { type: 'plain_text', text: 'Cannot Update' }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'This ticket is already closed or not found.' }}] });
     }
     if (ticket.priority === 'Critical') {
       return showModal({ type: 'modal', title: { type: 'plain_text', text: 'Already Critical 🔴', emoji: true }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'This ticket is already *Critical* — the highest priority. IT team is handling it.' }}] });
     }
     const priorityLadder = { Low: 'Medium', Medium: 'High', High: 'Critical' };
     const newPriority = priorityLadder[ticket.priority] || 'High';
     await Ticket.findOneAndUpdate({ ticketId }, { priority: newPriority, escalatedAt: new Date() });
     await showModal({ type: 'modal', title: { type: 'plain_text', text: '⬆️ Priority Updated', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⬆️ Ticket \`${ticketId}\` priority updated to *${newPriority}*.\n\nIT team has been notified.` }}]
     });
     const adminId = process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID;
     if (adminId && adminId !== 'FILL_KARO') await client.chat.postMessage({ channel: adminId, text: `⬆️ Ticket \`${ticketId}\` escalated to *${newPriority}* by employee (<@${userId}>)` }).catch(() => {});
   } catch(err) { console.error('bump_priority error:', err.message); }
 });

 // ── NEW FEATURE: Add Comment — employee adds update/info to existing ticket ────
 slackApp.action(/^add_comment_ticket_/, async ({ body, ack, client }) => {
   await ack();
   const ticketId = body.actions[0].value;
   const triggerId = body.trigger_id;
   const viewId = body.view?.id;
   if (!triggerId) return;
   try {
     const pushOrOpen = viewId
       ? (v) => client.views.push({ trigger_id: triggerId, view: v })
       : (v) => client.views.open({ trigger_id: triggerId, view: v });
     await pushOrOpen({
       type: 'modal',
       callback_id: 'add_comment_modal',
       private_metadata: ticketId,
       title: { type: 'plain_text', text: '💬 Add Update', emoji: true },
       submit: { type: 'plain_text', text: 'Send Update', emoji: true },
       close: { type: 'plain_text', text: 'Cancel', emoji: true },
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `Adding update to ticket \`${ticketId}\`` }},
         { type: 'input', block_id: 'comment_block',
           label: { type: 'plain_text', text: 'What has changed or what additional info do you want to add?', emoji: true },
           element: { type: 'plain_text_input', action_id: 'comment_input', multiline: true,
             placeholder: { type: 'plain_text', text: 'e.g. The issue started happening after Windows update. Error message: ...' }
           }
         }
       ]
     });
   } catch(e) { console.error('add_comment modal error:', e.message); }
 });

 slackApp.view('add_comment_modal', async ({ body, ack, client, view }) => {
   const userId = body.user.id;
   const ticketId = view.private_metadata;
   const comment = view.state.values?.comment_block?.comment_input?.value || '';
   try {
     const ticket = await Ticket.findOne({ ticketId });
     if (!ticket) {
       await ack({ response_action: 'update', view: {
         type: 'modal', title: { type: 'plain_text', text: 'Not Found' },
         close: { type: 'plain_text', text: 'Close' },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ Ticket \`${ticketId}\` not found.` }}]
       }});
       return;
     }
     const updatedDesc = (ticket.description || '') + `\n\n--- Employee Update (${new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})}) ---\n${comment}`;
     await Ticket.findOneAndUpdate({ ticketId }, { description: updatedDesc.substring(0, 1000) });
     // Show success confirmation inside modal
     await ack({ response_action: 'update', view: {
       type: 'modal', title: { type: 'plain_text', text: '✅ Update Sent!', emoji: true },
       close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: `✅ Your update for ticket \`${ticketId}\` has been sent to IT!\n\n_IT team will review your update and respond shortly._` }},
         { type: 'context', elements: [{ type: 'mrkdwn', text: `💬 Update: "${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}"` }]}
       ]
     }});
     const adminId = process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID;
     if (adminId && adminId !== 'FILL_KARO') {
       await client.chat.postMessage({ channel: adminId, text: `💬 Update on ticket \`${ticketId}\` from <@${userId}>:\n${comment}` }).catch(() => {});
     }
   } catch(err) {
     console.error('add_comment submit error:', err.message);
     await ack({ response_action: 'update', view: {
       type: 'modal', title: { type: 'plain_text', text: 'Error' },
       close: { type: 'plain_text', text: 'Close' },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ Update failed. Please try again.` }}]
     }}).catch(() => {});
   }
 });

 // ── Start Slack App ───────────────────────────────────────────────────
 slackApp.start().then(async () => {
 console.log(' Slack Bot started! Socket Mode active.');
 slackClient = slackApp.client;
 app.locals.slackClient = slackApp.client;

 // Auto-link admin Slack ID
 const adminSlackId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 if (adminSlackId && adminSlackId !== 'FILL_KARO') {
 await Employee.findOneAndUpdate(
 { $or: [
     { email: (process.env.ADMIN_EMAIL || 'sajan.kumar@wiom.in').toLowerCase() },
     { name: { $regex: 'sajan', $options: 'i' } }
 ]},
 { slackUserId: adminSlackId },
 { new: true }
 ).catch(() => {});
 }

 // ── FEATURE 6: Daily 9AM IST summary (= 03:30 UTC) ───────────────
 cron.schedule('30 3 * * *', async () => {
 try {
 const adminId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 if (!adminId || adminId === 'FILL_KARO') return;

 // BUG-09 fix: use IST midnight (UTC 18:30 prev day) not UTC midnight
 const IST_OFFSET_MS = 5.5 * 3600000;
 const todayStart = new Date(
   Math.floor((Date.now() + IST_OFFSET_MS) / 86400000) * 86400000 - IST_OFFSET_MS
 );

 const [totalOpen, newToday, resolvedToday, critical, slaBreached] = await Promise.all([
 Ticket.countDocuments({ status: { $in: ['Open', 'In Progress'] } }),
 Ticket.countDocuments({ createdAt: { $gte: todayStart } }),
 Ticket.countDocuments({ resolvedAt: { $gte: todayStart } }),
 Ticket.countDocuments({ priority: 'Critical', status: { $nin: ['Resolved', 'Closed'] } }),
 Ticket.countDocuments({ slaBreached: true, status: { $nin: ['Resolved', 'Closed'] } })
 ]);

 // Top 3 oldest unresolved tickets
 const oldest = await Ticket.find({ status: { $in: ['Open', 'In Progress'] } })
 .sort({ createdAt: 1 }).limit(3);

 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 let oldestText = '';
 oldest.forEach(t => {
 const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
 oldestText += `${priEmoji[t.priority]||''} \`${t.ticketId}\` ${t.empName} _(${hrs}h pending)_\n`;
 });

 const dateStr = new Date().toLocaleDateString('en-IN', {
 weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
 timeZone: 'Asia/Kolkata'
 });

 // Trending: top categories (last 7 days) — todayStart already IST-correct
 const trendData = await Ticket.aggregate([
 { $match: { createdAt: { $gte: new Date(Date.now() - 7*24*3600000) } } },
 { $group: { _id: '$category', count: { $sum: 1 } } },
 { $sort: { count: -1 } }, { $limit: 5 }
 ]);
 const trendText = trendData.length
 ? trendData.map(t => `• *${t._id || 'Other'}:* ${t.count} tickets`).join('\n')
 : '• No tickets this week';

 await slackApp.client.chat.postMessage({
 channel: adminId,
 text : `⚡ WIOM IT — Good Morning! IT Helpdesk Daily Summary ${dateStr}`,
 blocks : [
 { type:'header', text:{ type:'plain_text', text:`⚡ WIOM IT — Daily Summary`, emoji:true }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_${dateStr} | WIOM IT Helpdesk_` }]},
 { type:'divider' },
 { type:'section', fields:[
 { type:'mrkdwn', text:`*🎫 Today's New*\n*${newToday}* tickets` },
 { type:'mrkdwn', text:`*✅ Resolved Today*\n*${resolvedToday}* tickets` },
 { type:'mrkdwn', text:`*⏳ Total Open*\n*${totalOpen}* tickets` },
 { type:'mrkdwn', text:`*🔴 Critical Open*\n*${critical}*` },
 { type:'mrkdwn', text:`*⚠️ SLA Breached*\n*${slaBreached}*` }
 ]},
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: `*📊 Top Issues (Last 7 Days):*\n${trendText}` }},
 ...(oldestText ? [
 { type:'divider' },
 { type:'section', text:{ type:'mrkdwn', text:`*⏳ Oldest Pending Tickets:*\n${oldestText}` }}
 ] : []),
 { type:'context', elements:[{ type:'mrkdwn', text:`_Good morning! ⚡ WIOM IT Helpdesk_` }]}
 ]
 });
 console.log(' Daily summary sent to admin');
 } catch (err) {
 console.error('Daily summary cron error:', err.message);
 }
 });

 // ── Weekly Unknown Query Report — Every Monday 9AM IST (= 03:30 UTC) ─────────
 cron.schedule('30 3 * * 1', async () => {
   try {
     const adminId = process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID;
     if (!adminId || adminId === 'FILL_KARO' || !slackClient) return;

     const UnknownQuery = require('./models/UnknownQuery');
     const LearningQueue = require('./models/LearningQueue');
     const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600000);

     // Top 20 unknown queries this week + Learning Queue stats in parallel
     const [topUnknown, pendingReview, approvedThisWeek] = await Promise.all([
       UnknownQuery.find({
         createdAt: { $gte: oneWeekAgo },
         resolved: false
       })
       .sort({ attempts: -1 })
       .limit(20)
       .lean(),
       LearningQueue.countDocuments({ status: 'pending' }),
       LearningQueue.countDocuments({
         status: { $in: ['approved', 'edited_approved'] },
         reviewedAt: { $gte: oneWeekAgo }
       })
     ]);

     if (topUnknown.length === 0 && pendingReview === 0) {
       console.log('Weekly report: no unknown queries this week');
       return;
     }

     const listText = topUnknown.length
       ? topUnknown
           .map((q, i) => `${i+1}. \`${q.query.substring(0, 60)}\` — ${q.attempts} time(s)`)
           .join('\n')
       : '_No unknown queries this week!_';

     await slackClient.chat.postMessage({
       channel: adminId,
       text: '📊 Weekly Unknown Queries Report',
       blocks: [
         { type: 'header', text: { type: 'plain_text', text: '📊 Weekly Unknown Queries Report', emoji: true }},
         { type: 'section', text: { type: 'mrkdwn', text: `*Top ${topUnknown.length} queries the bot could not answer:*\n\n${listText}` }},
         { type: 'section', text: { type: 'mrkdwn', text: `*📋 Learning Queue:* ${pendingReview} answers waiting for review | ${approvedThisWeek} approved this week\n_Admin Dashboard → Learning Queue tab to review_` }},
         { type: 'section', text: { type: 'mrkdwn', text: '_Create KB articles for these queries → bot will automatically improve._' }},
         { type: 'context', elements: [{ type: 'mrkdwn', text: `_Total this week: ${topUnknown.length} unique unknown queries_` }]}
       ]
     });
     console.log('📊 Weekly unknown queries report sent');
   } catch(err) {
     console.error('Weekly report cron error:', err.message);
   }
 });

 }).catch(err => {
 console.error('❌ Slack Bot start failed:', err.message);
 });

 } catch (err) {
 console.error('❌ Slack Bot init error:', err.message);
 }
 } else {
 console.log('⚠️ Slack tokens not configured bot not started.');
 }
});

module.exports = app;

