const router   = require('express').Router();
const Admin    = require('../models/Admin');
const Employee = require('../models/Employee');
const Ticket   = require('../models/Ticket');
const { verifyAdmin } = require('../middleware/auth');

// ── POST /api/admin/broadcast  — Send message to all Slack employees ──────────
router.post('/broadcast', verifyAdmin, async (req, res) => {
  try {
    const { message, urgent = false } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const slackClient = req.app.locals.slackClient;
    if (!slackClient) return res.status(503).json({ error: 'Slack bot not connected' });

    const employees = await Employee.find({
      slackUserId: { $exists: true, $ne: null },
      isActive: true
    }).select('slackUserId name');

    if (!employees.length) return res.json({ success: true, sent: 0, failed: 0, message: 'No Slack-linked employees found' });

    let sent = 0, failed = 0;
    const emoji     = urgent ? '🚨' : '📢';
    const adminName = req.admin?.name || 'IT Team';

    for (const emp of employees) {
      try {
        await slackClient.chat.postMessage({
          channel: emp.slackUserId,
          text   : `${emoji} IT Helpdesk: ${message}`,
          blocks : [
            { type:'section', text:{ type:'mrkdwn', text: `${emoji} *WIOM IT Helpdesk — Announcement*\n\n${message}` }},
            { type:'context', elements:[{ type:'mrkdwn', text:`_Bheja by: ${adminName} | IT Helpdesk (Slack pe ticket)_` }]}
          ]
        });
        sent++;
      } catch { failed++; }
    }

    console.log(`📢 Broadcast sent: ${sent} success, ${failed} failed`);
    res.json({ success: true, sent, failed, total: employees.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/send-message  — Send Slack DM to one employee ────────────
router.post('/send-message', verifyAdmin, async (req, res) => {
  try {
    const { slackUserId, message, ticketId } = req.body;
    if (!slackUserId || !message) return res.status(400).json({ error: 'slackUserId aur message required hai' });

    const slackClient = req.app.locals.slackClient;
    if (!slackClient) return res.status(503).json({ error: 'Slack bot connected nahi hai' });

    const adminName = req.admin?.name || 'IT Team';
    const ticketRef = ticketId ? ` (Ticket: \`${ticketId}\`)` : '';

    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `💬 IT Team: ${message}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `💬 *WIOM IT Helpdesk — Message${ticketRef}*\n\n${message}` }},
        { type: 'context', elements: [{ type: 'mrkdwn', text: `_Bheja by: ${adminName} · IT Support_` }]}
      ]
    });

    // Save as comment on ticket if ticketId provided
    if (ticketId) {
      await Ticket.findOneAndUpdate(
        { ticketId },
        { $push: { comments: { author: adminName, role: 'admin', message: `[Slack Reply] ${message}`, addedAt: new Date() } } }
      ).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/team  — List all admins ────────────────────────────────────
router.get('/team', verifyAdmin, async (req, res) => {
  try {
    const admins = await Admin.find({}).select('-passwordHash').sort({ createdAt: 1 });
    res.json({ admins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/team  — Create new admin ──────────────────────────────────
router.post('/team', verifyAdmin, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin')
      return res.status(403).json({ error: 'Only superadmin can create admins' });

    const { username, password, name, email, role = 'admin' } = req.body;
    if (!username || !password || !name || !email)
      return res.status(400).json({ error: 'username, password, name, email required' });

    const admin = new Admin({ username, passwordHash: password, name, email, role });
    await admin.save();
    res.status(201).json({ success: true, admin: { username: admin.username, name: admin.name, role: admin.role } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/team/:username  — Toggle active / change role ────────────
router.patch('/team/:username', verifyAdmin, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin')
      return res.status(403).json({ error: 'Only superadmin can modify admins' });

    // BUG-8 fix: explicit allowlist — prevent mass-assignment of passwordHash, _id, etc.
    const { role, isActive, name, email } = req.body;
    const update = {};
    if (role      !== undefined) update.role     = role;
    if (isActive  !== undefined) update.isActive = isActive;
    if (name      !== undefined) update.name     = name;
    if (email     !== undefined) update.email    = email;
    if (!Object.keys(update).length)
      return res.status(400).json({ error: 'No valid fields to update' });

    const admin = await Admin.findOneAndUpdate(
      { username: req.params.username },
      { $set: update },
      { new: true }
    ).select('-passwordHash');
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json({ success: true, admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/charts  — Analytics data for dashboard ─────────────────────
router.get('/charts', verifyAdmin, async (req, res) => {
  try {
    // BUG-14 fix: single aggregation instead of 7 sequential countDocuments calls
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
    const IST_OFFSET_MS = 5.5 * 3600000;
    const trendRaw = await Ticket.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $project: {
          // Convert to IST date string (UTC + 5:30)
          day: { $dateToString: { format: '%Y-%m-%d', date: { $add: ['$createdAt', IST_OFFSET_MS] } } }
      }},
      { $group: { _id: '$day', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    const countByDay = Object.fromEntries(trendRaw.map(r => [r._id, r.count]));

    const trendLabels = [], trendData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600000);
      // Day label in IST
      const istDate = new Date(d.getTime() + IST_OFFSET_MS);
      const key = istDate.toISOString().slice(0, 10); // YYYY-MM-DD in IST
      trendData.push(countByDay[key] || 0);
      trendLabels.push(d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }));
    }

    // Category breakdown
    const catRaw = await Ticket.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Priority of open tickets
    const priRaw = await Ticket.aggregate([
      { $match: { status: { $in: ['Open', 'In Progress'] } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);

    // Average resolution time (hours)
    const resTime = await Ticket.aggregate([
      { $match: { resolvedAt: { $exists: true } } },
      { $project: { hours: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 3600000] } } },
      { $group: { _id: null, avg: { $avg: '$hours' } } }
    ]);

    // CSAT (avg rating)
    const csat = await Ticket.aggregate([
      { $match: { userRating: { $exists: true, $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$userRating' }, count: { $sum: 1 } } }
    ]);

    // Top 5 reporters
    const topReporters = await Ticket.aggregate([
      { $group: { _id: '$empName', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 5 }
    ]);

    res.json({
      trend          : { labels: trendLabels, data: trendData },
      categories     : catRaw.map(c => ({ label: c._id || 'Other', value: c.count })),
      priorities     : priRaw.map(p => ({ label: p._id, value: p.count })),
      avgResolutionHrs: Math.round((resTime[0]?.avg || 0) * 10) / 10,
      avgRating      : Math.round((csat[0]?.avg || 0) * 10) / 10,
      ratingCount    : csat[0]?.count || 0,
      topReporters   : topReporters.map(r => ({ name: r._id, count: r.count }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/keka-sync  — Sync employees from Keka HRMS ───────────────
router.post('/keka-sync', verifyAdmin, async (req, res) => {
  try {
    const kekaKey = process.env.KEKA_API_KEY;
    if (!kekaKey) {
      return res.status(503).json({
        error: 'KEKA_API_KEY not set. Railway Environment Variables mein add karein.'
      });
    }

    // Keka API v2 endpoint
    const kekaRes = await fetch('https://api.keka.com/v1/hris/employees?pagesize=500&status=active', {
      headers: { 'Authorization': `Bearer ${kekaKey}`, 'Accept': 'application/json' }
    });

    if (!kekaRes.ok) return res.status(502).json({ error: `Keka API returned ${kekaRes.status}` });

    const { data: employees = [] } = await kekaRes.json();
    let synced = 0, errors = 0;

    for (const ke of employees) {
      try {
        await Employee.findOneAndUpdate(
          { empId: String(ke.employeeNumber || ke.id).toUpperCase() },
          {
            name       : `${ke.firstName} ${ke.lastName}`.trim(),
            email      : ke.workEmail?.toLowerCase() || ke.email?.toLowerCase(),
            department : ke.department?.name,
            designation: ke.jobTitle,
            isActive   : ke.employmentStatus !== 'terminated'
          },
          { upsert: true, new: true }
        );
        synced++;
      } catch { errors++; }
    }

    res.json({ success: true, synced, errors, total: employees.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
