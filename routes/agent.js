/**
 * WIOM IT Helpdesk â€” Laptop Agent API
 * Endpoints used by the Node.js agent running on employee laptops.
 * Authentication: x-agent-key header must match AGENT_SECRET env var.
 */
const router   = require('express').Router();
const FixJob   = require('../models/FixJob');
const Employee = require('../models/Employee');

// â”€â”€ Auth middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const checkKey = (req, res, next) => {
  const key = req.headers['x-agent-key'];
  if (!key || key !== process.env.AGENT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// â”€â”€ POST /api/agent/register â€” agent startup ping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/register', checkKey, async (req, res) => {
  const { laptopSN, empId, agentVersion } = req.body;
  if (!laptopSN) return res.status(400).json({ error: 'laptopSN required' });
  try {
    await Employee.findOneAndUpdate(
      { laptopSN },
      { agentRegistered: true, agentVersion, agentLastSeen: new Date() }
    );
    console.log(`ðŸ¤– Agent registered: SN=${laptopSN} empId=${empId} v${agentVersion}`);
    res.json({ ok: true, message: 'Registered' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /api/agent/poll?sn=XXX â€” agent polls for pending fix jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/poll', checkKey, async (req, res) => {
  const { sn } = req.query;
  if (!sn) return res.status(400).json({ error: 'sn required' });
  try {
    // Update last-seen
    await Employee.findOneAndUpdate({ laptopSN: sn }, { agentLastSeen: new Date() });

    // Grab the oldest pending job for this laptop
    const job = await FixJob.findOneAndUpdate(
      { laptopSN: sn, status: 'pending' },
      { $set: { status: 'running' } },
      { sort: { createdAt: 1 }, new: true }
    );

    res.json({ job: job || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ POST /api/agent/result â€” agent reports fix outcome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/result', checkKey, async (req, res) => {
  const { jobId, status, result, details } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  try {
    const job = await FixJob.findByIdAndUpdate(
      jobId,
      { status, result, details },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Push Slack notification to employee
    const slackClient = req.app.locals.slackClient;
    if (slackClient && job.slackUserId) {
      const isSuccess = status === 'success';
      const header = isSuccess ? 'âœ… Auto-Fix Ho Gaya!' : 'âš ï¸ Auto-Fix Mein Issue';
      const msg    = isSuccess
        ? `âœ… *${job.fixLabel || 'Fix'} complete!* ðŸŽ‰\n\n${result}\n\n_Kuch aur ho toh batao!_ ðŸ™`
        : `âŒ *Auto-fix mein problem aayi.*\n\n${result}\n\nManual steps try karo ya ticket raise karo â€” \`/ticket\` ðŸŽ«`;

      await slackClient.chat.postMessage({
        channel: job.slackUserId,
        text   : isSuccess ? `âœ… ${job.fixLabel} complete!` : `âš ï¸ Auto-fix issue â€” ${result}`,
        blocks : [
          { type: 'header', text: { type: 'plain_text', text: header, emoji: true }},
          { type: 'section', text: { type: 'mrkdwn', text: msg }},
          ...(details?.summary ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `_${details.summary}_` }]}] : [])
        ]
      }).catch(err => console.error('Fix result Slack DM error:', err.message));
    }

    console.log(`ðŸ”§ Fix job ${jobId} â†’ ${status}: ${result}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /api/agent/status?sn=XXX â€” check if agent is online (admin use) â”€â”€â”€â”€â”€â”€
router.get('/status', checkKey, async (req, res) => {
  const { sn } = req.query;
  try {
    const emp = await Employee.findOne({ laptopSN: sn });
    if (!emp) return res.status(404).json({ error: 'Laptop not found' });

    const lastSeen = emp.agentLastSeen;
    const isOnline = lastSeen && (Date.now() - new Date(lastSeen)) < 120000; // within 2 min

    res.json({
      empId          : emp.empId,
      empName        : emp.name,
      laptopSN       : emp.laptopSN,
      agentRegistered: !!emp.agentRegistered,
      agentVersion   : emp.agentVersion,
      agentLastSeen  : lastSeen,
      isOnline
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/fix-slack-ids — fix all employee Slack ID mismatches ──────
router.post('/fix-slack-ids', checkKey, async (req, res) => {
  const slackClient = req.app.locals.slackClient;
  if (!slackClient) return res.status(503).json({ error: 'Slack not connected' });

  const report = { fixed: [], cleared: [], notFound: [], alreadyOk: [] };

  try {
    // Fetch all Slack workspace users
    let allSlackUsers = [];
    let cursor;
    do {
      const r = await slackClient.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
      allSlackUsers = allSlackUsers.concat(r.members || []);
      cursor = r.response_metadata?.next_cursor;
    } while (cursor);

    // Build email → slackUserId map (skip bots)
    const emailToSlack = {};
    for (const u of allSlackUsers) {
      if (u.is_bot || u.is_app_user || u.deleted) continue;
      const email = u.profile?.email?.toLowerCase();
      if (email) emailToSlack[email] = u.id;
    }

    const employees = await Employee.find({ isActive: true });

    for (const emp of employees) {
      const correctSlackId = emailToSlack[emp.email?.toLowerCase()];

      if (!correctSlackId) {
        // Employee email not found in Slack workspace
        if (emp.slackUserId) {
          await Employee.updateOne({ _id: emp._id }, { $unset: { slackUserId: '' } });
          report.cleared.push({ empId: emp.empId, name: emp.name, reason: 'not in Slack' });
        } else {
          report.notFound.push({ empId: emp.empId, name: emp.name });
        }
        continue;
      }

      if (emp.slackUserId === correctSlackId) {
        report.alreadyOk.push({ empId: emp.empId, name: emp.name });
        continue;
      }

      // Fix the slackUserId
      await Employee.updateOne({ _id: emp._id }, { $set: { slackUserId: correctSlackId } });
      report.fixed.push({
        empId: emp.empId,
        name: emp.name,
        old: emp.slackUserId || 'none',
        new: correctSlackId
      });
    }

    console.log(`Slack ID fix complete — fixed: ${report.fixed.length}, cleared: ${report.cleared.length}`);
    res.json({ ok: true, summary: { fixed: report.fixed.length, cleared: report.cleared.length, notFound: report.notFound.length, alreadyOk: report.alreadyOk.length }, details: report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

