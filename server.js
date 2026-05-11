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
const slaService     = require('./services/sla');
const Ticket         = require('./models/Ticket');
const Conversation   = require('./models/Conversation');

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
    const adminId = process.env.SAJAN_SLACK_ID;
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
              `_IT team aapke ticket par kaam kar rahi hai 🙏 Jaldi solve ho jayega!_\nUrgent ho toh call karein: *9654244281*`
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
    const adminId = process.env.SAJAN_SLACK_ID;
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
        username    : 'sajan',
        passwordHash: process.env.ADMIN_PASSWORD || 'Wiom@2024',
        name        : 'Sajan Kumar',
        email       : 'sajan.kumar@wiom.in',
        role        : 'superadmin'
      });
      console.log('✅ Default admin created: sajan / Wiom@2024');
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
      const pendingTickets = new Map(); // slackUserId -> ticketData

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
          const adminId = process.env.SAJAN_SLACK_ID;
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
              text   : '❌ Ticket create karne mein error aaya. Dobara try karein ya call karein: *9654244281*'
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
              { type:'context', elements:[{ type:'mrkdwn', text:`IT Helpdesk: 9654244281 | Koi aur problem ho toh batao!` }]}
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
          const emp = await Employee.findOne({
            $or: [{ slackUserId: userId }, { empId: userId }]
          });
          const name      = emp?.name?.split(' ')[0] || 'Employee';
          const laptop    = emp?.laptop    || null;
          const laptopSN  = emp?.laptopSN  || null;
          const dept      = emp?.department || null;
          const floor     = emp?.floor     || null;

          // ── Open Tickets (last 10) ─────────────────────────────────────────
          let myTickets = [];
          if (emp?.empId) {
            myTickets = await Ticket.find({ empId: emp.empId })
              .sort({ createdAt: -1 }).limit(1).lean();
          }
          const openTickets = myTickets.filter(t => t.status === 'Open' || t.status === 'In Progress');

          const statusEmoji = { 'Open':'🟡', 'In Progress':'🔵', 'Resolved':'✅', 'Closed':'⚫' };
          const priEmoji2   = { 'Critical':'🔴', 'High':'🟠', 'Medium':'🟡', 'Low':'🟢' };

          const blocks = [
            // ── Header ──────────────────────────────────────────────────────
            {
              type: 'header',
              text: { type: 'plain_text', text: '🛠️ WIOM IT Helpdesk', emoji: true }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Namaste ${name}!* 👋\nKoi bhi IT problem ho — neeche button dabao ya DM karo. AI turant jawab dega! 🤖\n_Tip: \`/ticket\` type karo seedha ticket banane ke liye_` }
            },

            // ── Employee Info ────────────────────────────────────────────────
            ...(emp ? [{
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `🪪 *Emp ID:* \`${emp.empId}\`` },
                { type: 'mrkdwn', text: `🏢 *Dept:* ${dept || '—'}` },
                { type: 'mrkdwn', text: `💻 *Laptop:* ${laptop || '—'}` },
                { type: 'mrkdwn', text: `🔢 *Serial No:* \`${laptopSN || '—'}\`` },
                { type: 'mrkdwn', text: `🎫 *Open Tickets:* ${openTickets.length > 0 ? `*${openTickets.length}*` : '✅ None'}` }
              ]
            }] : []),

            { type: 'divider' },

            // ── #1 MERI TICKETS ───────────────────────────────────────────────
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*🎫 Mera Last Ticket*` }
            },
            ...(myTickets.length === 0 ? [{
              type: 'section',
              text: { type: 'mrkdwn', text: '✅ Koi ticket nahi — sab theek chal raha hai!' }
            }] : myTickets.slice(0,1).map(t => ({
              type: 'section',
              text: { type: 'mrkdwn', text:
                `${statusEmoji[t.status]||'🟡'} *${t.ticketId}* — ${(t.description||'').substring(0,50)}${(t.description||'').length>50?'...':''}\n` +
                `${priEmoji2[t.priority]||'🟡'} ${t.priority} · ${t.category||'Other'} · _${Math.floor((Date.now()-new Date(t.createdAt))/3600000)}h ago_` +
                (t.resolution ? `\n✅ *Resolved:* ${t.resolution.substring(0,60)}` : '')
              }
            }))),

            { type: 'divider' },

            // ── Quick Actions — Category-wise ────────────────────────────────
            { type:'section', text:{ type:'mrkdwn', text:'*⚡ Quick Self-Service — apni problem category se select karo:*' }},

            // ── 💻 LAPTOP HARDWARE ───────────────────────────────────────────
            { type:'section', text:{ type:'mrkdwn', text:'*💻 Laptop — Hardware*' }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'💻 Laptop Slow',    emoji:true }, value:'Laptop bahut slow hai, kya karun', action_id:'home_quick_1' },
              { type:'button', text:{ type:'plain_text', text:'💻 Laptop On Nahi', emoji:true }, value:'Laptop on nahi ho raha hai', action_id:'home_quick_2' },
              { type:'button', text:{ type:'plain_text', text:'💙 Blue Screen',    emoji:true }, value:'Blue screen of death aa raha hai', action_id:'home_quick_3' },
              { type:'button', text:{ type:'plain_text', text:'🌡️ Overheating',    emoji:true }, value:'Laptop bahut garam ho raha hai overheating', action_id:'home_quick_4' },
              { type:'button', text:{ type:'plain_text', text:'🔋 Battery Issue',  emoji:true }, value:'Laptop ki battery jaldi khatam ho rahi hai ya charge nahi ho rahi', action_id:'home_quick_5' }
            ]},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'🖥️ Screen Black',   emoji:true }, value:'Laptop screen black hai kuch nahi dikh raha', action_id:'home_quick_6' },
              { type:'button', text:{ type:'plain_text', text:'⌨️ Keyboard Issue', emoji:true }, value:'Laptop ki keyboard kaam nahi kar rahi kuch keys nahi chal rahi', action_id:'home_quick_7' },
              { type:'button', text:{ type:'plain_text', text:'🖱️ Mouse/Touchpad', emoji:true }, value:'Mouse ya touchpad kaam nahi kar raha', action_id:'home_quick_8' },
              { type:'button', text:{ type:'plain_text', text:'🔌 Charger Issue',  emoji:true }, value:'Laptop ka charger kaam nahi kar raha charge nahi ho raha', action_id:'home_quick_10' },
              { type:'button', text:{ type:'plain_text', text:'❄️ Laptop Hang',    emoji:true }, value:'Laptop hang ya freeze ho raha hai respond nahi kar raha', action_id:'home_quick_21' }
            ]},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'⚡ Sudden Shutdown', emoji:true }, value:'Laptop achanak band ho jaata hai shutdown ho jaata hai', action_id:'home_quick_30' },
              { type:'button', text:{ type:'plain_text', text:'🔁 Restart Loop',    emoji:true }, value:'Laptop restart loop mein hai baar baar restart ho raha hai', action_id:'home_quick_33' }
            ]},

            // ── 🌐 NETWORK / INTERNET ────────────────────────────────────────
            { type:'divider' },
            { type:'section', text:{ type:'mrkdwn', text:'*🌐 Network / Internet*' }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'📶 WiFi Issue',    emoji:true }, value:'WiFi nahi chal raha internet nahi hai', action_id:'home_quick_11' },
              { type:'button', text:{ type:'plain_text', text:'🐢 Slow Internet', emoji:true }, value:'Internet bahut slow chal raha hai speed kam hai', action_id:'home_quick_29' },
              { type:'button', text:{ type:'plain_text', text:'🔑 WiFi Password', emoji:true }, value:'WiFi ka password bhool gaya ya galat ho gaya', action_id:'home_quick_32' },
              { type:'button', text:{ type:'plain_text', text:'📡 Hotspot Issue', emoji:true }, value:'Mobile hotspot se laptop connect nahi ho raha', action_id:'home_quick_26' }
            ]},

            // ── 🎤 AUDIO / VIDEO / DISPLAY ───────────────────────────────────
            { type:'divider' },
            { type:'section', text:{ type:'mrkdwn', text:'*🎤 Audio / Video / Display*' }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'🔊 No Sound',       emoji:true }, value:'Laptop mein sound nahi aa rahi speaker kaam nahi kar raha', action_id:'home_quick_9' },
              { type:'button', text:{ type:'plain_text', text:'🔇 Speaker Issue',  emoji:true }, value:'Laptop ka speaker kaam nahi kar raha awaaz nahi aa rahi', action_id:'home_quick_28' },
              { type:'button', text:{ type:'plain_text', text:'🎤 Mic Issue',      emoji:true }, value:'Mic kaam nahi kar raha Teams ya calls mein awaaz nahi jaati', action_id:'home_quick_16' },
              { type:'button', text:{ type:'plain_text', text:'📷 Camera Nahi',    emoji:true }, value:'Laptop ki camera kaam nahi kar rahi Teams ya Zoom mein', action_id:'home_quick_20' },
              { type:'button', text:{ type:'plain_text', text:'🖥️ Monitor Issue',  emoji:true }, value:'External monitor detect nahi ho raha screen nahi aa rahi', action_id:'home_quick_17' }
            ]},

            // ── 💿 SOFTWARE / APPS ───────────────────────────────────────────
            { type:'divider' },
            { type:'section', text:{ type:'mrkdwn', text:'*💿 Software / Apps*' }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'📹 Teams',           emoji:true }, value:'Teams mein problem hai call drop ho raha hai', action_id:'home_quick_13' },
              { type:'button', text:{ type:'plain_text', text:'🖥️ Zoom Problem',    emoji:true }, value:'Zoom kaam nahi kar raha meeting join nahi ho rahi', action_id:'home_quick_27' },
              { type:'button', text:{ type:'plain_text', text:'📄 Word/Excel',      emoji:true }, value:'Microsoft Word ya Excel nahi khul raha error aa raha hai', action_id:'home_quick_23' },
              { type:'button', text:{ type:'plain_text', text:'🌐 Browser Crash',   emoji:true }, value:'Browser slow hai ya crash ho raha hai Chrome Firefox band ho jaata hai', action_id:'home_quick_31' },
              { type:'button', text:{ type:'plain_text', text:'🔄 Windows Update',  emoji:true }, value:'Windows update mein problem hai ya update stuck hai', action_id:'home_quick_24' }
            ]},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'🔐 Software Install', emoji:true }, value:'Naya software install karna hai permission chahiye', action_id:'home_quick_25' },
              { type:'button', text:{ type:'plain_text', text:'📋 Copy Paste Nahi',  emoji:true }, value:'Copy paste kaam nahi kar raha Ctrl+C Ctrl+V nahi chal raha', action_id:'home_quick_34' },
              { type:'button', text:{ type:'plain_text', text:'🕐 Date/Time Wrong',  emoji:true }, value:'Laptop ki date ya time galat dikh rahi hai', action_id:'home_quick_35' }
            ]},

            // ── 🔐 ACCOUNT / SECURITY / STORAGE ─────────────────────────────
            { type:'divider' },
            { type:'section', text:{ type:'mrkdwn', text:'*🔐 Account / Security / Storage*' }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'🔑 Password Reset', emoji:true }, value:'Password bhool gaya reset karna hai', action_id:'home_quick_14' },
              { type:'button', text:{ type:'plain_text', text:'💾 Storage Full',   emoji:true }, value:'Laptop ki storage full ho gayi C drive full hai', action_id:'home_quick_18' },
              { type:'button', text:{ type:'plain_text', text:'🦠 Virus/Slow PC',  emoji:true }, value:'Laptop mein virus lag gaya bahut slow hai ya ads aa rahe hain', action_id:'home_quick_19' },
              { type:'button', text:{ type:'plain_text', text:'🔗 Shared Drive',   emoji:true }, value:'Shared drive ya network folder access nahi ho raha', action_id:'home_quick_36' }
            ]},

            // ── 🔄 REPLACEMENT ───────────────────────────────────────────────
            { type:'divider' },
            { type:'section', text:{ type:'mrkdwn', text:'*🔄 Replacement / Upgrade*' }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'🔄 Laptop Replace', emoji:true }, value:'Laptop exchange ya replace karna hai purana kharab ho gaya', action_id:'home_quick_37', style:'danger' }
            ]}
          ];

          await client.views.publish({
            user_id: userId,
            view   : { type: 'home', blocks }
          });
        } catch (err) {
          console.error('App Home error:', err.message);
        }
      });

      // ── Quick Action buttons from Home tab ────────────────────────────────
      const homeQuickActions = ['home_quick_1','home_quick_2','home_quick_3','home_quick_4','home_quick_5','home_quick_6','home_quick_7','home_quick_8','home_quick_9','home_quick_10','home_quick_11','home_quick_12','home_quick_13','home_quick_14','home_quick_15','home_quick_16','home_quick_17','home_quick_18','home_quick_19','home_quick_20','home_quick_21','home_quick_22','home_quick_23','home_quick_24','home_quick_25','home_quick_26','home_quick_27','home_quick_28','home_quick_29','home_quick_30','home_quick_31','home_quick_32','home_quick_33','home_quick_34','home_quick_35','home_quick_36','home_quick_37','home_sos'];
      homeQuickActions.forEach(actionId => {
        slackApp.action(actionId, async ({ body, ack, client }) => {
          await ack();
          const userId  = body.user.id;
          const problem = body.actions[0].value;
          try {
            await client.chat.postMessage({
              channel: userId,
              text   : `You: ${problem}`,
              blocks : [{ type:'section', text:{ type:'mrkdwn', text:`📨 *Aapka message:* "${problem}"\n\n⏳ AI jawab de raha hai...` }}]
            });
            // Trigger same flow as DM
            const fakeReq = { body: { Body: problem, From: `slack:${userId}` } };
            const emp = await Employee.findOne({ slackUserId: userId });
            const empInfo = { empId: emp?.empId || userId, empName: emp?.name || 'Employee', source:'slack', laptop: emp?.laptop, laptopSN: emp?.laptopSN, dept: emp?.department, floor: emp?.floor };
            const claudeSvc = require('./services/claude');
            const { reply } = await claudeSvc.chat([{ role:'user', content: problem }], empInfo);
            await client.chat.postMessage({
              channel: userId,
              text   : reply,
              blocks : [{ type:'section', text:{ type:'mrkdwn', text: reply }}]
            });
          } catch (err) {
            console.error('Home quick action error:', err.message);
          }
        });
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
              { type:'context', elements:[{ type:'mrkdwn', text:`_Aur help chahiye to batao, ya call karein: 9654244281_` }]}
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
                // ── Welcome Header ─────────────────────────────────────────
                { type:'section', text:{ type:'mrkdwn', text:`*Hello ${firstName}!* 👋` }},
                { type:'divider' },

                // ── 💻 Laptop Hardware ─────────────────────────────────────
                { type:'section', text:{ type:'mrkdwn', text:'*💻 Laptop — Hardware*' }},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'💻 Laptop Slow',    emoji:true }, value:'Laptop bahut slow hai, kya karun', action_id:'home_quick_1' },
                  { type:'button', text:{ type:'plain_text', text:'💻 Laptop On Nahi', emoji:true }, value:'Laptop on nahi ho raha hai', action_id:'home_quick_2' },
                  { type:'button', text:{ type:'plain_text', text:'💙 Blue Screen',    emoji:true }, value:'Blue screen of death aa raha hai', action_id:'home_quick_3' },
                  { type:'button', text:{ type:'plain_text', text:'🌡️ Overheating',    emoji:true }, value:'Laptop bahut garam ho raha hai overheating', action_id:'home_quick_4' },
                  { type:'button', text:{ type:'plain_text', text:'🔋 Battery Issue',  emoji:true }, value:'Laptop ki battery jaldi khatam ho rahi hai ya charge nahi ho rahi', action_id:'home_quick_5' }
                ]},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'🖥️ Screen Black',   emoji:true }, value:'Laptop screen black hai kuch nahi dikh raha', action_id:'home_quick_6' },
                  { type:'button', text:{ type:'plain_text', text:'⌨️ Keyboard Issue', emoji:true }, value:'Laptop ki keyboard kaam nahi kar rahi', action_id:'home_quick_7' },
                  { type:'button', text:{ type:'plain_text', text:'🖱️ Mouse/Touchpad', emoji:true }, value:'Mouse ya touchpad kaam nahi kar raha', action_id:'home_quick_8' },
                  { type:'button', text:{ type:'plain_text', text:'🔌 Charger Issue',  emoji:true }, value:'Laptop ka charger kaam nahi kar raha', action_id:'home_quick_10' },
                  { type:'button', text:{ type:'plain_text', text:'❄️ Laptop Hang',    emoji:true }, value:'Laptop hang ya freeze ho raha hai', action_id:'home_quick_21' }
                ]},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'⚡ Sudden Shutdown', emoji:true }, value:'Laptop achanak band ho jaata hai', action_id:'home_quick_30' },
                  { type:'button', text:{ type:'plain_text', text:'🔁 Restart Loop',    emoji:true }, value:'Laptop restart loop mein hai baar baar restart ho raha hai', action_id:'home_quick_33' }
                ]},
                { type:'divider' },

                // ── 🌐 Network / Internet ──────────────────────────────────
                { type:'section', text:{ type:'mrkdwn', text:'*🌐 Network / Internet*' }},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'📶 WiFi Issue',    emoji:true }, value:'WiFi nahi chal raha internet nahi hai', action_id:'home_quick_11' },
                  { type:'button', text:{ type:'plain_text', text:'🐢 Slow Internet', emoji:true }, value:'Internet bahut slow chal raha hai', action_id:'home_quick_29' },
                  { type:'button', text:{ type:'plain_text', text:'🔑 WiFi Password', emoji:true }, value:'WiFi ka password bhool gaya ya galat ho gaya', action_id:'home_quick_32' },
                  { type:'button', text:{ type:'plain_text', text:'📡 Hotspot Issue', emoji:true }, value:'Mobile hotspot se laptop connect nahi ho raha', action_id:'home_quick_26' }
                ]},
                { type:'divider' },

                // ── 🎤 Audio / Video / Display ────────────────────────────
                { type:'section', text:{ type:'mrkdwn', text:'*🎤 Audio / Video / Display*' }},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'🔊 No Sound',      emoji:true }, value:'Laptop mein sound nahi aa rahi', action_id:'home_quick_9' },
                  { type:'button', text:{ type:'plain_text', text:'🔇 Speaker Issue', emoji:true }, value:'Laptop ka speaker kaam nahi kar raha', action_id:'home_quick_28' },
                  { type:'button', text:{ type:'plain_text', text:'🎤 Mic Issue',     emoji:true }, value:'Mic kaam nahi kar raha', action_id:'home_quick_16' },
                  { type:'button', text:{ type:'plain_text', text:'📷 Camera Nahi',   emoji:true }, value:'Laptop ki camera kaam nahi kar rahi', action_id:'home_quick_20' },
                  { type:'button', text:{ type:'plain_text', text:'🖥️ Monitor Issue', emoji:true }, value:'External monitor detect nahi ho raha', action_id:'home_quick_17' }
                ]},
                { type:'divider' },

                // ── 💿 Software / Apps ────────────────────────────────────
                { type:'section', text:{ type:'mrkdwn', text:'*💿 Software / Apps*' }},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'📹 Teams',          emoji:true }, value:'Teams mein problem hai call drop ho raha hai', action_id:'home_quick_13' },
                  { type:'button', text:{ type:'plain_text', text:'🖥️ Zoom Problem',   emoji:true }, value:'Zoom kaam nahi kar raha', action_id:'home_quick_27' },
                  { type:'button', text:{ type:'plain_text', text:'📄 Word/Excel',     emoji:true }, value:'Microsoft Word ya Excel nahi khul raha', action_id:'home_quick_23' },
                  { type:'button', text:{ type:'plain_text', text:'🌐 Browser Crash',  emoji:true }, value:'Browser slow hai ya crash ho raha hai', action_id:'home_quick_31' },
                  { type:'button', text:{ type:'plain_text', text:'🔄 Windows Update', emoji:true }, value:'Windows update mein problem hai', action_id:'home_quick_24' }
                ]},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'🔐 Software Install', emoji:true }, value:'Naya software install karna hai', action_id:'home_quick_25' },
                  { type:'button', text:{ type:'plain_text', text:'📋 Copy Paste Nahi',  emoji:true }, value:'Copy paste kaam nahi kar raha', action_id:'home_quick_34' },
                  { type:'button', text:{ type:'plain_text', text:'🕐 Date/Time Wrong',  emoji:true }, value:'Laptop ki date ya time galat dikh rahi hai', action_id:'home_quick_35' }
                ]},
                { type:'divider' },

                // ── 🔐 Account / Security / Storage ──────────────────────
                { type:'section', text:{ type:'mrkdwn', text:'*🔐 Account / Security / Storage*' }},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'🔑 Password Reset', emoji:true }, value:'Password bhool gaya reset karna hai', action_id:'home_quick_14' },
                  { type:'button', text:{ type:'plain_text', text:'💾 Storage Full',   emoji:true }, value:'Laptop ki storage full ho gayi C drive full hai', action_id:'home_quick_18' },
                  { type:'button', text:{ type:'plain_text', text:'🦠 Virus/Slow PC',  emoji:true }, value:'Laptop mein virus lag gaya', action_id:'home_quick_19' },
                  { type:'button', text:{ type:'plain_text', text:'🔗 Shared Drive',   emoji:true }, value:'Shared drive ya network folder access nahi ho raha', action_id:'home_quick_36' }
                ]},
                { type:'divider' },

                // ── 🔄 Replacement ────────────────────────────────────────
                { type:'section', text:{ type:'mrkdwn', text:'*🔄 Replacement / Upgrade*' }},
                { type:'actions', elements:[
                  { type:'button', text:{ type:'plain_text', text:'🔄 Laptop Replace', emoji:true }, value:'Laptop exchange ya replace karna hai purana kharab ho gaya', action_id:'home_quick_37', style:'danger' }
                ]}
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

          // ── Pending ticket confirmation check ─────────────────────────────
          const pending = pendingTickets.get(userId);
          if (pending) {
            const isYes = /^(ha|haan|haa|yes|bilkul|ok|theek hai|ticket|bana do|create|kar do|ho jaye)/i.test(text.trim());
            const isNo  = /^(nahi|na|no|nope|mat|band karo|chodo|rehne do)/i.test(text.trim());

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
                    { type:'context', elements:[{ type:'mrkdwn', text:`✅ IT team ko notify kar diya gaya 🙏 | Ticket track karne ke liye type karein: *meri tickets*` }]}
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

          // ── Normal AI chat ────────────────────────────────────────────────
          const conv = await getSlackSession(userId, emp);
          conv.messages.push({ role: 'user', content: text });
          // Trim to last 20 messages to keep DB lean
          if (conv.messages.length > 20) conv.messages = conv.messages.slice(-20);
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
            await say({ text: '❌ Kuch technical problem aa gayi. Thoda wait karein aur dobara try karein. IT Helpdesk: 9654244281' });
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
        const adminSlackId = process.env.SAJAN_SLACK_ID;
        if (adminSlackId && adminSlackId !== 'FILL_KARO') {
          await Employee.findOneAndUpdate(
            { name: { $regex: 'sajan', $options: 'i' } },
            { slackUserId: adminSlackId },
            { new: true }
          ).catch(() => {});
        }

        // ── FEATURE 6: Daily 9AM IST summary (= 03:30 UTC) ───────────────
        cron.schedule('30 3 * * *', async () => {
          try {
            const adminId = process.env.SAJAN_SLACK_ID;
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
                { type:'context', elements:[{ type:'mrkdwn', text:`_Aaj ki shuruat mubarak! IT Helpdesk: 9654244281_` }]}
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
