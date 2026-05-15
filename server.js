require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const cron       = require('node-cron');
const connectDB  = require('./config/db');

const authRoutes     = require('./routes/auth');
const ticketRoutes   = require('./routes/tickets');
const aiRoutes       = require('./routes/ai');
const employeeRoutes = require('./routes/employees');
const adminRoutes    = require('./routes/admin');
const kbRoutes       = require('./routes/kb');
const agentRoutes    = require('./routes/agent');
const slaService     = require('./services/sla');
const Ticket         = require('./models/Ticket');
const Conversation   = require('./models/Conversation');
const FixJob         = require('./models/FixJob');

// ── FIX: Global crash guards — Slack Socket Mode disconnect nahi crash karein ─
process.on('uncaughtException', (err) => {
  // Slack Socket Mode "server explicit disconnect" is normal — ignore it
  if (err.message && err.message.includes('Unhandled event')) {
    console.warn('⚠️  Slack WebSocket disconnect (auto-reconnecting):', err.message);
    return; // do NOT exit — let Bolt auto-reconnect
  }
  console.error('💥 Uncaught Exception:', err.message);
  // For truly unexpected errors, log but keep running
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason?.message || reason);
  // Never crash the process on unhandled promise rejections
});

// ── Slack client (set after bot starts) ──────────────────────────────────────
let slackClient = null;

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Connect Database ──────────────────────────────────────────────────────────
connectDB();

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc    : ["'self'"],
      scriptSrc     : ["'self'", "'unsafe-inline'"],
      scriptSrcAttr : ["'unsafe-inline'"],
      styleSrc      : ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc       : ["'self'", "https://fonts.gstatic.com"],
      imgSrc        : ["'self'", "data:", "https:"],
      connectSrc    : ["'self'", "https://web-production-ef6c1.up.railway.app"]
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
    status  : 'ok',
    service : 'WIOM IT Helpdesk API',
    version : '1.0.0',
    portal  : 'https://web-production-ef6c1.up.railway.app',
    time    : new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/tickets',   ticketRoutes);
app.use('/api/ai',        aiRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/kb',        kbRoutes);
app.use('/api/agent',     agentRoutes);

// ── WhatsApp Webhook (Twilio) ──────────────────────────────────────────────────
app.post('/api/whatsapp/incoming', async (req, res) => {
  try {
    const accountSid  = process.env.TWILIO_ACCOUNT_SID;
    const authToken   = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) return res.send('<Response></Response>');
    const twilio = require('twilio')(accountSid, authToken);
    const waSvc  = require('./services/whatsapp');
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
    error  : err.message || 'Internal server error',
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
      status       : { $in: ['Open', 'In Progress'] },
      createdAt    : { $lte: fourHoursAgo },
      escalationSent: false
    });

    for (const t of stale) {
      const hoursOld = Math.round((Date.now() - t.createdAt) / 3600000);
      const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
      try {
        await slackClient.chat.postMessage({
          channel: adminId,
          text: `⚠️ Escalation: ${t.ticketId} — ${t.empName} (${hoursOld}h open)`,
          attachments: [{
            color: '#ef4444',
            blocks: [
              { type:'header', text:{ type:'plain_text', text:`⚠️ Escalation Alert — ${t.ticketId}`, emoji:true }},
              { type:'section', fields:[
                { type:'mrkdwn', text:`*👤 Employee*\n${t.empName} (${t.empDept||'Unknown'})` },
                { type:'mrkdwn', text:`*${priEmoji[t.priority]||'🟡'} Priority*\n${t.priority}` },
                { type:'mrkdwn', text:`*⏱ Open Since*\n${hoursOld} hours` },
                { type:'mrkdwn', text:`*📂 Category*\n${t.category||'Other'}` }
              ]},
              { type:'section', text:{ type:'mrkdwn', text:`*📝 Issue:*\n${t.description}` }},
              { type:'context', elements:[{ type:'mrkdwn', text:`_Abhi tak resolve nahi hua — please check karo!_` }]}
            ]
          }]
        });
        t.escalationSent = true;
        await t.save();
        console.log(`📣 Escalation sent for ${t.ticketId} (${hoursOld}h old)`);
      } catch (err) {
        console.error(`Escalation DM failed for ${t.ticketId}:`, err.message);
      }
    }
    if (stale.length) console.log(`⚡ Escalated ${stale.length} tickets`);
  } catch (err) {
    console.error('Escalation cron error:', err.message);
  }
});

// ── Employee Reminder Cron: Every hour — ticket 4h+ open → remind employee via Slack ─
cron.schedule('30 * * * *', async () => {
  try {
    if (!slackClient) return;

    const fourHoursAgo = new Date(Date.now() - 4 * 3600000);
    const unreminded = await Ticket.find({
      status       : { $in: ['Open', 'In Progress'] },
      createdAt    : { $lte: fourHoursAgo },
      reminderSent : false,
      slackUserId  : { $exists: true, $ne: null }
    });

    for (const t of unreminded) {
      const hoursOld = Math.floor((Date.now() - new Date(t.createdAt)) / 3600000);
      const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
      try {
        await slackClient.chat.postMessage({
          channel: t.slackUserId,
          text   : `⏳ Aapka ticket ${t.ticketId} abhi bhi open hai — IT team kaam kar rahi hai!`,
          blocks : [
            { type:'section', text:{ type:'mrkdwn', text:
              `⏳ *Aapka ticket abhi bhi open hai!*\n\n` +
              `*🎫 Ticket:* \`${t.ticketId}\`\n` +
              `*${priEmoji[t.priority]||'🟡'} Priority:* ${t.priority}\n` +
              `*📝 Problem:* ${(t.description||'').substring(0,80)}${(t.description||'').length>80?'...':''}\n` +
              `*⏱ Open Since:* ${hoursOld} ghante pehle`
            }},
            { type:'context', elements:[{ type:'mrkdwn', text:
              `_IT team aapke ticket par kaam kar rahi hai 🙏 Jaldi solve ho jayega!_\nUrgent ho toh call karein: *IT Helpdesk (Slack)*`
            }]}
          ]
        });
        t.reminderSent = true;
        await t.save();
        console.log(`🔔 Reminder sent to ${t.slackUserId} for ticket ${t.ticketId} (${hoursOld}h old)`);
      } catch (err) {
        console.error(`Reminder DM failed for ${t.ticketId}:`, err.message);
      }
    }
    if (unreminded.length) console.log(`🔔 Sent ${unreminded.length} employee reminders`);
  } catch (err) {
    console.error('Employee reminder cron error:', err.message);
  }
});

// ── Auto-Close Cron: Daily 2AM — Resolved 3+ days ago → Closed ───────────────
cron.schedule('0 2 * * *', async () => {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600000);
    const result = await Ticket.updateMany(
      { status: 'Resolved', resolvedAt: { $lte: threeDaysAgo } },
      { $set: { status: 'Closed', closedAt: new Date() } }
    );
    if (result.modifiedCount > 0)
      console.log(`🔒 Auto-closed ${result.modifiedCount} resolved tickets`);
  } catch (err) {
    console.error('Auto-close cron error:', err.message);
  }
});

