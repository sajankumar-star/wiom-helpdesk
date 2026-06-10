const router   = require('express').Router();
const jwt      = require('jsonwebtoken');
const Admin    = require('../models/Admin');
const Employee = require('../models/Employee');
const { verifyAdmin } = require('../middleware/auth');

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
// Employees login with Keka empId (internal tool — no password by design)
router.post('/employee-login', async (req, res) => {
  try {
    const { empId } = req.body;
    if (!empId) return res.status(400).json({ error: 'Employee ID required' });

    const emp = await Employee.findOne({ empId: empId.toUpperCase(), isActive: true });
    if (!emp) return res.status(404).json({ error: 'Employee not found. Contact IT Admin.' });

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
// BUG-04 fix: disabled by default — only active when SETUP_ENABLED=true (not SETUP_DISABLED)
// Run once on fresh deploy to create first admin, then remove SETUP_ENABLED from env
router.post('/setup-admin', async (req, res) => {
  if (process.env.SETUP_ENABLED !== 'true')
    return res.status(403).json({ error: 'Setup is disabled. Set SETUP_ENABLED=true in env to enable.' });

  try {
    const count = await Admin.countDocuments();
    if (count > 0) return res.status(400).json({ error: 'Admin already exists. Use admin panel to add more.' });

    const { password, name, email } = req.body;
    if (!password || password.length < 8)
      return res.status(400).json({ error: 'Password required (min 8 chars)' });

    // BUG-03 fix: use a proper username, require password explicitly
    const admin = await Admin.create({
      username    : 'it_admin',
      passwordHash: password,
      name        : name || 'IT Admin',
      email       : email || process.env.ADMIN_EMAIL || 'it@wiom.in',
      role        : 'superadmin'
    });

    res.json({ message: 'Admin created successfully', username: admin.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/change-password ────────────────────────────────────────────
router.post('/change-password', verifyAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'currentPassword and newPassword required' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const admin = await Admin.findById(req.admin._id || req.admin.id);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    const ok = await admin.comparePassword(currentPassword);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    admin.passwordHash = newPassword; // pre-save hook will hash it
    await admin.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
