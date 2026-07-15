const router      = require('express').Router();
const crypto      = require('crypto');
const Ticket      = require('../models/Ticket');
const Employee    = require('../models/Employee');
const { verifyAdmin, verifyEmployee } = require('../middleware/auth');
const emailSvc    = require('../services/email');
const slaSvc      = require('../services/sla');

// ── Category / priority normalization ─────────────────────────────────────────
// External bots may send lowercase/slug values (e.g. "asset-request", "high").
// Map them onto this portal's canonical enum values.
const VALID_CATEGORIES = ['Hardware','Software','Network','Account','Purchase','Theft/Loss','Asset Request','Software Request','Emergency','Other'];
const CATEGORY_ALIASES = {
  'hardware':'Hardware', 'software':'Software', 'network':'Network',
  'account':'Account', 'purchase':'Purchase',
  'asset-request':'Asset Request', 'asset_request':'Asset Request', 'assetrequest':'Asset Request', 'asset request':'Asset Request',
  'software-request':'Software Request', 'software_request':'Software Request', 'software request':'Software Request',
  'theft/loss':'Theft/Loss', 'theft':'Theft/Loss', 'loss':'Theft/Loss',
  'emergency':'Emergency', 'other':'Other'
};
function normalizeCategory(c) {
  if (!c) return 'Other';
  const key = String(c).trim().toLowerCase();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  const match = VALID_CATEGORIES.find(v => v.toLowerCase() === key);
  return match || 'Other';
}
function normalizePriority(p) {
  if (!p) return 'Medium';
  const map = { critical:'Critical', high:'High', medium:'Medium', low:'Low' };
  return map[String(p).trim().toLowerCase()] || 'Medium';
}

// ── Notify the Employee Query Bot of status changes ──────────────────────────
async function notifyBotStatusChange(ticket) {
  const payload = {
    ticketId      : ticket.ticketId,
    empSlackUserId: ticket.slackUserId || ticket.empEmail || null,
    status        : ticket.status,
    note          : ticket.lastNote || '',
    updatedAt     : new Date().toISOString()
  };
  const body = JSON.stringify(payload);
  const sig  = crypto.createHmac('sha256', process.env.BOT_WEBHOOK_SECRET)
                     .update(body).digest('hex');
  try {
    const r = await fetch(process.env.BOT_WEBHOOK_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Signature': 'sha256=' + sig },
      body
    });
    console.log('bot webhook:', r.status, await r.text());
  } catch (e) { console.error('bot webhook failed:', e); }
}

// ── Notify IT admin on Slack for a newly created ticket (Section 3) ────────────
async function notifyAdminSlack(req, ticket) {
  try {
    const client  = req.app.locals.slackClient;
    const adminId = process.env.ADMIN_EMAIL_SLACK_ID || process.env.ADMIN_SLACK_USER_ID || process.env.SAJAN_SLACK_ID;
    if (!client || !adminId || adminId === 'FILL_KARO') return;
    const priColor = { Critical:'#ef4444', High:'#f59e0b', Medium:'#3b82f6', Low:'#10b981' };
    await client.chat.postMessage({
      channel: adminId,
      text   : `New Ticket: ${ticket.ticketId} — ${ticket.empName}`,
      attachments: [{
        color: priColor[ticket.priority] || '#3b82f6',
        blocks: [
          { type:'section', fields:[
            { type:'mrkdwn', text:`*🎫 Ticket*\n\`${ticket.ticketId}\`` },
            { type:'mrkdwn', text:`*👤 Employee*\n${ticket.empName} (${ticket.empId})` },
            { type:'mrkdwn', text:`*📂 Category*\n${ticket.category}` },
            { type:'mrkdwn', text:`*⚡ Priority*\n${ticket.priority}` }
          ]},
          { type:'section', text:{ type:'mrkdwn', text:`*📝 Issue:*\n${ticket.description}` }},
          { type:'context', elements:[{ type:'mrkdwn', text:`Source: ${ticket.source}` }]}
        ]
      }]
    });
  } catch (err) {
    console.error('[admin-notify] failed:', err.message);
  }
}

