const router   = require('express').Router();
const Employee = require('../models/Employee');
const { verifyAdmin } = require('../middleware/auth');

// ── Allowed fields for employee create/update (BUG-02 fix: prevent mass-assignment) ──
const allowedEmployeeFields = [
  'empId','name','email','department','designation','floor','phone',
  'laptop','laptopSN','isActive','slackUserId','slackHandle',
  'managerSlackId','managerName'
];
const pickAllowed = (body) => {
  const safe = {};
  for (const key of allowedEmployeeFields) {
    if (body[key] !== undefined) safe[key] = body[key];
  }
  return safe;
};

// ── GET /api/employees  — List all ───────────────────────────────────────────
router.get('/', verifyAdmin, async (req, res) => {
  try {
    const { dept, floor, search } = req.query;
    const filter = { isActive: true };
    if (dept)   filter.department = dept;
    if (floor)  filter.floor      = floor;
    if (search) {
      const s = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name  : { $regex: s, $options: 'i' } },
        { empId : { $regex: s, $options: 'i' } },
        { email : { $regex: s, $options: 'i' } }
      ];
    }
    const emps = await Employee.find(filter).sort({ name: 1 });
    res.json({ employees: emps, total: emps.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/employees/:empId ─────────────────────────────────────────────────
router.get('/:empId', verifyAdmin, async (req, res) => {
  try {
    const emp = await Employee.findOne({ empId: req.params.empId.toUpperCase() });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/employees  — Add employee ───────────────────────────────────────
router.post('/', verifyAdmin, async (req, res) => {
  try {
    // BUG-02 fix: only allowed fields are saved
    const data = pickAllowed(req.body);
    if (!data.empId || !data.name)
      return res.status(400).json({ error: 'empId and name required' });
    data.empId = data.empId.toUpperCase();
    const emp = await Employee.create(data);
    res.status(201).json({ success: true, employee: emp });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Employee ID already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/employees/bulk  — Bulk import from JSON ─────────────────────────
router.post('/bulk', verifyAdmin, async (req, res) => {
  try {
    const { employees } = req.body;
    if (!Array.isArray(employees)) return res.status(400).json({ error: 'employees array required' });

    // BUG-25 fix: track inserts vs updates separately
    const results = { inserted: 0, updated: 0, errors: [] };
    for (const e of employees) {
      try {
        const data = pickAllowed(e);
        if (!data.empId) { results.errors.push({ empId: e.empId, error: 'empId required' }); continue; }
        data.empId = data.empId.toUpperCase();

        const existing = await Employee.exists({ empId: data.empId });
        await Employee.findOneAndUpdate(
          { empId: data.empId },
          { $set: data },
          { upsert: true, new: true }
        );
        if (existing) {
          results.updated++;
        } else {
          results.inserted++;
        }
      } catch (err) {
        results.errors.push({ empId: e.empId, error: err.message });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/employees/:empId  — Update employee ───────────────────────────
router.patch('/:empId', verifyAdmin, async (req, res) => {
  try {
    // BUG-02 fix: only allowed fields are updated
    const data = pickAllowed(req.body);
    if (!Object.keys(data).length)
      return res.status(400).json({ error: 'No valid fields to update' });

    const emp = await Employee.findOneAndUpdate(
      { empId: req.params.empId.toUpperCase() },
      { $set: data },
      { new: true }
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true, employee: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/employees/:empId/slack  — Link Slack user ID ──────────────────
router.patch('/:empId/slack', verifyAdmin, async (req, res) => {
  try {
    const { slackUserId, slackHandle } = req.body;
    const emp = await Employee.findOneAndUpdate(
      { empId: req.params.empId.toUpperCase() },
      { slackUserId, slackHandle }
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/employees/:empId/manager  — Set reporting manager ─────────────
router.patch('/:empId/manager', verifyAdmin, async (req, res) => {
  try {
    const { managerSlackId, managerName } = req.body;
    if (!managerSlackId) return res.status(400).json({ error: 'managerSlackId required' });
    const emp = await Employee.findOneAndUpdate(
      { empId: req.params.empId.toUpperCase() },
      { managerSlackId, managerName: managerName || '' },
      { new: true }
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true, employee: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/employees/search  — Search by name for Slack external_select ────
router.get('/search/options', verifyAdmin, async (req, res) => {
  try {
    const raw = req.query.q || '';
    const q = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emps = await Employee.find({
      isActive: true,
      $or: [
        { name  : { $regex: q, $options: 'i' } },
        { empId : { $regex: q, $options: 'i' } },
      ]
    }).limit(20).select('empId name slackUserId').lean();

    // Slack external_select format
    const options = emps.map(e => ({
      text : { type: 'plain_text', text: `${e.name} (${e.empId})` },
      value: JSON.stringify({ slackId: e.slackUserId || '', name: e.name, empId: e.empId }),
    }));
    res.json({ options });
  } catch (err) {
    res.status(500).json({ options: [] });
  }
});

module.exports = router;
