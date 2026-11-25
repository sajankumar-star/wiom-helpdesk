require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { App }  = require('@slack/bolt');
const axios    = require('axios') || require('https');
const claudeSvc= require('../services/claude');
const emailSvc = require('../services/email');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';

// ── Gatekeeper shadow-classify (TEST mode — sirf log, bot ka reply NAHI badalta) ──
const { classify: classifyIssue } = require('../services/classifyIssue');
const GK_SLACK_LOG = String(process.env.GATEKEEPER_SLACK_LOG || process.env.GATEKEEPER_ENABLED || 'false') === 'true';
const shadowClassify = async (text, source) => {
  if (!GK_SLACK_LOG || !text) return;
  try {
    const r = await classifyIssue(text);
    console.log(`🔎 [Gatekeeper/Slack ${source}] ${r.isIT ? 'IT' : 'NON-IT'} (${r.category}, conf ${r.confidence.toFixed(2)}, via ${r.via}) — "${String(text).slice(0, 60)}"`);
  } catch (e) {
    console.warn('[Gatekeeper/Slack] classify fail:', e.message);
  }
};

// â”€â”€ Init Slack Bolt App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const app = new App({
  token        : process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode   : true,                              // No public URL needed!
  appToken     : process.env.SLACK_APP_TOKEN        // xapp-... token
});

// â”€â”€ In-memory session store (per Slack user) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const sessions = {};   // { slackUserId: { sessionId, empId, empName, messages[] } }

const getSession = (userId) => sessions[userId] || null;

const setSession = (userId, data) => {
  sessions[userId] = { ...sessions[userId], ...data };
};

// â”€â”€ Helper: Lookup employee by Slack user ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const lookupEmployee = async (slackUserId, client) => {
  try {
    // Get Slack profile
    const profile = await client.users.info({ user: slackUserId });
    const email   = profile.user?.profile?.email;
    const name    = profile.user?.profile?.real_name || profile.user?.name;

    // Try to find in DB by email
    const res = await fetch(`${API_BASE}/api/employees?search=${encodeURIComponent(email || '')}`);
    const data = await res.json();

    if (data.employees?.length) {
      const emp = data.employees[0];
      return { empId: emp.empId, empName: emp.name, email: emp.email, dept: emp.department };
    }

    // Fallback: use Slack name as employee name
    return { empId: slackUserId, empName: name, email, dept: 'Unknown' };
  } catch {
    return { empId: slackUserId, empName: 'Employee', email: null, dept: 'Unknown' };
  }
};

// â”€â”€ /helpdesk Slash Command â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.command('/helpdesk', async ({ command, ack, client, respond }) => {
  await ack();

  const userId  = command.user_id;
  const text    = command.text?.trim() || '';

  // /helpdesk reset â€” clear session
  if (text === 'reset') {
    delete sessions[userId];
    await respond({ text: 'ðŸ”„ Session reset! Ab nayi baat shuru karo.', response_type: 'ephemeral' });
    return;
  }

  // /helpdesk status â€” show my tickets
  if (text === 'status') {
    const session = getSession(userId);
    if (!session?.empId) {
      await respond({ text: 'âŒ Pehle koi problem batao: `/helpdesk wifi nahi chal raha`', response_type: 'ephemeral' });
      return;
    }
    await showMyTickets(userId, session.empId, respond, client);
    return;
  }

  // /helpdesk â€” no text
  if (!text) {
    await respond({
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*ðŸ›  WIOM IT Helpdesk* â€” Namaste!\n\nAapki problem batao, main solve karne ki koshish karoonga:\n\n`/helpdesk wifi nahi chal raha`\n`/helpdesk outlook open nahi ho raha`\n`/helpdesk laptop bahut slow hai`\n`/helpdesk printer kaam nahi kar raha`\n\n*Other commands:*\n`/helpdesk status` â€” Mere tickets dekho\n`/helpdesk reset` â€” Nayi baat shuru karo'
          }
        }
      ]
    });
    return;
  }

  // Shadow classify (test mode — sirf log)
  shadowClassify(text, 'cmd');

  // Show typing indicator
  await respond({ text: 'ðŸ¤– _Soch raha hoon... ek second..._', response_type: 'ephemeral' });

  // Lookup employee
  const emp = await lookupEmployee(userId, client);
  const session = getSession(userId) || { messages: [], sessionId: `slack-${userId}-${Date.now()}` };
  setSession(userId, { ...emp, sessionId: session.sessionId, messages: session.messages || [] });

  // Add user message to history
  const messages = [...(session.messages || []), { role: 'user', content: text }];
  setSession(userId, { messages });

  try {
    // Call Claude AI
    const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(
      messages,
      { empId: emp.empId, empName: emp.empName, source: 'slack' }
    );

    // Add assistant reply to history
    const updatedMessages = [...messages, { role: 'assistant', content: reply }];
    setSession(userId, { messages: updatedMessages });

    // Build response blocks
    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*ðŸ¤– WIOM IT Helpdesk*\n\n${reply}` }
      }
    ];

    // If ticket should be created
    if (shouldCreateTicket && ticketData) {
      const ticketRes = await createTicket({
        empId          : emp.empId,
        empName        : emp.empName,
        empEmail       : emp.email,
        empDept        : emp.dept,
        slackUserId    : userId,
        slackChannelId : command.channel_id,
        category       : ticketData.category,
        priority       : ticketData.priority,
        description    : ticketData.description || text,
        aiSteps        : ticketData.steps || [],
        source         : 'slack'
      });

      if (ticketRes) {
        blocks.push({ type: 'divider' });
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `âœ… *Ticket Create Ho Gaya!*\n` +
                  `ðŸŽ« *ID:* \`${ticketRes.ticketId}\`\n` +
                  `ðŸ“‹ *Category:* ${ticketRes.category}\n` +
                  `ðŸ”´ *Priority:* ${ticketRes.priority}\n` +
                  `â± *SLA:* ${ticketRes.slaHours} hours\n\n` +
                  `ADMIN_EMAIL Kumar ko alert kar diya gaya hai. Woh jald hi aapki madad karenge! ðŸ™`
          }
        });
        // Send ADMIN_EMAIL a DM alert
        await notifyADMIN_EMAIL(client, ticketRes, emp, command.channel_id);
      }
    } else {
      // Add quick action buttons
      blocks.push({ type: 'divider' });
      blocks.push({
        type    : 'actions',
        elements: [
          {
            type     : 'button',
            text     : { type: 'plain_text', text: 'âœ… Problem solve ho gayi' },
            style    : 'primary',
            action_id: 'resolved_self',
            value    : JSON.stringify({ userId, ticketId: null })
          },
          {
            type     : 'button',
            text     : { type: 'plain_text', text: 'ðŸŽ« Ticket Raise Karo' },
            style    : 'danger',
            action_id: 'raise_ticket',
            value    : JSON.stringify({ userId, issue: text, empId: emp.empId, empName: emp.empName })
          }
        ]
      });
    }

    await respond({ response_type: 'ephemeral', blocks });

  } catch (err) {
    console.error('Slack /helpdesk error:', err);
    await respond({
      text         : 'âŒ Kuch error aa gaya. IT Helpdesk se Slack pe contact karo',
      response_type: 'ephemeral'
    });
  }
});

