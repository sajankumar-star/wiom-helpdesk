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
 const adminId = process.env.ADMIN_EMAIL_SLACK_ID;
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
 const adminId = process.env.ADMIN_EMAIL_SLACK_ID;
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
 if (global._sentRecurringAlerts?.has(key)) continue;
 if (!global._sentRecurringAlerts) global._sentRecurringAlerts = new Set();
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
 const pendingTickets = new Map(); // slackUserId -> ticketData
 const expandedHomeMap = new Map(); // slackUserId -> Set<categoryKey>

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
 emoji: '🔴', color: 'danger',
 desc: 'Laptop, Mouse, Keyboard, Monitor replacement request',
 rows: [
 [
 { text:'Laptop Replacement', value:'Laptop needs replacement old one is damaged or not working', id:'home_quick_37' },
 { text:'️ Mouse Replacement', value:'Mouse is damaged need a replacement', id:'home_quick_60' },
 { text:'Keyboard Replacement', value:'Keyboard is damaged need a replacement', id:'home_quick_61' },
 { text:'️ New Monitor Request', value:'Need a new monitor or monitor replacement', id:'home_quick_62' }
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
 'home_quick_72': { fixType: ['fix_keyboard'], label: 'Caps Lock Fix' },
 'home_quick_8' : { fixType: ['fix_touchpad'], label: '️ Touchpad Fix' },
 'home_quick_40': { fixType: ['fix_bluetooth'], label: 'Bluetooth Fix' },
 'home_quick_63': { fixType: ['fix_usb'], label: 'USB Fix' },
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
 'home_quick_8' : { file: 'fix-touchpad.bat', label: '️ Touchpad Fix' },
 'home_quick_21': { file: 'fix-freezing.bat', label: '❄️ Freezing Fix' },
 'home_quick_30': { file: 'fix-sudden-shutdown.bat', label: '⚡ Sudden Shutdown Fix' },
 'home_quick_33': { file: 'fix-bluescreen.bat', label: 'Restart Loop Fix' },
 'home_quick_38': { file: 'fix-fan-noise.bat', label: 'Fan Noise Fix' },
 'home_quick_39': { file: 'fix-screen-flicker.bat', label: 'Screen Flicker Fix' },
 'home_quick_40': { file: 'fix-bluetooth.bat', label: 'Bluetooth Fix' },
 'home_quick_63': { file: 'fix-usb.bat', label: 'USB Fix' },
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

 // ── Build Home Tab blocks (with collapsible categories) ───────────────
 const buildHomeBlocks = (emp, myTickets, expandedSet) => {
 const name = emp?.name?.split(' ')[0] || 'Employee';
 const laptop = emp?.laptop || null;
 const laptopSN = emp?.laptopSN || null;
 const dept = emp?.department || null;
 const openCnt = myTickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;

 const statEmoji = { 'Open':'', 'In Progress':'', 'Resolved':'✅', 'Closed':'⚫' };
 const priEmoji2 = { 'Critical':'', 'High':'', 'Medium':'', 'Low':'' };

 // Time-based greeting IST (UTC+5:30)
 const _now = new Date();
 const istHour = Math.floor((_now.getUTCHours() * 60 + _now.getUTCMinutes() + 330) / 60) % 24;
 const greeting = istHour < 12 ? 'Good Morning' : istHour < 17 ? 'Good Afternoon' : 'Good Evening';

 const blocks = [
 { type:'header', text:{ type:'plain_text', text:'WIOM IT Helpdesk', emoji:true }},

 { type:'section', text:{ type:'mrkdwn', text:
 '*' + greeting + ', ' + name + '!* :wave:\nSelect a category below or *type your problem directly in DM* AI will help instantly.\n_To create a ticket: type `/ticket`_'
 }},

 ...(emp ? [{
 type:'section', fields:[
 { type:'mrkdwn', text:'*Emp ID:* `' + emp.empId + '`' },
 { type:'mrkdwn', text:'*Dept:* ' + (dept||'-') },
 { type:'mrkdwn', text:'*Laptop:* ' + (laptop||'-') },
 { type:'mrkdwn', text:'*S/N:* `' + (laptopSN||'-') + '`' },
 { type:'mrkdwn', text: openCnt > 0
 ? '*Open Tickets:* *' + openCnt + ' open* :warning:'
 : '*Tickets:* :white_check_mark: No open tickets' }
 ]
 }] : []),

 { type:'divider' },

 ...(myTickets.length > 0 ? [
 { type:'section', text:{ type:'mrkdwn', text:
 '*Last Ticket:* ' + (statEmoji[myTickets[0].status]||':yellow_circle:') + ' `' + myTickets[0].ticketId + '` - ' + (myTickets[0].description||'').substring(0,50) + '...\n' +
 (priEmoji2[myTickets[0].priority]||':yellow_circle:') + ' ' + myTickets[0].priority + ' | ' + (myTickets[0].category||'Other') + ' | _' + Math.floor((Date.now()-new Date(myTickets[0].createdAt))/3600000) + 'h ago_' +
 (myTickets[0].resolution ? '\n:white_check_mark: *Resolved:* ' + myTickets[0].resolution.substring(0,60) : '')
 }}
 ] : []),

 { type:'divider' },
 { type:'section', text:{ type:'mrkdwn', text:'*Select a Category:*' }},
 { type:'context', elements:[{ type:'mrkdwn', text:'_Click a category to expand, then select your issue. Or type your problem in DM._' }]}
 ];

 for (const cat of CATEGORIES) {
 const isExpanded = expandedSet.has(cat.key);
 // All category buttons: same color (primary = green)
 blocks.push({
 type: 'actions',
 elements: [{
 type: 'button',
 text: { type: 'plain_text', text: `${isExpanded ? '▼' : '▶'} ${cat.label}`, emoji: true },
 style: 'primary',
 action_id: `cat_toggle_${cat.key}`,
 value: cat.key
 }]
 });

 if (isExpanded) {
 for (const row of cat.rows) {
 blocks.push({
 type: 'actions',
 elements: row.map(btn => ({
 type : 'button',
 text : { type: 'plain_text', text: btn.text, emoji: true },
 value : btn.value,
 action_id: btn.id
 }))
 });
 }
 // Collapse button — click to close this category & scroll back up
 blocks.push({
 type: 'actions',
 elements: [{
 type: 'button',
 text: { type: 'plain_text', text: '▲ Close & Scroll Up', emoji: true },
 action_id: `cat_toggle_${cat.key}`,
 value: cat.key
 }]
 });
 blocks.push({ type: 'divider' });
 }
 }

 // SOS at bottom
 blocks.push({ type:'divider' });
 blocks.push({
 type:'actions',
 elements:[{
 type:'button', style:'danger',
 text:{ type:'plain_text', text:'SOS IT Emergency / SOS', emoji:true },
 action_id:'home_sos', value:'sos'
 }]
 });

 return blocks;
 };

 // ── FEATURE 5: Office hours check (IST = UTC+5:30) ────────────────────
 const isOfficeHours = () => {
 const now = new Date();
 const istMins = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
 const istHour = Math.floor(istMins / 60) % 24;
 return istHour >= 9 && istHour < 19; // 9AM7PM IST
 };

 // ── FEATURE 2: Format reply for Slack mrkdwn ─────────────────────────
 const formatForSlack = (text) => {
 return text
 .replace(/\bStep (\d+):\s*/gi, '\n*Step $1:* ') // Bold step numbers
 .replace(/^\n+/, '') // Remove leading newline
 .replace(/\n{3,}/g, '\n\n') // Max 2 blank lines
 .trim();
 };

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
 empCache.set(slackUserId, { data, ts: Date.now() });
 return data;
 } catch {
 return { empId: slackUserId, empName: 'Employee', email: null, dept: 'Unknown' };
 }
 };

 // ── Notify admin ──────────────────────────────────────────────────────
 const notifyAdmin = async (client, ticket, emp) => {
 try {
 const adminId = process.env.ADMIN_EMAIL_SLACK_ID;
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

 // ── Back to categories (DM) ──────────────────────────────────────────
 slackApp.action('dm_back_to_categories', async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const channelId = body.channel?.id || userId;
 const msgTs = body.message?.ts;
 try {
 const emp = await lookupEmployee(userId, client);
 const firstName = (emp?.empName || 'there').split(' ')[0];
 const catBlocks = [
 { type:'section', text:{ type:'mrkdwn', text:`*Hello ${firstName}!* \n_Apni IT problem category select karo:_` }},
 { type:'divider' },
 ...CATEGORIES.map(cat => ({
 type: 'actions',
 elements: [{
 type : 'button',
 text : { type: 'plain_text', text: cat.label, emoji: true },
 style : 'primary',
 action_id: `dm_cat_${cat.key}`,
 value : cat.key
 }]
 }))
 ];
 if (msgTs) {
 await client.chat.update({ channel: channelId, ts: msgTs, text: 'Categories', blocks: catBlocks });
 } else {
 await client.chat.postMessage({ channel: userId, text: 'Categories', blocks: catBlocks });
 }
 } catch (err) {
 console.error('dm_back_to_categories error:', err.message);
 // Fallback: post fresh categories message
 try {
 await client.chat.postMessage({ channel: userId, text: 'Select category:', blocks: [
 { type:'section', text:{ type:'mrkdwn', text:`_Apni IT problem category select karo:_` }},
 { type:'divider' },
 ...CATEGORIES.map(cat => ({
 type: 'actions',
 elements: [{ type:'button', text:{ type:'plain_text', text: cat.label, emoji:true }, style:'primary', action_id:`dm_cat_${cat.key}`, value: cat.key }]
 }))
 ]});
 } catch {}
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
 const problem = body.actions[0].value; // e.g. "laptop very slow"
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
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
 empDept: emp.dept, empFloor: emp.floor,
 laptop: emp.laptop, laptopSN: emp.laptopSN,
 category: autoCategory, priority: 'Medium',
 description: problem, source: 'slack', slackUserId: userId
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
 const homeQuickActions = ['home_quick_1','home_quick_2','home_quick_3','home_quick_4','home_quick_5','home_quick_6','home_quick_7','home_quick_8','home_quick_9','home_quick_10','home_quick_11','home_quick_12','home_quick_13','home_quick_14','home_quick_15','home_quick_16','home_quick_17','home_quick_18','home_quick_19','home_quick_20','home_quick_21','home_quick_22','home_quick_23','home_quick_24','home_quick_25','home_quick_26','home_quick_27','home_quick_28','home_quick_29','home_quick_30','home_quick_31','home_quick_32','home_quick_33','home_quick_34','home_quick_35','home_quick_36','home_quick_37','home_quick_38','home_quick_39','home_quick_40','home_quick_41','home_quick_42','home_quick_43','home_quick_44','home_quick_45','home_quick_46','home_quick_47','home_quick_48','home_quick_49','home_quick_50','home_quick_51','home_quick_52','home_quick_53','home_quick_54','home_quick_55','home_quick_56','home_quick_57','home_quick_58','home_quick_59','home_quick_60','home_quick_61','home_quick_62','home_quick_63','home_quick_64','home_quick_65','home_quick_66','home_quick_67','home_quick_68','home_quick_69','home_quick_70','home_quick_71','home_quick_72','home_sos'];
 homeQuickActions.forEach(actionId => {
 slackApp.action(actionId, async ({ body, ack, client }) => {
 await ack();
 const userId = body.user.id;
 const problem = body.actions[0].value;
 const triggerId = body.trigger_id;
 try {
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

 // ── Hardware Replacement / Emergency modal ────────────────────
 if (HARDWARE_SPECIAL_IDS.has(actionId)) {
 const hwBlocks = buildHardwareBlocks(actionId, emp);
 await client.views.open({
 trigger_id: triggerId,
 view: {
 type: 'modal',
 title: { type: 'plain_text', text: 'Hardware Request', emoji: true },
 close: { type: 'plain_text', text: 'Close', emoji: true },
 blocks: hwBlocks
 }
 });
 // Auto-create ticket ONLY for liquid damage emergency
 if (actionId === 'home_quick_70' && emp?.empId) {
 try {
 const result = await createTicketSlack({
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
 empDept: emp.dept, empFloor: emp.floor,
 laptop: emp.laptop, laptopSN: emp.laptopSN,
 description: `EMERGENCY: Liquid/Water Damage ${emp.laptop || 'Laptop'} (S/N: ${emp.laptopSN || 'Unknown'})`,
 category: 'Hardware', priority: 'Critical',
 source: 'slack', slackUserId: userId
 });
 if (result && !result._duplicate) await notifyAdmin(client, result, emp);
 } catch (ticketErr) {
 console.error('Liquid damage ticket error:', ticketErr.message);
 }
 }
 return;
 }

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

 // ── DM Handler ────────────────────────────────────────────────────────
 slackApp.message(async ({ message, client, say }) => {
 if (message.bot_id || message.subtype) return;
 const userId = message.user;
 const text = message.text?.trim();
 if (!text) return;

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
 const firstName = (emp.empName || 'there').split(' ')[0];
 await say({
 text: `Hello ${firstName}! WIOM IT Helpdesk`,
 blocks: [
 { type:'section', text:{ type:'mrkdwn', text:`*Hello ${firstName}!* \n_Apni IT problem category select karo:_` }},
 { type:'divider' },
 ...CATEGORIES.map(cat => ({
 type: 'actions',
 elements: [{
 type : 'button',
 text : { type: 'plain_text', text: cat.label, emoji: true },
 style : 'primary',
 action_id: `dm_cat_${cat.key}`,
 value : cat.key
 }]
 }))
 ]
 });
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

 // ── Vague laptop/wifi/problem message → show quick-select buttons ──
 const vaguePatterns = [
 { regex: /^(laptop\s*(not\s*working|kharab|kaam\s*nahi|issue|problem|hang|slow|band|on\s*nahi|nahi\s*chal|theek\s*nahi|kuch\s*ho\s*gaya|bhot\s*slow|dead|crash)|laptop$)/i,
 type: 'laptop' },
 { regex: /^(wifi\s*(nahi|not|issue|problem|kharab|kaam\s*nahi|nahi\s*chal|disconnect)|internet\s*(nahi|not|slow|issue|kharab)|network\s*(issue|problem|nahi))/i,
 type: 'wifi' },
 { regex: /^(software\s*(issue|problem|nahi|not)|app\s*(crash|not|nahi|issue)|teams\s*(nahi|not|issue)|outlook\s*(nahi|not|issue)|windows\s*(issue|problem))/i,
 type: 'software' },
 { regex: /^(password\s*(bhool|forgot|reset|issue|nahi\s*pata)|account\s*(locked|issue|nahi)|login\s*(nahi|issue|problem))/i,
 type: 'account' },
 ];

 const vagueMatch = vaguePatterns.find(p => p.regex.test(text.trim()));

 if (vagueMatch) {
 const quickButtons = {
 laptop: [
 { text: "Won't Turn On", val: 'wont_turn_on' },
 { text: 'Very Slow', val: 'laptop_slow' },
 { text: 'Screen Black', val: 'screen_black' },
 { text: 'Blue Screen', val: 'blue_screen' },
 { text: 'Freezing/Hanging', val: 'freezing' },
 { text: 'Battery Issue', val: 'battery' },
 { text: 'Overheating', val: 'overheat' },
 { text: 'Something Else', val: 'laptop_other' },
 ],
 wifi: [
 { text: 'WiFi Not Connecting', val: 'wifi_not_connect' },
 { text: 'Very Slow Internet', val: 'internet_slow' },
 { text: 'WiFi Keeps Dropping', val: 'wifi_drop' },
 { text: 'Website Not Opening', val: 'website_blocked' },
 ],
 software: [
 { text: 'Teams Not Working', val: 'teams_issue' },
 { text: 'Outlook Issue', val: 'outlook_issue' },
 { text: 'App Crashing', val: 'app_crash' },
 { text: 'Windows Update Stuck', val: 'windows_update' },
 { text: 'Something Else', val: 'software_other' },
 ],
 account: [
 { text: 'Forgot Password', val: 'password_reset' },
 { text: 'Account Locked', val: 'account_locked' },
 { text: 'Email Password', val: 'email_password' },
 { text: '2FA / OTP Issue', val: 'otp_issue' },
 ],
 };

 const vagueAIMap = {
 wont_turn_on: "laptop won't turn on", laptop_slow: 'laptop very slow',
 screen_black: 'laptop screen black', blue_screen: 'laptop blue screen error',
 freezing: 'laptop freezing and hanging', battery: 'laptop battery not charging',
 overheat: 'laptop overheating', laptop_other: 'laptop hardware issue',
 wifi_not_connect: 'wifi not connecting', internet_slow: 'internet very slow',
 wifi_drop: 'wifi keeps disconnecting', website_blocked: 'website not opening',
 teams_issue: 'Microsoft Teams not working', outlook_issue: 'Outlook not working',
 app_crash: 'app crashing', windows_update: 'windows update stuck',
 software_other: 'software issue', password_reset: 'forgot laptop password',
 account_locked: 'account locked', email_password: 'email password reset',
 otp_issue: '2FA OTP not received',
 };

 const btns = quickButtons[vagueMatch.type] || [];
 // Split into rows of 4
 const rows = [];
 for (let i = 0; i < btns.length; i += 4) rows.push(btns.slice(i, i + 4));

 const blocks = [
 { type: 'section', text: { type: 'mrkdwn', text: `*Kya problem aa rahi hai exactly?* Select karo:` }},
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

 await say({ text: 'Kya problem hai exactly? Select karo:', blocks });

 // Register handlers for these vague-pick actions (once per server start — use regex)
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
 const pending = pendingTickets.get(userId);
 if (pending) {
 // IMPORTANT: Must be exact short responses "NAHI HUAA" must NOT trigger isNo
 // "nahi huaa", "nahi chala", "kaam nahi kiya" = failed attempt → goes to AI
 // "nahi", "na", "no" alone = user declining ticket → isNo
 const isYes = /^(ha|haan|haa|han|yes|bilkul|ok|bana do|create|kar do|ho jaye)\s*[!।.,]?\s*$/i.test(text.trim());
 const isNo = /^(nahi|na|no|nope|mat|chodo|rehne do|band karo)\s*[!।.,]?\s*$/i.test(text.trim());

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
 // Show instant typing indicator so user knows bot is working
 const thinkingMsg = await say({ text: '⏳ Soch raha hoon...' });

 const conv = await getSlackSession(userId, emp);
 conv.messages.push({ role: 'user', content: text });
 if (conv.messages.length > 20) conv.messages = conv.messages.slice(-20);

 // Run DB save and AI call in parallel for speed
 const [, { reply, shouldCreateTicket, ticketData }] = await Promise.all([
 conv.save(),
 claudeSvc.chat(
 conv.messages,
 { empId: emp.empId, empName: emp.empName, source: 'slack',
 laptop: emp.laptop, laptopSN: emp.laptopSN, dept: emp.dept, floor: emp.floor }
 )
 ]);

 conv.messages.push({ role: 'assistant', content: reply });
 await conv.save();

 // ── FEATURE 2: Format for Slack ───────────────────────────────────
 const formattedReply = formatForSlack(reply);

 const blocks = [{ type:'section', text:{ type:'mrkdwn', text: formattedReply }}];

 // ── Auto-detect ticket context when AI suggests raising a ticket ──
 if (shouldCreateTicket) {
 // Extract category from conversation
 const allUserText = conv.messages.filter(m=>m.role==='user').map(m=>m.content).join(' ').toLowerCase();
 let autoCategory = 'Other';
 if (/wifi|internet|network|connection|hotspot|broadband/i.test(allUserText)) autoCategory = 'Network';
 else if (/teams|zoom|outlook|email|browser|chrome|word|excel|office|app|software|windows|update|onedrive|pdf|virus|storage|2fa|otp|antivirus/i.test(allUserText)) autoCategory = 'Software';
 else if (/laptop|screen|keyboard|mouse|battery|charg|touchpad|usb|bluetooth|camera|mic|headphone|sound|speaker|display|monitor|fan|overheat|blue screen|bsod|freeze|hang|slow|boot|startup/i.test(allUserText)) autoCategory = 'Hardware';
 else if (/password|account|login|locked|access|2fa|otp|email.*reset|reset.*email/i.test(allUserText)) autoCategory = 'Account';
 else if (/replace|replacement|new mouse|new keyboard|new monitor|new laptop/i.test(allUserText)) autoCategory = 'Purchase';

 let autoPriority = 'Medium';
 if (/urgent|critical|emergency|immediately|stop.*work|can.*t work|completely|floor down/i.test(allUserText)) autoPriority = 'High';
 else if (/minor|small|little|low|whenever/i.test(allUserText)) autoPriority = 'Low';

 // Use last user message as description (most recent problem statement)
 const lastUserMsg = conv.messages.filter(m=>m.role==='user').slice(-3).map(m=>m.content).join('; ');

 pendingTickets.set(userId, {
 empId: emp.empId, empName: emp.empName, empEmail: emp.email,
 empDept: emp.dept, empFloor: emp.floor,
 laptop: emp.laptop, laptopSN: emp.laptopSN,
 category: ticketData?.category || autoCategory,
 priority: ticketData?.priority || autoPriority,
 description: ticketData?.description || lastUserMsg || text,
 source: 'slack', slackUserId: userId
 });
 blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`_Ticket banana hai? *"Ha"* ya *"Nahi"* type karo_ ` }]});
 }

 // Replace "Soch raha hoon..." with actual reply
 try {
 await client.chat.update({
 channel: userId,
 ts: thinkingMsg.ts,
 text: reply,
 blocks
 });
 } catch {
 await say({ text: reply, blocks });
 }

 } catch (err) {
 console.error('❌ DM handler error:', err.message);
 try {
 await say({ text: '❌ Kuch technical problem aa gayi. Thoda wait karein aur dobara try karein.' });
 } catch (sayErr) {
 console.error('❌ Could not send error message:', sayErr.message);
 }
 }
 });

 // ── Start Slack App ───────────────────────────────────────────────────
 slackApp.start().then(async () => {
 console.log(' Slack Bot started! Socket Mode active.');
 slackClient = slackApp.client;
 app.locals.slackClient = slackApp.client;

 // Auto-link admin Slack ID
 const adminSlackId = process.env.ADMIN_EMAIL_SLACK_ID;
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
 const adminId = process.env.ADMIN_EMAIL_SLACK_ID;
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

 await slackApp.client.chat.postMessage({
 channel: adminId,
 text : ` Good Morning! IT Helpdesk Daily Summary ${dateStr}`,
 blocks : [
 { type:'header', text:{ type:'plain_text', text:` IT Helpdesk Daily Summary`, emoji:true }},
 { type:'context', elements:[{ type:'mrkdwn', text:`_${dateStr}_` }]},
 { type:'divider' },
 { type:'section', fields:[
 { type:'mrkdwn', text:`* Aaj Aaye*\n*${newToday}* tickets` },
 { type:'mrkdwn', text:`*✅ Aaj Resolve*\n*${resolvedToday}* tickets` },
 { type:'mrkdwn', text:`*⏳ Total Open*\n*${totalOpen}* tickets` },
 { type:'mrkdwn', text:`* Critical Open*\n*${critical}*` },
 { type:'mrkdwn', text:`*⚠️ SLA Breached*\n*${slaBreached}*` }
 ]},
 ...(oldestText ? [
 { type:'divider' },
 { type:'section', text:{ type:'mrkdwn', text:`*⏳ Sabse Purane Pending Tickets:*\n${oldestText}` }}
 ] : []),
 { type:'context', elements:[{ type:'mrkdwn', text:`_Aaj ki shuruat mubarak! IT Helpdesk: IT Helpdesk (Slack)_` }]}
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

