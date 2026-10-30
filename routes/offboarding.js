const router      = require('express').Router();
const mongoose    = require('mongoose');
const Employee    = require('../models/Employee');
const Offboarding = require('../models/Offboarding');
const { verifyAdmin } = require('../middleware/auth');
const exitSvc     = require('../services/offboarding');

const STEPS = ['gmail', 'slack', 'laptop'];
const isFinal = (s) => s === 'Done' || s === 'Skipped';

// Load case by :id (404 if missing / bad id)
const loadCase = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: 'Exit case not found' }); return null; }
  const ob = await Offboarding.findById(req.params.id);
  if (!ob) { res.status(404).json({ error: 'Exit case not found' }); return null; }
  return ob;
};

// All 3 steps done → case Completed + employee inactive
const finalizeIfDone = async (ob) => {
  if (ob.status === 'Completed') return;
  if (STEPS.every(s => isFinal(ob[s].status))) {
    ob.status      = 'Completed';
    ob.completedAt = new Date();
    await Employee.updateOne({ empId: ob.empId }, { $set: { isActive: false } });
  }
};

const markStep = (ob, step, { status, mode, by, error, note }) => {
  ob[step] = { status, mode, at: new Date(), by, error: error || undefined, note: note || ob[step].note };
};

// Run one auto step (gmail / slack) against the API, record result on the case
const runAuto = async (ob, step, by) => {
  try {
    if (step === 'gmail') {
      await exitSvc.suspendGoogleUser(ob.email);
    } else {
      const r = await exitSvc.deactivateSlackUser({ slackUserId: ob.slackUserId, email: ob.email });
      ob.slackUserId = r.slackUserId;
    }
    markStep(ob, step, { status: 'Done', mode: 'auto', by });
  } catch (err) {
    markStep(ob, step, { status: 'Failed', mode: 'auto', by, error: err.message });
  }
};

// ── GET /api/offboarding/integrations — kaunsa API configured hai ────────────
router.get('/integrations', verifyAdmin, (req, res) => {
  res.json(exitSvc.integrationStatus());
});

// ── GET /api/offboarding — List exit cases ───────────────────────────────────
router.get('/', verifyAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const cases = await Offboarding.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ cases, total: cases.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/offboarding — Start exit for an employee ───────────────────────
router.post('/', verifyAdmin, async (req, res) => {
  try {
    const { empId, lastWorkingDay, reason } = req.body;
    if (!empId) return res.status(400).json({ error: 'empId required' });

    const emp = await Employee.findOne({ empId: String(empId).toUpperCase() }).lean();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const existing = await Offboarding.findOne({ empId: emp.empId, status: 'In Progress' });
    if (existing) return res.json({ success: true, case: existing, existing: true });

    const ob = await Offboarding.create({
      empId      : emp.empId,
      name       : emp.name,
      email      : emp.email,
      department : emp.department,
      slackUserId: emp.slackUserId,
      laptopModel: emp.laptop,
      laptopSN   : emp.laptopSN,
      lastWorkingDay: lastWorkingDay ? new Date(lastWorkingDay) : undefined,
      reason     : reason || undefined,
      startedBy  : req.admin.name,
    });
    res.status(201).json({ success: true, case: ob });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/offboarding/:id/run-all — Gmail + Slack ek click mein ──────────
router.post('/:id/run-all', verifyAdmin, async (req, res) => {
  try {
    const ob = await loadCase(req, res);
    if (!ob) return;
    const cfg = exitSvc.integrationStatus();
    if (cfg.google && !isFinal(ob.gmail.status)) await runAuto(ob, 'gmail', req.admin.name);
    if (cfg.slack  && !isFinal(ob.slack.status)) await runAuto(ob, 'slack', req.admin.name);
    await finalizeIfDone(ob);
    await ob.save();
    res.json({ success: true, case: ob });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/offboarding/:id/gmail | /slack ─────────────────────────────────
// body.mode: 'auto' (API se band karo) | 'manual' (maine khud kar diya) | 'skip'
router.post('/:id/:step(gmail|slack)', verifyAdmin, async (req, res) => {
  try {
    const ob = await loadCase(req, res);
    if (!ob) return;
    const { step } = req.params;
    const mode = req.body.mode || 'auto';
    const by   = req.admin.name;

    if (mode === 'auto')        await runAuto(ob, step, by);
    else if (mode === 'manual') markStep(ob, step, { status: 'Done',    mode: 'manual', by, note: req.body.note });
    else if (mode === 'skip')   markStep(ob, step, { status: 'Skipped', mode: 'manual', by, note: req.body.note });
    else return res.status(400).json({ error: 'mode must be auto, manual or skip' });

    await finalizeIfDone(ob);
    await ob.save();
    res.json({ success: ob[step].status !== 'Failed', case: ob, error: ob[step].error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/offboarding/:id/laptop — Laptop + accessories received ─────────
router.post('/:id/laptop', verifyAdmin, async (req, res) => {
  try {
    const ob = await loadCase(req, res);
    if (!ob) return;
    const { condition, charger, bag, mouse, idCard, other, note, mode } = req.body;

    if (mode === 'skip') {
      markStep(ob, 'laptop', { status: 'Skipped', mode: 'manual', by: req.admin.name, note });
    } else {
      if (!condition) return res.status(400).json({ error: 'Laptop condition required' });
      ob.laptopReceived = { condition, charger: !!charger, bag: !!bag, mouse: !!mouse, idCard: !!idCard, other };
      // "Not Returned" = still pending recovery, not done
      const status = condition === 'Not Returned' ? 'Pending' : 'Done';
      markStep(ob, 'laptop', { status, mode: 'manual', by: req.admin.name, note });
    }

    await finalizeIfDone(ob);
    await ob.save();
    res.json({ success: true, case: ob });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
