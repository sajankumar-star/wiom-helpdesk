const router   = require('express').Router();
const Employee = require('../models/Employee');
const { verifyAdmin } = require('../middleware/auth');

// ── GET /api/employees  — List all ───────────────────────────────────────────
router.get('/', verifyAdmin, async (req, res) => {
  try {
    const { dept, floor, search } = req.query;
    const filter = { isActive: true };
    if (dept)   filter.department = dept;
    if (floor)  filter.floor      = floor;
    if (search) filter.$or = [
      { name  : { $regex: search, $options: 'i' } },
      { empId : { $regex: search, $options: 'i' } },
      { email : { $regex: search, $options: 'i' } }
    ];
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
    const emp = await Employee.create(req.body);
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

    const results = { inserted: 0, updated: 0, errors: [] };
    for (const e of employees) {
      try {
        await Employee.findOneAndUpdate(
          { empId: e.empId.toUpperCase() },
          e,
          { upsert: true, new: true }
        );
        results.inserted++;
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
    const emp = await Employee.findOneAndUpdate(
      { empId: req.params.empId.toUpperCase() },
      req.body,
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
    await Employee.findOneAndUpdate(
      { empId: req.params.empId.toUpperCase() },
      { slackUserId, slackHandle }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
