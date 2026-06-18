const router      = require('express').Router();
const Ticket      = require('../models/Ticket');
const Employee    = require('../models/Employee');
const { verifyAdmin, verifyEmployee } = require('../middleware/auth');
const emailSvc    = require('../services/email');
const slaSvc      = require('../services/sla');

// ── POST /api/tickets  — Create new ticket ────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { empId, empName, empEmail, empDept, empFloor, laptop,
            category, priority, description, source, slackUserId,
            slackChannelId, aiSessionId, aiSteps, skipDuplicateCheck,
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
          error  : 'duplicate',
          message: `Aapka ticket ${existing.ticketId} already open hai. Pehle wala resolve hone ke baad naya ticket create karein.`,
          ticket : existing
        });
      }
    }

    const ticket = await Ticket.create({
      empId, empName, empEmail, empDept, empFloor, laptop,
      category   : category   || 'Other',
      priority   : priority   || 'Medium',
      description,
      source     : source     || 'web',
      slackUserId, slackChannelId, aiSessionId,
      aiTried      : !!aiSteps,
      aiSteps      : aiSteps      || [],
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

    // Send alert to ADMIN_EMAIL
    emailSvc.sendAdminAlert(ticket).catch(console.error);

    res.status(201).json({ success: true, ticket });

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

    // ── Slack DM to employee when ticket CLOSED ──────────────────────────────
    if (status === 'Closed' && !ticket.closedAt) {
      ticket.closedAt = new Date();

      if (slackClient && ticket.slackUserId) {
        slackClient.chat.postMessage({
          channel: ticket.slackUserId,
          text   : `🔒 Aapka ticket ${ticket.ticketId} close ho gaya!`,
          blocks : [
            { type:'header', text:{ type:'plain_text', text:'🔒 Ticket Closed', emoji:true }},
            { type:'section', text:{ type:'mrkdwn', text:
              `Aapka IT support ticket *close* kar diya gaya hai.\n\n` +
              `*Ticket ID:* \`${ticket.ticketId}\`\n` +
              `*Category:* ${ticket.category}\n` +
              `*Issue:* ${(ticket.description || '').substring(0, 80)}${(ticket.description || '').length > 80 ? '...' : ''}` +
              (ticket.resolution ? `\n*Resolution:* ${ticket.resolution}` : '')
            }},
            { type:'divider' },
            { type:'section', text:{ type:'mrkdwn', text:`*Same problem wapas aayi?* Naya ticket banao:` }},
            { type:'actions', elements:[
              { type:'button', text:{ type:'plain_text', text:'🎫 New Ticket', emoji:true },
                style:'primary', action_id:'new_ticket_after_close', value:'new_ticket' }
            ]},
            { type:'context', elements:[{ type:'mrkdwn',
              text:`IT Helpdesk | Koi bhi problem ho: \`/ticket\` command use karo` }]}
          ]
        }).catch(e => console.error('Slack close DM error:', e.message));

        // Refresh Home Tab — remove closed ticket from view
        if (req.app.locals.refreshEmployeeHomeTab) {
          setTimeout(() => req.app.locals.refreshEmployeeHomeTab(ticket.slackUserId), 2000);
        }
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
      }).catch(() => {});
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