// â”€â”€ Button: Problem Resolved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.action('resolved_self', async ({ ack, body, respond }) => {
  await ack();
  const userId = body.user.id;
  delete sessions[userId]; // Clear session

  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    text: 'ðŸŽ‰ *Bahut badiya!* Problem solve ho gayi. Agar koi aur problem ho toh `/helpdesk` type karo. Have a productive day! ðŸ’ª'
  });
});

// â”€â”€ Button: Raise Ticket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.action('raise_ticket', async ({ ack, body, respond, client }) => {
  await ack();

  let data = {};
  try { data = JSON.parse(body.actions[0].value); } catch {}

  const { userId, issue, empId, empName } = data;
  const emp = getSession(userId) || {};

  await respond({ text: '_Ticket create ho raha hai..._', response_type: 'ephemeral' });

  const ticket = await createTicket({
    empId  : empId || emp.empId || userId,
    empName: empName || emp.empName || 'Employee',
    empEmail: emp.email,
    empDept: emp.dept,
    slackUserId: userId,
    slackChannelId: body.channel?.id,
    description: issue || 'IT Issue â€” reported via Slack',
    category: 'Other',
    priority: 'Medium',
    source  : 'slack',
    aiSteps : emp.messages
      ?.filter(m => m.role === 'assistant')
      .map(m => m.content.substring(0, 100)) || []
  });

  if (ticket) {
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: `âœ… *Ticket ${ticket.ticketId} create ho gaya!*\nADMIN_EMAIL Kumar ko alert kar diya. Woh jald aapki madad karenge. ðŸ™`
    });
    await notifyADMIN_EMAIL(client, ticket, { empId, empName }, body.channel?.id);
  }
});

// â”€â”€ DM: Any direct message to bot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.message(async ({ message, client, say }) => {
  if (message.bot_id || message.subtype) return; // Skip bot messages

  const userId = message.user;
  const text   = message.text?.trim();
  if (!text) return;

  // Shadow classify (test mode — sirf log)
  shadowClassify(text, 'dm');

  const emp     = await lookupEmployee(userId, client);
  const session = getSession(userId) || { messages: [], sessionId: `slack-dm-${userId}-${Date.now()}` };
  setSession(userId, { ...emp, sessionId: session.sessionId, messages: session.messages });

  const messages = [...(session.messages || []), { role: 'user', content: text }];
  setSession(userId, { messages });

  try {
    const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(
      messages,
      { empId: emp.empId, empName: emp.empName, source: 'slack' }
    );

    setSession(userId, { messages: [...messages, { role: 'assistant', content: reply }] });

    await say({ text: reply, thread_ts: message.ts });

    if (shouldCreateTicket && ticketData) {
      const ticket = await createTicket({
        empId   : emp.empId, empName: emp.empName, empEmail: emp.email,
        slackUserId: userId, category: ticketData.category,
        priority: ticketData.priority, description: ticketData.description || text,
        aiSteps : ticketData.steps, source: 'slack'
      });
      if (ticket) {
        await say({
          text     : `ðŸŽ« *Ticket ${ticket.ticketId}* create ho gaya! ADMIN_EMAIL ko alert kar diya. Priority: *${ticket.priority}*, SLA: *${ticket.slaHours}h*`,
          thread_ts: message.ts
        });
        await notifyADMIN_EMAIL(client, ticket, emp, message.channel);
      }
    }
  } catch (err) {
    console.error('DM handler error:', err);
    await say({ text: 'âŒ Kuch error aa gaya. IT Helpdesk se Slack pe contact karo', thread_ts: message.ts });
  }
});