// ── Recurring Issue Alert: Every 30 min — flag when 3+ employees report same problem ──
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
        text   : `⚠️ ${g.count} employees same problem report kar rahe hain: ${g._id}`,
        blocks : [
          { type:'header', text:{ type:'plain_text', text:`⚠️ Recurring Issue Alert`, emoji:true }},
          { type:'section', text:{ type:'mrkdwn', text:
            `*${g.count} employees ne last 1 hour mein same issue report kiya!*\n\n*Category:* ${g._id}\n*Employees:* ${g.employees.slice(0,5).join(', ')}${g.count > 5 ? ` +${g.count-5} more` : ''}`
          }},
          { type:'context', elements:[{ type:'mrkdwn', text:`_Systemic problem ho sakta hai — please investigate!_` }]}
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
        username    : 'ADMIN_EMAIL',
        passwordHash: process.env.ADMIN_PASSWORD || 'Wiom@2024',
        name        : 'IT Admin',
        email       : process.env.ADMIN_EMAIL || 'it@wiom.in',
        role        : 'superadmin'
      });
      console.log('✅ Default admin created: ADMIN_EMAIL / Wiom@2024');
    }
  } catch (err) {
    console.error('Admin setup error:', err.message);
  }
};

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 WIOM Helpdesk API running on port ${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health: http://localhost:${PORT}/health\n`);

  await ensureAdminExists();

  // ── Start Slack Bot ────────────────────────────────────────────────────────
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_BOT_TOKEN !== 'FILL_KARO') {
    try {
      const { App }   = require('@slack/bolt');
      const claudeSvc = require('./services/claude');
      const Employee  = require('./models/Employee');
      const API_BASE  = process.env.API_BASE_URL || `http://localhost:${PORT}`;

      const slackApp = new App({
        token        : process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        socketMode   : true,
        appToken     : process.env.SLACK_APP_TOKEN
      });

      // ── In-memory store for pending ticket confirmations (short-lived) ─────
      const pendingTickets  = new Map(); // slackUserId -> ticketData
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
              brandLabel : '🍎 Apple MacBook',
              warrantyUrl: `https://checkcoverage.apple.com/?sn=${enc}`,
              diagScript : null,   // Mac can't run .bat
              diagLabel  : null,
              appleMode  : true,
              supportUrl : 'https://getsupport.apple.com'
            };
          case 'hp':
            return {
              brandLabel : '🖥️ HP',
              warrantyUrl: `https://support.hp.com/us-en/checkwarranty`,
              diagScript : 'fix-diagnostic-hp.bat',
              diagLabel  : '🔍 HP Hardware Diagnostic Script',
              appleMode  : false,
              supportUrl : 'https://support.hp.com'
            };
          case 'dell':
            return {
              brandLabel : '🖥️ Dell',
              warrantyUrl: `https://www.dell.com/support/home/?s=BSD&ServiceTag=${enc}`,
              diagScript : 'fix-diagnostic-dell.bat',
              diagLabel  : '🔍 Dell SupportAssist Script',
              appleMode  : false,
              supportUrl : 'https://www.dell.com/support'
            };
          case 'lenovo':
            return {
              brandLabel : '🖥️ Lenovo',
              warrantyUrl: `https://pcsupport.lenovo.com/us/en/warranty-lookup`,
              diagScript : 'fix-diagnostic-lenovo.bat',
              diagLabel  : '🔍 Lenovo Vantage Diagnostic Script',
              appleMode  : false,
              supportUrl : 'https://support.lenovo.com'
            };
          default:
            return {
              brandLabel : '💻 Laptop',
              warrantyUrl: null,
              diagScript : null,
              diagLabel  : null,
              appleMode  : false,
              supportUrl : null
            };
        }
      };

      // ── Category definitions ──────────────────────────────────────────────
      const CATEGORIES = [
        {
          key: 'laptop', label: '💻 Laptop — Hardware',
          rows: [
            [
              { text:'💻 Laptop Very Slow',          value:'My laptop is very slow, what should I do',                                    id:'home_quick_1'  },
              { text:'💻 Laptop Won\'t Turn On',      value:'My laptop is not turning on at all',                                          id:'home_quick_2'  },
              { text:'💙 Blue Screen Error',          value:'Getting blue screen of death BSOD error',                                     id:'home_quick_3'  },
              { text:'🌡️ Laptop Overheating',         value:'My laptop is overheating getting very hot',                                   id:'home_quick_4'  },
              { text:'🔋 Battery Not Charging',       value:'Laptop battery drains quickly or not charging at all',                        id:'home_quick_5'  }
            ],
            [
              { text:'🖥️ Screen Black / No Display',  value:'Laptop screen is black cannot see anything',                                 id:'home_quick_6'  },
              { text:'⌨️ Keyboard Not Working',        value:'Laptop keyboard not working some keys not responding',                       id:'home_quick_7'  },
              { text:'🖱️ Mouse / Touchpad Issue',      value:'Mouse or touchpad is not working not responding',                            id:'home_quick_8'  },
              { text:'🔌 Charger Not Working',         value:'Laptop charger not working laptop not charging',                             id:'home_quick_10' },
              { text:'❄️ Laptop Freezing / Hanging',   value:'Laptop is hanging freezing not responding at all',                           id:'home_quick_21' }
            ],
            [
              { text:'⚡ Sudden Shutdown',             value:'Laptop shuts down suddenly without any warning',                             id:'home_quick_30' },
              { text:'🔁 Stuck in Restart Loop',       value:'Laptop is stuck in restart loop keeps restarting again and again',           id:'home_quick_33' },
              { text:'💨 Fan Making Loud Noise',       value:'Laptop fan is making very loud noise constantly',                            id:'home_quick_38' },
              { text:'📺 Screen Flickering',           value:'Laptop screen is flickering blinking or flashing',                          id:'home_quick_39' },
              { text:'🔵 Bluetooth Not Working',       value:'Laptop bluetooth not working cannot connect any device',                     id:'home_quick_40' }
            ],
            [
              { text:'🔌 USB Port Not Working',        value:'USB port not working pendrive or device not detected',                       id:'home_quick_63' },
              { text:'😴 Won\'t Wake from Sleep',      value:'Laptop not waking up from sleep or hibernate screen stays black',            id:'home_quick_64' },
              { text:'🚫 Boot Error / Won\'t Start',   value:'Laptop not starting getting boot error Windows not loading',                 id:'home_quick_65' },
              { text:'👆 Touchscreen Not Working',     value:'Laptop touchscreen not working touch not responding at all',                 id:'home_quick_66' },
              { text:'🖥️ HDMI / External Display',     value:'HDMI cable not working external monitor or TV not connecting',              id:'home_quick_67' }
            ],
            [
              { text:'💳 SD Card Not Detected',        value:'SD card or memory card not being detected in laptop',                        id:'home_quick_68' },
              { text:'🔐 Fingerprint Not Working',     value:'Fingerprint reader not working cannot login with fingerprint',               id:'home_quick_69' },
              { text:'💧 Liquid / Water Damage',       value:'Liquid or water spilled on laptop needs immediate attention',                id:'home_quick_70', style:'danger' },
              { text:'🐌 Slow After Windows Update',   value:'Laptop became very slow after a Windows update',                            id:'home_quick_71' },
              { text:'🔡 Caps Lock / Keys Stuck',      value:'Caps Lock always stays on or keyboard keys are stuck',                      id:'home_quick_72' }
            ]
          ]
        },
        {
          key: 'network', label: '🌐 Network / Internet',
          rows: [
            [
              { text:'📶 WiFi Not Working',            value:'WiFi not working no internet connection',                                    id:'home_quick_11' },
              { text:'🐢 Internet Very Slow',          value:'Internet speed is very slow browsing not working properly',                  id:'home_quick_29' },
              { text:'🔑 WiFi Password',               value:'Need WiFi password or forgot WiFi password',                                 id:'home_quick_32' },
              { text:'📡 Mobile Hotspot Issue',        value:'Mobile hotspot not connecting to laptop',                                    id:'home_quick_26' },
            ],
            [
              { text:'🚫 Website Blocked / Not Opening',value:'Website not opening showing blocked or access denied',                      id:'home_quick_43' },
              { text:'📶 WiFi Keeps Disconnecting',    value:'WiFi keeps disconnecting again and again dropping connection',               id:'home_quick_44' },
              { text:'📧 Emails Not Loading',          value:'Email inbox not loading emails not coming or not sending',                   id:'home_quick_45' }
            ]
          ]
        },
        {
          key: 'audio', label: '🎤 Audio / Video / Display',
          rows: [
            [
              { text:'🔊 No Sound / Audio',            value:'No sound coming from laptop speakers audio not working',                    id:'home_quick_9'  },
              { text:'🔇 Speaker Not Working',         value:'Laptop speaker not working no audio output at all',                         id:'home_quick_28' },
              { text:'🎤 Microphone Not Working',      value:'Microphone not working voice not going in Teams or calls',                   id:'home_quick_16' },
              { text:'📷 Camera Not Working',          value:'Laptop camera not working in Teams Zoom or Meet',                           id:'home_quick_20' },
              { text:'🖥️ External Monitor Not Working',value:'External monitor not detected screen not showing on it',                    id:'home_quick_17' }
            ],
            [
              { text:'🎧 Headphone Not Working',       value:'Headphone or earphone not connecting or no sound in headphone',             id:'home_quick_46' },
              { text:'📽️ Projector Not Connecting',    value:'Laptop not connecting to projector presentation not showing',               id:'home_quick_47' },
              { text:'🖥️ Wrong Screen Resolution',     value:'Screen resolution is wrong everything looks too big or too small',          id:'home_quick_48' },
              { text:'📹 Video Call Quality Issue',    value:'Video call not working properly video lagging or freezing',                  id:'home_quick_49' }
            ]
          ]
        },
        {
          key: 'software', label: '💿 Software / Apps',
          rows: [
            [
              { text:'📹 Microsoft Teams Issue',       value:'Microsoft Teams not working call dropping or not opening',                   id:'home_quick_13' },
              { text:'🖥️ Zoom Not Working',            value:'Zoom not working cannot join meeting or Zoom crashing',                     id:'home_quick_27' },
              { text:'📄 Word / Excel Not Opening',    value:'Microsoft Word or Excel not opening showing error',                         id:'home_quick_23' },
              { text:'🌐 Browser Crashing / Slow',     value:'Browser is slow crashing or freezing Chrome Firefox Edge',                  id:'home_quick_31' },
              { text:'🔄 Windows Update Problem',      value:'Windows update not installing stuck or causing issues',                     id:'home_quick_24' }
            ],
            [
              { text:'🔐 Software Installation',       value:'Need to install new software need IT permission',                           id:'home_quick_25' },
              { text:'📋 Copy Paste Not Working',      value:'Copy paste not working Ctrl+C Ctrl+V not responding',                       id:'home_quick_34' },
              { text:'🕐 Wrong Date / Time',           value:'Laptop showing wrong date or time needs to be corrected',                   id:'home_quick_35' },
              { text:'📧 Outlook Not Working',         value:'Outlook not opening or cannot send receive emails',                         id:'home_quick_50' },
              { text:'☁️ OneDrive Not Syncing',        value:'OneDrive not syncing files not going to cloud',                             id:'home_quick_51' }
            ],
            [
              { text:'📄 PDF Not Opening',             value:'PDF file not opening PDF reader not working',                               id:'home_quick_52' },
              { text:'💥 App Keeps Crashing',          value:'Application keeps crashing or closing suddenly',                            id:'home_quick_53' },
              { text:'🖨️ Printer Not Working',         value:'Printer not working print job not completing',                             id:'home_quick_54' }
            ]
          ]
        },
        {
          key: 'account', label: '🔐 Account / Security / Storage',
          rows: [
            [
              { text:'🔑 Password Reset',              value:'Forgot password need to reset it',                                          id:'home_quick_14' },
              { text:'💾 Storage / Disk Full',         value:'Laptop storage full C drive is full cannot save files',                     id:'home_quick_18' },
              { text:'🦠 Virus / Malware Suspected',   value:'Laptop may have virus showing ads or behaving strangely',                   id:'home_quick_19' },
              { text:'🔗 Shared Drive Access Issue',   value:'Cannot access shared drive or network folder',                              id:'home_quick_36' },
              { text:'🔒 Account Locked / Login Issue',value:'Account is locked cannot login to Windows or any account',                  id:'home_quick_55' }
            ],
            [
              { text:'📱 2FA / OTP Not Received',      value:'Two factor authentication OTP not coming cannot login',                     id:'home_quick_56' },
              { text:'🛡️ Antivirus Alert / Warning',   value:'Antivirus showing alert or has blocked something',                         id:'home_quick_57' },
              { text:'☁️ OneDrive Storage Full',       value:'OneDrive storage is full files not syncing',                               id:'home_quick_58' },
              { text:'📧 Email Password Reset',        value:'Forgot email account password need to reset it',                           id:'home_quick_59' }
            ]
          ]
        },
        {
          key: 'replacement', label: '🔄 Replacement / Upgrade',
          rows: [
            [
              { text:'🔄 Laptop Replacement Request',  value:'Laptop needs replacement old one is damaged or not working',  id:'home_quick_37', style:'danger' },
              { text:'🖱️ Mouse Replacement Request',   value:'Mouse is damaged need a replacement',                        id:'home_quick_60' },
              { text:'⌨️ Keyboard Replacement Request', value:'Keyboard is damaged need a replacement',                     id:'home_quick_61' },
              { text:'🖥️ New Monitor Request',         value:'Need a new monitor or monitor replacement',                  id:'home_quick_62' }
            ]
          ]
        }
      ];

      // ── Auto-Fix mapping: which buttons can be auto-fixed on laptop ──────
      const AUTO_FIX_MAP = {
        'home_quick_1' : { fixType: ['kill_heavy', 'clean_temp'], label: '💻 Laptop Speed Fix'      },
        'home_quick_21': { fixType: ['kill_heavy'],               label: '💻 Freezing Fix'           },
        'home_quick_71': { fixType: ['kill_heavy', 'clean_temp'], label: '💻 Speed Boost Fix'        },
        'home_quick_11': { fixType: ['fix_wifi'],                 label: '📶 WiFi Reset'             },
        'home_quick_44': { fixType: ['fix_wifi'],                 label: '📶 WiFi Reconnect Fix'     },
        'home_quick_29': { fixType: ['fix_wifi'],                 label: '📶 Internet Speed Fix'     },
        'home_quick_13': { fixType: ['fix_teams'],                label: '📹 Teams Fix'              },
        'home_quick_50': { fixType: ['fix_outlook'],              label: '📧 Outlook Fix'            },
        'home_quick_34': { fixType: ['fix_clipboard'],            label: '📋 Copy-Paste Fix'         },
        'home_quick_9' : { fixType: ['fix_sound'],                label: '🔊 Sound Fix'             },
        'home_quick_28': { fixType: ['fix_sound'],                label: '🔊 Speaker Fix'            },
        'home_quick_35': { fixType: ['fix_datetime'],             label: '🕐 Date/Time Fix'         },
        'home_quick_18': { fixType: ['clean_disk', 'clean_temp'], label: '💾 Storage Cleanup'        },
      };

      // ── Download Script mapping: 1-click .bat scripts hosted on server ───
      const PORTAL = process.env.API_BASE_URL || 'https://web-production-ef6c1.up.railway.app';
      const SCRIPT_MAP = {
        // ── Laptop Hardware & Performance ─────────────────────────────────────
        'home_quick_1' : { file: 'fix-slow-laptop.bat',     label: '💻 Slow Laptop Fix'        },
        'home_quick_3' : { file: 'fix-bluescreen.bat',      label: '💙 Blue Screen Fix'        },
        'home_quick_4' : { file: 'fix-overheating.bat',     label: '🌡️ Overheating Fix'        },
        'home_quick_6' : { file: 'fix-black-screen.bat',    label: '🖥️ Black Screen Fix'       },
        'home_quick_7' : { file: 'fix-keyboard.bat',        label: '⌨️ Keyboard Fix'           },
        'home_quick_8' : { file: 'fix-touchpad.bat',        label: '🖱️ Touchpad Fix'           },
        'home_quick_21': { file: 'fix-freezing.bat',        label: '❄️ Freezing Fix'           },
        'home_quick_30': { file: 'fix-sudden-shutdown.bat', label: '⚡ Sudden Shutdown Fix'    },
        'home_quick_33': { file: 'fix-bluescreen.bat',      label: '🔁 Restart Loop Fix'       },
        'home_quick_38': { file: 'fix-fan-noise.bat',       label: '💨 Fan Noise Fix'          },
        'home_quick_39': { file: 'fix-screen-flicker.bat',  label: '📺 Screen Flicker Fix'     },
        'home_quick_40': { file: 'fix-bluetooth.bat',       label: '🔵 Bluetooth Fix'          },
        'home_quick_63': { file: 'fix-usb.bat',             label: '🔌 USB Fix'                },
        'home_quick_64': { file: 'fix-sleep-wake.bat',      label: '😴 Sleep/Wake Fix'         },
        'home_quick_65': { file: 'fix-bluescreen.bat',      label: '🚫 Boot Error Fix'         },
        'home_quick_66': { file: 'fix-touchscreen.bat',     label: '👆 Touchscreen Fix'        },
        'home_quick_67': { file: 'fix-hdmi.bat',            label: '🖥️ HDMI Fix'               },
        'home_quick_68': { file: 'fix-sdcard.bat',          label: '💳 SD Card Fix'            },
        'home_quick_69': { file: 'fix-fingerprint.bat',     label: '🔐 Fingerprint Fix'        },
        'home_quick_71': { file: 'fix-slow-laptop.bat',     label: '🐌 Post-Update Speed Fix'  },
        'home_quick_72': { file: 'fix-capslock.bat',        label: '🔡 Caps Lock Fix'          },
        // ── Internet & Network ────────────────────────────────────────────────
        'home_quick_11': { file: 'fix-wifi.bat',            label: '📶 WiFi Fix'               },
        'home_quick_26': { file: 'fix-wifi.bat',            label: '📡 Hotspot Fix'            },
        'home_quick_29': { file: 'fix-wifi.bat',            label: '🐢 Internet Speed Fix'     },
        'home_quick_44': { file: 'fix-wifi.bat',            label: '📶 WiFi Disconnect Fix'    },
        'home_quick_45': { file: 'fix-outlook.bat',         label: '📧 Email Fix'              },
        // ── Audio & Display ───────────────────────────────────────────────────
        'home_quick_9' : { file: 'fix-sound.bat',           label: '🔊 Sound Fix'              },
        'home_quick_16': { file: 'fix-mic.bat',             label: '🎤 Microphone Fix'         },
        'home_quick_17': { file: 'fix-hdmi.bat',            label: '🖥️ External Monitor Fix'   },
        'home_quick_20': { file: 'fix-camera.bat',          label: '📷 Camera Fix'             },
        'home_quick_28': { file: 'fix-sound.bat',           label: '🔇 Speaker Fix'            },
        'home_quick_46': { file: 'fix-headphone.bat',       label: '🎧 Headphone Fix'          },
        'home_quick_47': { file: 'fix-projector.bat',       label: '📽️ Projector Fix'          },
        'home_quick_48': { file: 'fix-resolution.bat',      label: '🖥️ Resolution Fix'         },
        'home_quick_49': { file: 'fix-video-call.bat',      label: '📹 Video Call Fix'         },
        // ── Software & Apps ───────────────────────────────────────────────────
        'home_quick_13': { file: 'fix-teams.bat',           label: '📹 Teams Fix'              },
        'home_quick_23': { file: 'fix-word-excel.bat',      label: '📄 Word/Excel Fix'         },
        'home_quick_24': { file: 'fix-windows-update.bat',  label: '🔄 Windows Update Fix'     },
        'home_quick_27': { file: 'fix-zoom.bat',            label: '🖥️ Zoom Fix'               },
        'home_quick_31': { file: 'fix-browser.bat',         label: '🌐 Browser Fix'            },
        'home_quick_34': { file: 'fix-clipboard.bat',       label: '📋 Copy-Paste Fix'         },
        'home_quick_35': { file: 'fix-datetime.bat',        label: '🕐 Date/Time Fix'          },
        'home_quick_50': { file: 'fix-outlook.bat',         label: '📧 Outlook Fix'            },
        'home_quick_51': { file: 'fix-onedrive.bat',        label: '☁️ OneDrive Fix'           },
        'home_quick_52': { file: 'fix-pdf.bat',             label: '📄 PDF Fix'                },
        'home_quick_53': { file: 'fix-app-crash.bat',       label: '💥 App Crash Fix'          },
        'home_quick_54': { file: 'fix-printer.bat',         label: '🖨️ Printer Fix'            },
        // ── Security & Storage ────────────────────────────────────────────────
        'home_quick_18': { file: 'fix-storage.bat',         label: '💾 Storage Cleanup'        },
        'home_quick_19': { file: 'fix-virus-scan.bat',      label: '🦠 Virus Scan'             },
        'home_quick_57': { file: 'fix-virus-scan.bat',      label: '🛡️ Antivirus Fix'          },
        'home_quick_58': { file: 'fix-onedrive.bat',        label: '☁️ OneDrive Storage Fix'   },
      };

      // ── Build Home Tab blocks (with collapsible categories) ───────────────
      const buildHomeBlocks = (emp, myTickets, expandedSet) => {
        const name     = emp?.name?.split(' ')[0] || 'Employee';
        const laptop   = emp?.laptop    || null;
        const laptopSN = emp?.laptopSN  || null;
        const dept     = emp?.department || null;
        const floor    = emp?.floor     || null;
        const openCnt  = myTickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;

        const statEmoji = { 'Open':'🟡', 'In Progress':'🔵', 'Resolved':'✅', 'Closed':'⚫' };
        const priEmoji2 = { 'Critical':'🔴', 'High':'🟠', 'Medium':'🟡', 'Low':'🟢' };

        const blocks = [
          { type:'header', text:{ type:'plain_text', text:'🛠️ WIOM IT Helpdesk', emoji:true }},
          { type:'section', text:{ type:'mrkdwn', text:`*Namaste ${name}!* 👋\nKoi bhi IT problem ho — neeche category dabao. AI turant jawab dega! 🤖\n_Tip: \`/ticket\` type karo seedha ticket banane ke liye_` }},
          ...(emp ? [{
            type:'section', fields:[
              { type:'mrkdwn', text:`🪪 *Emp ID:* \`${emp.empId}\`` },
              { type:'mrkdwn', text:`🏢 *Dept:* ${dept||'—'}` },
              { type:'mrkdwn', text:`💻 *Laptop:* ${laptop||'—'}` },
              { type:'mrkdwn', text:`🔢 *Serial No:* \`${laptopSN||'—'}\`` },
              { type:'mrkdwn', text:`🎫 *Open Tickets:* ${openCnt > 0 ? `*${openCnt}*` : '✅ None'}` }
            ]
          }] : []),
          { type:'divider' },
          { type:'section', text:{ type:'mrkdwn', text:'*🎫 Mera Last Ticket*' }},
          ...(myTickets.length === 0
            ? [{ type:'section', text:{ type:'mrkdwn', text:'✅ Koi ticket nahi — sab theek chal raha hai!' }}]
            : [{ type:'section', text:{ type:'mrkdwn', text:
                `${statEmoji[myTickets[0].status]||'🟡'} *${myTickets[0].ticketId}* — ${(myTickets[0].description||'').substring(0,50)}${(myTickets[0].description||'').length>50?'...':''}\n` +
                `${priEmoji2[myTickets[0].priority]||'🟡'} ${myTickets[0].priority} · ${myTickets[0].category||'Other'} · _${Math.floor((Date.now()-new Date(myTickets[0].createdAt))/3600000)}h ago_` +
                (myTickets[0].resolution ? `\n✅ *Resolved:* ${myTickets[0].resolution.substring(0,60)}` : '')
              }}]
          ),
          { type:'divider' },
          { type:'section', text:{ type:'mrkdwn', text:'*⚡ Quick Self-Service — category click karo to expand:*' }}
        ];

        for (const cat of CATEGORIES) {
          const isExpanded = expandedSet.has(cat.key);
          const arrow = isExpanded ? '▼' : '▶';
          blocks.push({
            type: 'actions',
            elements: [{
              type: 'button',
              text: { type: 'plain_text', text: `${arrow}  ${cat.label}`, emoji: true },
              action_id: `cat_toggle_${cat.key}`,
              value: cat.key
            }]
          });
          if (isExpanded) {
            for (const row of cat.rows) {
              blocks.push({
                type: 'actions',
                elements: row.map(btn => ({
                  type    : 'button',
                  text    : { type: 'plain_text', text: btn.text, emoji: true },
                  value   : btn.value,
                  action_id: btn.id,
                  ...(btn.style ? { style: btn.style } : {})
                }))
              });
            }
            blocks.push({ type: 'divider' });
          }
        }
        return blocks;
      };

      // ── FEATURE 5: Office hours check (IST = UTC+5:30) ────────────────────
      const isOfficeHours = () => {
        const now = new Date();
        const istMins = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
        const istHour = Math.floor(istMins / 60) % 24;
        return istHour >= 9 && istHour < 19; // 9AM–7PM IST
      };

      // ── FEATURE 2: Format reply for Slack mrkdwn ─────────────────────────
      const formatForSlack = (text) => {
        return text
          .replace(/\bStep (\d+):\s*/gi, '\n*Step $1:* ')  // Bold step numbers
          .replace(/^\n+/, '')                               // Remove leading newline
          .replace(/\n{3,}/g, '\n\n')                       // Max 2 blank lines
          .trim();
      };

      // ── FEATURE 1: Load/create MongoDB conversation session ───────────────
      const getSlackSession = async (slackUserId, emp) => {
        const cutoff = new Date(Date.now() - 24 * 3600000); // 24h window
        let conv = await Conversation.findOne({
          slackUserId,
          source  : 'slack',
          resolved: false,
          lastActive: { $gte: cutoff }
        }).sort({ lastActive: -1 });

        if (!conv) {
          conv = new Conversation({
            sessionId: `slack-${slackUserId}-${Date.now()}`,
            empId    : emp.empId,
            empName  : emp.empName,
            source   : 'slack',
            slackUserId,
            messages : []
          });
        }
        return conv;
      };

      // ── Employee lookup ───────────────────────────────────────────────────
      const lookupEmployee = async (slackUserId, client) => {
        try {
          let dbEmp = await Employee.findOne({ slackUserId });
          if (dbEmp) {
            return { empId: dbEmp.empId, empName: dbEmp.name, email: dbEmp.email,
                     dept: dbEmp.department, floor: dbEmp.floor,
                     laptop: dbEmp.laptop, laptopSN: dbEmp.laptopSN };
          }
          const profile = await client.users.info({ user: slackUserId });
          const email   = profile.user?.profile?.email;
          const name    = profile.user?.profile?.real_name || profile.user?.name;
          if (email)  dbEmp = await Employee.findOne({ email: email.toLowerCase() });
          if (!dbEmp && name) dbEmp = await Employee.findOne({ name: { $regex: name.split(' ')[0], $options: 'i' } });
          if (dbEmp) {
            dbEmp.slackUserId = slackUserId;
            await dbEmp.save();
            return { empId: dbEmp.empId, empName: dbEmp.name, email: dbEmp.email,
                     dept: dbEmp.department, floor: dbEmp.floor,
                     laptop: dbEmp.laptop, laptopSN: dbEmp.laptopSN };
          }
          return { empId: slackUserId, empName: name || 'Employee', email, dept: 'Unknown' };
        } catch {
          return { empId: slackUserId, empName: 'Employee', email: null, dept: 'Unknown' };
        }
      };

      // ── Notify admin ──────────────────────────────────────────────────────
      const notifyAdmin = async (client, ticket, emp) => {
        try {
          const adminId = process.env.ADMIN_EMAIL_SLACK_ID;
          if (!adminId || adminId === 'FILL_KARO') return;
          const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
          const priColor = { Critical:'#ef4444', High:'#f59e0b', Medium:'#3b82f6', Low:'#10b981' };
          await client.chat.postMessage({
            channel: adminId,
            text: `${priEmoji[ticket.priority]||'🟡'} Naya ticket: ${ticket.ticketId} — ${emp.empName}`,
            attachments: [{
              color: priColor[ticket.priority] || '#3b82f6',
              blocks: [
                { type:'section', fields:[
                  { type:'mrkdwn', text:`*🎫 Ticket ID*\n\`${ticket.ticketId}\`` },
                  { type:'mrkdwn', text:`*👤 Employee*\n${emp.empName}` },
                  { type:'mrkdwn', text:`*${priEmoji[ticket.priority]||'🟡'} Priority*\n${ticket.priority}` },
                  { type:'mrkdwn', text:`*📂 Category*\n${ticket.category||'Other'}` }
                ]},
                { type:'section', text:{ type:'mrkdwn', text:`*📝 Issue:*\n${ticket.description}` }},
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
            body   : JSON.stringify({ ...data, aiTried: true })
          });
          const json = await res.json();
          if (res.status === 409) return { _duplicate: true, ticket: json.ticket, message: json.message };
          return json.ticket;
        } catch { return null; }
      };

      // ── /helpdesk command ─────────────────────────────────────────────────
      slackApp.command('/helpdesk', async ({ command, ack, respond, client }) => {
        await ack();
        const userId = command.user_id;
        const text   = command.text?.trim() || '';

        if (!text) {
          await respond({ response_type: 'ephemeral', blocks:[
            { type:'section', text:{ type:'mrkdwn', text:'*🛠 WIOM IT Helpdesk*\nApni IT problem batao!\n\n*Examples:*\n• `/helpdesk wifi nahi chal raha`\n• `/helpdesk laptop slow hai`\n• `/helpdesk outlook nahi khul raha`\n\n_Apne tickets dekhne ke liye:_ `/helpdesk status`' }}
          ], text:'WIOM IT Helpdesk — apni problem batao' });
          return;
        }

        // ── /helpdesk status ────────────────────────────────────────────────
        if (text.toLowerCase() === 'status' || text.toLowerCase() === 'meri tickets') {
          const emp = await lookupEmployee(userId, client);
          const tickets = await Ticket.find({
            $or: [{ empId: emp.empId }, { slackUserId: userId }],
            status: { $nin: ['Closed'] }
          }).sort({ createdAt: -1 }).limit(5);

          if (!tickets.length) {
            await respond({ response_type: 'ephemeral', text: '🎉 Koi open ticket nahi hai! Sab kuch theek hai.' });
            return;
          }

          const priEmoji  = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
          const statEmoji = { Open:'⏳', 'In Progress':'🔄', Waiting:'⏸', Resolved:'✅', Closed:'🔒' };
          const blocks = [
            { type:'section', text:{ type:'mrkdwn', text:`*📋 Aapke Tickets (${tickets.length})*` }},
            { type:'divider' }
          ];
          tickets.forEach(t => {
            const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
            blocks.push({ type:'section', fields:[
              { type:'mrkdwn', text:`*\`${t.ticketId}\`*\n${priEmoji[t.priority]||'🟡'} ${t.priority}` },
              { type:'mrkdwn', text:`*${statEmoji[t.status]||'⏳'} ${t.status}*\n${hrs}h ago` }
            ]});
            blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`_${(t.description||'').substring(0,70)}..._` }]});
          });
          await respond({ response_type: 'ephemeral', text: `Aapke ${tickets.length} ticket(s)`, blocks });
          return;
        }

        await respond({ text: '🤖 _Soch raha hoon..._ ek second!', response_type: 'ephemeral' });

        const emp  = await lookupEmployee(userId, client);
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
              const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
              blocks.push({ type:'divider' });
              blocks.push({ type:'section', fields:[
                { type:'mrkdwn', text:`*✅ Ticket Bana:*\n\`${result.ticketId}\`` },
                { type:'mrkdwn', text:`*${priEmoji[result.priority]||'🟡'} Priority:*\n${result.priority}` }
              ]});
              blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team ko alert kar diya gaya 🙏` }]});
              await notifyAdmin(client, result, emp);
            }
          }

          await respond({ response_type: 'ephemeral', text: reply, blocks });
        } catch (err) {
          console.error('Slack /helpdesk error:', err.message);
          await respond({ text: '❌ Error aa gaya. Baad mein try karo.', response_type: 'ephemeral' });
        }
      });

      // ── /ticket command — Quick modal ticket creation ─────────────────────
      slackApp.command('/ticket', async ({ command, ack, client }) => {
        await ack();
        try {
          await client.views.open({
            trigger_id: command.trigger_id,
            view: {
              type       : 'modal',
              callback_id: 'ticket_modal',
              title  : { type:'plain_text', text:'🎫 Naya IT Ticket', emoji:true },
              submit : { type:'plain_text', text:'Ticket Banao ✅', emoji:true },
              close  : { type:'plain_text', text:'Cancel', emoji:true },
              blocks : [
                {
                  type    : 'input',
                  block_id: 'description_block',
                  label   : { type:'plain_text', text:'📝 Problem kya hai?', emoji:true },
                  element : {
                    type       : 'plain_text_input',
                    action_id  : 'description_input',
                    multiline  : true,
                    min_length : 10,
                    placeholder: { type:'plain_text', text:'Jaise: Laptop on nahi ho raha, WiFi nahi chal raha, Password bhool gaya...' }
                  }
                },
                {
                  type    : 'input',
                  block_id: 'category_block',
                  label   : { type:'plain_text', text:'📂 Category', emoji:true },
                  element : {
                    type       : 'static_select',
                    action_id  : 'category_input',
                    placeholder: { type:'plain_text', text:'Category select karo' },
                    options    : [
                      { text:{ type:'plain_text', text:'💻 Hardware — Laptop, keyboard, mouse, screen' }, value:'Hardware' },
                      { text:{ type:'plain_text', text:'💿 Software — App, Windows, Office' }, value:'Software' },
                      { text:{ type:'plain_text', text:'📶 Network — WiFi, internet, VPN' }, value:'Network' },
                      { text:{ type:'plain_text', text:'🔑 Account — Password, login, email' }, value:'Account' },
                      { text:{ type:'plain_text', text:'🛒 Purchase — New equipment request' }, value:'Purchase' },
                      { text:{ type:'plain_text', text:'❓ Other — Kuch aur' }, value:'Other' }
                    ]
                  }
                },
                {
                  type    : 'input',
                  block_id: 'priority_block',
                  label   : { type:'plain_text', text:'🚨 Kitna Urgent Hai?', emoji:true },
                  element : {
                    type          : 'static_select',
                    action_id     : 'priority_input',
                    initial_option: { text:{ type:'plain_text', text:'🟡 Medium — Normal problem' }, value:'Medium' },
                    options       : [
                      { text:{ type:'plain_text', text:'🔴 Critical — Kaam bilkul ruk gaya' }, value:'Critical' },
                      { text:{ type:'plain_text', text:'🟠 High — Bahut zaruri, jaldi chahiye' }, value:'High' },
                      { text:{ type:'plain_text', text:'🟡 Medium — Normal problem, chal sakta hai' }, value:'Medium' },
                      { text:{ type:'plain_text', text:'🟢 Low — Jab time mile tab theek karo' }, value:'Low' }
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
          const vals       = view.state.values;
          const description = vals.description_block.description_input.value;
          const category    = vals.category_block.category_input.selected_option?.value || 'Other';
          const priority    = vals.priority_block.priority_input.selected_option?.value || 'Medium';

          const emp = await lookupEmployee(userId, client);

          const result = await createTicketSlack({
            empId  : emp.empId,   empName : emp.empName, empEmail: emp.email,
            empDept: emp.dept,    empFloor: emp.floor,
            laptop : emp.laptop,  laptopSN: emp.laptopSN,
            description, category, priority,
            source: 'slack', slackUserId: userId
          });

          const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };

          if (result?._duplicate) {
            await client.chat.postMessage({
              channel: userId,
              text   : `⚠️ ${result.message}`
            });
          } else if (result) {
            await client.chat.postMessage({
              channel: userId,
              text   : `🎫 Ticket ${result.ticketId} create ho gaya!`,
              blocks : [
                { type:'header', text:{ type:'plain_text', text:'✅ Ticket Create Ho Gaya!', emoji:true }},
                { type:'section', fields:[
                  { type:'mrkdwn', text:`*🎫 Ticket ID:*\n\`${result.ticketId}\`` },
                  { type:'mrkdwn', text:`*${priEmoji[result.priority]||'🟡'} Priority:*\n${result.priority}` },
                  { type:'mrkdwn', text:`*📂 Category:*\n${result.category}` },
                  { type:'mrkdwn', text:`*⏳ Status:*\nOpen` }
                ]},
                { type:'section', text:{ type:'mrkdwn', text:`*📝 Problem:*\n${description}` }},
                { type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team ko notify kar diya gaya 🙏 | _App Home mein "Mere Tickets" section mein dekh sakte ho_` }]}
              ]
            });
            await notifyAdmin(client, result, emp);
            console.log(`🎫 Ticket ${result.ticketId} created via /ticket modal by ${emp.empName}`);
          }
        } catch (err) {
          console.error('/ticket modal submit error:', err.message);
          try {
            await client.chat.postMessage({
              channel: userId,
              text   : '❌ Ticket create karne mein error aaya. Dobara try karein ya call karein: *IT Helpdesk (Slack)*'
            });
          } catch {}
        }
      });

      // ── FEATURE 8: Rating action handler ─────────────────────────────────
      slackApp.action('rate_ticket', async ({ body, ack, client }) => {
        await ack();
        try {
          const value    = body.actions[0].value;          // "WIOM-TKT-0001:4"
          const [ticketId, ratingStr] = value.split(':');
          const rating   = parseInt(ratingStr);
          const userId   = body.user.id;

          await Ticket.findOneAndUpdate(
            { ticketId },
            { userRating: rating, userFeedback: `${rating}/5 stars via Slack` }
          );

          const stars     = '⭐'.repeat(rating);
          const ratingMsg = rating >= 4 ? 'Shukriya! Bahut accha feedback mila 😊'
                          : rating >= 3 ? 'Shukriya! Hum aur behtar karne ki koshish karenge 🙏'
                          : 'Shukriya! Hum is feedback ko improve karne mein use karenge 😔';

          await client.chat.update({
            channel: body.channel.id,
            ts     : body.message.ts,
            text   : `✅ Ticket ${ticketId} — Rating: ${stars}`,
            blocks : [
              { type:'section', text:{ type:'mrkdwn', text:
                `✅ *Ticket \`${ticketId}\` resolve ho gaya!*\n\n*Aapki Rating:* ${stars} (${rating}/5)\n${ratingMsg}`
              }},
              { type:'context', elements:[{ type:'mrkdwn', text:`IT Helpdesk: IT Helpdesk (Slack) | Koi aur problem ho toh batao!` }]}
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

      // ── DM category expand handlers (post sub-buttons on click) ──────────
      CATEGORIES.forEach(cat => {
        slackApp.action(`dm_cat_${cat.key}`, async ({ body, ack, client }) => {
          await ack();
          const userId = body.user.id;
          try {
            const catBlocks = [
              { type:'section', text:{ type:'mrkdwn', text:`> *${cat.label}*` }}
            ];
            for (const row of cat.rows) {
              catBlocks.push({
                type: 'actions',
                elements: row.map(btn => ({
                  type    : 'button',
                  text    : { type: 'plain_text', text: btn.text, emoji: true },
                  value   : btn.value,
                  action_id: btn.id,
                  ...(btn.style ? { style: btn.style } : {})
                }))
              });
            }
            await client.chat.postMessage({ channel: userId, text: cat.label, blocks: catBlocks });
          } catch (err) {
            console.error('dm_cat action error:', err.message);
          }
        });
      });

      // ── Hardware Replacement / Emergency special IDs ─────────────────────
      const HARDWARE_SPECIAL_IDS = new Set(['home_quick_37','home_quick_60','home_quick_61','home_quick_62','home_quick_70']);

      const buildHardwareBlocks = (actionId, emp) => {
        const isLiquid     = actionId === 'home_quick_70';
        const isLaptopRep  = actionId === 'home_quick_37';
        const isMouseRep   = actionId === 'home_quick_60';
        const isKeyboardRep= actionId === 'home_quick_61';
        const isMonitorRep = actionId === 'home_quick_62';

        const brand     = detectBrand(emp?.laptop);
        const brandInfo = getBrandInfo(brand, emp?.laptopSN);
        const model     = emp?.laptop   || 'Unknown';
        const sn        = emp?.laptopSN || 'Unknown';
        const blocks    = [];

        // ── Emergency alert (liquid damage) ────────────────────────────────
        if (isLiquid) {
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text:
              '🚨 *EMERGENCY — Turant yeh karo:*\n' +
              '1. *TURANT laptop band karo* — Power button 10 sec hold karo\n' +
              '2. Charger aur USB sab nikaalo\n' +
              '3. Laptop *ulta rakh do* (keyboard neeche)\n' +
              '4. *MAT chalaao* — circuit damage hoga\n' +
              '5. IT ko call karo: *IT Helpdesk (Slack)*'
            }
          });
          blocks.push({ type: 'divider' });
        }

        // ── Peripheral replacements (mouse/keyboard/monitor) ───────────────
        if (isMouseRep || isKeyboardRep || isMonitorRep) {
          const item = isMouseRep ? '🖱️ Mouse' : isKeyboardRep ? '⌨️ Keyboard' : '🖥️ Monitor';
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*${item} Replacement Request*\n\nIT team ko request bhej di jayegi. 1 working day mein replacement milegi.\n\nIT: *IT Helpdesk (Slack)* (9AM–7PM)` }
          });
          return blocks;
        }

        // ── Laptop info block (for laptop replacement + liquid damage) ─────
        blocks.push({
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*💻 Aapka Laptop:*\n${model}` },
            { type: 'mrkdwn', text: `*🔢 Serial No:*\n\`${sn}\`` },
            { type: 'mrkdwn', text: `*🏷️ Brand:*\n${brandInfo.brandLabel}` },
            { type: 'mrkdwn', text: `*📍 Floor:*\n${emp?.floor || '—'}` }
          ]
        });
        blocks.push({ type: 'divider' });

        // ── Apple MacBook — separate section ──────────────────────────────
        if (brandInfo.appleMode) {
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: '*🍎 Apple MacBook — Warranty Check:*\nAapka serial number se Apple coverage check karo:' }
          });
          blocks.push({
            type: 'actions',
            elements: [{ type:'button', text:{ type:'plain_text', text:'🔗 Apple Coverage Check', emoji:true }, url: brandInfo.warrantyUrl, action_id:`warranty_apple_${actionId}` }]
          });
          blocks.push({ type: 'divider' });
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text:
              '*🔍 Apple Diagnostics (Built-in — Free):*\n' +
              '1. MacBook *band karo*\n' +
              '2. Power button dabaao aur *hold karo* (startup options aane tak)\n' +
              '3. Screen par options aate hi *D key* dabaao\n' +
              '4. Diagnostics automatically start hogi ✅\n' +
              '_Result screen par dikhega — IT ko photo bhejo_'
            }
          });
          blocks.push({
            type: 'actions',
            elements: [{ type:'button', text:{ type:'plain_text', text:'🍎 Apple Support', emoji:true }, url: brandInfo.supportUrl, action_id:`apple_support_${actionId}` }]
          });
        } else {
          // ── Non-Apple: Warranty + Diagnostic Script ──────────────────────
          if (brandInfo.warrantyUrl) {
            blocks.push({
              type: 'section',
              text: { type: 'mrkdwn', text: `*🛡️ Warranty Check (${brandInfo.brandLabel}):*\nAapka serial number \`${sn}\` se warranty status check karo:` }
            });
            blocks.push({
              type: 'actions',
              elements: [{ type:'button', text:{ type:'plain_text', text:`🔗 ${brandInfo.brandLabel} Warranty Check`, emoji:true }, url: brandInfo.warrantyUrl, action_id:`warranty_${brand}_${actionId}` }]
            });
            blocks.push({ type: 'divider' });
          }
          if (brandInfo.diagScript) {
            blocks.push({
              type: 'section',
              text: { type: 'mrkdwn', text: `*🔍 Hardware Diagnostic (Auto-Run):*\nYe script download karo → double-click karo → automatically diagnostic tool chalega aur report dikhayega:` }
            });
            blocks.push({
              type: 'actions',
              elements: [{
                type:'button', text:{ type:'plain_text', text:`⬇️ ${brandInfo.diagLabel}`, emoji:true },
                style:'primary',
                url: `${PORTAL}/scripts/${brandInfo.diagScript}`,
                action_id: `diag_dl_${actionId}`
              }]
            });
            blocks.push({ type: 'divider' });
          }
        }

        // ── Ticket raise instruction (always at bottom) ────────────────────
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text:
            (isLiquid
              ? '⚠️ *IT team ko turant ticket raise ho rahi hai...*\n_Aap unhe call bhi karo: IT Helpdesk (Slack)_'
              : '*📋 Replacement ticket IT team ko jayega.*\n_1 working day mein respond karenge._\n_IT: IT Helpdesk (Slack) (9AM–7PM)_'
            )
          }
        });

        return blocks;
      };

      // ── Quick Action buttons from Home tab ────────────────────────────────
      const homeQuickActions = ['home_quick_1','home_quick_2','home_quick_3','home_quick_4','home_quick_5','home_quick_6','home_quick_7','home_quick_8','home_quick_9','home_quick_10','home_quick_11','home_quick_12','home_quick_13','home_quick_14','home_quick_15','home_quick_16','home_quick_17','home_quick_18','home_quick_19','home_quick_20','home_quick_21','home_quick_22','home_quick_23','home_quick_24','home_quick_25','home_quick_26','home_quick_27','home_quick_28','home_quick_29','home_quick_30','home_quick_31','home_quick_32','home_quick_33','home_quick_34','home_quick_35','home_quick_36','home_quick_37','home_quick_38','home_quick_39','home_quick_40','home_quick_41','home_quick_42','home_quick_43','home_quick_44','home_quick_45','home_quick_46','home_quick_47','home_quick_48','home_quick_49','home_quick_50','home_quick_51','home_quick_52','home_quick_53','home_quick_54','home_quick_55','home_quick_56','home_quick_57','home_quick_58','home_quick_59','home_quick_60','home_quick_61','home_quick_62','home_quick_63','home_quick_64','home_quick_65','home_quick_66','home_quick_67','home_quick_68','home_quick_69','home_quick_70','home_quick_71','home_quick_72','home_sos'];
      homeQuickActions.forEach(actionId => {
        slackApp.action(actionId, async ({ body, ack, client }) => {
          await ack();
          const userId   = body.user.id;
          const problem  = body.actions[0].value;
          try {
            const emp     = await Employee.findOne({ slackUserId: userId });
            const empInfo = {
              empId  : emp?.empId    || userId,
              empName: emp?.name     || 'Employee',
              source : 'slack',
              laptop : emp?.laptop,
              laptopSN: emp?.laptopSN,
              dept   : emp?.department,
              floor  : emp?.floor
            };

            // ── Hardware Replacement / Emergency — special flow ────────────
            if (HARDWARE_SPECIAL_IDS.has(actionId)) {
              const hwBlocks = buildHardwareBlocks(actionId, emp);
              await client.chat.postMessage({ channel: userId, text: '🔧 Hardware Request', blocks: hwBlocks });

              // Auto-create Critical ticket for liquid damage
              if (actionId === 'home_quick_70' && emp?.empId) {
                try {
                  const Ticket = require('./models/Ticket');
                  await Ticket.create({
                    empId      : emp.empId,
                    empName    : emp.name,
                    slackUserId: userId,
                    issue      : `🚨 EMERGENCY: Liquid/Water Damage — ${emp.laptop || 'Laptop'} (S/N: ${emp.laptopSN || 'Unknown'})`,
                    category   : 'Hardware',
                    priority   : 'Critical',
                    status     : 'Open',
                    source     : 'slack',
                    floor      : emp.floor,
                    department : emp.department
                  });
                } catch (ticketErr) {
                  console.error('Liquid damage ticket error:', ticketErr.message);
                }
              }
              return;
            }

            // ── Start a fresh conversation session and SAVE it ────────────
            // This ensures that when user says "nahi huaa", the DM handler
            // loads this session and Claude sees full history → no repeats.
            await Conversation.updateMany(
              { slackUserId: userId, source: 'slack', resolved: false },
              { resolved: true }
            );
            const conv = await getSlackSession(userId, empInfo);
            conv.messages.push({ role: 'user', content: problem });

            const claudeSvc = require('./services/claude');
            const { reply } = await claudeSvc.chat(conv.messages, empInfo);

            // Save both the user message and AI reply to MongoDB
            conv.messages.push({ role: 'assistant', content: reply });
            await conv.save();
            const formattedReply = formatForSlack(reply);

            const blocks = [{ type:'section', text:{ type:'mrkdwn', text: formattedReply }}];

            // ── One-Click Download Script (always shown for fixable problems) ──
            const scriptConfig = SCRIPT_MAP[actionId];
            if (scriptConfig) {
              const scriptUrl = `${PORTAL}/scripts/${scriptConfig.file}`;
              blocks.push({ type: 'divider' });
              blocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `*⚡ Ya ek click mein automatic fix karo:*\n_IT ka safe script hai — download karo, double-click karo, kaam ho jayega!_` }
              });
              blocks.push({
                type: 'actions',
                elements: [
                  {
                    type     : 'button',
                    text     : { type: 'plain_text', text: `⬇️ ${scriptConfig.label} — Auto Script`, emoji: true },
                    style    : 'primary',
                    url      : scriptUrl,
                    action_id: `dl_${actionId}`
                  }
                ]
              });
            }

            // ── Agent Auto-Fix button (only if agent registered + online) ────
            const fixConfig = AUTO_FIX_MAP[actionId];
            if (fixConfig && emp?.laptopSN && emp?.agentRegistered) {
              const isOnline = emp.agentLastSeen && (Date.now() - new Date(emp.agentLastSeen)) < 120000;
              if (isOnline) {
                const fixValue = `${fixConfig.fixType.join(',')}|${fixConfig.label}|${emp.laptopSN}`;
                blocks.push({
                  type: 'actions',
                  elements: [
                    {
                      type     : 'button',
                      text     : { type: 'plain_text', text: `⚡ IT Agent se Auto-Fix (Background)`, emoji: true },
                      action_id: 'autofix_request',
                      value    : fixValue,
                      confirm  : {
                        title  : { type: 'plain_text', text: 'Auto-Fix Confirm?' },
                        text   : { type: 'mrkdwn', text: `*${fixConfig.label}* automatically run hogi aapke laptop par silently.\n30 seconds mein result milega! 🔧` },
                        confirm: { type: 'plain_text', text: 'Haan, Fix Karo!' },
                        deny   : { type: 'plain_text', text: 'Nahi' }
                      }
                    }
                  ]
                });
              }
            }

            await client.chat.postMessage({ channel: userId, text: reply, blocks });
          } catch (err) {
            console.error('Home quick action error:', err.message);
          }
        });
      });

      // ── Auto-Fix request handler ──────────────────────────────────────────
      slackApp.action('autofix_request', async ({ body, ack, client }) => {
        await ack();
        const userId = body.user.id;
        const value  = body.actions[0].value;  // "fix_teams,fix_outlook|📧 Teams Fix|SN123"

        try {
          const [typesPart, label, laptopSN] = value.split('|');
          const fixType = typesPart.split(',').filter(Boolean);

          if (!laptopSN || !fixType.length) {
            await client.chat.postMessage({
              channel: userId,
              text   : '❌ Auto-fix config mein kuch issue hai. Manually steps try karo.'
            });
            return;
          }

          const emp = await Employee.findOne({ slackUserId: userId });
          if (!emp) {
            await client.chat.postMessage({
              channel: userId,
              text   : '❌ Employee record nahi mila. IT ko contact karo: IT Helpdesk (Slack)'
            });
            return;
          }

          // Create FixJob in DB
          const job = await FixJob.create({
            empId      : emp.empId,
            empName    : emp.name,
            laptopSN,
            fixType,
            fixLabel   : label || 'Auto Fix',
            status     : 'pending',
            slackUserId: userId
          });

          console.log(`⚡ Auto-fix job created: ${job._id} → ${fixType.join(',')} for ${emp.empId} (SN:${laptopSN})`);

          await client.chat.postMessage({
            channel: userId,
            text   : `⚡ ${label} shuru ho rahi hai...`,
            blocks : [
              { type: 'header', text: { type: 'plain_text', text: '⚡ Auto-Fix Shuru!', emoji: true }},
              { type: 'section', text: { type: 'mrkdwn', text:
                `*${label}* aapke laptop par automatically run ho rahi hai! 🔧\n\n` +
                `_Aapko kuch nahi karna — laptop par IT Agent kaam kar raha hai..._\n\n` +
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
              text   : '❌ Auto-fix shuru nahi ho saka. Manual steps try karo ya ticket raise karo.'
            });
          } catch {}
        }
      });

      // ── DM Handler ────────────────────────────────────────────────────────
      slackApp.message(async ({ message, client, say }) => {
        if (message.bot_id || message.subtype) return;
        const userId = message.user;
        const text   = message.text?.trim();
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
            await say({ text: `🔄 Theek hai ${firstName}! Nayi baat shuru karte hain. Aapki nai IT problem kya hai?` });
            return;
          }

          // ── FEATURE 7: Meri tickets command ──────────────────────────────
          const isTicketCheck = /^(meri tickets|my tickets|tickets dikhao|ticket status|mera ticket|open tickets|meri ticket)$/i.test(text.trim());
          if (isTicketCheck) {
            const tickets = await Ticket.find({
              $or: [{ empId: emp.empId }, { slackUserId: userId }],
              status: { $nin: ['Closed'] }
            }).sort({ createdAt: -1 }).limit(5);

            if (!tickets.length) {
              await say({ text: '🎉 *Koi open ticket nahi hai!* Sab kuch theek chal raha hai.' });
              return;
            }

            const priEmoji  = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
            const statEmoji = { Open:'⏳', 'In Progress':'🔄', Waiting:'⏸', Resolved:'✅', Closed:'🔒' };
            let ticketText  = `*📋 Aapke Open Tickets (${tickets.length}):*\n\n`;
            tickets.forEach(t => {
              const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
              ticketText += `${priEmoji[t.priority]||'🟡'} *\`${t.ticketId}\`* ${statEmoji[t.status]||'⏳'} ${t.status} — _${hrs}h pehle_\n`;
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
              text: `Hello ${firstName}! 👋 WIOM IT Helpdesk`,
              blocks: [
                { type:'section', text:{ type:'mrkdwn', text:`*Hello ${firstName}!* 👋\n_Apni IT problem category select karo:_` }},
                { type:'divider' },
                ...CATEGORIES.map(cat => ({
                  type: 'actions',
                  elements: [{
                    type    : 'button',
                    text    : { type: 'plain_text', text: cat.label, emoji: true },
                    action_id: `dm_cat_${cat.key}`,
                    value   : cat.key
                  }]
                }))
              ]
            });
            return;
          }

          // ── Laptop info query ─────────────────────────────────────────────
          const isLaptopQuery = /laptop|model|serial|s\/n|sn|serial no|asset|device/i.test(text.trim());
          if (isLaptopQuery) {
            const empRec = await Employee.findOne({ slackUserId: userId });
            const model  = empRec?.laptop   || emp.laptop   || null;
            const sn     = empRec?.laptopSN || emp.laptopSN || null;
            if (model || sn) {
              await say({
                text: `💻 Aapka Laptop: ${model||'—'} | SN: ${sn||'—'}`,
                blocks: [
                  { type:'section', fields:[
                    { type:'mrkdwn', text:`*💻 Laptop Model:*\n${model||'—'}` },
                    { type:'mrkdwn', text:`*🔢 Serial No:*\n\`${sn||'—'}\`` }
                  ]}
                ]
              });
              return;
            }
          }

          // ── "Ticket bana do" — instant creation ──────────────────────────
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
                const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
                await say({
                  text: `🎫 Ticket ${result.ticketId} ban gaya!`,
                  blocks: [
                    { type:'header', text:{ type:'plain_text', text:'✅ Ticket Created!', emoji:true }},
                    { type:'section', fields:[
                      { type:'mrkdwn', text:`*🎫 Ticket ID:*\n\`${result.ticketId}\`` },
                      { type:'mrkdwn', text:`*${priEmoji[result.priority]||'🟡'} Priority:*\n${result.priority}` },
                      { type:'mrkdwn', text:`*📂 Category:*\n${result.category||'Other'}` },
                      { type:'mrkdwn', text:`*⏳ Status:*\nOpen` }
                    ]},
                    { type:'section', text:{ type:'mrkdwn', text:`*📝 Problem:*\n${(result.description||'').substring(0,100)}` }},
                    { type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team ko notify kar diya gaya 🙏 | Status: *meri tickets* likh ke check karo` }]}
                  ]
                });
                await notifyAdmin(client, result, emp);
              }
            } else {
              // No context → ask for problem description
              await say({
                text: '🎫 Ticket banane ke liye `/ticket` command use karo — seedha modal khulega!',
                blocks: [
                  { type:'section', text:{ type:'mrkdwn', text:`*🎫 Ticket Banana Hai?*\n\nDo tarike hain:\n\n*1.* \`/ticket\` type karo → form bhar do → turant ticket ban jayega ✅\n*2.* Apni problem batao → AI steps dega → phir ticket automatically suggest karega 🤖` }},
                  { type:'context', elements:[{ type:'mrkdwn', text:`_Urgent hai? Call karo: *IT Helpdesk (Slack)*_` }]}
                ]
              });
            }
            return;
          }

          // ── Pending ticket confirmation check ─────────────────────────────
          const pending = pendingTickets.get(userId);
          if (pending) {
            // IMPORTANT: Must be exact short responses — "NAHI HUAA" must NOT trigger isNo
            // "nahi huaa", "nahi chala", "kaam nahi kiya" = failed attempt → goes to AI
            // "nahi", "na", "no" alone = user declining ticket → isNo
            const isYes = /^(ha|haan|haa|han|yes|bilkul|ok|bana do|create|kar do|ho jaye)\s*[!।.,]?\s*$/i.test(text.trim());
            const isNo  = /^(nahi|na|no|nope|mat|chodo|rehne do|band karo)\s*[!।.,]?\s*$/i.test(text.trim());

            if (isYes) {
              pendingTickets.delete(userId);
              const result = await createTicketSlack(pending);
              if (result?._duplicate) {
                await say({ text: `⚠️ ${result.message}` });
              } else if (result) {
                const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
                await say({
                  text: `🎫 Ticket ${result.ticketId} create ho gaya!`,
                  blocks: [
                    { type:'section', fields:[
                      { type:'mrkdwn', text:`*🎫 Ticket Bana!*\n\`${result.ticketId}\`` },
                      { type:'mrkdwn', text:`*${priEmoji[result.priority]||'🟡'} Priority*\n${result.priority}` }
                    ]},
                    { type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team ko notify kar diya gaya 🙏` }]}
                  ]
                });
                await notifyAdmin(client, result, emp);
              }
              return;
            }

            if (isNo) {
              pendingTickets.delete(userId);
              await say({ text: '👍 Theek hai! Koi aur problem ho toh batao.' });
              return;
            }
          }

          // ── "Aap karo" / "You do it" detection ─────────────────────────
          const isAapKaro = /\b(aap\s*(he|hi|karo|kar|kardo|krdo|khud|chalao|run|open)|tum\s*karo|khud\s*kar|agent\s*(se|karo|chalao)|auto.*fix|you\s*do\s*it|do\s*it\s*yourself|khud\s*(karo|kare|chalao))\b/i.test(text);
          if (isAapKaro) {
            const brand     = detectBrand(emp?.laptop);
            const brandInfo = getBrandInfo(brand, emp?.laptopSN);
            const isOnline  = emp?.agentRegistered && emp?.agentLastSeen
              && (Date.now() - new Date(emp.agentLastSeen)) < 120000;

            const aapKaroBlocks = [];

            if (isOnline && emp?.laptopSN) {
              // Agent online → create a FixJob for diagnostic
              const diagFixMap = { hp: 'run_hp_diag', dell: 'run_dell_diag', lenovo: 'run_lenovo_diag' };
              const diagFix    = diagFixMap[brand] || 'kill_heavy';
              const diagLabel  = brandInfo.diagScript
                ? `🔍 ${brandInfo.brandLabel} Diagnostic`
                : '💻 Auto Cleanup';
              await FixJob.create({
                empId: emp.empId, empName: emp.empName, laptopSN: emp.laptopSN,
                fixType: [diagFix], fixLabel: diagLabel,
                status: 'pending', slackUserId: userId
              });
              aapKaroBlocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text:
                  `⚡ *Chal raha hoon!* Agent aapke laptop par *${diagLabel}* run kar raha hai.\n_30-60 seconds mein result milega — wait karo!_ 🔍`
                }
              });
            } else {
              // Agent offline → show download script
              aapKaroBlocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text:
                  `🤖 *Script download karo → double-click karo → automatic chalega!*\n_IT ka safe script hai — bilkul ek click mein kaam ho jayega._`
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
                  elements: [{ type: 'mrkdwn', text: '_Is problem ke liye specific script nahi hai — ticket raise karo ya steps manually karo._' }]
                });
              }
            }

            await say({ text: '🤖 Auto-fix chal raha hai!', blocks: aapKaroBlocks });
            return;
          }

          // ── Normal AI chat ────────────────────────────────────────────────
          const conv = await getSlackSession(userId, emp);
          conv.messages.push({ role: 'user', content: text });
          // Trim to last 30 messages to keep DB lean
          if (conv.messages.length > 30) conv.messages = conv.messages.slice(-30);
          await conv.save();

          const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(
            conv.messages,
            { empId: emp.empId, empName: emp.empName, source: 'slack',
              laptop: emp.laptop, laptopSN: emp.laptopSN, dept: emp.dept, floor: emp.floor }
          );

          conv.messages.push({ role: 'assistant', content: reply });
          await conv.save();

          // ── FEATURE 2: Format for Slack ───────────────────────────────────
          const formattedReply = formatForSlack(reply);

          const blocks = [{ type:'section', text:{ type:'mrkdwn', text: formattedReply }}];

          if (shouldCreateTicket && ticketData) {
            pendingTickets.set(userId, {
              empId: emp.empId, empName: emp.empName, empEmail: emp.email,
              empDept: emp.dept, empFloor: emp.floor,
              laptop: emp.laptop, laptopSN: emp.laptopSN,
              ...ticketData,
              description: ticketData.description || text,
              source: 'slack', slackUserId: userId
            });
            blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`_Ticket banana hai? *"Ha"* ya *"Nahi"* reply karo_ 🎫` }]});
          }

          await say({ text: reply, blocks });

        } catch (err) {
          console.error('❌ DM handler error:', err.message);
          try {
            await say({ text: '❌ Kuch technical problem aa gayi. Thoda wait karein aur dobara try karein. IT Helpdesk: IT Helpdesk (Slack)' });
          } catch (sayErr) {
            console.error('❌ Could not send error message:', sayErr.message);
          }
        }
      });

      // ── Start Slack App ───────────────────────────────────────────────────
      slackApp.start().then(async () => {
        console.log('🤖 Slack Bot started! Socket Mode active.');
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

            const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
            let oldestText = '';
            oldest.forEach(t => {
              const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
              oldestText += `${priEmoji[t.priority]||'🟡'} \`${t.ticketId}\` — ${t.empName} _(${hrs}h pending)_\n`;
            });

            const dateStr = new Date().toLocaleDateString('en-IN', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              timeZone: 'Asia/Kolkata'
            });

            await slackApp.client.chat.postMessage({
              channel: adminId,
              text   : `📊 Good Morning! IT Helpdesk Daily Summary — ${dateStr}`,
              blocks : [
                { type:'header', text:{ type:'plain_text', text:`📊 IT Helpdesk — Daily Summary`, emoji:true }},
                { type:'context', elements:[{ type:'mrkdwn', text:`_${dateStr}_` }]},
                { type:'divider' },
                { type:'section', fields:[
                  { type:'mrkdwn', text:`*📬 Aaj Aaye*\n*${newToday}* tickets` },
                  { type:'mrkdwn', text:`*✅ Aaj Resolve*\n*${resolvedToday}* tickets` },
                  { type:'mrkdwn', text:`*⏳ Total Open*\n*${totalOpen}* tickets` },
                  { type:'mrkdwn', text:`*🔴 Critical Open*\n*${critical}*` },
                  { type:'mrkdwn', text:`*⚠️ SLA Breached*\n*${slaBreached}*` }
                ]},
                ...(oldestText ? [
                  { type:'divider' },
                  { type:'section', text:{ type:'mrkdwn', text:`*⏳ Sabse Purane Pending Tickets:*\n${oldestText}` }}
                ] : []),
                { type:'context', elements:[{ type:'mrkdwn', text:`_Aaj ki shuruat mubarak! IT Helpdesk: IT Helpdesk (Slack)_` }]}
              ]
            });
            console.log('📊 Daily summary sent to admin');
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
    console.log('⚠️  Slack tokens not configured — bot not started.');
  }
});

module.exports = app;
