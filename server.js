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

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 WIOM Helpdesk API running on port ${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health: http://localhost:${PORT}/health\n`);

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
                  { type:'mrkdwn', text:`*⏱ SLA*\n${ticket.slaHours}h` }
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

          // ── Open Ticket count ──────────────────────────────────────────────
          let openCount = 0;
          if (emp?.empId) {
            openCount = await Ticket.countDocuments({ empId: emp.empId, status: { $in: ['Open','In Progress'] } });
          }

          const blocks = [
            // ── Header ──────────────────────────────────────────────────────
            {
              type: 'header',
              text: { type: 'plain_text', text: '🛠️ WIOM IT Helpdesk', emoji: true }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Namaste ${name}!* 👋  Aapka swagat hai WIOM IT Helpdesk mein.\n*Ghar Ka Net — Gurgaon Office Support*\n\nKoi bhi IT problem ho — DM karo ya neeche se quick action lo. 🤖` }
            },

            // ── Employee Info ────────────────────────────────────────────────
            ...(emp ? [{
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `🪪 *Emp ID:* \`${emp.empId}\`` },
                { type: 'mrkdwn', text: `🏢 *Dept:* ${dept || '—'}` },
                { type: 'mrkdwn', text: `💻 *Laptop:* ${laptop || '—'}` },
                { type: 'mrkdwn', text: `🔢 *Serial No:* \`${laptopSN || '—'}\`` },
                { type: 'mrkdwn', text: `🏠 *Floor:* ${floor || '—'}` },
                { type: 'mrkdwn', text: `🎫 *Open Tickets:* ${openCount > 0 ? `*${openCount}*` : '✅ None'}` }
              ]
            }] : []),

            { type: 'divider' },

            // ── Quick Actions ─────────────────────────────────────────────────
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '*⚡ Quick Self-Service — ek message karo:*' }
            },
            {
              type: 'actions',
              elements: [
                { type:'button', text:{ type:'plain_text', text:'💻 Laptop Slow', emoji:true }, value:'laptop slow hai', action_id:'home_quick_1' },
                { type:'button', text:{ type:'plain_text', text:'📶 WiFi Issue', emoji:true  }, value:'WiFi nahi chal raha', action_id:'home_quick_2' },
                { type:'button', text:{ type:'plain_text', text:'📧 Outlook', emoji:true     }, value:'Outlook nahi khul raha', action_id:'home_quick_3' },
                { type:'button', text:{ type:'plain_text', text:'📹 Teams', emoji:true       }, value:'Teams call drop ho raha hai', action_id:'home_quick_4' },
                { type:'button', text:{ type:'plain_text', text:'🔑 Password', emoji:true    }, value:'Password reset karna hai', action_id:'home_quick_5' }
              ]
            },
            {
              type: 'actions',
              elements: [
                { type:'button', text:{ type:'plain_text', text:'🖨️ Printer', emoji:true      }, value:'Printer nahi chal raha', action_id:'home_quick_6' },
                { type:'button', text:{ type:'plain_text', text:'💙 Blue Screen', emoji:true  }, value:'Blue screen aa raha hai', action_id:'home_quick_7' },
                { type:'button', text:{ type:'plain_text', text:'🌡️ Overheating', emoji:true  }, value:'Laptop overheating hai', action_id:'home_quick_8' },
                { type:'button', text:{ type:'plain_text', text:'🔇 Mic Issue', emoji:true    }, value:'Mic nahi chal raha Teams mein', action_id:'home_quick_9' },
                { type:'button', text:{ type:'plain_text', text:'🆘 Emergency', emoji:true }, style:'danger', value:'emergency it help chahiye', action_id:'home_sos' }
              ]
            },

            { type: 'divider' },

            // ── IT Tips ───────────────────────────────────────────────────────
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '*📋 IT Best Practices — Zaroori Tips (Must Follow)*' }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text:
                '🔒 *Security*\n' +
                '• `#1` Lock screen when away — *Win + L* press karo\n' +
                '• `#2` Password 12+ characters, special symbols daalo\n' +
                '• `#3` Public WiFi pe company kaam mat karo (cafe, train, hotel)\n' +
                '• `#4` Suspicious email links pe click mat karo — phishing ho sakta hai\n' +
                '• `#5` Company data personal WhatsApp/email pe share mat karo\n' +
                '• `#6` Unauthorized software install mat karo — IT se request karo'
              }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text:
                '💻 *Laptop Care*\n' +
                '• `#7` Laptop hamesha bag mein le jaao — haath mein nahi\n' +
                '• `#8` Charger/USB cable seedha nikalo — angle se nahi (port damage hoti hai)\n' +
                '• `#9` Keyboard aur screen monthly saaf karo — microfiber cloth se\n' +
                '• `#10` Power mode: *Balanced* use karo — High Performance nahi\n' +
                '• `#11` Screen timeout 5 minutes set karo: Settings → Power & Sleep'
              }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text:
                '📁 *Data & Performance*\n' +
                '• `#12` Important files *OneDrive* pe save karo — sirf Desktop pe nahi (crash hone pe sab kho jaata hai)\n' +
                '• `#13` Laptop din mein ek baar restart karo — 80% slowness issues fix ho jaate hain\n' +
                '• `#14` IT issues same day report karo — der karne se choti problem badi ho jaati hai\n' +
                '• `#15` Software install ke liye IT se bolo — manager approval ke baad admin password milega'
              }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text:
                '📧 *Email & Communication*\n' +
                '• `#16` Company email se hi official kaam karo — Gmail nahi\n' +
                '• `#17` Email mein OTP, password, payment links pe click mat karo\n' +
                '• `#18` IT/HR se aaya bhi email lage to pehle call karke verify karo\n' +
                '• `#19` Teams pe meetings join karte waqt earphones use karo — noise reduce hoti hai'
              }
            },

            { type: 'divider' },

            // ── Self-Fix Guide ─────────────────────────────────────────────────
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '*🔧 Common Problems — Pehle Ye Try Karo*' }
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: '*💻 Laptop Slow?*\nTask Manager → CPU/RAM dekho → Chrome tabs band karo → Restart' },
                { type: 'mrkdwn', text: '*📶 WiFi Nahi?*\nWiFi off/on karo → Airplane mode on/off → Restart' },
                { type: 'mrkdwn', text: '*💻 Laptop On Nahi?*\nCharger lagao → 5 min wait → Power button ek baar press' },
                { type: 'mrkdwn', text: '*🌐 Internet Nahi (WiFi hai)?*\nCMD → `ipconfig /flushdns` → Browser restart' },
                { type: 'mrkdwn', text: '*📧 Outlook Error?*\nOutlook → File → Account Settings → Repair karo' },
                { type: 'mrkdwn', text: '*📹 Teams Audio/Video?*\nSettings → Devices → Correct mic/camera select karo' }
              ]
            },

            { type: 'divider' },

            // ── Contact ───────────────────────────────────────────────────────
            {
              type: 'section',
              text: { type: 'mrkdwn', text:
                '*📞 IT Team Contact*\n' +
                '👤 *Sajan Kumar* — IT Admin\n' +
                '📱 *9654244281*\n' +
                '📧 sajan.kumar@wiom.in\n' +
                '⏰ Mon–Sat, 9AM–7PM IST\n\n' +
                '_Koi bhi problem ho — is app ko DM karo! AI turant jawab dega. 🤖_'
              }
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `🔄 Last updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST  |  WIOM Internet Services — IT Department` }]
            }
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
      const homeQuickActions = ['home_quick_1','home_quick_2','home_quick_3','home_quick_4','home_quick_5','home_quick_6','home_quick_7','home_quick_8','home_quick_9','home_sos'];
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
            const firstName  = (emp.empName || 'there').split(' ')[0];
            const laptopInfo = emp.laptop
              ? `\n💻 *Aapka Laptop:* ${emp.laptop}${emp.laptopSN ? ` | *S/N:* ${emp.laptopSN}` : ''}`
              : '';
            await say({
              text: `Hello ${firstName}! 👋`,
              blocks: [
                { type:'section', text:{ type:'mrkdwn', text:
                  `Hello *${firstName}!* 👋 WIOM IT Helpdesk mein aapka swagat hai.${laptopInfo}\n\nAapki kya IT samasya hai? Batayein, main madad karunga.`
                }},
                { type:'context', elements:[{ type:'mrkdwn', text:`_Type "meri tickets" apne tickets dekhne ke liye | "reset" nayi baat shuru karne ke liye_` }]}
              ]
            });
            return;
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