// â”€â”€ Helper: Create ticket via API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const createTicket = async (data) => {
  try {
    const res = await fetch(`${API_BASE}/api/tickets`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ ...data, aiTried: true })
    });
    const json = await res.json();
    return json.ticket;
  } catch (err) {
    console.error('Ticket create error:', err);
    return null;
  }
};

// â”€â”€ Helper: Notify ADMIN_EMAIL via Slack DM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const notifyADMIN_EMAIL = async (client, ticket, emp, channelId) => {
  try {
    const ADMIN_EMAILId = process.env.ADMIN_EMAIL_SLACK_ID;
    if (!ADMIN_EMAILId) return;

    const priEmoji = { Critical:'ðŸ”´', High:'ðŸŸ ', Medium:'ðŸŸ¡', Low:'ðŸŸ¢' };

    await client.chat.postMessage({
      channel: ADMIN_EMAILId,
      blocks : [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${priEmoji[ticket.priority]||'ðŸŸ¡'} *Naya Ticket: ${ticket.ticketId}*\n\n` +
                  `*Employee:* ${emp.empName} (${emp.empId})\n` +
                  `*Issue:* ${ticket.description}\n` +
                  `*Priority:* ${ticket.priority} | *SLA:* ${ticket.slaHours}h\n` +
                  `*Source:* Slack`
          }
        },
        {
          type    : 'actions',
          elements: [
            {
              type     : 'button',
              text     : { type: 'plain_text', text: 'âœ… Mark Resolved' },
              style    : 'primary',
              action_id: 'admin_resolve',
              value    : ticket.ticketId
            },
            {
              type     : 'button',
              text     : { type: 'plain_text', text: 'ðŸ’¬ Reply to Employee' },
              action_id: 'admin_reply',
              value    : JSON.stringify({ ticketId: ticket.ticketId, slackUserId: ticket.slackUserId })
            }
          ]
        }
      ]
    });
  } catch (err) {
    console.error('ADMIN_EMAIL DM error:', err.message);
  }
};

// â”€â”€ Admin: Mark Resolved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.action('admin_resolve', async ({ ack, body, client, respond }) => {
  await ack();
  const ticketId = body.actions[0].value;

  try {
    await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
      method : 'PATCH',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${process.env.ADMIN_JWT_TOKEN}`
      },
      body: JSON.stringify({ status: 'Resolved', resolvedBy: 'Human', resolution: 'Resolved by ADMIN_EMAIL via Slack' })
    });

    await respond({
      response_type   : 'ephemeral',
      replace_original: false,
      text            : `âœ… *${ticketId}* mark as resolved!`
    });
  } catch (err) {
    await respond({ text: `âŒ Error: ${err.message}`, response_type: 'ephemeral' });
  }
});

// â”€â”€ Show my tickets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const showMyTickets = async (userId, empId, respond, client) => {
  try {
    const res  = await fetch(`${API_BASE}/api/tickets?empId=${empId}`);
    const data = await res.json();
    const tickets = (data.tickets || []).slice(0, 5);

    if (!tickets.length) {
      await respond({ text: 'ðŸ“­ Aapka koi ticket nahi hai abhi.', response_type: 'ephemeral' });
      return;
    }

    const priEmoji = { Critical:'ðŸ”´', High:'ðŸŸ ', Medium:'ðŸŸ¡', Low:'ðŸŸ¢' };
    const stEmoji  = { Open:'â³', 'In Progress':'ðŸ”§', Resolved:'âœ…', Closed:'ðŸ”’' };

    const ticketList = tickets.map(t =>
      `${stEmoji[t.status]||'â³'} *${t.ticketId}* â€” ${t.category} (${priEmoji[t.priority]||'ðŸŸ¡'}${t.priority})\n` +
      `   ${t.description?.substring(0,60)}...`
    ).join('\n\n');

    await respond({
      response_type: 'ephemeral',
      text: `*ðŸŽ« Aapke Recent Tickets:*\n\n${ticketList}`
    });
  } catch (err) {
    await respond({ text: 'âŒ Tickets load nahi hue. Try again.', response_type: 'ephemeral' });
  }
};

// â”€â”€ Start Bot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(async () => {
  const port = process.env.SLACK_PORT || 3001;
  await app.start(port);
  console.log(`\nðŸ¤– WIOM Slack Bot running!`);
  console.log(`âš¡ Socket Mode â€” no public URL needed`);
  console.log(`ðŸ“‹ Commands: /helpdesk | DM the bot\n`);
})();

