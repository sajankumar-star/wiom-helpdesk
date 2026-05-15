const router   = require('express').Router();
const jwt      = require('jsonwebtoken');
const Admin    = require('../models/Admin');
const Employee = require('../models/Employee');

const sign = (payload, expiresIn = '24h') =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });

// ── POST /api/auth/admin-login ────────────────────────────────────────────────
router.post('/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const admin = await Admin.findOne({ username: username.toLowerCase(), isActive: true });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await admin.comparePassword(password);
    if (!ok)  return res.status(401).json({ error: 'Invalid credentials' });

    admin.lastLogin = new Date();
    await admin.save();

    const token = sign({ id: admin._id, username: admin.username, role: admin.role, name: admin.name });
    res.json({ token, name: admin.name, role: admin.role });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/employee-login ─────────────────────────────────────────────
// Employees login with Keka empId (no password — internal tool)
router.post('/employee-login', async (req, res) => {
  try {
    const { empId } = req.body;
    if (!empId) return res.status(400).json({ error: 'Employee ID required' });

    const emp = await Employee.findOne({ empId: empId.toUpperCase(), isActive: true });
    if (!emp) return res.status(404).json({ error: 'Employee not found. Contact ADMIN_EMAIL.' });

    emp.lastLogin = new Date();
    await emp.save();

    const token = sign({
      empId  : emp.empId,
      name   : emp.name,
      email  : emp.email,
      dept   : emp.department,
      floor  : emp.floor,
      laptop : emp.laptop
    });

    res.json({
      token,
      empId  : emp.empId,
      name   : emp.name,
      dept   : emp.department,
      floor  : emp.floor,
      laptop : emp.laptop,
      email  : emp.email
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/setup-admin ────────────────────────────────────────────────
// Run once to create first admin (disable after)
router.post('/setup-admin', async (req, res) => {
  if (process.env.SETUP_DISABLED === 'true')
    return res.status(403).json({ error: 'Setup disabled' });

  try {
    const existing = await Admin.findOne({ username: 'ADMIN_EMAIL' });
    if (existing) return res.status(400).json({ error: 'Admin already exists' });

    const admin = await Admin.create({
      username    : 'ADMIN_EMAIL',
      passwordHash: req.body.password || 'Wiom@2024',
      name        : 'IT Admin',
      email       : process.env.ADMIN_EMAIL || 'it@wiom.in',
      role        : 'superadmin'
    });

    res.json({ message: 'Admin created', username: admin.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