// ── POST /api/tickets  — Create new ticket ────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    // Optional shared-token protection. Open by default; if BOT_API_TOKEN is set,
    // callers must send it as `Authorization: Bearer <token>` or `x-api-key`.
    const requiredToken = process.env.BOT_API_TOKEN;
    if (requiredToken) {
      const auth = req.headers['authorization'] || '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['x-api-key'] || '');
      if (provided !== requiredToken) return res.status(401).json({ error: 'unauthorized' });
    }

    const { empId, empName, empEmail, empDept, empFloor, laptop,
            category, priority, description, source, slackUserId,
            slackChannelId, aiSessionId, aiSteps, aiNotes, skipDuplicateCheck,
            screenshots } = req.body;

    if (!empId || !description)
      return res.status(400).json({ error: 'empId and description required' });

    // ── Duplicate ticket check (last 30 min, same employee, open ticket) ──────
    if (!skipDuplicateCheck) {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
      const existing = await Ticket.findOne({
        empId : empId.toUpperCase(),
        status: { $in: ['Open', 'In Progress'] },
        createdAt: { $gte: thirtyMinAgo }
      });
      if (existing) {
        return res.status(409).json({
          error   : 'duplicate',
          message : `Aapka ticket ${existing.ticketId} already open hai. Pehle wala resolve hone ke baad naya ticket create karein.`,
          ticketId: existing.ticketId,
          status  : existing.status,
          ticket  : existing
        });
      }
    }

    const ticket = await Ticket.create({
      empId, empName, empEmail, empDept, empFloor, laptop,
      category   : normalizeCategory(category),
      priority   : normalizePriority(priority),
      description,
      source     : source     || 'web',
      slackUserId, slackChannelId, aiSessionId,
      aiTried      : !!(aiSteps || aiNotes),
      aiSteps      : aiSteps      || [],
      aiNotes      : aiNotes      || undefined,
      screenshots  : Array.isArray(screenshots) ? screenshots.slice(0, 5) : []
    });

    // Update employee stats
    await Employee.findOneAndUpdate(
      { empId: empId.toUpperCase() },
      { $inc: { totalTickets: 1 }, lastTicket: new Date() }
    );

    // Send confirmation email
    if (empEmail) {
      emailSvc.sendTicketConfirmation(ticket).catch(console.error);
    }

    // Send alert to ADMIN_EMAIL (email) + IT admin Slack notification
    emailSvc.sendAdminAlert(ticket).catch(console.error);
    notifyAdminSlack(req, ticket);

    res.status(201).json({
      success    : true,
      ticketId   : ticket.ticketId,
      status     : ticket.status,
      slaDeadline: ticket.slaDeadline,
      createdAt  : ticket.createdAt,
      ticket
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tickets  — List tickets (admin) ──────────────────────────────────
router.get('/', verifyAdmin, async (req, res) => {
  try {
    const { status, priority, category, empId, page = 1, limit = 50, date } = req.query;

    const filter = {};
    if (status)   filter.status   = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (empId)    filter.empId    = empId.toUpperCase();
    if (date) {
      const d = new Date(date);
      filter.createdAt = {
        $gte: new Date(d.setHours(0,0,0,0)),
        $lte: new Date(d.setHours(23,59,59,999))
      };
    }

    const [tickets, total] = await Promise.all([
      Ticket.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(+limit),
      Ticket.countDocuments(filter)
    ]);

    res.json({ tickets, total, page: +page, pages: Math.ceil(total/limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tickets/my  — Employee's own tickets ─────────────────────────────
router.get('/my', verifyEmployee, async (req, res) => {
  try {
    const tickets = await Ticket.find({ empId: req.user.empId })
      .sort({ createdAt: -1 }).limit(20);
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tickets/stats  — Dashboard stats ─────────────────────────────────
router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);

    const [total, open, resolved, critical, todayCount, slaBreached] = await Promise.all([
      Ticket.countDocuments(),
      // Open = Open + In Progress + Waiting (all active tickets)
      Ticket.countDocuments({ status: { $in: ['Open', 'In Progress', 'Waiting'] } }),
      Ticket.countDocuments({ status: { $in: ['Resolved', 'Closed'] }, resolvedAt: { $gte: today } }),
      Ticket.countDocuments({ priority: 'Critical', status: { $nin: ['Resolved', 'Closed'] } }),
      Ticket.countDocuments({ createdAt: { $gte: today } }),
      // SLA Breached = breached AND still active (not resolved OR closed)
      Ticket.countDocuments({ slaBreached: true, status: { $nin: ['Resolved', 'Closed'] } })
    ]);

    // Category breakdown
    const catBreakdown = await Ticket.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({ total, open, resolved, critical, todayCount, slaBreached, catBreakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tickets/:id ──────────────────────────────────────────────────────
router.get('/:id', verifyAdmin, async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/tickets/:id  — Update status / assign / resolve ────────────────
router.patch('/:id', verifyAdmin, async (req, res) => {
  try {
    const { status, assignedTo, resolution, resolvedBy, comment, priority } = req.body;
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (status)     ticket.status     = status;
    if (assignedTo) ticket.assignedTo = assignedTo;
    if (resolution) ticket.resolution = resolution;
    if (resolvedBy) ticket.resolvedBy = resolvedBy;
    if (priority)   ticket.priority   = priority;

    const slackClient = req.app.locals.slackClient;

    if (status === 'Resolved' && !ticket.resolvedAt) {
      ticket.resolvedAt = new Date();

      // ── Email resolution to employee ────────────────────────────────────────
      if (ticket.empEmail) {
        emailSvc.sendResolutionEmail(ticket).catch(console.error);
      }

      // ── Slack DM to employee when ticket resolved ───────────────────────────
      if (slackClient && ticket.slackUserId) {
        const resolvedBy_ = req.body.resolvedBy || assignedTo || 'IT Team';
        slackClient.chat.postMessage({
          channel: ticket.slackUserId,
          text   : `✅ Aapka ticket ${ticket.ticketId} resolve ho gaya!`,
          blocks : [
            { type:'section', text:{ type:'mrkdwn', text:
              `✅ *Aapka support ticket resolve ho gaya hai!*\n\n*Ticket:* \`${ticket.ticketId}\`\n*Category:* ${ticket.category}` +
              (ticket.resolution ? `\n*Resolution:* ${ticket.resolution}` : '')
            }},
            { type:'divider' },
            { type:'section', text:{ type:'mrkdwn', text:`*Aapka experience kaisa raha? Rating dein:*` }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'⭐ 1', emoji:true }, value:`${ticket.ticketId}:1`, action_id:'rate_ticket' },
              { type:'button', text:{ type:'plain_text', text:'⭐⭐ 2', emoji:true }, value:`${ticket.ticketId}:2`, action_id:'rate_ticket' },
              { type:'button', text:{ type:'plain_text', text:'⭐⭐⭐ 3', emoji:true }, value:`${ticket.ticketId}:3`, action_id:'rate_ticket' },
              { type:'button', text:{ type:'plain_text', text:'⭐⭐⭐⭐ 4', emoji:true }, value:`${ticket.ticketId}:4`, action_id:'rate_ticket' },
              { type:'button', text:{ type:'plain_text', text:'⭐⭐⭐⭐⭐ 5', emoji:true }, value:`${ticket.ticketId}:5`, action_id:'rate_ticket' }
            ]},
            { type:'context', elements:[{ type:'mrkdwn',
              text:`Resolved by ${resolvedBy_} | Agar problem wapas aaye: IT Helpdesk (Slack)` }]}
          ]
        }).catch(e => console.error('Slack resolve DM error:', e.message));

        // Refresh Home Tab — remove resolved ticket from view
        if (req.app.locals.refreshEmployeeHomeTab) {
          setTimeout(() => req.app.locals.refreshEmployeeHomeTab(ticket.slackUserId), 2000);
        }
      }
    }

    if (status === 'Closed' && !ticket.closedAt) {
      ticket.closedAt = new Date();
      // Refresh Home Tab — remove closed ticket from employee's view
      if (slackClient && ticket.slackUserId && req.app.locals.refreshEmployeeHomeTab) {
        setTimeout(() => req.app.locals.refreshEmployeeHomeTab(ticket.slackUserId), 2000);
      }
    }

    // ── Slack DM for other status changes (In Progress, Waiting, Open) ────────
    if (req.body.status && !['Resolved', 'Closed'].includes(req.body.status) && ticket.slackUserId && slackClient) {
      const statusEmoji = { 'In Progress': '🔄', 'Waiting': '⏸️', 'Open': '🔓' };
      const emoji = statusEmoji[req.body.status] || '📋';
      const msg = `${emoji} Ticket \`${ticket.ticketId}\` ka status update hua: *${req.body.status}*`;
      slackClient.chat.postMessage({
        channel: ticket.slackUserId,
        text: msg,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: msg }},
          { type: 'context', elements: [{ type: 'mrkdwn', text: `_Assigned to: ${ticket.assignedTo || 'IT Team'}_` }]}
        ]
      }).catch(e => console.error('[slack-dm] status update failed:', e.message));
    }

    // ── Slack DM when ticket is assigned/reassigned ──────────────────────────
    if (req.body.assignedTo && ticket.slackUserId && slackClient) {
      const assignMsg = `👤 Aapka ticket \`${ticket.ticketId}\` assign hua: *${req.body.assignedTo}* handle karega.`;
      slackClient.chat.postMessage({
        channel: ticket.slackUserId,
        text: assignMsg,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: assignMsg }},
          { type: 'context', elements: [{ type: 'mrkdwn', text: `_Category: ${ticket.category} | Priority: ${ticket.priority}_` }]}
        ]
      }).catch(() => {});
    }

    if (comment) {
      ticket.comments.push({
        author : req.admin?.name || 'IT Team',
        role   : 'admin',
        message: comment
      });
    }

    await ticket.save();

    // Notify the Employee Query Bot on any status change (fire-and-forget).
    if (req.body.status && process.env.BOT_WEBHOOK_URL && process.env.BOT_WEBHOOK_SECRET) {
      ticket.lastNote = resolution || comment || '';
      notifyBotStatusChange(ticket);
    }

    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tickets/:id/comment ────────────────────────────────────────────
router.post('/:id/comment', verifyAdmin, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
    const ticket = await Ticket.findOneAndUpdate(
      { ticketId: req.params.id },
      { $push: { comments: { author: req.admin.name, role: 'admin', message: message.trim() } } },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/tickets/:id ───────────────────────────────────────────────────
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin')
      return res.status(403).json({ error: 'Only superadmin can delete tickets' });
    const deleted = await Ticket.findOneAndDelete({ ticketId: req.params.id });
    if (!deleted) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
