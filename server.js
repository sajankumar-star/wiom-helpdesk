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
const slaService     = require('./services/sla');
const Ticket         = require('./models/Ticket');

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

// ── Auto-Escalation Cron: Every hour — Slack DM Sajan for 4h+ open tickets ──
cron.schedule('0 * * * *', async () => {
  try {
    const sajanId = process.env.SAJAN_SLACK_ID;
    if (!slackClient || !sajanId || sajanId === 'FILL_KARO') return;

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
          channel: sajanId,
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
    if (stale.length) console.log(`⚡ Escalated ${stale.length} tickets to Sajan`);
  } catch (err) {
    console.error('Escalation cron error:', err.message);
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

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 WIOM Helpdesk API running on port ${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health: http://localhost:${PORT}/health\n`);

  // ── Start Slack Bot (if tokens are configured) ─────────────────────────────
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_BOT_TOKEN !== 'FILL_KARO') {
    try {
      const { App } = require('@slack/bolt');
      const claudeSvc = require('./services/claude');
      const API_BASE  = process.env.API_BASE_URL || `http://localhost:${PORT}`;

      const slackApp = new App({
        token        : process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        socketMode   : true,
        appToken     : process.env.SLACK_APP_TOKEN
      });

      // Sessions store
      const sessions = {};

      const Employee = require('./models/Employee');

      const lookupEmployee = async (slackUserId, client) => {
        try {
          // 1️⃣ Try DB lookup by saved slackUserId (fastest)
          let dbEmp = await Employee.findOne({ slackUserId });
          if (dbEmp) {
            return { empId: dbEmp.empId, empName: dbEmp.name, email: dbEmp.email,
                     dept: dbEmp.department, floor: dbEmp.floor,
                     laptop: dbEmp.laptop, laptopSN: dbEmp.laptopSN };
          }

          // 2️⃣ Get Slack profile (name + email)
          const profile = await client.users.info({ user: slackUserId });
          const email   = profile.user?.profile?.email;
          const name    = profile.user?.profile?.real_name || profile.user?.name;

          // 3️⃣ Try DB lookup by email
          if (email) {
            dbEmp = await Employee.findOne({ email: email.toLowerCase() });
          }
          // 4️⃣ Try DB lookup by name (partial match)
          if (!dbEmp && name) {
            dbEmp = await Employee.findOne({ name: { $regex: name.split(' ')[0], $options: 'i' } });
          }

          if (dbEmp) {
            // Save Slack ID for future fast lookups
            dbEmp.slackUserId = slackUserId;
            await dbEmp.save();
            return { empId: dbEmp.empId, empName: dbEmp.name, email: dbEmp.email,
                     dept: dbEmp.department, floor: dbEmp.floor,
                     laptop: dbEmp.laptop, laptopSN: dbEmp.laptopSN };
          }

          // 5️⃣ Fallback — unknown employee
          return { empId: slackUserId, empName: name || 'Employee', email, dept: 'Unknown' };
        } catch {
          return { empId: slackUserId, empName: 'Employee', email: null, dept: 'Unknown' };
        }
      };

      const notifySajan = async (client, ticket, emp) => {
        try {
          const sajanId = process.env.SAJAN_SLACK_ID;
          if (!sajanId || sajanId === 'FILL_KARO') return;
          const priEmoji = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };
          const priColor = { Critical:'#ef4444', High:'#f59e0b', Medium:'#3b82f6', Low:'#10b981' };
          await client.chat.postMessage({
            channel: sajanId,
            text: `${priEmoji[ticket.priority]||'🟡'} Naya ticket: ${ticket.ticketId} — ${emp.empName}`,
            attachments: [{
              color: priColor[ticket.priority] || '#3b82f6',
              blocks: [
                { type:'section', fields:[
                  { type:'mrkdwn', text:`*🎫 Ticket ID*\n\`${ticket.ticketId}\`` },
                  { type:'mrkdwn', text:`*👤 Employee*\n${emp.empName}` },
                  { type:'mrkdwn', text:`*${priEmoji[ticket.priority]||'🟡'} Priority*\n${ticket.priority}` },
                  { type:'mrkdwn', text:`*⏱ SLA*\n${ticket.slaHours}h` }
                ]},
                { type:'section', text:{ type:'mrkdwn', text:`*📝 Issue:*\n${ticket.description}` }},
                { type:'context', elements:[{ type:'mrkdwn', text:`Category: ${ticket.category} | Source: ${ticket.source||'web'} | ${emp.dept||'Unknown Dept'}` }]}
              ]
            }]
          });
        } catch (err) {
          console.error('Sajan DM error:', err.message);
        }
      };

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

      // /helpdesk command
      slackApp.command('/helpdesk', async ({ command, ack, respond, client }) => {
        await ack();
        const userId = command.user_id;
        const text   = command.text?.trim() || '';

        if (!text) {
          await respond({ response_type: 'ephemeral', blocks:[
            { type:'section', text:{ type:'mrkdwn', text:'*🛠 WIOM IT Helpdesk*\nApni IT problem batao — main try karunga solve karne ki!\n\n*Examples:*\n• `/helpdesk wifi nahi chal raha`\n• `/helpdesk laptop slow hai`\n• `/helpdesk outlook nahi khul raha`\n\n_Apne tickets dekhne ke liye:_ `/helpdesk status`' }}
          ], text:'WIOM IT Helpdesk — apni problem batao' });
          return;
        }

        // ── /helpdesk status — show employee's open tickets ─────────────────
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
          const statEmoji = { Open:'⏳', 'In Progress':'🔄', Resolved:'✅', Closed:'🔒' };
          const blocks = [
            { type:'section', text:{ type:'mrkdwn', text:`*📋 Tere Tickets (${tickets.length})*` }},
            { type:'divider' }
          ];
          tickets.forEach(t => {
            const hrs = Math.round((Date.now() - new Date(t.createdAt)) / 3600000);
            blocks.push({ type:'section', fields:[
              { type:'mrkdwn', text:`*\`${t.ticketId}\`*\n${priEmoji[t.priority]||'🟡'} ${t.priority}` },
              { type:'mrkdwn', text:`*${statEmoji[t.status]||'⏳'} ${t.status}*\n${hrs}h ago` }
            ]});
            blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`${(t.description||'').substring(0,60)}...` }]});
          });
          await respond({ response_type: 'ephemeral', text: `Tere ${tickets.length} ticket(s)`, blocks });
          return;
        }

        await respond({ text: '🤖 _Soch raha hoon..._ ek second!', response_type: 'ephemeral' });

        const emp = await lookupEmployee(userId, client);
        const sess = sessions[userId] || { messages: [] };
        const messages = [...(sess.messages || []), { role: 'user', content: text }];
        sessions[userId] = { ...emp, messages };

        try {
          const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(messages, { empId: emp.empId, empName: emp.empName, source: 'slack', laptop: emp.laptop, laptopSN: emp.laptopSN, dept: emp.dept, floor: emp.floor });
          sessions[userId].messages = [...messages, { role: 'assistant', content: reply }];

          const blocks = [
            { type:'section', text:{ type:'mrkdwn', text: reply }}
          ];

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
              await notifySajan(client, result, emp);
            }
          }

          await respond({ response_type: 'ephemeral', text: reply, blocks });
        } catch (err) {
          console.error('Slack error:', err.message);
          await respond({ text: '❌ Error aa gaya. Baad mein try karo ya IT team se contact karo.', response_type: 'ephemeral' });
        }
      });

      // DM handler
      slackApp.message(async ({ message, client, say }) => {
        if (message.bot_id || message.subtype) return;
        const userId = message.user;
        const text   = message.text?.trim();
        if (!text) return;

        const emp  = await lookupEmployee(userId, client);
        const sess = sessions[userId] || { messages: [] };

        // ── Check if user is confirming/rejecting a pending ticket ────────────
        if (sess.pendingTicket) {
          const isYes = /^(ha|haan|haa|yes|bilkul|ok|theek hai|ticket|bana do|create|kar do|ho jaye)/i.test(text.trim());
          const isNo  = /^(nahi|na|no|nope|mat|band karo|chodo|rehne do)/i.test(text.trim());

          if (isYes) {
            const result = await createTicketSlack(sess.pendingTicket);
            delete sess.pendingTicket;
            sessions[userId] = sess;

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
              await notifySajan(client, result, emp);
            }
            return;
          }

          if (isNo) {
            delete sess.pendingTicket;
            sessions[userId] = sess;
            await say({ text: '👍 Theek hai! Koi aur problem ho toh batao.' });
            return;
          }
        }

        // ── Reset session on greeting — fresh start ───────────────────────────
        const isGreeting = /^(hello|hi|hey|namaste|hlo|hii|namaskar|good morning|good afternoon|good evening|salam|sup|helo)$/i.test(text.trim());
        if (isGreeting) {
          sessions[userId] = { ...emp, messages: [] };
          const firstName = (emp.empName || 'there').split(' ')[0];
          await say({ text: `Hello ${firstName}! 👋 WIOM IT Helpdesk mein aapka swagat hai. Aapki kya IT samasya hai? Batayein, main turant sahayata karunga.` });
          return;
        }

        // ── Normal AI chat ────────────────────────────────────────────────────
        const messages = [...(sess.messages || []), { role: 'user', content: text }];
        sessions[userId] = { ...sess, messages };

        try {
          const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(messages, { empId: emp.empId, empName: emp.empName, source: 'slack', laptop: emp.laptop, laptopSN: emp.laptopSN, dept: emp.dept, floor: emp.floor });
          sessions[userId].messages = [...messages, { role: 'assistant', content: reply }];

          const blocks = [{ type:'section', text:{ type:'mrkdwn', text: reply }}];

          // ── AI wants to create ticket — save as pending, ask user ────────────
          if (shouldCreateTicket && ticketData) {
            sessions[userId].pendingTicket = {
              empId: emp.empId, empName: emp.empName, empEmail: emp.email,
              empDept: emp.dept, empFloor: emp.floor,
              laptop: emp.laptop, laptopSN: emp.laptopSN,
              ...ticketData,
              description: ticketData.description || text,
              source: 'slack', slackUserId: userId
            };
            blocks.push({ type:'context', elements:[{ type:'mrkdwn', text:`_Ticket banana hai? *"Ha"* ya *"Nahi"* reply karo_ 🎫` }]});
          }

          await say({ text: reply, blocks }); // ← NO thread_ts — normal message

        } catch (err) {
          console.error('❌ DM handler error:', err.message);
          await say({ text: '❌ Kuch error aa gaya. Sajan se contact karo: 9654244281' });
        }
      });

      slackApp.start().then(async () => {
        console.log('🤖 Slack Bot started! Socket Mode active.');
        slackClient = slackApp.client;       // for escalation cron
        app.locals.slackClient = slackApp.client; // for routes (resolve DM)

        // Auto-link Sajan's Slack ID if configured
        const sajanSlackId = process.env.SAJAN_SLACK_ID;
        if (sajanSlackId && sajanSlackId !== 'FILL_KARO') {
          const Employee = require('./models/Employee');
          await Employee.findOneAndUpdate(
            { name: { $regex: 'sajan', $options: 'i' } },
            { slackUserId: sajanSlackId },
            { new: true }
          ).catch(() => {});
        }
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
