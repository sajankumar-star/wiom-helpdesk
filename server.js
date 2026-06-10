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

// ── FIX: Global crash guards Slack Socket Mode disconnect nahi crash karein ─
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

 // ── In-memory store for pending ticket confirmations (short-lived) ─────
 const pendingTickets  = new Map(); // slackUserId -> ticketData (with createdAt)
 const processingUsers = new Set(); // Fix 8: per-user lock — prevents race conditions
 const expandedHomeMap = new Map(); // slackUserId -> Set<categoryKey>
 const failedAttempts  = new Map(); // slackUserId -> { count, lastTime } — tracks "Nahi hua" clicks
 const unknownAttempts = new Map(); // userId → { count, lastQuery, lastTime } — unknown query escalation

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

 // ── Build Home Tab blocks — FINAL Phase 1 design ────────────────────────────────────────
         const buildHomeBlocks = (emp, myTickets, expandedSet) => {
           const blocks = [];

           // ── Header ────────────────────────────────────────────────────────
           blocks.push({
             type: 'section',
             text: { type: 'mrkdwn', text: '*🛠 Wiom IT Helpdesk*\nSelect your issue category below.\n_Most common issues can be resolved automatically._' },
             accessory: { type: 'image', image_url: 'https://wiom-helpdesk-production.up.railway.app/wiom-logo.webp', alt_text: 'WIOM' }
           });
           blocks.push({ type: 'divider' });

           // ── 11 Categories ────────────────────────────────────────────────
           // Row 1-3: main categories (3 per row)
           blocks.push({ type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '💻 Device & Hardware', emoji: true }, action_id: 'cat_laptop', value: 'laptop' },
             { type: 'button', text: { type: 'plain_text', text: '🌐 Network & Internet', emoji: true }, action_id: 'cat_network', value: 'network' },
             { type: 'button', text: { type: 'plain_text', text: '📊 Microsoft Office', emoji: true }, action_id: 'cat_msoffice', value: 'office' },
           ]});
           blocks.push({ type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '🌍 Browser & Apps', emoji: true }, action_id: 'cat_browser', value: 'browser' },
             { type: 'button', text: { type: 'plain_text', text: '📧 Email & Comm', emoji: true }, action_id: 'cat_email', value: 'email' },
             { type: 'button', text: { type: 'plain_text', text: '🔐 Access & Identity', emoji: true }, action_id: 'cat_access', value: 'access' },
           ]});
           blocks.push({ type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '☁️ Cloud & Storage', emoji: true }, action_id: 'cat_cloud', value: 'cloud' },
             { type: 'button', text: { type: 'plain_text', text: '🔒 Security', emoji: true }, action_id: 'cat_security', value: 'security' },
           ]});
           // Row 4: Emergency — alone, prominent red
           blocks.push({ type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '🚨 Emergency Support', emoji: true }, action_id: 'cat_emergency', value: 'emergency', style: 'danger' },
           ]});
           // Row 5: Asset Requests — last, alone
           blocks.push({ type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '📦 Asset Requests', emoji: true }, action_id: 'cat_asset', value: 'asset' },
           ]});
           blocks.push({ type: 'divider' });

           // ── My Tickets + Ticket Counter ──────────────────────────────────
           const statEmoji = { 'Open': '🔴', 'In Progress': '🟡', 'Waiting': '🟠', 'Resolved': '🟢', 'Closed': '⚪' };
           const priEmoji2 = { 'Critical': '🔴', 'High': '🟠', 'Medium': '🟡', 'Low': '🟢' };
           const allTickets = myTickets ? myTickets.slice(0, 3) : [];
           const openCount = allTickets.filter(t => ['Open','In Progress','Waiting'].includes(t.status)).length;

           // ── Ticket Counter — show open ticket count only (no View button)
           if (openCount > 0) {
             blocks.push({ type: 'section', text: { type: 'mrkdwn', text:
               `🎫 *Open Tickets: ${openCount}* — IT team is actively working on these`
             }});
           }

           if (allTickets.length > 0) {
             for (const t of allTickets) {
               const hrs = Math.floor((Date.now() - new Date(t.createdAt)) / 3600000);
               const timeStr = hrs < 24 ? hrs + 'h ago' : Math.floor(hrs/24) + 'd ago';
               const statusLine = (statEmoji[t.status]||'🔵') + ' *' + t.status + '*  ' + (priEmoji2[t.priority]||'🟡') + ' ' + t.priority;
               // No Details button — ticket info visible directly
               blocks.push({
                 type: 'section',
                 text: { type: 'mrkdwn', text: '`' + t.ticketId + '` — ' + statusLine + '\n_' + (t.description||'').substring(0,60) + '..._\n📅 ' + timeStr },
               });
             }
             blocks.push({ type: 'divider' });
           }

           // ── Quick Actions — WiFi + Create Ticket only ─────────────────────
           blocks.push({ type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '📶 WiFi Password', emoji: true }, action_id: 'home_quick_wifi_pwd_quick', value: 'wifi password', style: 'primary' },
             { type: 'button', text: { type: 'plain_text', text: '🎫 Create Ticket', emoji: true }, action_id: 'vague_pick_create_ticket', value: 'create ticket' },
           ]});

           // ── Footer ───────────────────────────────────────────────────────
           blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text:
             '⚡ *Zivon AI Support* — 24/7 Available  |  📧 sajan.kumar@wiom.in'
           }]});

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
     text: { type: 'mrkdwn', text: `*Hey ${firstName}! 👋*\n\nI'm *Zivon* — WIOM's AI IT Assistant.\nLaptop, WiFi, software, password — tell me your problem and I'll fix it right away!\n\n_Select a category below — Zivon will help you instantly!_` },
     accessory: { type: 'image', image_url: 'https://wiom-helpdesk-production.up.railway.app/images/zivon-robot.gif', alt_text: 'Zivon' }
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
     // Priority selector
     { type: 'input', block_id: 'priority_block',
       optional: false,
       label: { type: 'plain_text', text: '⚡ Priority', emoji: true },
       element: {
         type: 'static_select',
         action_id: 'priority_select',
         placeholder: { type: 'plain_text', text: 'Select priority...', emoji: true },
         // IMPORTANT: initial_option text MUST exactly match one of the options below
         initial_option: { text: { type: 'plain_text', text: '🟡 Medium — Partial impact on work', emoji: true }, value: 'Medium' },
         options: [
           { text: { type: 'plain_text', text: '🔴 Critical — Work completely stopped', emoji: true }, value: 'Critical' },
           { text: { type: 'plain_text', text: '🟠 High — Work severely impacted', emoji: true }, value: 'High' },
           { text: { type: 'plain_text', text: '🟡 Medium — Partial impact on work', emoji: true }, value: 'Medium' },
           { text: { type: 'plain_text', text: '🟢 Low — Minor issue, fix when possible', emoji: true }, value: 'Low' },
         ]
       }
     },
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

 // ── Detect reply mode — decides which buttons (if any) to show ───────────────
 // 'question' → AI asked a diagnostic question, no buttons needed yet
 // 'ticket'   → AI wants user to confirm ticket with "ha" (only IT Ticket button)
 // 'steps'    → AI gave actual fix steps (Ho gaya + IT Ticket both show)
 const detectReplyMode = (reply, shouldCreateTicket) => {
   const lines = reply.trim().split('\n').filter(l => l.trim());
   const hasNumberedSteps = /^\d+[\.\)]\s/m.test(reply);
   const hasBullets = /^[•\-\*]\s/m.test(reply);
   const hasRealSteps = hasNumberedSteps || hasBullets;

   // Real numbered/bulleted steps → always 'steps' (user may have already tried them)
   if (hasRealSteps) return 'steps';

   // No real steps but ticket ask → 'ticket' only (nothing is resolved yet — no Ho gaya)
   // e.g. installation request, physical damage, theft — IT team hasn't come yet
   if (shouldCreateTicket) return 'ticket';

   // Short reply with question mark → diagnostic question (no buttons yet)
   const isQuestion = /\?/.test(reply) && lines.length <= 3;
   if (isQuestion) return 'question';

   // Multi-line informational reply with no ticket ask → show both buttons as fallback
   return lines.length >= 4 ? 'steps' : 'question';
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
   if (mode === 'question') {
     // AI is asking a diagnostic question — no buttons, wait for user reply
     return blocks;
   }

   blocks.push({ type: 'divider' });

   if (mode === 'ticket') {
     // Only ticket confirm button
     blocks.push({
       type: 'actions',
       elements: [{
         type: 'button',
         text: { type: 'plain_text', text: '🎫  IT Ticket Banao', emoji: true },
         action_id: 'quick_ticket_btn',
         style: 'danger',
         value: urgency,
         confirm: {
           title: { type: 'plain_text', text: 'Ticket Create Karein?' },
           text: { type: 'mrkdwn', text: '_IT team ko alert bheja jayega — woh directly fix karegi._' },
           confirm: { type: 'plain_text', text: '✅ Ha, Banao!' },
           deny: { type: 'plain_text', text: 'Ruko' }
         }
       }]
     });
   } else {
     // Steps mode — Ho gaya + Ticket + Wrong Answer feedback
     blocks.push({
       type: 'actions',
       elements: [
         {
           type: 'button',
           text: { type: 'plain_text', text: '✅  Ho gaya!', emoji: true },
           action_id: 'resolved_yes_btn',
           style: 'primary',
           value: urgency
         },
         {
           type: 'button',
           text: { type: 'plain_text', text: '🎫  IT Ticket Banao', emoji: true },
           action_id: 'quick_ticket_btn',
           style: 'danger',
           value: urgency,
           confirm: {
             title: { type: 'plain_text', text: 'Ticket Create Karein?' },
             text: { type: 'mrkdwn', text: '_IT team ko alert bheja jayega — woh directly fix karegi._' },
             confirm: { type: 'plain_text', text: '✅ Ha, Banao!' },
             deny: { type: 'plain_text', text: 'Ruko' }
           }
         },
         {
           type: 'button',
           text: { type: 'plain_text', text: '❌  Kaam Nahi Aaya', emoji: true },
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
       text: { type: 'plain_text', text: '🎫  IT Ticket Create Karo', emoji: true },
       action_id: 'quick_ticket_btn',
       style: 'danger',
       confirm: {
         title: { type: 'plain_text', text: 'Ticket Create Karein?' },
         text: { type: 'mrkdwn', text: '_IT team directly aayegi — woh personally fix karegi._' },
         confirm: { type: 'plain_text', text: '✅ Ha, Banao!' },
         deny: { type: 'plain_text', text: 'Ruko' }
       }
     },
     {
       type: 'button',
       text: { type: 'plain_text', text: '🔄  Phir Try Karo', emoji: true },
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

 // ── Create ticket via API ─────────────────────────────────────────────
 const createTicketSlack = async (data) => {
 try {
 const res = await fetch(`${API_BASE}/api/tickets`, {
 method : 'POST',
 headers: { 'Content-Type': 'application/json' },
 body : JSON.stringify({ ...data, aiTried: true })
 });
 const json = await res.json();
 if (res.status === 409) return { _duplicate: true, ticket: json.ticket, message: json.message };
 if (!res.ok) {
 console.error('Ticket creation failed:', res.status, json.error || json.message || JSON.stringify(json));
 return null;
 }
 if (!json.ticket) {
 console.error('Ticket creation response missing ticket field:', JSON.stringify(json));
 return null;
 }
 console.log('Ticket created:', json.ticket.ticketId, '| empId:', data.empId, '| category:', json.ticket.category);
 return json.ticket;
 } catch (err) {
 console.error('createTicketSlack fetch error:', err.message);
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
 {
 type : 'input',
 block_id: 'priority_block',
 label : { type:'plain_text', text:'How Urgent Is It?', emoji:true },
 element : {
 type : 'static_select',
 action_id : 'priority_input',
 initial_option: { text:{ type:'plain_text', text:'Medium Normal problem' }, value:'Medium' },
 options : [
 { text:{ type:'plain_text', text:'Critical - Work completely stopped' }, value:'Critical' },
 { text:{ type:'plain_text', text:'High - Very urgent, needed ASAP' }, value:'High' },
 { text:{ type:'plain_text', text:'Medium - Normal issue, can partially work' }, value:'Medium' },
 { text:{ type:'plain_text', text:'Low - Minor issue, fix when possible' }, value:'Low' }
 ]
 }
 }
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
 const priority = vals.priority_block.priority_input.selected_option?.value || 'Medium';

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
 text: `_From: WIOM IT Team (Zivon) | ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}_`
 }]}
 ]
 });
 sent++;
 } catch { failed++; }
 }
 // Confirm to admin
 await client.chat.postMessage({
 channel: body.user.id,
 text: `✅ Broadcast sent! ${sent} employees ko message mila. ${failed > 0 ? `(${failed} failed)` : ''}`,
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
         { text: '📹 Teams Issue',            val: 'teams_issue' },
         { text: '🎥 Zoom Issue',             val: 'zoom_issue' },
         { text: '📄 Adobe PDF Issue',        val: 'pdf_issue' },
         { text: '❌ Application Crash',      val: 'app_crash' },
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
     cat_security: {
       label: '🔒 Security', desc: 'Select your specific issue:',
       issues: [
         { text: '🎣 Phishing Email',         val: 'phishing_email' },
         { text: '🦠 Virus / Malware',        val: 'virus_malware' },
         { text: '🔓 Suspicious Login',       val: 'suspicious_login' },
         { text: '🚨 Security Alert',         val: 'security_alert' },
         { text: '💀 Account Hacked',         val: 'account_hacked' },
       ]
     },
     cat_emergency: {
       label: '🚨 Emergency Support', desc: '⚠️ HIGH/CRITICAL ticket created immediately:',
       issues: [
         { text: '💧 Water/Liquid Damage',    val: 'liquid_damage' },
         { text: '📱 Device Lost/Stolen',     val: 'device_lost' },
         { text: '💀 Account Hacked',         val: 'account_hacked' },
         { text: '🔥 Burning Smell',          val: 'burning_smell' },
         { text: '🔋 Battery Swelling',       val: 'battery_swelling' },
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
         { type: 'context', elements: [{ type: 'mrkdwn', text: 'IT team working on this. Contact: sajan.kumar@wiom.in' }]}
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
 { type:'input', block_id:'priority_block',
 label:{ type:'plain_text', text:'How Urgent?' },
 element:{ type:'static_select', action_id:'priority_input',
 initial_option:{ text:{ type:'plain_text', text:'Medium - Normal issue' }, value:'Medium' },
 options:[
 { text:{ type:'plain_text', text:'Critical - Work completely stopped' }, value:'Critical' },
 { text:{ type:'plain_text', text:'High - Very urgent' }, value:'High' },
 { text:{ type:'plain_text', text:'Medium - Normal issue' }, value:'Medium' },
 { text:{ type:'plain_text', text:'Low - Minor issue' }, value:'Low' }
 ]}}
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
 slackApp.action(/^vague_pick_(new_laptop|new_mouse|new_keyboard|new_headphone|new_monitor)$/, async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const rawKey = body.actions[0].value;
   const triggerId = body.trigger_id;
   const isInsideModal = body.view?.type === 'modal';

   const itemNames = {
     new_laptop: 'New Laptop', new_mouse: 'New Mouse', new_keyboard: 'New Keyboard',
     new_headphone: 'Headphone', new_monitor: 'New Monitor',
   };
   const itemName = itemNames[rawKey] || 'Equipment';
   const mailSubject = encodeURIComponent(`${itemName} Request - Approval Required`);
   const mailBody = encodeURIComponent(`Hi,\n\nI am requesting a ${itemName} for my work.\n\nReason: [Please fill reason]\n\nCC: sajan.kumar@wiom.in\n\nThank you`);

   // ── Modal view — no header/url blocks (not supported in Slack modals) ──────
   const modalBlocks = [
     { type: 'section', text: { type: 'mrkdwn', text: `*📦 ${itemName} Request*\n\n*Manager approval is required* before IT can process this request.` }},
     { type: 'divider' },
     { type: 'section', fields: [
       { type: 'mrkdwn', text: '*Processing Time:*\n2 Working Days' },
       { type: 'mrkdwn', text: '*IT Contact:*\nsajan.kumar@wiom.in' },
     ]},
     { type: 'divider' },
     { type: 'section', text: { type: 'mrkdwn', text:
       `*How to request:*\n1. Get manager approval (email/message)\n2. Email IT: *sajan.kumar@wiom.in*\n   Subject: \`${itemName} Request - Approval Required\`\n3. CC your manager in the email\n4. IT team will arrange within 2 working days`
     }},
     { type: 'context', elements: [{ type: 'mrkdwn', text: '_Once approved by your manager, the IT team will arrange it directly._' }]}
   ];

   // ── DM message blocks — header + mailto url button work fine in messages ──
   const dmBlocks = [
     { type: 'header', text: { type: 'plain_text', text: `📦 ${itemName} Request`, emoji: true }},
     { type: 'section', text: { type: 'mrkdwn', text: '*Approval Required*\n\nPlease obtain approval from your reporting manager.' }},
     { type: 'divider' },
     { type: 'section', fields: [
       { type: 'mrkdwn', text: '*CC:*\nsajan.kumar@wiom.in' },
       { type: 'mrkdwn', text: '*Processing Time:*\n2 Working Days' },
     ]},
     { type: 'divider' },
     { type: 'actions', elements: [
       { type: 'button', text: { type: 'plain_text', text: '📧 Send Approval Email', emoji: true }, style: 'primary', url: `mailto:?subject=${mailSubject}&body=${mailBody}`, action_id: `dl_asset_email_${rawKey}` },
     ]},
     { type: 'context', elements: [{ type: 'mrkdwn', text: '_Once approved by your manager, the IT team will arrange it directly._' }]}
   ];

   if (isInsideModal && triggerId) {
     // Inside cat_asset modal → push a new modal on top (views.push)
     try {
       await client.views.push({
         trigger_id: triggerId,
         view: { type: 'modal', title: { type: 'plain_text', text: `📦 ${itemName}`, emoji: true }, close: { type: 'plain_text', text: '← Back', emoji: true }, blocks: modalBlocks }
       });
     } catch(e) {
       console.error(`asset modal push error (${rawKey}):`, e.message);
       // Fallback: send DM
       try {
         const dm = await client.conversations.open({ users: userId });
         await client.chat.postMessage({ channel: dm.channel.id, text: `${itemName} Request`, blocks: dmBlocks });
       } catch(dmErr) { console.error('asset DM fallback error:', dmErr.message); }
     }
   } else {
     // Home Tab or DM context → send as DM (url button works in messages)
     try {
       const dm = await client.conversations.open({ users: userId });
       await client.chat.postMessage({ channel: dm.channel.id, text: `${itemName} Request`, blocks: dmBlocks });
     } catch(e) { console.error(`asset DM error (${rawKey}):`, e.message); }
   }
 });

 slackApp.action(/^vague_pick_/, async ({ body, ack, client, say }) => {
 await ack();
 const userId = body.user.id;
 const actionId = body.actions[0].action_id;
 const rawKey = body.actions[0].value;

 // Asset request keys — handled by dedicated asset handler above, skip here to avoid duplicate/race
 const ASSET_KEYS = ['new_laptop', 'new_mouse', 'new_keyboard', 'new_headphone', 'new_monitor'];
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
       await client.chat.postMessage({ channel: userId, text: '🎫 To create a ticket, please describe your issue and raise it via the Create Ticket button. Or email IT directly: sajan.kumar@wiom.in' })
         .catch(dmErr => console.error('create_ticket fallback DM error:', dmErr.message));
     }
   }
   return;
 }

 const KEY_TO_PROBLEM = {
   laptop_slow: 'laptop bahut slow hai hang ho rha hai', excel_slow: 'Microsoft Excel bahut slow chal rha hai hang ho rha hai freeze ho rha hai',
   blue_screen: 'blue screen bsod error aa rha hai',
   overheat: 'laptop overheating bahut garam ho rha hai', battery_issue: 'battery issue charging problem',
   battery_not_charging: 'battery charge nahi ho rhi charger nahi chal rha',
   keys_not_working: 'keyboard kaam nahi kar rha', touchpad_issue: 'touchpad kaam nahi kar rha cursor stuck',
   camera_issue: 'laptop ka webcam/camera video call mein kaam nahi kar rha — black screen ya camera detect nahi ho rha, Privacy settings ya driver issue', mic_issue: 'laptop ka built-in microphone kaam nahi kar rha — video call mein awaaz nahi jaati, Privacy settings mein mic off ho sakta hai',
   sound_none: 'laptop ke speakers se awaaz bilkul nahi aa rhi — volume sahi hai phir bhi silent hai', screen_black: 'screen black ho gyi kuch nahi dikh rha',
   external_monitor: 'external monitor HDMI se connect kiya par laptop pe detect nahi ho rha second screen nahi aa rha', scanner_issue: 'office scanner ya printer ka scanner mode kaam nahi kar rha PC pe detect nahi ho rha',
   wont_turn_on: 'laptop on nahi ho rha won\'t turn on start nahi ho rha',
  wifi_not_connect: 'wifi nahi chal rha connect nahi ho rha', no_internet: 'internet bilkul nahi chal rha laptop connected hai par pages nahi khul rhe',
  internet_slow: 'internet bahut slow hai',
   lan_issue: 'lan cable nahi chal rha ethernet issue', network_drive: 'network shared drive missing hai — mapped drive Z: ya shared folder accessible nahi hai, reconnect karna hai',
   excel_issue: 'excel open nahi ho rha crash ho rha', word_issue: 'word open nahi ho rha crash',
   ppt_issue: 'powerpoint open nahi ho rha', office_activation: 'MS Office activation error — employees khud activate nahi kar sakte, IT ticket raise karo',
   file_corrupted: 'Word Excel PPT ya koi bhi file nahi khul rhi — software missing ya file open karne mein error aa rha', chrome_issue: 'Google Chrome browser nahi khul rha ya crash ho rha hai — Task Manager se Chrome end karo dobara open karo',
   edge_issue: 'Edge browser nahi khul rha ya crash ho rha — Task Manager se close karo dobara open karo', browser_slow: 'Google Chrome ya Edge browser bahut slow hai pages load hote hain ya freeze ho jaata hai',
   website_blocked: 'specific website page open nahi ho rha browser mein load nahi ho rha — doosri websites theek chal rhi hain', teams_issue: 'Teams app nahi khul rha ya call drop ho rhi hai ya messages nahi aa rhe — system tray se Quit karo dobara open karo',
   zoom_issue: 'Zoom app nahi khul rha ya meeting join nahi ho rhi ya call quality issue hai — Zoom close karo dobara open karo', pdf_issue: 'PDF file nahi khul rhi Adobe Acrobat ya Reader kaam nahi kar rha ya PDF open karne mein error',
   app_crash: 'application/software nahi khul rha ya crash ho rha hai — Task Manager se process end karo dobara open karo, restart karo', gmail_issue: 'Gmail nahi khul rha ya emails nahi aa rhe — Chrome mein gmail.com directly open karo, incognito mein try karo',
   outlook_email: 'gmail email issue', email_login: 'gmail login nahi ho rha email mein access nahi',
  slack_issue: 'Slack app nahi khul rha ya messages nahi aa rhe ya notifications band hain — Quit karo system tray se, dobara open karo, agar bhi nahi to cache clear karo',
   email_not_sending: 'Gmail se email send nahi ho rhi — error aa rha hai ya email stuck hai outbox mein', email_not_receiving: 'Gmail inbox mein emails nahi aa rhi — expected emails missing hain ya inbox khali hai',
   calendar_sync: 'Google Calendar sync issue hai — meetings aur events show nahi ho rahe ya Google Calendar open karne mein problem hai', password_reset: 'password bhool gaya reset karna hai',
   account_locked: 'account locked ho gaya login nahi ho rha', shared_folder: 'shared folder access nahi mil rha',
   email_access: 'Gmail account access chahiye — naya account ya existing account mein problem', software_access: 'kisi software ka access chahiye — install karna hai ya permission chahiye, IT karega',
   new_laptop: 'new laptop request chahiye', new_mouse: 'mouse chahiye new',
   new_keyboard: 'keyboard chahiye new', new_headphone: 'headphone chahiye',
   new_monitor: 'monitor chahiye new', new_charger: 'charger chahiye',
   screen_flicker: 'laptop screen flicker kar rhi hai blink ho rhi',
   projector_issue: 'projector ya HDMI conference room mein connect nahi ho rha',
   usb_issue: 'USB port kaam nahi kar rha device detect nahi ho rhi',
   fan_noise: 'laptop fan bahut tez noise kar rha hai ya band hai',
   physical_damage: 'laptop physically damage ho gaya crack aa gaya ya gir gaya',
   liquid_damage: 'laptop mein paani ya liquid gir gaya water damage EMERGENCY',
   frequent_disconnect: 'WiFi baar baar disconnect ho rhi hai unstable',
   door_access: 'office door access card kaam nahi kar rha ya naya card chahiye',
   mobile_not_working: 'company phone kaam nahi kar rha on nahi ho rha',
   sim_not_working: 'company SIM kaam nahi kar rha network nahi aa rha',
   mobile_internet: 'company phone par internet nahi chal rha',
   email_mobile: 'company phone par Gmail email setup karna hai',
   mobile_app: 'company phone par app kaam nahi kar rha crash ho rha',
   mobile_charging: 'company phone charge nahi ho rha',
   mobile_screen_damage: 'company phone ki screen crack ho gayi damage hui',
   google_drive_issue: 'Google Drive files nahi khul rhi ya sync nahi ho rhi',
   shared_drive_issue: 'shared Google Drive folder access nahi hai files missing',
   file_sync_issue: 'files sync nahi ho rhi Google Drive shared folder mein',
   storage_full: 'laptop storage full ho gayi C drive full files save nahi ho rhe',
   phishing_email: 'suspicious phishing email aaya hai jo fake lagta hai',
   virus_malware: 'laptop mein virus ya malware hai suspicious activity ho rhi',
   suspicious_login: 'kisi aur ne mera account use kiya suspicious login alert',
   security_alert: 'security alert aa rha hai laptop ya account mein suspicious',
   account_hacked: 'mera account hack ho gaya password kaam nahi EMERGENCY',
   burning_smell: 'laptop se burning smell ya smoke aa rha hai EMERGENCY',
   battery_swelling: 'laptop ki battery swell phool gayi hai EMERGENCY',
   data_loss: 'important files delete ho gayi hain data missing hai',
   device_lost: 'laptop ya device kho gaya hai ya chori ho gaya',
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

   // ── KB-FIRST: Use direct KB answer if available (no AI call needed) ──────
   // Guarantees correct answer even when Groq is rate-limited
   let reply = claudeSvc.DIRECT_KB?.[rawKey] || null;

   if (!reply) {
     // No direct KB — call AI
     const aiPrompt = `Employee ne IT Helpdesk se yeh issue select kiya: "${naturalProblem}"\n\nSeedha troubleshooting steps do. Koi sawaal mat poochho. 3-4 simple steps max. End karo with: "Agar theek nahi hua → *Create Ticket* button dabao."`;
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
     await client.chat.postMessage({ channel: userId, text: '❌ Something went wrong. Please try again or email IT: sajan.kumar@wiom.in' })
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
 let myTickets = [];
 if (emp?.empId) {
 myTickets = await Ticket.find({ empId: emp.empId, status: { $in: ['Open', 'In Progress', 'Waiting'] } }).sort({ createdAt: -1 }).limit(3).lean();
 }
 const expandedSet = expandedHomeMap.get(userId) || new Set();
 const blocks = buildHomeBlocks(emp, myTickets, expandedSet);
 await client.views.publish({ user_id: userId, view: { type: 'home', blocks } });

 // Send greeting DM once per session when user opens Home Tab
 if (!greetedUsers.has(userId)) {
   greetedUsers.add(userId);
   const firstName = (emp?.empName || emp?.name || 'there').split(' ')[0];
   try {
     const dm = await client.conversations.open({ users: userId });
     // Same greeting everywhere — uses shared buildGreetingBlocks
     await client.chat.postMessage({ channel: dm.channel.id, text: `Hey ${firstName}! Main Zivon hoon — WIOM IT Assistant ⚡`, blocks: buildGreetingBlocks(firstName) });
   } catch (dmErr) {
     console.error('Greeting DM error:', dmErr.message);
   }
 }
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
 const channelId = dm.channel.id;
 const emp = await lookupEmployee(userId, client).catch(() => null);
 const firstName = (emp?.empName || 'there').split(' ')[0];
 await client.chat.postMessage({ channel: channelId, text: `Hey ${firstName}! I'm Zivon ⚡`, blocks: buildGreetingBlocks(firstName) });
 } catch (err) {
 console.error('home_open_dm error:', err.message);
 }
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
           { type: 'context', elements: [{ type: 'mrkdwn', text: '_Zivon is available 24/7 — Anytime, Anywhere ✦_' }] }
         ]
       });
       return;
     }

     const priEmoji = { Critical: '🔴', High: '🟠', Medium: '🟡', Low: '🟢' };
     const statEmoji = { Open: '⏳', 'In Progress': '🔧', Waiting: '⏸️', Resolved: '✅' };
     let ticketText = `*📋 Your Pending Tickets (${tickets.length}):*\n\n`;
     tickets.forEach(t => {
       const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
       const days = hrs >= 24 ? `${Math.floor(hrs/24)}d ${hrs%24}h` : `${hrs}h`;
       ticketText += `${priEmoji[t.priority] || '🟡'} *\`${t.ticketId}\`*  ${statEmoji[t.status] || '⏳'} *${t.status}*  _${days} ago_\n`;
       ticketText += `> ${(t.description || '').replace(/\n/g, ' ').substring(0, 70)}...\n\n`;
     });

     const hasCritical = tickets.some(t => t.priority === 'Critical' || t.priority === 'High');
     const urgencyMsg = hasCritical
       ? `_🚨 You have a *High/Critical* ticket — IT team is looking into it urgently!_`
       : `_IT team will resolve these shortly — if urgent, please raise ticket priority!_`;

     await client.chat.postMessage({
       channel: channelId,
       text: `Aapke ${tickets.length} pending ticket(s)`,
       blocks: [
         { type: 'section', text: { type: 'mrkdwn', text: ticketText } },
         { type: 'divider' },
         { type: 'context', elements: [{ type: 'mrkdwn', text: urgencyMsg }] }
       ]
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
     await client.chat.postMessage({ channel: userId, text: `Hey ${firstName}! Main Zivon hoon ⚡`, blocks: buildGreetingBlocks(firstName) });
   } catch (err) { console.error('home_chat_ai error:', err.message); }
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
 { type: 'section', text: { type: 'mrkdwn', text: '📧 *Email:*\nsajan.kumar@wiom.in' }},
 ]
 }
 });
 } catch (err) {
 console.error('home_contact_it error:', err.message);
 }
 });

 // ── SOS Issue selected → DM employee + alert admin + auto-ticket ─────
 slackApp.action('sos_issue', async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const issueType = body.actions[0].value;
 try {
 const emp = await Employee.findOne({ slackUserId: userId });
 const name = emp?.name?.split(' ')[0] || 'Employee';

 // Detect category and priority from issue type
 const isHardware = /laptop|water|liquid|overheat|fan|blue screen|screen/i.test(issueType);
 const isSecurity = /virus|ransomware|hack|data lost/i.test(issueType);
 const isNetwork  = /internet|vpn|network/i.test(issueType);
 const category   = isSecurity ? 'Software' : isNetwork ? 'Network' : 'Hardware';
 const priority   = /water|liquid|virus|ransomware|data lost|dead/i.test(issueType) ? 'Critical' : 'High';

 // Auto-create ticket for ALL SOS issues
 let ticketId = null;
 if (emp?.empId) {
 try {
 const result = await createTicketSlack({
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
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

 // Send DM to employee
 const dm = await client.conversations.open({ users: userId });
 await client.chat.postMessage({
 channel: dm.channel.id,
 text: `🆘 SOS raised: ${issueType}`,
 blocks: [
 { type: 'header', text: { type: 'plain_text', text: '🆘 SOS Emergency Registered!', emoji: true }},
 { type: 'section', text: { type: 'mrkdwn', text: `*${name}, your SOS has been registered!*\n*Issue:* ${issueType.split(' — ')[0]}` }},
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: `📧 *Contact IT NOW:*\nEmail: sajan.kumar@wiom.in | Slack: DM Sajan Kumar` }},
 ticketId
 ? { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ Ticket auto-created: \`${ticketId}\` | Priority: *${priority}* | IT has been alerted!` }]}
 : { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ IT has been alerted! They will reach out shortly.` }]}
 ]
 });

 // Emergency Slack alert to admin (in addition to ticket DM)
 const adminId = (process.env.ADMIN_EMAIL_SLACK_ID || process.env.SAJAN_SLACK_ID);
 if (adminId) {
 await client.chat.postMessage({
 channel: adminId,
 text: `🆘 SOS Alert from ${emp?.name || userId}: ${issueType}`,
 blocks: [
 { type: 'header', text: { type: 'plain_text', text: '🆘 SOS EMERGENCY ALERT!', emoji: true }},
 { type: 'section', text: { type: 'mrkdwn', text: `*Employee:* ${emp?.name || userId}\n*Emp ID:* ${emp?.empId || '-'}\n*Dept:* ${emp?.department || '-'}\n*Floor:* ${emp?.floor || '-'}\n*Issue:* 🔴 *${issueType.split(' — ')[0]}*\n*Detail:* ${issueType.split(' — ')[1] || '-'}` }},
 ticketId
 ? { type: 'context', elements: [{ type: 'mrkdwn', text: `Ticket: \`${ticketId}\` | Priority: *${priority}* | Category: ${category}` }]}
 : { type: 'context', elements: [{ type: 'mrkdwn', text: `⚠️ Ticket auto-create failed — manual ticket banana hoga` }]}
 ]
 });
 }
 } catch (err) {
 console.error('sos_issue error:', err.message);
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
 // Add back button to return to categories
 catBlocks.push({ type: 'divider' });
 catBlocks.push({
 type: 'actions',
 elements: [{
 type: 'button',
 text: { type: 'plain_text', text: '↩ Back to Categories', emoji: true },
 action_id: 'dm_back_to_categories',
 value: 'back'
 }]
 });

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
 '*️ New Monitor Request*\n\n' +
 'New equipment requires *Functional Head approval*.\n\n' +
 '*Steps:*\n' +
 '1. Email your *Reporting Manager*\n' +
 '2. CC both:\n' +
 ' *sajan.kumar@wiom.in*\n' +
 ' Your *Functional Head*\n' +
 '3. Explain in the email why the item is needed\n\n' +
 '*Timeline: 4 working days after Functional Head approval*'
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
 `*${item} Replacement Request*\n\n` +
 '*Steps:*\n' +
 '1. Email your *Reporting Manager*\n' +
 '2. CC: *sajan.kumar@wiom.in*\n' +
 '3. Describe the problem and why a replacement is needed\n\n' +
 '*Timeline: 2 working days*'
 }
 });

 return blocks;
 };

 // ── Quick Action buttons from Home tab ────────────────────────────────
 // homeQuickActions: ONLY home_quick_* and home_new_* and home_sos buttons.
 // cat_*, go_home_btn, dm_my_tickets, and all vague_pick_* are handled by their OWN dedicated
 // handlers or regex handlers. DO NOT add them here — it causes both handlers to fire (race condition).
 const homeQuickActions = [
   'home_quick_wifi_pwd_quick',
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
 try {
 // ── FIX: Open modals IMMEDIATELY before any DB call ───────────
 // Slack trigger_id expires in 3 seconds — DB calls can push past that

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
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🔴 Laptop Dead', emoji: true }, action_id: 'sos_issue', value: 'Laptop Dead — laptop is not turning on at all' },
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🌐 Internet Down', emoji: true }, action_id: 'sos_issue', value: 'Internet Down — no internet or network connectivity' }
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
 { type: 'section', text: { type: 'mrkdwn', text: '📧 *IT Direct:*  sajan.kumar@wiom.in  |  💬 Slack: Sajan Kumar' }}
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
         `⚠️ *Pehle yeh manual steps try karo:*\n\n` +
         `1. *Power adapter check karo* — cable properly plugged in hai?\n` +
         `2. *Adapter LED check karo* — light aa rahi hai adapter mein?\n` +
         `3. *Power button 10 seconds hold karo* — hard reset hoga\n` +
         `4. *Power adapter dono taraf laga hai?* — laptop aur socket dono side firmly check karo\n` +
         `5. *Alag power socket try karo*\n\n` +
         `_Agar yeh sab karne ke baad bhi on nahi hua — IT team physically aayegi._`
       }},
       { type: 'divider' },
       { type: 'section', text: { type: 'mrkdwn', text: '*IT Team ko bulana hai? HIGH Priority ticket raise karo:*' }},
       { type: 'actions', elements: [
         { type: 'button', text: { type: 'plain_text', text: '🎫 IT Ticket Raise Karo (HIGH)', emoji: true },
           style: 'danger', action_id: 'quick_ticket_btn', value: "Laptop won't turn on at all" }
       ]},
       { type: 'context', elements: [{ type: 'mrkdwn', text: '_Koi aur IT problem ho toh Home tab pe jaao aur category choose karo._' }]}
     ]
   }
 });
 // DB call AFTER modal — background mein pendingTicket set karo
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

 // ── Get AI response — try KB first (instant), then AI ───────────
 // Run DB cleanup in background (don't await — saves ~200ms)
 Conversation.updateMany(
 { slackUserId: userId, source: 'slack', resolved: false },
 { resolved: true }
 ).catch(() => {});

 const claudeSvc = require('./services/claude');

 // Try static KB first — instant, no API call needed
 let reply = claudeSvc.getKBAnswer ? claudeSvc.getKBAnswer(problem) : null;

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
   const loadingViewId = err._loadingViewId; // may be undefined
   const fallbackView = {
     type: 'modal',
     title: { type: 'plain_text', text: 'IT Help', emoji: true },
     close: { type: 'plain_text', text: 'Close', emoji: true },
     blocks: [
       { type: 'section', text: { type: 'mrkdwn', text: '*Kuch gadbad ho gayi — phir se try karo.*\n\nYa seedha ticket raise karo — IT team directly help karegi.' }},
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
 try {
 const emp = await lookupEmployee(userId, client);
 const result = await createTicketSlack({
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
 empDept: emp.dept, empFloor: emp.floor,
 laptop: emp.laptop, laptopSN: emp.laptopSN,
 description: 'Email / Google Account password reset self-service steps try kiye, nahi hua',
 category: 'Account', priority: 'High',
 source: 'slack', slackUserId: userId
 });
 if (result && !result._duplicate) {
 await client.chat.postMessage({
 channel: userId,
 text: `Ticket ${result.ticketId} create ho gaya!`,
 blocks: [
 { type: 'section', fields: [
 { type: 'mrkdwn', text: `* Ticket:*\n\`${result.ticketId}\`` },
 { type: 'mrkdwn', text: `* Priority:*\nHigh` }
 ]},
 { type: 'context', elements: [{ type: 'mrkdwn', text: '✅ IT team password reset kar degi jaldi respond karenge ' }]}
 ]
 });
 await notifyAdmin(client, result, emp);
 } else if (result?._duplicate) {
 await client.chat.postMessage({ channel: userId, text: `⚠️ ${result.message}` });
 }
 } catch (err) {
 console.error('Email pwd ticket error:', err.message);
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
 text : '❌ Auto-fix config mein kuch issue hai. Manually steps try karo.'
 });
 return;
 }

 const emp = await Employee.findOne({ slackUserId: userId });
 if (!emp) {
 await client.chat.postMessage({
 channel: userId,
 text : '❌ Employee record nahi mila. IT ko contact karo: IT Helpdesk (Slack)'
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
 text : `⚡ ${label} shuru ho rahi hai...`,
 blocks : [
 { type: 'header', text: { type: 'plain_text', text: '⚡ Auto-Fix Shuru!', emoji: true }},
 { type: 'section', text: { type: 'mrkdwn', text:
 `*${label}* aapke laptop par automatically run ho rahi hai! \n\n` +
 `_Aapko kuch nahi karna laptop par IT Agent kaam kar raha hai..._\n\n` +
 `⏳ *~30 seconds mein result milega!*`
 }},
 { type: 'context', elements: [{ type: 'mrkdwn', text: `_Job ID: \`${job._id}\` | Laptop: \`${laptopSN}\`_` }]}
 ]
 });

 } catch (err) {
 console.error('autofix_request error:', err.message);
 try {
 await client.chat.postMessage({
 channel: userId,
 text : '❌ Auto-fix shuru nahi ho saka. Manual steps try karo ya ticket raise karo.'
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
 { type: 'section', text: { type: 'mrkdwn', text: '*IT se milne ka slot book karo!* 📅\nIT team aapki problem personally fix karegi.' }},
 { type: 'input', block_id: 'slot_block', label: { type: 'plain_text', text: 'Date & Time' },
 element: { type: 'static_select', action_id: 'slot_input',
 placeholder: { type: 'plain_text', text: 'Slot select karo' },
 options: slots.slice(0, 20).map(s => ({ text: { type: 'plain_text', text: s.label }, value: s.value }))
 }},
 { type: 'input', block_id: 'reason_block', label: { type: 'plain_text', text: 'Problem kya hai?' },
 element: { type: 'plain_text_input', action_id: 'reason_input', multiline: true,
 placeholder: { type: 'plain_text', text: 'Brief mein batao — laptop slow, setup needed, etc.' }}}
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
 { type: 'context', elements: [{ type: 'mrkdwn', text: '_IT team confirm karegi — Zivon se message aayega! 😊_' }]}
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
 await client.chat.postMessage({ channel: userId, text: '❌ Booking mein kuch problem aayi. Dobara try karo ya /ticket use karo.' });
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
 { type: 'section', text: { type: 'mrkdwn', text: `*${dateDisplay} ${appt.timeSlot}* pe IT team milegi! 😊\n\nProblem: ${appt.reason}\n\nLocation: IT Helpdesk Desk (Floor details IT team batayegi)` }},
 { type: 'context', elements: [{ type: 'mrkdwn', text: '_Cancel karna ho toh IT ko Slack pe batao_' }]}
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
 text: `❌ Appointment cancel ho gayi. Naya slot book karo: /appoint`,
 blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: `❌ *Appointment Cancel* ho gayi aapki.\n\nNaya slot book karne ke liye: \`/appoint\`\nYa turant help ke liye: \`/ticket\`` }}
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
 await say({ text: '📸 Screenshot dekh raha hoon...' });
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

   const visionPrompt = `You are Zivon — WIOM IT helpdesk assistant. An employee sent this screenshot of their laptop/screen showing an IT problem.

Analyze the screenshot carefully and:
1. Identify exactly what error/issue is visible
2. Give 2-3 simple steps to fix it (non-technical employee, no CMD, no Device Manager)
3. If it needs IT help → suggest clicking the IT Ticket button below

Reply in Hinglish. Be specific about what you see. Max 5 lines. No "common issue" opener.`;

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
     { type: 'context', elements: [{ type: 'mrkdwn', text: '_Zivon Vision — Kaam nahi hua? Neeche IT Ticket button click karo._' }]}
   ]});
 } else {
   await say({ text: 'Screenshot mila! Error message clearly share karo, ya *Create Ticket* button dabao — IT team directly help karegi.' });
 }
 } catch (err) {
 console.error('Photo diagnosis error:', err.message);
 await say({ text: 'Screenshot mila! Error message clearly share karo, ya *Create Ticket* button dabao — IT team directly help karegi.' });
 }
 } else {
 await say({ text: `File mila (${file.name})! Iske baare mein kya help chahiye? 😊` });
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
 await say({ text: ` Theek hai ${firstName}! Nayi baat shuru karte hain. Aapki nai IT problem kya hai?` });
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
 await say({ text: '*Koi open ticket nahi hai!* Sab kuch theek chal raha hai.' });
 return;
 }

 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 const statEmoji = { Open:'⏳', 'In Progress':'', Waiting:'⏸', Resolved:'✅', Closed:'' };
 let ticketText = `* Aapke Open Tickets (${tickets.length}):*\n\n`;
 tickets.forEach(t => {
 const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
 ticketText += `${priEmoji[t.priority]||''} *\`${t.ticketId}\`* ${statEmoji[t.status]||'⏳'} ${t.status} _${hrs}h pehle_\n`;
 ticketText += `> ${(t.description||'').substring(0,60)}...\n\n`;
 });
 await say({ blocks:[
 { type:'section', text:{ type:'mrkdwn', text: ticketText }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_Aur help chahiye to batao, ya call karein: IT Helpdesk (Slack)_` }]}
 ], text: `Aapke ${tickets.length} open ticket(s)` });
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
 failedAttempts.delete(userId); // reset failure count on fresh greeting
 const firstName = (emp.empName || 'there').split(' ')[0];
 await say({ text: `Hey ${firstName}! Main Zivon hoon ⚡`, blocks: buildGreetingBlocks(firstName) });
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
 text: `Aapka Laptop: ${model||''} | SN: ${sn||''}`,
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
     email_login: 'gmail login nahi ho rha email mein access nahi',
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
   const subLabel = `_Select karo — Zivon help karega 👇_`;
   const blocks = [
     { type: 'section', text: { type: 'mrkdwn', text: `*${label} — exact problem select karo:*\n${subLabel}` } },
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

   await say({ text: `${label} — exact problem batao:`, blocks });
   return;
 }

 // ── Catch-all: completely vague short messages → show category buttons ──
 const isCatchAllVague = text.trim().split(/\s+/).length <= 4 &&
 /^(help|problem|issue|kuch|kuch\s*nahi|kuch\s*ho\s*gaya|nahi\s*chal|kaam\s*nahi|help\s*karo|kuch\s*hua|ajeeb|theek\s*nahi|dekho|sun|ek\s*problem|problem\s*hai|issue\s*hai|ek\s*issue|dikkat|dikkat\s*hai)/i.test(text.trim());
 if (isCatchAllVague) {
 await say({
 text: 'Kya problem hai? Select karo:',
 blocks: [
 { type:'section', text:{ type:'mrkdwn', text:`*🤔 Thoda aur bata sakte ho?*\nKis cheez mein problem aa rahi hai:` }},
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
 text: `Ticket ${result.ticketId} ban gaya!`,
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
 await say({ text: '❌ Ticket create karne mein problem aayi. Please `/ticket` command use karo.' });
 }
 } else {
 // No context → open /ticket modal instructions
 await say({
 text: 'Ticket banane ke liye `/ticket` command use karo!',
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
 text: `Ticket ${result.ticketId} create ho gaya!`,
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
 await say({ text: '❌ Ticket create karne mein problem aayi. Please try `/ticket` command use karo ya IT team ko directly contact karo.' });
 }
 return;
 }

 if (isNo) {
 pendingTickets.delete(userId);
 await say({ text: 'Theek hai! Let us know if you need more help.' });
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
 `⚡ *Chal raha hoon!* Agent aapke laptop par *${diagLabel}* run kar raha hai.\n_30-60 seconds mein result milega wait karo!_ `
 }
 });
 } else {
 // Agent offline → show download script
 aapKaroBlocks.push({
 type: 'section',
 text: { type: 'mrkdwn', text:
 ` *Script download karo → double-click karo → automatic chalega!*\n_IT ka safe script hai bilkul ek click mein kaam ho jayega._`
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
 elements: [{ type: 'mrkdwn', text: '_Is problem ke liye specific script nahi hai ticket raise karo ya steps manually karo._' }]
 });
 }
 }

 await say({ text: 'Auto-fix chal raha hai!', blocks: aapKaroBlocks });
 return;
 }

 // ── Normal AI chat ────────────────────────────────────────────────

 // Typing indicator — ChatGPT style, shows user's issue being analyzed
 const shortIssue = text.length > 55 ? text.substring(0, 52) + '...' : text;
 const thinkingMsg = await say({
   text: 'Zivon soch raha hai...',
   blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: `_✦  Zivon: "${shortIssue}" — check kar raha hoon..._` }] }]
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
     /spartans|kaun\s*hoon|Zivon|IT|sajan kumar|khushi hui|koi baat nahi|theek hoon|IT problems mein help|Hello.*Kya IT|Theek hoon/i.test(kbReply) ||
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
         text: 'IT Support ticket raise kar raha hoon',
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `⚡ *2 attempts ke baad bhi identify nahi ho paya.*\n\nIT team directly handle karegi. Neeche ticket raise karo:` }},
           { type: 'actions', elements: [
             { type: 'button', text: { type: 'plain_text', text: '🎫 IT Ticket Raise Karo', emoji: true },
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
   /khushi hui|koi baat nahi|theek hoon|aur koi.*IT help|IT problems mein help|Main Zivon|Zivon hoon|koi aur cheez|Kya IT problem/i.test(reply) ||
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
 await say({ text: '❌ Kuch technical problem aa gayi. Thoda wait karein aur dobara try karein.' });
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
   const channelId = body.channel?.id || body.container?.channel_id || userId;
   console.log(`✅ resolved_yes_btn: userId=${userId} viewId=${viewId} channelId=${channelId}`);
   failedAttempts.delete(userId);
   pendingTickets.delete(userId);

   if (viewId) {
     await client.views.update({ view_id: viewId, view: resolvedModalView() })
       .then(() => console.log('✅ resolved modal updated OK'))
       .catch(e => console.error('resolved_yes_btn modal err:', e.message));
   } else {
     await client.chat.postMessage({ channel: channelId, text: 'Issue Resolved!', blocks: resolvedDMBlocks() });
   }
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
       text: 'Samajh gaya — main theek kar raha hoon.',
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text:
         `🔧 *Samajh gaya — main theek kar raha hoon.*\n\nAbhi IT ticket chahiye? Neeche IT Ticket button click karo:`
       }}]
     });

     // 2. Auto-generate better answer using AI + send immediately
     if (question && question.length > 3) {
       const claudeSvc = require('./services/claude');

       // Try KB first, then AI
       let reply = claudeSvc.getKBAnswer ? claudeSvc.getKBAnswer(question) : null;
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
           text: 'Yeh try karo:',
           blocks: [
             { type: 'section', text: { type: 'mrkdwn', text: `✅ *Yeh try karo:*\n\n${formatted}` }},
             { type: 'actions', elements: [
               { type: 'button', text: { type: 'plain_text', text: '✅ Ho gaya!', emoji: true },
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
             `❌ *Bot ka jawab kaam nahi aaya*\n*Employee:* ${empName}\n*Sawaal:* _${question.substring(0, 150)}_\n\n🔧 Bot ne automatically better answer generate kiya aur employee ko diya.`
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
       { type: 'section', text: { type: 'mrkdwn', text: '*Steps se solve nahi hua — IT team ko bhejte hain.*\n\nIT team personally aayegi aur fix karegi.' } },
       { type: 'actions', elements: [
         { type: 'button', text: { type: 'plain_text', text: 'Create Ticket', emoji: true }, action_id: 'quick_ticket_btn', style: 'danger', value: 'Medium',
           confirm: { title: { type: 'plain_text', text: 'Ticket Create Karein?' }, text: { type: 'mrkdwn', text: '_IT team ko alert bheja jayega._' }, confirm: { type: 'plain_text', text: 'Ha, Banao!' }, deny: { type: 'plain_text', text: 'Ruko' } }
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
       await client.chat.postMessage({ channel: channelId, text: 'Steps se solve nahi hua.', blocks: escalateBlocks });
     }
     return;
   }

   // ── First failure → AI gives next different step ────────────────────────────
   // In modal context: update modal to loading first
   if (viewId) {
     await client.views.update({ view_id: viewId, view: {
       type: 'modal', title: { type: 'plain_text', text: 'Trying Again...', emoji: true },
       close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '_Alag approach dhundh raha hoon..._' }}]
     }}).catch(() => {});
   }
   const thinkMsg = viewId ? null : await client.chat.postMessage({
     channel: channelId,
     text: 'Zivon alag approach dhundh raha hai...',
     blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: '_✦  Zivon: Different approach dhundh raha hoon..._' }] }]
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
     conv.messages.push({ role: 'user', content: 'steps try kiye but problem same hai. please koi alag method batao — jo pehle suggest kiya wo dobara mat batao.' });
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
     const fallbackText = 'Laptop restart karo aur dobara check karo. Agar phir bhi nahi hua — Create Ticket button dabao.';
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
     } else {
       try {
         await client.chat.update({
           channel: thinkMsg.channel, ts: thinkMsg.ts, text: fallbackText,
           blocks: buildDMBlocks('', fallbackText)
         });
       } catch {
         await client.chat.postMessage({ channel: channelId, text: fallbackText }).catch(() => {});
       }
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
               `IT team jald se jald aapki madad karegi.`
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
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Ticket nahi ban saka. IT ko email karo: sajan.kumar@wiom.in' }}]
       }}).catch(() => {});
     } else {
       await client.chat.postEphemeral({ channel: channelId, user: userId,
         text: 'Ticket nahi ban saka. IT ko email karo: sajan.kumar@wiom.in' });
     }
   }
 }); // end quick_ticket_btn

 // ── Ticket Notes Form Submission ─────────────────────────────────────────────
 slackApp.view('quick_ticket_notes_modal', async ({ body, ack, client, view }) => {
   const userId = body.user.id;
   const notes = view.state.values?.notes_block?.notes_input?.value || '';
   // Read priority from dropdown — user's selection overrides everything
   const selectedPriority = view.state.values?.priority_block?.priority_select?.selected_option?.value || null;
   let metadata = {};
   try { metadata = JSON.parse(view.private_metadata || '{}'); } catch {}

   const baseDesc = metadata.description || 'IT support needed';
   const fullDesc = baseDesc + (notes.trim() ? '\n\nEmployee Notes: ' + notes.trim() : '');

   try {
     const emp = await lookupEmployee(userId, client).catch(() => ({ empId: userId, empName: 'User', email: 'unknown@wiom.in' }));
     const pending = pendingTickets.get(userId) || {};
     const result = await createTicketSlack({
       empId: emp.empId, empName: emp.empName, empEmail: emp.email || 'unknown@wiom.in',
       empDept: emp.dept, empFloor: emp.floor,
       laptop: emp.laptop, laptopSN: emp.laptopSN,
       category: pending.category || 'Other', priority: selectedPriority || pending.priority || metadata.priority || 'Medium',
       description: fullDesc.replace(/[*_`]/g, '').substring(0, 500),
       source: 'slack', slackUserId: userId, createdAt: Date.now()
     });

     if (result?._duplicate) {
       await ack({ response_action: 'update', view: {
         type: 'modal', title: { type: 'plain_text', text: 'Already Open', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⚠️ ${result.message}` }}]
       }});
     } else if (result) {
       pendingTickets.delete(userId);
       await ack({ response_action: 'update', view: ticketCreatedModalView(result) });
       await notifyAdmin(client, result, emp);
     } else {
       await ack({ response_action: 'update', view: {
         type: 'modal', title: { type: 'plain_text', text: 'Error', emoji: true },
         close: { type: 'plain_text', text: 'Close', emoji: true },
         blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Ticket nahi ban saka. IT ko email karo: sajan.kumar@wiom.in' }}]
       }});
     }
   } catch(err) {
     console.error('quick_ticket_notes_modal submission error:', err.message);
     await ack({ response_action: 'update', view: {
       type: 'modal', title: { type: 'plain_text', text: 'Error', emoji: true },
       close: { type: 'plain_text', text: 'Close', emoji: true },
       blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Ticket nahi ban saka. IT ko email karo: sajan.kumar@wiom.in' }}]
     }});
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
 { name: { $regex: 'ADMIN_EMAIL', $options: 'i' } },
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
 text : `⚡ Zivon — Good Morning! IT Helpdesk Daily Summary ${dateStr}`,
 blocks : [
 { type:'header', text:{ type:'plain_text', text:`⚡ Zivon — Daily IT Summary`, emoji:true }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_${dateStr} | Your Smart Office IT Buddy_` }]},
 { type:'divider' },
 { type:'section', fields:[
 { type:'mrkdwn', text:`* Aaj Aaye*\n*${newToday}* tickets` },
 { type:'mrkdwn', text:`*✅ Aaj Resolve*\n*${resolvedToday}* tickets` },
 { type:'mrkdwn', text:`*⏳ Total Open*\n*${totalOpen}* tickets` },
 { type:'mrkdwn', text:`* Critical Open*\n*${critical}*` },
 { type:'mrkdwn', text:`*⚠️ SLA Breached*\n*${slaBreached}*` }
 ]},
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: `*📊 Top Issues (Last 7 Days):*\n${trendText}` }},
 ...(oldestText ? [
 { type:'divider' },
 { type:'section', text:{ type:'mrkdwn', text:`*⏳ Sabse Purane Pending Tickets:*\n${oldestText}` }}
 ] : []),
 { type:'context', elements:[{ type:'mrkdwn', text:`_Aaj ki shuruat mubarak! ⚡ Zivon — Your Smart Office IT Buddy_` }]}
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
           .map((q, i) => `${i+1}. \`${q.query.substring(0, 60)}\` — ${q.attempts} baar poochha gaya`)
           .join('\n')
       : '_Is hafte koi unknown query nahi aayi!_';

     await slackClient.chat.postMessage({
       channel: adminId,
       text: '📊 Weekly Unknown Queries Report',
       blocks: [
         { type: 'header', text: { type: 'plain_text', text: '📊 Weekly Unknown Queries Report', emoji: true }},
         { type: 'section', text: { type: 'mrkdwn', text: `*Top ${topUnknown.length} queries bot answer nahi de paya:*\n\n${listText}` }},
         { type: 'section', text: { type: 'mrkdwn', text: `*📋 Learning Queue:* ${pendingReview} answers waiting for review | ${approvedThisWeek} approved this week\n_Admin Dashboard → Learning Queue tab se review karein_` }},
         { type: 'section', text: { type: 'mrkdwn', text: '_In queries ke liye KB articles banao → bot automatically improve hoga._' }},
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

