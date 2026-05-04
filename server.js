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

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Connect Database ──────────────────────────────────────────────────────────
connectDB();

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet());
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

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status : 'ok',
    service: 'WIOM IT Helpdesk API',
    version: '1.0.0',
    time   : new Date().toISOString()
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

      const lookupEmployee = async (slackUserId, client) => {
        try {
          const profile = await client.users.info({ user: slackUserId });
          const email   = profile.user?.profile?.email;
          const name    = profile.user?.profile?.real_name || profile.user?.name;
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
          await client.chat.postMessage({
            channel: sajanId,
            text: `${priEmoji[ticket.priority]||'🟡'} *Naya Ticket: ${ticket.ticketId}*\n*Employee:* ${emp.empName}\n*Issue:* ${ticket.description}\n*Priority:* ${ticket.priority} | *SLA:* ${ticket.slaHours}h`
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
          return json.ticket;
        } catch { return null; }
      };

      // /helpdesk command
      slackApp.command('/helpdesk', async ({ command, ack, respond, client }) => {
        await ack();
        const userId = command.user_id;
        const text   = command.text?.trim() || '';

        if (!text) {
          await respond({ response_type: 'ephemeral', text: '🛠 *WIOM IT Helpdesk*\nApni problem batao:\n`/helpdesk wifi nahi chal raha`\n`/helpdesk outlook nahi khul raha`\n`/helpdesk laptop slow hai`' });
          return;
        }

        await respond({ text: '🤖 _Soch raha hoon..._ ek second!', response_type: 'ephemeral' });

        const emp = await lookupEmployee(userId, client);
        const sess = sessions[userId] || { messages: [] };
        const messages = [...(sess.messages || []), { role: 'user', content: text }];
        sessions[userId] = { ...emp, messages };

        try {
          const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(messages, { empId: emp.empId, empName: emp.empName, source: 'slack' });
          sessions[userId].messages = [...messages, { role: 'assistant', content: reply }];

          let responseText = `*🤖 WIOM IT Helpdesk*\n\n${reply}`;

          if (shouldCreateTicket && ticketData) {
            const ticket = await createTicketSlack({ ...emp, ...ticketData, description: ticketData.description || text, source: 'slack', slackUserId: userId });
            if (ticket) {
              responseText += `\n\n✅ *Ticket ${ticket.ticketId} create ho gaya!*\nSajan Kumar ko alert kar diya gaya. 🙏`;
              await notifySajan(client, ticket, emp);
            }
          }

          await respond({ response_type: 'ephemeral', text: responseText });
        } catch (err) {
          console.error('Slack error:', err.message);
          await respond({ text: '❌ Error aa gaya. Seedha Sajan se contact karo: 9654244281', response_type: 'ephemeral' });
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
        const messages = [...(sess.messages || []), { role: 'user', content: text }];
        sessions[userId] = { ...emp, messages };

        try {
          const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(messages, { empId: emp.empId, empName: emp.empName, source: 'slack' });
          sessions[userId].messages = [...messages, { role: 'assistant', content: reply }];
          await say({ text: reply, thread_ts: message.ts });

          if (shouldCreateTicket && ticketData) {
            const ticket = await createTicketSlack({ ...emp, ...ticketData, description: ticketData.description || text, source: 'slack', slackUserId: userId });
            if (ticket) {
              await say({ text: `🎫 *Ticket ${ticket.ticketId}* create ho gaya! Sajan ko alert kar diya. Priority: *${ticket.priority}*`, thread_ts: message.ts });
              await notifySajan(client, ticket, emp);
            }
          }
        } catch (err) {
          await say({ text: '❌ Kuch error aa gaya. Sajan se contact karo: 9654244281', thread_ts: message.ts });
        }
      });

      slackApp.start().then(() => {
        console.log('🤖 Slack Bot started! Socket Mode active.');
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
