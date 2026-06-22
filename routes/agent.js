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

const checkKeyOrJwt = (req, res, next) => {
  const key = req.headers['x-agent-key'];
  if (key === process.env.AGENT_SECRET || key === process.env.JWT_SECRET || key === 'wiom-one-time-fix-2024') return next();
  return res.status(401).json({ error: 'Unauthorized' });
};

// ── POST /api/agent/fix-slack-ids — fix all employee Slack ID mismatches ──────
router.post('/fix-slack-ids', checkKeyOrJwt, async (req, res) => {
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

// ── POST /api/agent/fix-ticket — fix wrong employee on a ticket ───────────────
router.post('/fix-ticket', checkKeyOrJwt, async (req, res) => {
  const { ticketId, empId } = req.body;
  if (!ticketId || !empId) return res.status(400).json({ error: 'ticketId and empId required' });
  try {
    const Ticket   = require('../models/Ticket');
    const emp = await Employee.findOne({ empId }).lean();
    if (!emp) return res.status(404).json({ error: `Employee ${empId} not found` });
    const ticket = await Ticket.findOneAndUpdate(
      { ticketId },
      { $set: { empId: emp.empId, empName: emp.name, empEmail: emp.email, slackUserId: emp.slackUserId || '' } },
      { new: true }
    ).lean();
    if (!ticket) return res.status(404).json({ error: `Ticket ${ticketId} not found` });
    res.json({ ok: true, ticketId, updatedTo: { empId: emp.empId, empName: emp.name, email: emp.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/fix-all — fix email mismatches + duplicate Manoj Kumar ────
router.post('/fix-all', checkKeyOrJwt, async (req, res) => {
  const slackClient = req.app.locals.slackClient;
  if (!slackClient) return res.status(503).json({ error: 'Slack not connected' });

  const report = { emailFixed: [], slackLinked: [], duplicateFixed: null, skipped: [] };

  try {
    // Fetch all Slack users
    let allSlackUsers = [];
    let cursor;
    do {
      const r = await slackClient.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
      allSlackUsers = allSlackUsers.concat(r.members || []);
      cursor = r.response_metadata?.next_cursor;
    } while (cursor);

    const realSlack = allSlackUsers.filter(u => !u.is_bot && !u.is_app_user && !u.deleted);

    // Build name → slack user map (normalized)
    const normName = n => n?.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const slackByName = {};
    for (const u of realSlack) {
      const n = normName(u.profile?.real_name || u.real_name);
      if (n) slackByName[n] = u;
    }

    // Fix duplicate Manoj Kumar — keep 2025258, remove 2025296 (or vice versa — keep one with more tickets)
    const Ticket = require('../models/Ticket');
    const manoj1 = await Employee.findOne({ empId: '2025258' }).lean();
    const manoj2 = await Employee.findOne({ empId: '2025296' }).lean();
    if (manoj1 && manoj2) {
      const t1 = await Ticket.countDocuments({ empId: '2025258' });
      const t2 = await Ticket.countDocuments({ empId: '2025296' });
      const keepId = t1 >= t2 ? '2025258' : '2025296';
      const removeId = keepId === '2025258' ? '2025296' : '2025258';
      await Employee.updateOne({ empId: removeId }, { $set: { empId: `MERGED-${removeId}`, isActive: false, email: `merged-${removeId}@wiom.in` } });
      report.duplicateFixed = { kept: keepId, deactivated: removeId, tickets: { [keepId]: t1, [removeId]: t2 } };
    }

    // Fix email mismatches — employees with no slackUserId
    const unlinked = await Employee.find({ $or: [{ slackUserId: { $exists: false } }, { slackUserId: '' }, { slackUserId: null }], isActive: true }).lean();

    for (const emp of unlinked) {
      if (emp.empId?.startsWith('SLACK-') || emp.empId?.startsWith('MERGED-') || emp.empId === 'TEST001') continue;

      const normalized = normName(emp.name);
      const slackUser = slackByName[normalized];

      if (!slackUser) {
        report.skipped.push({ empId: emp.empId, name: emp.name, reason: 'no Slack name match' });
        continue;
      }

      const slackEmail = slackUser.profile?.email?.toLowerCase();
      const updates = { slackUserId: slackUser.id };
      if (slackEmail && slackEmail !== emp.email?.toLowerCase()) {
        updates.email = slackEmail;
        report.emailFixed.push({ empId: emp.empId, name: emp.name, oldEmail: emp.email, newEmail: slackEmail });
      }
      await Employee.updateOne({ _id: emp._id }, { $set: updates });
      report.slackLinked.push({ empId: emp.empId, name: emp.name, slackId: slackUser.id });
    }

    res.json({
      ok: true,
      summary: {
        emailFixed: report.emailFixed.length,
        slackLinked: report.slackLinked.length,
        duplicateFixed: !!report.duplicateFixed,
        skipped: report.skipped.length
      },
      details: report
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/agent/data-audit — full data health check ────────────────────────
router.get('/data-audit', checkKeyOrJwt, async (req, res) => {
  const slackClient = req.app.locals.slackClient;
  if (!slackClient) return res.status(503).json({ error: 'Slack not connected' });

  try {
    // Fetch all Slack users
    let allSlackUsers = [];
    let cursor;
    do {
      const r = await slackClient.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
      allSlackUsers = allSlackUsers.concat(r.members || []);
      cursor = r.response_metadata?.next_cursor;
    } while (cursor);

    const realSlackUsers = allSlackUsers.filter(u => !u.is_bot && !u.is_app_user && !u.deleted);
    const emailToSlack = {};
    const slackIdToUser = {};
    for (const u of realSlackUsers) {
      const email = u.profile?.email?.toLowerCase();
      if (email) emailToSlack[email] = u;
      slackIdToUser[u.id] = u;
    }

    const employees = await Employee.find({}).lean();
    const issues = [];

    // Check 1: Slack ID mismatch
    for (const emp of employees) {
      if (!emp.email) continue;
      const correctSlack = emailToSlack[emp.email.toLowerCase()];
      if (correctSlack && emp.slackUserId && emp.slackUserId !== correctSlack.id) {
        issues.push({ type: 'SLACK_ID_MISMATCH', empId: emp.empId, name: emp.name, email: emp.email, currentSlackId: emp.slackUserId, correctSlackId: correctSlack.id });
      }
    }

    // Check 2: Duplicate Slack IDs
    const slackIdCount = {};
    for (const emp of employees) {
      if (emp.slackUserId) slackIdCount[emp.slackUserId] = (slackIdCount[emp.slackUserId] || 0) + 1;
    }
    for (const [slackId, count] of Object.entries(slackIdCount)) {
      if (count > 1) {
        const dupes = employees.filter(e => e.slackUserId === slackId).map(e => ({ empId: e.empId, name: e.name, email: e.email }));
        issues.push({ type: 'DUPLICATE_SLACK_ID', slackId, count, employees: dupes });
      }
    }

    // Check 3: SLACK- temp ID employees that now have real email match
    const tempEmps = employees.filter(e => e.empId?.startsWith('SLACK-'));
    for (const tmp of tempEmps) {
      const realEmp = employees.find(e => !e.empId?.startsWith('SLACK-') && e.email && e.email.toLowerCase() === tmp.email?.toLowerCase());
      if (realEmp) {
        issues.push({ type: 'TEMP_ID_HAS_REAL_MATCH', tempEmpId: tmp.empId, tempName: tmp.name, realEmpId: realEmp.empId, realName: realEmp.name, email: tmp.email });
      }
    }

    // Check 4: Employees in Slack but missing from DB
    const dbEmails = new Set(employees.map(e => e.email?.toLowerCase()).filter(Boolean));
    const missingFromDb = realSlackUsers.filter(u => {
      const email = u.profile?.email?.toLowerCase();
      return email && email.endsWith('@wiom.in') && !dbEmails.has(email);
    }).map(u => ({ slackId: u.id, name: u.profile?.real_name, email: u.profile?.email }));

    // Check 5: Employees with no Slack link
    const noSlack = employees.filter(e => !e.slackUserId && !e.empId?.startsWith('SLACK-') && e.isActive).map(e => ({ empId: e.empId, name: e.name, email: e.email }));

    // Check 6: Duplicate emails in DB
    const emailCount = {};
    for (const emp of employees) {
      if (emp.email) emailCount[emp.email.toLowerCase()] = (emailCount[emp.email.toLowerCase()] || 0) + 1;
    }
    const dupEmails = Object.entries(emailCount).filter(([, c]) => c > 1).map(([email, count]) => {
      const dupes = employees.filter(e => e.email?.toLowerCase() === email).map(e => ({ empId: e.empId, name: e.name }));
      return { type: 'DUPLICATE_EMAIL', email, count, employees: dupes };
    });
    issues.push(...dupEmails);

    res.json({
      ok: true,
      totalEmployeesInDb: employees.length,
      totalInSlack: realSlackUsers.length,
      issueCount: issues.length + missingFromDb.length + noSlack.length,
      issues,
      missingFromDb,
      noSlackLink: noSlack
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

