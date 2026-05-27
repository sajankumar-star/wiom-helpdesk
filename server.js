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
 scriptSrc : ["'self'", "'unsafe-inline'"],
 scriptSrcAttr : ["'unsafe-inline'"],
 styleSrc : ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
 fontSrc : ["'self'", "https://fonts.gstatic.com"],
 imgSrc : ["'self'", "data:", "https:"],
 connectSrc : ["'self'", "https://web-production-ef6c1.up.railway.app"]
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
 portal : 'https://web-production-ef6c1.up.railway.app',
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
 { type:'context', elements:[{ type:'mrkdwn', text:`_Abhi tak resolve nahi hua please check karo!_` }]}
 ]
 }]
 });
 t.escalationSent = true;
 await t.save();
 console.log(` Escalation sent for ${t.ticketId} (${hoursOld}h old)`);
 } catch (err) {
 console.error(`Escalation DM failed for ${t.ticketId}:`, err.message);
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
 reminderSent : false,
 slackUserId : { $exists: true, $ne: null }
 });

 for (const t of unreminded) {
 const hoursOld = Math.floor((Date.now() - new Date(t.createdAt)) / 3600000);
 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 try {
 await slackClient.chat.postMessage({
 channel: t.slackUserId,
 text : `⏳ Aapka ticket ${t.ticketId} abhi bhi open hai IT team kaam kar rahi hai!`,
 blocks : [
 { type:'section', text:{ type:'mrkdwn', text:
 `⏳ *Aapka ticket abhi bhi open hai!*\n\n` +
 `* Ticket:* \`${t.ticketId}\`\n` +
 `*${priEmoji[t.priority]||''} Priority:* ${t.priority}\n` +
 `* Problem:* ${(t.description||'').substring(0,80)}${(t.description||'').length>80?'...':''}\n` +
 `*⏱ Open Since:* ${hoursOld} ghante pehle`
 }},
 { type:'context', elements:[{ type:'mrkdwn', text:
 `_IT team aapke ticket par kaam kar rahi hai Jaldi solve ho jayega!_\nUrgent ho toh call karein: *IT Helpdesk (Slack)*`
 }]}
 ]
 });
 t.reminderSent = true;
 await t.save();
 console.log(` Reminder sent to ${t.slackUserId} for ticket ${t.ticketId} (${hoursOld}h old)`);
 } catch (err) {
 console.error(`Reminder DM failed for ${t.ticketId}:`, err.message);
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

 for (const g of grouped) {
 const key = `recurring-alert-${g._id}-${new Date().toISOString().slice(0,13)}`;
 // Avoid duplicate alerts in same hour (use simple in-memory set)
 if (!global._sentRecurringAlerts) global._sentRecurringAlerts = new Set();
 if (global._sentRecurringAlerts.size > 200) global._sentRecurringAlerts.clear(); // prevent memory leak
 if (global._sentRecurringAlerts.has(key)) continue;
 global._sentRecurringAlerts.add(key);

 await slackClient.chat.postMessage({
 channel: adminId,
 text : `⚠️ ${g.count} employees same problem report kar rahe hain: ${g._id}`,
 blocks : [
 { type:'header', text:{ type:'plain_text', text:`⚠️ Recurring Issue Alert`, emoji:true }},
 { type:'section', text:{ type:'mrkdwn', text:
 `*${g.count} employees ne last 1 hour mein same issue report kiya!*\n\n*Category:* ${g._id}\n*Employees:* ${g.employees.slice(0,5).join(', ')}${g.count > 5 ? ` +${g.count-5} more` : ''}`
 }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_Systemic problem ho sakta hai please investigate!_` }]}
 ]
 });
 console.log(`⚠️ Recurring issue alert sent for category: ${g._id} (${g.count} tickets)`);
 }
 } catch (err) {
 console.error('Recurring issue cron error:', err.message);
 }
});

// ── Auto-create default admin if none exists ──────────────────────────────────
const ensureAdminExists = async () => {
 try {
 const Admin = require('./models/Admin');
 const count = await Admin.countDocuments();
 if (count === 0) {
 await Admin.create({
 username : 'ADMIN_EMAIL',
 passwordHash: process.env.ADMIN_PASSWORD || 'Wiom@2024',
 name : 'IT Admin',
 email : process.env.ADMIN_EMAIL || 'it@wiom.in',
 role : 'superadmin'
 });
 console.log('✅ Default admin created: ADMIN_EMAIL / Wiom@2024');
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

 // ── Category definitions ──────────────────────────────────────────────
 const CATEGORIES = [
 {
 key: 'laptop', label: 'Laptop & Display',
 emoji: '🔵', color: 'primary',
 desc: 'Slow, Screen, Keyboard, Audio, Camera, USB, Bluetooth',
 rows: [
 [
 { text:'Laptop Slow', value:'My laptop is very slow what should I do', id:'home_quick_1' },
 { text:'Won\'t Turn On', value:'My laptop is not turning on at all', id:'home_quick_2' },
 { text:'Blue Screen', value:'Getting blue screen of death BSOD error', id:'home_quick_3' },
 { text:'️ Overheating', value:'My laptop is overheating getting very hot', id:'home_quick_4' },
 { text:'Battery Issue', value:'Laptop battery drains quickly or not charging at all', id:'home_quick_5' }
 ],
 [
 { text:'️ Screen Black', value:'Laptop screen is black cannot see anything', id:'home_quick_6' },
 { text:'Keyboard Issue', value:'Laptop keyboard not working some keys not responding', id:'home_quick_7' },
 { text:'️ Touchpad Issue', value:'Mouse or touchpad is not working not responding', id:'home_quick_8' },
 { text:'Freezing / Hanging', value:'Laptop is hanging freezing not responding at all', id:'home_quick_21' },
 { text:'Sudden Shutdown', value:'Laptop shuts down suddenly without any warning', id:'home_quick_30' }
 ],
 [
 { text:'No Sound', value:'No sound coming from laptop speakers audio not working', id:'home_quick_9' },
 { text:'Mic Not Working', value:'Microphone not working voice not going in Teams or calls', id:'home_quick_16' },
 { text:'Camera Issue', value:'Laptop camera not working in Teams Zoom or Meet', id:'home_quick_20' },
 { text:'Headphone Issue', value:'Headphone or earphone not connecting or no sound', id:'home_quick_46' },
 { text:'️ External Monitor', value:'External monitor not detected screen not showing on it', id:'home_quick_17' }
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
 key: 'network', label: 'Network & Internet',
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
 desc: 'Teams, Zoom, Outlook, Password reset, Virus, OneDrive',
 rows: [
 [
 { text:'Teams Issue', value:'Microsoft Teams not working call dropping or not opening', id:'home_quick_13' },
 { text:'️ Zoom Issue', value:'Zoom not working cannot join meeting or Zoom crashing', id:'home_quick_27' },
 { text:'Outlook Issue', value:'Outlook not opening or cannot send receive emails', id:'home_quick_50' },
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
 { text:'️ Antivirus Alert', value:'Antivirus showing alert or has blocked something', id:'home_quick_57' },
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
 key: 'access', label: 'Access & Permissions',
 emoji: '🔒', color: 'primary',
 desc: 'System access, App access, VPN, Permission requests',
 rows: [
 [
 { text:'🔐 VPN Issue', value:'VPN not connecting or VPN is not working', id:'home_quick_73' },
 { text:'🔑 Access Request', value:'Need access to a system software or application', id:'home_quick_74' },
 { text:'Account Locked', value:'Account is locked cannot login to Windows or any account', id:'home_quick_55b' },
 { text:'👤 New User Setup', value:'New employee needs laptop and account setup', id:'home_quick_75' }
 ]
 ]
 },
 {
 key: 'printer', label: 'Printer & Peripheral',
 emoji: '🖨️', color: 'primary',
 desc: 'Printer, Mouse, Keyboard, USB, External devices',
 rows: [
 [
 { text:'🖨️ Printer Offline', value:'Printer is offline not working cannot print', id:'home_quick_54' },
 { text:'Print Queue Stuck', value:'Printer showing error document stuck in print queue', id:'home_quick_76' },
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
 'home_quick_50': { fixType: ['fix_outlook'], label: 'Outlook Fix' },
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
 const PORTAL = process.env.API_BASE_URL || 'https://web-production-ef6c1.up.railway.app';
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
 'home_quick_45': { file: 'fix-outlook.bat', label: 'Email Fix' },
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
 'home_quick_50': { file: 'fix-outlook.bat', label: 'Outlook Fix' },
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
 'home_quick_2' : { file: 'fix-wont-turn-on.bat', label: 'Won\'t Turn On Fix' },
 'home_quick_5' : { file: 'fix-battery.bat', label: 'Battery Fix' },
 'home_quick_10': { file: 'fix-battery.bat', label: 'Charging Fix' },
 // ── WiFi Password & Website ───────────────────────────────────────────
 'home_quick_32': { file: 'fix-wifi-password.bat', label: 'WiFi Password Fix' },
 'home_quick_43': { file: 'fix-website-blocked.bat', label: 'Website Fix' },
 };

 // ── DM Script detector: maps free-text issue → script file + label ────
 // ORDER IS CRITICAL — specific entries FIRST, general ones LAST
 const getScriptForText = (text) => {
   if (!text) return null;
   const t = text.toLowerCase();
   // ── Fan FIRST — before sound/speed checks (fan sound ≠ speaker sound) ──
   if (/\bfan\b/.test(t)) return { file: 'fix-fan-noise.bat', label: '🌬️ Auto-Fix: Fan Noise' };
   // ── Blue/Black screen before general screen ───────────────────────────
   if (/blue.?screen|bsod|bluescreen/.test(t)) return { file: 'fix-bluescreen.bat', label: '💙 Auto-Fix: Blue Screen' };
   if (/black.?screen|no display|blank screen/.test(t)) return { file: 'fix-black-screen.bat', label: '🖥️ Auto-Fix: Black Screen' };
   if (/screen flicker|flicker|blink/.test(t)) return { file: 'fix-screen-flicker.bat', label: '📺 Auto-Fix: Screen Flicker' };
   // ── Overheating before slow (both can say "garam") ────────────────────
   if (/overheat|garam|hot laptop|laptop garm/.test(t)) return { file: 'fix-overheating.bat', label: '🌡️ Auto-Fix: Overheating' };
   // ── Specific hardware BEFORE general slow ─────────────────────────────
   if (/camera|camra|webcam|\bcam\b/.test(t)) return { file: 'fix-camera.bat', label: '📷 Auto-Fix: Camera' };
   if (/mic|microphone/.test(t)) return { file: 'fix-mic.bat', label: '🎤 Auto-Fix: Microphone' };
   if (/headphone|earphone|earbuds/.test(t)) return { file: 'fix-headphone.bat', label: '🎧 Auto-Fix: Headphone' };
   if (/projector/.test(t)) return { file: 'fix-projector.bat', label: '📽️ Auto-Fix: Projector' };
   if (/hdmi|external monitor|external screen/.test(t)) return { file: 'fix-hdmi.bat', label: '🖥️ Auto-Fix: HDMI/Monitor' };
   if (/resolution|display sett/.test(t)) return { file: 'fix-resolution.bat', label: '🖥️ Auto-Fix: Resolution' };
   if (/sound|audio|speaker|awaaz/.test(t)) return { file: 'fix-sound.bat', label: '🔊 Auto-Fix: Sound' };
   if (/keyboard|keys|typing|type nahi/.test(t)) return { file: 'fix-keyboard.bat', label: '⌨️ Auto-Fix: Keyboard' };
   if (/touchpad|trackpad|cursor/.test(t)) return { file: 'fix-touchpad.bat', label: '🖱️ Auto-Fix: Touchpad' };
   if (/touchscreen/.test(t)) return { file: 'fix-touchscreen.bat', label: '🖱️ Auto-Fix: Touchscreen' };
   if (/bluetooth|\bbt\b/.test(t)) return { file: 'fix-bluetooth.bat', label: '🔵 Auto-Fix: Bluetooth' };
   if (/usb|pendrive|pen drive|flash drive/.test(t)) return { file: 'fix-usb.bat', label: '🔌 Auto-Fix: USB' };
   if (/sd card|sdcard|memory card/.test(t)) return { file: 'fix-sdcard.bat', label: '💳 Auto-Fix: SD Card' };
   if (/fingerprint|finger print/.test(t)) return { file: 'fix-fingerprint.bat', label: '👆 Auto-Fix: Fingerprint' };
   if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charg|\bplug\b.*(?:power|charg|laptop)/.test(t)) return { file: 'fix-battery.bat', label: '🔋 Auto-Fix: Battery' };
   if (/sleep|wake|hibernate|suspend/.test(t)) return { file: 'fix-sleep-wake.bat', label: '💤 Auto-Fix: Sleep/Wake' };
   if (/turn on|boot|start nahi|on nahi|won.?t turn/.test(t)) return { file: 'fix-wont-turn-on.bat', label: '⚡ Auto-Fix: Won\'t Turn On' };
   if (/sudden shutdown|shut.?down|band ho|band ho jata/.test(t)) return { file: 'fix-sudden-shutdown.bat', label: '⚡ Auto-Fix: Sudden Shutdown' };
   // ── Software apps BEFORE network — "teams not connecting" ≠ wifi ─────
   if (/\bteams\b/.test(t)) return { file: 'fix-teams.bat', label: '📹 Auto-Fix: Teams' };
   if (/\bzoom\b/.test(t)) return { file: 'fix-zoom.bat', label: '🎥 Auto-Fix: Zoom' };
   if (/outlook/.test(t)) return { file: 'fix-outlook.bat', label: '📧 Auto-Fix: Outlook' };
   // ── Network — "net" alone also means internet in India ───────────────
   if (/wifi|wi-fi|internet|\bnet\b|network|hotspot|broadband|ping|nahi chal rha|nahi chal raha/.test(t)) return { file: 'fix-wifi.bat', label: '📶 Auto-Fix: WiFi' };
   if (/onedrive|one drive/.test(t)) return { file: 'fix-onedrive.bat', label: '☁️ Auto-Fix: OneDrive' };
   if (/\bpdf\b/.test(t)) return { file: 'fix-pdf.bat', label: '📄 Auto-Fix: PDF' };
   if (/word|excel|office|powerpoint/.test(t)) return { file: 'fix-word-excel.bat', label: '📄 Auto-Fix: Word/Excel' };
   if (/chrome|browser|firefox|edge|safari/.test(t)) return { file: 'fix-browser.bat', label: '🌐 Auto-Fix: Browser' };
   if (/printer|print/.test(t)) return { file: 'fix-printer.bat', label: '🖨️ Auto-Fix: Printer' };
   if (/windows update|win update/.test(t)) return { file: 'fix-windows-update.bat', label: '🔄 Auto-Fix: Windows Update' };
   if (/copy.?paste|clipboard|ctrl.?c|ctrl.?v/.test(t)) return { file: 'fix-clipboard.bat', label: '📋 Auto-Fix: Copy-Paste' };
   if (/date|time|clock|galat time|wrong time/.test(t)) return { file: 'fix-datetime.bat', label: '🕐 Auto-Fix: Date/Time' };
   if (/caps.?lock|capslock/.test(t)) return { file: 'fix-capslock.bat', label: '🔡 Auto-Fix: Caps Lock' };
   if (/crash|app crash|app band/.test(t)) return { file: 'fix-app-crash.bat', label: '💥 Auto-Fix: App Crash' };
   if (/website block|site block|open nahi ho raha/.test(t)) return { file: 'fix-website-blocked.bat', label: '🌐 Auto-Fix: Website' };
   if (/virus|malware|ransomware|hack/.test(t)) return { file: 'fix-virus-scan.bat', label: '🦠 Auto-Fix: Virus Scan' };
   if (/storage|disk full|space|jagah nahi/.test(t)) return { file: 'fix-storage.bat', label: '💾 Auto-Fix: Storage Cleanup' };
   // ── General laptop slow — LAST (most generic catch) ───────────────────
   if (/slow|hang|lagg|freez|stuck|fast karo|speed|chalta nahi/.test(t)) return { file: 'fix-slow-laptop.bat', label: '⚡ Auto-Fix: Slow Laptop' };
   return null;
 };

 // ── Category color config ─────────────────────────────────────────────
 const CAT_COLORS = {
   laptop:      { icon: '🔵 💻', label: 'Laptop & Display',        desc: 'Screen · Battery · Keyboard · Audio · Camera and more' },
   network:     { icon: '🟢 🌐', label: 'Network & Internet',       desc: 'Wi-Fi · Internet Slow · Website · VPN and more' },
   software:    { icon: '🟣 ⚙️',  label: 'Software, Apps & Account', desc: 'Teams · Outlook · Password · Virus · Storage and more' },
   replacement: { icon: '🟠 🔄', label: 'Replacement / Upgrade',    desc: 'Laptop · Mouse · Keyboard · Monitor replacement' },
   access:      { icon: '🔴 🔒', label: 'Access & Permissions',     desc: 'VPN · Access Request · Account Locked · New User Setup' },
   printer:     { icon: '🩵 🖨️', label: 'Printer & Peripheral',    desc: 'Printer · Print Queue · Mouse · USB devices' },
 };

 // ── Build flat Home Tab blocks — ALL categories visible, no expand needed ──
 const buildHomeBlocks = (emp, myTickets, expandedSet) => {
 const name = (emp?.empName || emp?.name || 'there').split(' ')[0];
 const laptop = emp?.laptop || null;
 const laptopSN = emp?.laptopSN || null;
 const dept = emp?.dept || emp?.department || null;
 const openCnt = myTickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;

 const statEmoji = { 'Open':'🔴', 'In Progress':'🟡', 'Resolved':'✅', 'Closed':'⚫' };
 const priEmoji2 = { 'Critical':'🔴', 'High':'🟠', 'Medium':'🟡', 'Low':'🟢' };

 const blocks = [];

 // ── HEADER ──────────────────────────────────────────────────────────────
 blocks.push({ type: 'header', text: { type: 'plain_text', text: `👋  Hello ${name}!  Welcome to WIOM IT Helpdesk`, emoji: true } });
 blocks.push({
   type: 'section',
   text: { type: 'mrkdwn', text: `*How can we help you today?* 😊\n🟢 *Zivon is Online* — Anytime, Anywhere${openCnt > 0 ? `   |   🔔 *${openCnt} Open Ticket${openCnt > 1 ? 's' : ''}*` : ''}` },
   accessory: { type: 'image', image_url: 'https://web-production-ef6c1.up.railway.app/images/zivon-robot.gif', alt_text: 'Zivon AI' }
 });
 blocks.push({ type: 'divider' });
 blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*📂   Select a Category*\n_Apni problem select karo — Zivon turant help karega!_ 👇' } });

 // ── ALL CATEGORIES — flat, all sub-issues visible ────────────────────
 for (const cat of CATEGORIES) {
   const cfg = CAT_COLORS[cat.key] || { icon: '⚪ 📁', label: cat.label, desc: cat.desc };
   // Category colored header
   blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${cfg.icon}  *${cfg.label}*\n_${cfg.desc}_` } });
   // All sub-issue rows for this category
   for (const row of cat.rows) {
     blocks.push({
       type: 'actions',
       elements: row.map(btn => ({
         type: 'button',
         text: { type: 'plain_text', text: btn.text, emoji: true },
         value: btn.value,
         action_id: btn.id
       }))
     });
   }
   blocks.push({ type: 'divider' });
 }

 // ── MY TICKETS ───────────────────────────────────────────────────────────
 if (myTickets.length > 0) {
   blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🎫   My Tickets*${openCnt > 0 ? ` — 🔴 *${openCnt} Open*` : ''}` } });
   for (const t of myTickets.slice(0, 3)) {
     const hrs = Math.floor((Date.now() - new Date(t.createdAt)) / 3600000);
     blocks.push({
       type: 'section',
       text: { type: 'mrkdwn', text: `${statEmoji[t.status]||'🔵'} \`${t.ticketId}\`  ${priEmoji2[t.priority]||'🟡'} *${t.priority}* — ${(t.description||'').substring(0,55)}...\n_${t.category||'Other'} · ${hrs}h ago · ${t.status}${t.resolution ? ' · ✅ Resolved' : ''}_` }
     });
   }
   blocks.push({ type: 'divider' });
 }

 // ── BOTTOM CTAs ──────────────────────────────────────────────────────────
 blocks.push({
   type: 'section',
   fields: [
     { type: 'mrkdwn', text: "*🤖  Can't find your issue?*\n_Type your problem in DM — Zivon will help instantly!_" },
     { type: 'mrkdwn', text: '*🎧  Need Urgent Help?*\n_Contact IT Support Team directly_' }
   ]
 });
 blocks.push({
   type: 'actions',
   elements: [
     { type: 'button', text: { type: 'plain_text', text: '✨  Chat with AI Assistant', emoji: true }, action_id: 'home_chat_ai', value: 'chat_ai', style: 'primary' },
     { type: 'button', text: { type: 'plain_text', text: '🎧  Contact IT Support', emoji: true }, action_id: 'home_contact_it', value: 'contact_it', style: 'danger' }
   ]
 });

 // ── EMPLOYEE FOOTER ───────────────────────────────────────────────────────
 if (emp?.empId) {
   blocks.push({
     type: 'context',
     elements: [{ type: 'mrkdwn', text: `👤 *${emp.empName||emp.empId}* · 🏢 ${dept||'—'} · 💻 ${laptop||'—'} · 🏷️ \`${laptopSN||'—'}\` · ${openCnt > 0 ? `🔔 ${openCnt} open ticket(s)` : '✅ No open tickets'}` }]
   });
 }
 blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_Made with ❤️ by WIOM IT Team  |  Powered by Zivon AI_' }] });

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
     text: { type: 'mrkdwn', text: `*Hey ${firstName}! 👋*\n\nMain *Zivon* hoon — WIOM ka IT assistant.\nLaptop, WiFi, software, password — koi bhi problem batao, abhi fix karunga!\n\n_Category choose karo ya seedha type karo_ 👇` },
     accessory: { type: 'image', image_url: 'https://web-production-ef6c1.up.railway.app/images/zivon-robot.gif', alt_text: 'Zivon' }
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
   { type: 'context', elements: [{ type: 'mrkdwn', text: '_Ya seedha apni problem type karo — Zivon samjhega! ✦  Anytime, Anywhere_' }] }
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
 // 'ticket'   → AI wants user to confirm ticket with "ha"
 // 'steps'    → AI gave actual fix steps, show Ho gaya + Ticket
 const detectReplyMode = (reply, shouldCreateTicket) => {
   if (shouldCreateTicket) return 'ticket';
   const lines = reply.trim().split('\n').filter(l => l.trim());
   const hasNumberedSteps = /^\d+[\.\)]\s/m.test(reply);
   const hasBullets = /^[•\-\*]\s/m.test(reply);
   const hasSteps = hasNumberedSteps || hasBullets || lines.length >= 4;
   // Question mode: short reply, ends with ?, no steps
   const isQuestion = !hasSteps && /\?/.test(reply) && lines.length <= 3;
   return isQuestion ? 'question' : 'steps';
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
     // Steps mode — Ho gaya + Ticket
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
 { type:'section', text:{ type:'mrkdwn', text:'* WIOM IT Helpdesk*\nApni IT problem batao!\n\n*Examples:*\n `/helpdesk wifi nahi chal raha`\n `/helpdesk laptop slow hai`\n `/helpdesk outlook nahi khul raha`\n\n_Apne tickets dekhne ke liye:_ `/helpdesk status`' }}
 ], text:'WIOM IT Helpdesk apni problem batao' });
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
 await respond({ response_type: 'ephemeral', text: 'Koi open ticket nahi hai! Sab kuch theek hai.' });
 return;
 }

 const priEmoji = { Critical:'', High:'', Medium:'', Low:'' };
 const statEmoji = { Open:'⏳', 'In Progress':'', Waiting:'⏸', Resolved:'✅', Closed:'' };
 const blocks = [
 { type:'section', text:{ type:'mrkdwn', text:`* Aapke Tickets (${tickets.length})*` }},
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
 await respond({ response_type: 'ephemeral', text: `Aapke ${tickets.length} ticket(s)`, blocks });
 return;
 }

 await respond({ text: '_Soch raha hoon..._ ek second!', response_type: 'ephemeral' });

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
 { text:{ type:'plain_text', text:'Network - WiFi, internet, VPN' }, value:'Network' },
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
 text : '❌ Ticket create karne mein problem aayi. Please try again or contact IT directly.'
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
 // Only admin can broadcast
 if (adminId && command.user_id !== adminId) {
 await client.chat.postEphemeral({
 channel: command.channel_id, user: command.user_id,
 text: '❌ Sirf IT Admin broadcast kar sakta hai!'
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
 { type: 'section', text: { type: 'mrkdwn', text: '*Yeh message SABHI employees ko Slack DM mein milega!* 📢' }},
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
 const employees = await Employee.find({ slackUserId: { $exists: true, $ne: null, $ne: '' } }).lean();
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
 slackApp.action(/^vague_pick_/, async ({ body, ack, client, say }) => {
 await ack();
 const userId = body.user.id;
 const actionId = body.actions[0].action_id;
 const problem = body.actions[0].value; // e.g. "laptop very slow"

 // ── Special case: "Create Ticket" button → open /ticket modal directly ─
 if (actionId === 'vague_pick_create_ticket') {
   try {
     await client.views.open({
       trigger_id: body.trigger_id,
       view: {
         type: 'modal', callback_id: 'ticket_modal',
         title: { type: 'plain_text', text: 'New IT Ticket', emoji: true },
         submit: { type: 'plain_text', text: 'Submit Ticket ✅', emoji: true },
         close: { type: 'plain_text', text: 'Cancel', emoji: true },
         blocks: [
           { type: 'input', block_id: 'description_block',
             label: { type: 'plain_text', text: 'Describe your problem:' },
             element: { type: 'plain_text_input', action_id: 'description_input', multiline: true, min_length: 10,
               placeholder: { type: 'plain_text', text: 'e.g. Laptop not turning on, WiFi not working, Forgot password...' }}},
           { type: 'input', block_id: 'category_block',
             label: { type: 'plain_text', text: 'Category' },
             element: { type: 'static_select', action_id: 'category_input',
               placeholder: { type: 'plain_text', text: 'Select a category' },
               options: [
                 { text: { type: 'plain_text', text: 'Hardware - Laptop, keyboard, mouse, screen' }, value: 'Hardware' },
                 { text: { type: 'plain_text', text: 'Software - App, Windows, Office' }, value: 'Software' },
                 { text: { type: 'plain_text', text: 'Network - WiFi, internet, VPN' }, value: 'Network' },
                 { text: { type: 'plain_text', text: 'Account - Password, login, email' }, value: 'Account' },
                 { text: { type: 'plain_text', text: 'Purchase - New equipment request' }, value: 'Purchase' },
                 { text: { type: 'plain_text', text: '❓ Other - Something else' }, value: 'Other' }
               ]}},
           { type: 'input', block_id: 'priority_block',
             label: { type: 'plain_text', text: 'How Urgent Is It?' },
             element: { type: 'static_select', action_id: 'priority_input',
               initial_option: { text: { type: 'plain_text', text: 'Medium - Normal problem' }, value: 'Medium' },
               options: [
                 { text: { type: 'plain_text', text: 'Critical - Work completely stopped' }, value: 'Critical' },
                 { text: { type: 'plain_text', text: 'High - Very urgent, needed ASAP' }, value: 'High' },
                 { text: { type: 'plain_text', text: 'Medium - Normal issue, can partially work' }, value: 'Medium' },
                 { text: { type: 'plain_text', text: 'Low - Minor issue, fix when possible' }, value: 'Low' }
               ]}}
         ]
       }
     });
   } catch (err) { console.error('vague_pick_create_ticket modal error:', err.message); }
   return;
 }

 try {
 const emp = await lookupEmployee(userId, client);
 const conv = await getSlackSession(userId, emp);
 conv.messages.push({ role: 'user', content: problem });
 if (conv.messages.length > 30) conv.messages = conv.messages.slice(-30);
 await conv.save();

 const { reply, shouldCreateTicket } = await claudeSvc.chat(
 conv.messages,
 { empId: emp.empId, empName: emp.empName, source: 'slack',
 laptop: emp.laptop, laptopSN: emp.laptopSN, dept: emp.dept, floor: emp.floor }
 );

 conv.messages.push({ role: 'assistant', content: reply });
 await conv.save();

 const formattedReply = formatForSlack(reply);
 const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: formattedReply }}];

 if (shouldCreateTicket) {
 const allUserText = conv.messages.filter(m=>m.role==='user').map(m=>m.content).join(' ').toLowerCase();
 let autoCategory = 'Other';
 if (/wifi|internet|network/i.test(allUserText)) autoCategory = 'Network';
 else if (/teams|zoom|outlook|browser|app|software|windows/i.test(allUserText)) autoCategory = 'Software';
 else if (/laptop|screen|keyboard|battery|hardware|slow|hang|freeze|blue screen/i.test(allUserText)) autoCategory = 'Hardware';
 else if (/password|account|locked|login/i.test(allUserText)) autoCategory = 'Account';
 pendingTickets.set(userId, {
 empId: emp.empId, empName: emp.empName, empEmail: emp.email || 'unknown@wiom.in',
 empDept: emp.dept, empFloor: emp.floor,
 laptop: emp.laptop, laptopSN: emp.laptopSN,
 category: autoCategory, priority: 'Medium',
 description: problem, source: 'slack', slackUserId: userId,
 createdAt: Date.now()
 });
 blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`_Ticket banana hai? *"ha"* ya *"nahi"* type karo_` }]});
 }

 await client.chat.postMessage({ channel: userId, text: reply, blocks });
 } catch (err) {
 console.error('vague_pick action error:', err.message);
 await client.chat.postMessage({ channel: userId, text: '❌ Kuch error aa gaya. Apni problem DM mein type karo.' });
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
 channel: body.channel.id,
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
 myTickets = await Ticket.find({ empId: emp.empId }).sort({ createdAt: -1 }).limit(1).lean();
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
 CATEGORIES.forEach(cat => {
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
 if (emp?.empId) myTickets = await Ticket.find({ empId: emp.empId }).sort({ createdAt: -1 }).limit(1).lean();
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
 await client.chat.postMessage({ channel: channelId, text: `Hey ${firstName}! Main Zivon hoon ⚡`, blocks: buildGreetingBlocks(firstName) });
 } catch (err) {
 console.error('home_open_dm error:', err.message);
 }
 });

 // ── My Tickets button — show pending tickets with IT urgency message ────────
 slackApp.action('dm_my_tickets', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const channelId = body.channel?.id || userId;
   try {
     const emp = await lookupEmployee(userId, client);
     const tickets = await Ticket.find({
       $or: [{ empId: emp.empId }, { slackUserId: userId }],
       status: { $nin: ['Closed', 'Resolved'] }
     }).sort({ createdAt: -1 }).limit(5);

     if (!tickets.length) {
       await client.chat.postMessage({
         channel: channelId,
         text: 'Koi pending ticket nahi hai!',
         blocks: [
           { type: 'section', text: { type: 'mrkdwn', text: `✅ *Koi pending ticket nahi hai!*\n\nSab theek chal raha hai — koi nayi problem ho toh seedha batao! 😊` } },
           { type: 'context', elements: [{ type: 'mrkdwn', text: '_Zivon 24/7 available hai — Anytime, Anywhere ✦_' }] }
         ]
       });
       return;
     }

     const priEmoji = { Critical: '🔴', High: '🟠', Medium: '🟡', Low: '🟢' };
     const statEmoji = { Open: '⏳', 'In Progress': '🔧', Waiting: '⏸️', Resolved: '✅' };
     let ticketText = `*📋 Aapke Pending Tickets (${tickets.length}):*\n\n`;
     tickets.forEach(t => {
       const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
       const days = hrs >= 24 ? `${Math.floor(hrs/24)}d ${hrs%24}h` : `${hrs}h`;
       ticketText += `${priEmoji[t.priority] || '🟡'} *\`${t.ticketId}\`*  ${statEmoji[t.status] || '⏳'} *${t.status}*  _${days} pehle_\n`;
       ticketText += `> ${(t.description || '').replace(/\n/g, ' ').substring(0, 70)}...\n\n`;
     });

     const hasCritical = tickets.some(t => t.priority === 'Critical' || t.priority === 'High');
     const urgencyMsg = hasCritical
       ? `_🚨 Aapka ek *High/Critical* ticket hai — IT team turant dekh rahi hai!_`
       : `_IT team inhe jaldi resolve karegi — agar urgent lage toh seedha batao!_`;

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
     await client.chat.postMessage({ channel: channelId, text: '❌ Tickets load nahi ho sake. Dobara try karo.' });
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
 { type: 'section', text: { type: 'mrkdwn', text: '*IT Admin se seedha baat karo:*' }},
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: '📱 *Phone:*\n*9654244281*' }},
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
 { type: 'section', text: { type: 'mrkdwn', text: `*${name}, aapka SOS register ho gaya!*\n*Issue:* ${issueType.split(' — ')[0]}` }},
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: `📞 *IT Admin se ABHI contact karo:*\n📱 *Phone:* *9654244281*\n📧 *Email:* sajan.kumar@wiom.in` }},
 ticketId
 ? { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ Ticket auto-created: \`${ticketId}\` | Priority: *${priority}* | IT Admin ko alert bhej diya gaya hai!` }]}
 : { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ IT Admin ko alert bhej diya gaya hai! Woh jald aayenge.` }]}
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
 CATEGORIES.forEach(cat => {
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
 ' *EMERGENCY Turant yeh karo:*\n' +
 '1. *TURANT laptop band karo* Power button 10 sec hold karo\n' +
 '2. Charger aur USB sab nikaalo\n' +
 '3. Laptop *ulta rakh do* (keyboard neeche)\n' +
 '4. *MAT chalaao* circuit damage hoga\n' +
 '5. IT ko call karo: *IT Helpdesk (Slack)*'
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
 'Naye equipment ke liye *Functional Head ki approval* zaroori hai.\n\n' +
 '*Kya karna hai:*\n' +
 '1. Apne *Reporting Manager* ko email karo\n' +
 '2. CC mein dono add karo:\n' +
 ' *sajan.kumar@wiom.in*\n' +
 ' Apne *Functional Head*\n' +
 '3. Email mein likho item ki zaroorat kyun hai\n\n' +
 '*Timeline: Functional Head ki approval ke baad 4 working days*'
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
 '*Kya karna hai:*\n' +
 '1. Apne *Reporting Manager* ko email karo\n' +
 '2. CC mein add karo: *sajan.kumar@wiom.in*\n' +
 '3. Email mein likho kya problem hai aur replacement kyun chahiye\n\n' +
 '*Timeline: 2 working days*'
 }
 });

 return blocks;
 };

 // ── Quick Action buttons from Home tab ────────────────────────────────
 const homeQuickActions = ['home_quick_1','home_quick_2','home_quick_3','home_quick_4','home_quick_5','home_quick_6','home_quick_7','home_quick_7b','home_quick_8','home_quick_9','home_quick_10','home_quick_11','home_quick_12','home_quick_13','home_quick_14','home_quick_15','home_quick_16','home_quick_17','home_quick_18','home_quick_19','home_quick_20','home_quick_21','home_quick_22','home_quick_23','home_quick_24','home_quick_25','home_quick_26','home_quick_27','home_quick_28','home_quick_29','home_quick_30','home_quick_31','home_quick_32','home_quick_33','home_quick_34','home_quick_35','home_quick_36','home_quick_37','home_quick_38','home_quick_39','home_quick_40','home_quick_41','home_quick_42','home_quick_43','home_quick_44','home_quick_45','home_quick_46','home_quick_47','home_quick_48','home_quick_49','home_quick_50','home_quick_51','home_quick_52','home_quick_53','home_quick_54','home_quick_55','home_quick_55b','home_quick_56','home_quick_57','home_quick_58','home_quick_59','home_quick_60','home_quick_61','home_quick_62','home_quick_63','home_quick_63b','home_quick_64','home_quick_65','home_quick_66','home_quick_67','home_quick_68','home_quick_69','home_quick_70','home_quick_71','home_quick_72','home_quick_73','home_quick_74','home_quick_75','home_quick_76','home_quick_77','home_sos'];
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
 '*Email / Google Account Password Reset*\n\n' +
 '*Follow these steps:*\n' +
 '1. Go to *Google Account*: myaccount.google.com\n' +
 '2. Click the *Security* tab\n' +
 '3. Under *"How you sign in to Google"* click *Password*\n' +
 '4. Enter your current password _(or verify via fingerprint / prompt)_\n' +
 '5. Set your new password\n\n' +
 '_Still not working? Raise a ticket below for IT support._'
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
 { type: 'section', text: { type: 'mrkdwn', text: '*Apna emergency issue select karo — IT Admin ko turant alert jayega:*' }},
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
 { type: 'button', style: 'danger', text: { type: 'plain_text', text: '🔑 VPN Not Working', emoji: true }, action_id: 'sos_issue', value: 'VPN Not Working — cannot connect to remote access or company VPN' }
 ]
 },
 { type: 'divider' },
 { type: 'section', text: { type: 'mrkdwn', text: '📞 *IT Admin Direct:*  📱 *9654244281*  |  📧 sajan.kumar@wiom.in' }}
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
 modalBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*⚡ One-Click Auto Fix:*\n_Download, double-click, and it runs automatically!_' }});
 modalBlocks.push({
 type: 'actions',
 elements: [{
 type: 'button',
 text: { type: 'plain_text', text: `⬇️ ${scriptConfig.label} - Auto Script`, emoji: true },
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
 modalBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_Still not working? Type your problem in DM — AI will follow up and help you further._' }]});

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
 console.error('Home quick action error:', err.message, err.stack);
 try {
 const scriptConfig = SCRIPT_MAP[actionId];
 const fallbackBlocks = [
 { type: 'section', text: { type: 'mrkdwn', text: `*Your issue has been noted!*\n\nAI is temporarily unavailable — try the script below or type in DM.` }}
 ];
 if (scriptConfig) {
 const scriptUrl = `${PORTAL}/scripts/${scriptConfig.file}`;
 fallbackBlocks.push({ type: 'divider' });
 fallbackBlocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: `⬇️ ${scriptConfig.label} - Auto Script`, emoji: true }, style: 'primary', url: scriptUrl, action_id: `dl_fallback_${actionId}` }] });
 }
 fallbackBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_Or type your problem in DM — AI will help you there too._' }]});
 await client.chat.postMessage({ channel: userId, text: 'Your issue has been noted!', blocks: fallbackBlocks });
 } catch (msgErr) {
 console.error('Fallback message failed:', msgErr.message);
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
 await client.chat.update({ channel: body.channel.id, ts: body.message.ts,
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
 await client.chat.update({ channel: body.channel.id, ts: body.message.ts,
 text: `❌ Appointment cancelled: ${appt?.empName}`,
 blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ *Cancelled:* ${appt?.empName}` }}]
 });
 }
 } catch (err) { console.error('Appt cancel error:', err.message); }
 });

 // ── DM Handler ────────────────────────────────────────────────────────
 slackApp.message(async ({ message, client, say }) => {
 if (message.bot_id) return;
 // Handle file/image uploads (screenshot diagnosis)
 if (message.subtype === 'file_share' && message.files && message.files.length > 0) {
 const userId = message.user;
 const file = message.files[0];
 if (file.mimetype?.startsWith('image/')) {
 try {
 await say({ text: '📸 Screenshot dekh raha hoon...' });
 // Try vision AI if Anthropic available
 const claudeSvc = require('./services/claude');
 const emp = await lookupEmployee(userId, client);
 let diagnosis = null;
 if (process.env.ANTHROPIC_API_KEY) {
 const Anthropic = require('@anthropic-ai/sdk');
 const ant = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 // Get file URL with bot token
 const fileInfo = await client.files.info({ file: file.id });
 const imgUrl = fileInfo.file?.url_private;
 if (imgUrl) {
 // Download image
 const https = require('https');
 const imgBuffer = await new Promise((resolve, reject) => {
 const chunks = [];
 const req = https.get(imgUrl, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }, (res) => {
 res.on('data', c => chunks.push(c));
 res.on('end', () => resolve(Buffer.concat(chunks)));
 });
 req.on('error', reject);
 req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
 });
 const base64 = imgBuffer.toString('base64');
 const ext = (file.name || '').split('.').pop()?.toLowerCase();
 const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
 const resp = await ant.messages.create({
 model: 'claude-3-5-haiku-20241022',
 max_tokens: 300,
 system: `You are Zivon, WIOM's IT helpdesk bot. Analyze this screenshot from an employee's laptop/screen. Identify the error/issue and give a SHORT friendly solution in Hindi/Hinglish (3-4 lines max). Be specific about what you see. Format: "Dekha! [what you see]. [solution]. [closing]"`,
 messages: [{ role: 'user', content: [
 { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 }},
 { type: 'text', text: `Employee ${emp?.empName || ''} ne ye screenshot bheja hai. Kya dikha raha hai aur kya fix hai?` }
 ]}]
 });
 diagnosis = resp.content[0]?.text;
 }
 }
 if (diagnosis) {
 const formatted = diagnosis.replace(/\*\*/g, '*');
 await say({ text: diagnosis, blocks: [
 { type: 'section', text: { type: 'mrkdwn', text: `📸 *Screenshot Analysis:*\n\n${formatted}` }},
 { type: 'context', elements: [{ type: 'mrkdwn', text: '_Zivon AI Vision | Kaam nahi hua toh ticket raise karo: type *ha*_' }]}
 ]});
 } else {
 await say({ text: 'Screenshot mila! 📸 Describe karo kya error aa raha hai — main help karunga! 😊' });
 }
 } catch (err) {
 console.error('Photo diagnosis error:', err.message);
 await say({ text: '📸 Screenshot mila! Kya error dikh raha hai? Describe karo — main turant fix batata hoon! 😊' });
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
       { text: '📧 Outlook Issue', val: 'outlook_issue' },
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
   };

   const vagueAIMap = {
     screen_black: 'laptop screen completely black not showing anything',
     screen_flicker: 'screen blinking flickering constantly',
     screen_dim: 'screen too dark dim cannot see properly',
     screen_color: 'screen showing wrong colors or lines',
     screen_no_display: 'screen shows nothing no display at all',
     wont_turn_on: "laptop won't turn on at all",
     laptop_slow: 'laptop very slow hanging',
     blue_screen: 'laptop blue screen BSOD error',
     freezing: 'laptop freezing and hanging',
     battery_issue: 'laptop battery or charging issue',
     battery_not_charging: 'laptop battery not charging at all',
     battery_drain: 'laptop battery draining too fast backup very low',
     battery_stuck: 'laptop battery stuck at 0 percent not charging',
     battery_dead: 'laptop battery completely dead not working',
     overheat: 'laptop overheating getting very hot',
     laptop_other: 'laptop hardware issue not specified',
     wifi_not_connect: 'wifi not connecting at all',
     internet_slow: 'internet very slow speed problem',
     wifi_drop: 'wifi keeps disconnecting dropping frequently',
     website_blocked: 'website not opening blocked',
     sound_none: 'no sound at all from speakers',
     sound_headphone: 'headphone not working no audio in headphone',
     mic_issue: 'microphone not working in Teams Zoom',
     sound_distorted: 'sound is distorted crackling bad quality',
     keys_not_working: 'keyboard keys not working not typing',
     keys_wrong: 'keyboard typing wrong characters',
     touchpad_issue: 'mouse touchpad not working cursor stuck',
     numlock_issue: 'numlock numpad not working',
     teams_issue: 'Microsoft Teams not working crashing',
     outlook_issue: 'Outlook not working email issue',
     app_crash: 'app crashing not opening',
     windows_update: 'windows update stuck failing',
     software_other: 'software app issue not specified',
     password_reset: 'forgot laptop Windows password',
     account_locked: 'account locked cannot login',
     email_password: 'email Google account password reset',
     otp_issue: '2FA OTP not received',
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
   };

   const btns = quickButtons[vagueMatch.type] || [];
   const rows = [];
   for (let i = 0; i < btns.length; i += 4) rows.push(btns.slice(i, i + 4));

   const label = categoryLabels[vagueMatch.type] || 'Issue';
   const blocks = [
     { type: 'section', text: { type: 'mrkdwn', text: `*${label} — exact problem select karo:*\n_Zivon directly fix + script dega 👇_` } },
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
 { type:'button', text:{ type:'plain_text', text:'📧 Email / Outlook', emoji:true }, action_id:'vague_pick_outlook_issue', value:'Outlook not working' },
 { type:'button', text:{ type:'plain_text', text:'📹 Teams / Zoom', emoji:true }, action_id:'vague_pick_teams_issue', value:'Microsoft Teams not working' },
 { type:'button', text:{ type:'plain_text', text:'🎫 Create Ticket', emoji:true }, style:'primary', action_id:'vague_pick_create_ticket', value:'create ticket' },
 ]},
 { type:'context', elements:[{ type:'mrkdwn', text:`_Ya seedha apni problem type karo — Zivon samjhega! 😊_` }]}
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
     /spartans|kaun\s*hoon|Zivon|IT Admin|sajan kumar|khushi hui|koi baat nahi|theek hoon|IT problems mein help|Hello.*Kya IT|Theek hoon/i.test(kbReply) ||
     // Ticket status replies — no buttons needed, user just wanted info
     /IT team ke paas hai|my tickets|Status dekhne|ticket.*resolve|same day resolve|priority mark/i.test(kbReply) ||
     // Resolved confirm
     /Khushi hui.*resolve|resolve ho gaya|Great.*resolve/i.test(kbReply)
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

 let autoPriority = 'Medium';
 if (/urgent|critical|emergency|immediately|stop.*work|can.*t work|completely|floor down/i.test(allUserText)) autoPriority = 'High';
 else if (/minor|small|little|low|whenever/i.test(allUserText)) autoPriority = 'Low';

 const lastUserMsg = conv.messages.filter(m=>m.role==='user').slice(-3).map(m=>m.content).join('; ');

 // Build blocks: script FIRST → answer → ticket button ALWAYS
 // Use current message (text) for script detection — NOT recentUserText (avoids old WiFi context bleeding in)
 // Info-only = informational, no troubleshooting → NO buttons
 // NEVER info-only if shouldCreateTicket = true (user must confirm with "ha")
 const isInfoOnly = !shouldCreateTicket && (
   // Greeting / identity / thanks
   /khushi hui|koi baat nahi|theek hoon|aur koi.*IT help|IT problems mein help|Main Zivon|Zivon hoon|koi aur cheez|Kya IT problem/i.test(reply) ||
   // Ticket status / info queries
   /IT team ke paas|my tickets|Status dekhne|ticket.*resolve|same day|priority mark/i.test(reply) ||
   // Resolved celebrations
   /resolve ho gaya|Great.*resolve|sahi ho gaya.*Koi aur/i.test(reply)
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

 // ── ✅ Resolved — user says it worked ────────────────────────────────────────
 slackApp.action('resolved_yes_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const channelId = body.channel?.id || body.container?.channel_id;
   failedAttempts.delete(userId); // reset failure count
   pendingTickets.delete(userId); // no ticket needed

   const replies = [
     `✅ *Bahut badhiya!* Sahi ho gaya 😊\n\nKoi aur IT problem ho toh seedha batao — main hoon! 🚀`,
     `✅ *Ho gaya* 🎉 Mast!\n\nKoi aur problem aaye toh yahan type karo — main 24/7 hoon! 😄`,
     `*Nice!* Lagta hai issue solve ho gayi 😊\n\nAur kuch chahiye? Batao!`
   ];
   const msg = replies[Math.floor(Math.random() * replies.length)];

   await client.chat.postMessage({
     channel: channelId,
     text: '✅ Problem solve ho gayi!',
     blocks: [{ type:'section', text:{ type:'mrkdwn', text: msg }}]
   });
 });

 // ── ❌ Not resolved — give next steps, escalate on 2nd failure ───────────────
 slackApp.action('not_resolved_btn', async ({ body, ack, client }) => {
   await ack();
   const userId = body.user.id;
   const channelId = body.channel?.id || body.container?.channel_id;

   // Track failure count
   const prev = failedAttempts.get(userId) || { count: 0, lastTime: 0 };
   // Reset if last attempt was >30 min ago (fresh issue)
   const isStale = Date.now() - prev.lastTime > 30 * 60 * 1000;
   const count = isStale ? 1 : prev.count + 1;
   failedAttempts.set(userId, { count, lastTime: Date.now() });

   // ── After 2 failures → auto ticket ─────────────────────────────────────────
   if (count >= 2) {
     failedAttempts.delete(userId);
     await client.chat.postMessage({
       channel: channelId,
       text: 'Steps se nahi hua — IT ticket raise karte hain!',
       blocks: buildAutoTicketBlocks(
         `No worries 👍\n\nLagta hai ye steps se theek nahi ho raha. *IT team physically aayegi* — woh direct fix karegi!\n\n_Ek click mein ticket create karo:_`
       )
     });
     return;
   }

   // ── First failure → AI gives next different step ────────────────────────────
   const thinkMsg = await client.chat.postMessage({
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
     // Use ORIGINAL issue — pendingTickets > button value > first user msg
     // button value is problemText set by buildDMBlocks (not "Medium" which is old urgency)
     const btnValue = body.actions?.[0]?.value || '';
     const originalIssue = pendingTickets.get(userId)?.description
       || (btnValue.length > 10 && !/^(Critical|High|Medium|Low|script)$/.test(btnValue) ? btnValue : null)
       || conv.messages.filter(m => m.role === 'user').find(m => !/(nahi hua|try kiye|same hai)/i.test(m.content))?.content
       || '';
     const nextBlocks = buildDMBlocks(originalIssue, formattedReply);

     await client.chat.update({
       channel: thinkMsg.channel, ts: thinkMsg.ts, text: reply, blocks: nextBlocks
     });
   } catch(err) {
     console.error('not_resolved_btn AI error:', err.message);
     try {
       await client.chat.update({
         channel: thinkMsg.channel, ts: thinkMsg.ts,
         text: 'Ek aur step try karo!',
         blocks: buildDMBlocks('', `No worries 👍\n\nEk aur cheez try karo:\n\n1. Laptop restart karo\n2. Dobara check karo\n3. Koi error message aa raha? Bol batao!`)
       });
     } catch (updateErr) {
       console.error('not_resolved_btn fallback update error:', updateErr.message);
       try {
         await client.chat.postMessage({ channel: channelId, text: 'No worries! Ek aur kaam karo — laptop restart karo aur dobara check karo.' });
       } catch {}
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
         text: '⚡ Script download ho gayi!',
         blocks: [
           { type:'section', text:{ type:'mrkdwn',
             text:`⚡ *Script download ho gayi!*\n\nScript run karo (Double-click ya Admin mode mein) aur 1-2 min wait karo.\n\n_Ho gaya ya nahi? Batao 👇_` }},
           { type:'actions', elements: [
             { type:'button', text:{ type:'plain_text', text:'✅ Script se ho gaya!', emoji:true },
               action_id:'resolved_yes_btn', style:'primary', value:'script' },
             { type:'button', text:{ type:'plain_text', text:'❌ Script se bhi nahi hua', emoji:true },
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
   const channelId = body.channel?.id || body.container?.channel_id;
   try {
     const emp = await lookupEmployee(userId, client);

     // Get pendingTickets data (set by KB/AI path) or fallback to message text
     let pending = pendingTickets.get(userId);
     if (!pending) {
       // Build from button's parent message text or generic fallback
       const msgText = body.message?.blocks?.[0]?.text?.text
         || body.message?.text
         || 'IT support required';
       pending = {
         empId: emp.empId, empName: emp.empName, empEmail: emp.email || 'unknown@wiom.in',
         empDept: emp.dept, empFloor: emp.floor,
         laptop: emp.laptop, laptopSN: emp.laptopSN,
         category: 'Other', priority: 'Medium',
         description: msgText.replace(/[*_`]/g, '').substring(0, 200),
         source: 'slack', slackUserId: userId,
         createdAt: Date.now()
       };
     }

     const result = await createTicketSlack(pending);
     if (result?._duplicate) {
       await client.chat.postEphemeral({ channel: channelId, user: userId,
         text: `⚠️ ${result.message}` });
     } else if (result) {
       pendingTickets.delete(userId);
       const priEmoji2 = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
       await client.chat.postMessage({
         channel: channelId,
         text: `✅ Ticket Created: ${result.ticketId}`,
         blocks: [
           { type:'section', text:{ type:'mrkdwn',
             text:`✅ *Ticket Created!* \`${result.ticketId}\`\n${priEmoji2[result.priority]||'🟡'} Priority: *${result.priority}* | Category: *${result.category}*\n_IT team jald aapke paas aayegi!_ 🚀` }},
           { type:'context', elements:[{ type:'mrkdwn', text:`_${(result.description||'').substring(0,80)}_` }]}
         ]
       });
       await notifyAdmin(client, result, emp);
     }
   } catch(err) {
     console.error('quick_ticket_btn error:', err.message);
     await client.chat.postEphemeral({ channel: channelId, user: userId,
       text: '❌ Ticket nahi ban saka. /ticket command try karo ya IT ko directly call karo: 9654244281' });
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

 const todayStart = new Date();
 todayStart.setUTCHours(0, 0, 0, 0);

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

 // Trending: top categories today
 const todayStart2 = new Date(); todayStart2.setHours(0,0,0,0);
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

