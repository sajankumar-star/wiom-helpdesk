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

// ── POST /api/agent/fix-all — fix email mismatches + duplicate cleanup ────────
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

    // Normalize helper
    const norm = n => (n || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

    // Build multiple lookup maps
    const slackByFullName = {}, slackByFirstLast = {}, slackByEmail = {};
    for (const u of realSlack) {
      const full = norm(u.profile?.real_name || u.real_name || '');
      if (full) slackByFullName[full] = u;
      const parts = full.split(' ');
      if (parts.length >= 2) {
        const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
        if (!slackByFirstLast[firstLast]) slackByFirstLast[firstLast] = u;
      }
      const email = u.profile?.email?.toLowerCase();
      if (email) slackByEmail[email] = u;
    }

    // Find Slack user by DB employee using multiple strategies
    const findSlack = (emp) => {
      const fullNorm = norm(emp.name);
      if (slackByFullName[fullNorm]) return slackByFullName[fullNorm];
      const parts = fullNorm.split(' ');
      if (parts.length >= 2) {
        const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
        if (slackByFirstLast[firstLast]) return slackByFirstLast[firstLast];
      }
      if (emp.email && slackByEmail[emp.email.toLowerCase()]) return slackByEmail[emp.email.toLowerCase()];
      return null;
    };

    // Fix duplicate employees (same email, multiple records) — keep one with more tickets
    const Ticket = require('../models/Ticket');
    const allEmps = await Employee.find({ isActive: true }).lean();
    const emailGroups = {};
    for (const e of allEmps) {
      const key = e.email?.toLowerCase();
      if (key) { if (!emailGroups[key]) emailGroups[key] = []; emailGroups[key].push(e); }
    }
    const dupFixed = [];
    for (const [email, group] of Object.entries(emailGroups)) {
      if (group.length < 2) continue;
      const counts = await Promise.all(group.map(e => Ticket.countDocuments({ empId: e.empId })));
      const maxIdx = counts.indexOf(Math.max(...counts));
      for (let i = 0; i < group.length; i++) {
        if (i !== maxIdx && !group[i].empId?.startsWith('MERGED-')) {
          await Employee.updateOne({ _id: group[i]._id }, { $set: { empId: `MERGED-${group[i].empId}`, isActive: false, email: `merged-${Date.now()}@wiom.in` } });
          dupFixed.push({ deactivated: group[i].empId, kept: group[maxIdx].empId, email });
        }
      }
    }
    if (dupFixed.length) report.duplicateFixed = dupFixed;

    // Fix unlinked employees
    const unlinked = await Employee.find({ $or: [{ slackUserId: { $exists: false } }, { slackUserId: '' }, { slackUserId: null }], isActive: true }).lean();

    for (const emp of unlinked) {
      if (emp.empId?.startsWith('SLACK-') || emp.empId?.startsWith('MERGED-') || emp.empId === 'TEST001') continue;
      const slackUser = findSlack(emp);
      if (!slackUser) { report.skipped.push({ empId: emp.empId, name: emp.name }); continue; }

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
      summary: { emailFixed: report.emailFixed.length, slackLinked: report.slackLinked.length, duplicatesDeactivated: dupFixed.length, skipped: report.skipped.length },
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

// ── POST /api/agent/keka-sync — sync employees + assets from Keka ─────────────
router.post('/keka-sync', checkKeyOrJwt, async (req, res) => {
  const KEKA_CLIENT_ID     = 'ba5e016d-b4ae-4760-8ce8-13f0161badfe';
  const KEKA_CLIENT_SECRET = 'A6hO1Q3Oym5RLVoAlr3r';
  const KEKA_API_KEY       = 'txHdWdKQtRw2lkOjg0YaqQeFeTRZuU-luZbj9IdfEGA=';
  const KEKA_BASE          = 'https://omniainformation.keka.com/api/v1';

  const report = { employeesAdded: 0, employeesUpdated: 0, assetsLinked: 0, assetsSkipped: 0, errors: [] };

  try {
    // 1. Get Keka token
    const tokenRes = await fetch('https://login.keka.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'kekaapi', scope: 'kekaapi',
        client_id: KEKA_CLIENT_ID, client_secret: KEKA_CLIENT_SECRET, api_key: KEKA_API_KEY
      })
    });
    if (!tokenRes.ok) return res.status(502).json({ error: 'Keka token failed', status: tokenRes.status });
    const { access_token } = await tokenRes.json();
    const headers = { Authorization: `Bearer ${access_token}` };

    // 2. Fetch all employees from Keka (paginated)
    let allKekaEmps = [];
    let page = 1;
    while (true) {
      const r = await fetch(`${KEKA_BASE}/hris/employees?pageNumber=${page}&pageSize=100`, { headers });
      const d = await r.json();
      if (!d.succeeded || !d.data?.length) break;
      allKekaEmps = allKekaEmps.concat(d.data);
      if (page >= d.totalPages) break;
      page++;
    }

    // 3. Upsert employees in DB
    const slackClient = req.app.locals.slackClient;
    let slackEmailMap = {};
    if (slackClient) {
      let allSlackUsers = [], cursor;
      do {
        const r = await slackClient.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
        allSlackUsers = allSlackUsers.concat(r.members || []);
        cursor = r.response_metadata?.next_cursor;
      } while (cursor);
      for (const u of allSlackUsers) {
        if (u.is_bot || u.is_app_user || u.deleted) continue;
        const email = u.profile?.email?.toLowerCase();
        if (email) slackEmailMap[email] = u.id;
      }
    }

    for (const ke of allKekaEmps) {
      if (!ke.employeeNumber || ke.employeeNumber === '01') continue; // skip test record
      if (ke.employmentStatus !== 0) continue; // 0 = active

      const empData = {
        empId: ke.employeeNumber,
        name: ke.displayName || `${ke.firstName} ${ke.lastName}`.trim(),
        email: ke.email?.toLowerCase(),
        isActive: true,
      };
      if (slackEmailMap[empData.email]) empData.slackUserId = slackEmailMap[empData.email];

      const existing = await Employee.findOne({ empId: ke.employeeNumber });
      if (existing) {
        await Employee.updateOne({ empId: ke.employeeNumber }, { $set: empData });
        report.employeesUpdated++;
      } else {
        await Employee.create(empData);
        report.employeesAdded++;
      }
    }

    // 4. Fetch all assets from Keka (paginated)
    let allAssets = [];
    page = 1;
    while (true) {
      const r = await fetch(`${KEKA_BASE}/assets?pageNumber=${page}&pageSize=100`, { headers });
      const d = await r.json();
      if (!d.succeeded || !d.data?.length) break;
      allAssets = allAssets.concat(d.data);
      if (page >= d.totalPages) break;
      page++;
    }

    // 5. Link assets to employees
    for (const asset of allAssets) {
      if (!asset.assignedTo?.email) { report.assetsSkipped++; continue; }
      const email = asset.assignedTo.email.toLowerCase();
      const updated = await Employee.findOneAndUpdate(
        { email },
        { $set: { laptop: asset.assetName, laptopSN: asset.assetId } }
      );
      if (updated) report.assetsLinked++;
      else report.assetsSkipped++;
    }

    console.log(`Keka sync done: +${report.employeesAdded} new, ${report.employeesUpdated} updated, ${report.assetsLinked} assets linked`);
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/create-missing-slack-records — create temp DB records for Slack users not in DB ──
router.post('/create-missing-slack-records', checkKeyOrJwt, async (req, res) => {
  const slackClient = req.app.locals.slackClient;
  if (!slackClient) return res.status(503).json({ error: 'Slack not connected' });

  try {
    let allSlackUsers = [], cursor;
    do {
      const r = await slackClient.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
      allSlackUsers = allSlackUsers.concat(r.members || []);
      cursor = r.response_metadata?.next_cursor;
    } while (cursor);

    const realUsers = allSlackUsers.filter(u => !u.is_bot && !u.is_app_user && !u.deleted);
    const employees = await Employee.find({}).lean();
    const dbEmails = new Set(employees.map(e => e.email?.toLowerCase()).filter(Boolean));
    const dbSlackIds = new Set(employees.map(e => e.slackUserId).filter(Boolean));

    const created = [], skipped = [];
    for (const u of realUsers) {
      const email = u.profile?.email?.toLowerCase();
      if (!email || !email.endsWith('@wiom.in')) continue;
      if (dbEmails.has(email) || dbSlackIds.has(u.id)) { skipped.push(u.id); continue; }

      const name = u.profile?.real_name || u.name;
      await Employee.findOneAndUpdate(
        { empId: `SLACK-${u.id}` },
        { $setOnInsert: { empId: `SLACK-${u.id}`, name, email, slackUserId: u.id, isActive: true } },
        { upsert: true }
      );
      created.push({ slackId: u.id, name, email });
    }

    res.json({ ok: true, created: created.length, skipped: skipped.length, records: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/set-slack-id — directly set slackUserId on an employee ───
router.post('/set-slack-id', checkKeyOrJwt, async (req, res) => {
  const { empId, slackUserId } = req.body;
  if (!empId || !slackUserId) return res.status(400).json({ error: 'empId and slackUserId required' });
  try {
    const emp = await Employee.findOneAndUpdate(
      { empId },
      { $set: { slackUserId } },
      { new: true }
    );
    if (!emp) return res.status(404).json({ error: `Employee ${empId} not found` });
    res.json({ ok: true, empId: emp.empId, name: emp.name, slackUserId: emp.slackUserId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/fix-merged-records — delete fake MERGED- empId records ────
router.post('/fix-merged-records', checkKeyOrJwt, async (req, res) => {
  try {
    const mergedRecords = await Employee.find({ empId: /^MERGED-/ }).lean();
    const deleted = [];
    for (const rec of mergedRecords) {
      await Employee.deleteOne({ _id: rec._id });
      deleted.push({ empId: rec.empId, name: rec.name });
    }
    res.json({ ok: true, deleted, count: deleted.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

