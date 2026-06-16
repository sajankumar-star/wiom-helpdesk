const jwt   = require('jsonwebtoken');
const Admin = require('../models/Admin');

// ── Verify JWT for admin routes ───────────────────────────────────────────────
// BUG-11 fix: DB check ensures deactivated admins can't use old tokens
const verifyAdmin = async (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Confirm admin still exists and is active in DB
    const admin = await Admin.findOne({ _id: decoded.id, isActive: true }).lean();
    if (!admin) return res.status(401).json({ error: 'Account deactivated or not found' });

    req.admin = admin;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── Verify Slack secret (for Slack webhook calls) ─────────────────────────────
const verifySlackSecret = (req, res, next) => {
  const secret = req.headers['x-slack-secret'];
  if (secret !== process.env.SLACK_INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

// ── Simple employee token (lighter, no DB check) ──────────────────────────────
const verifyEmployee = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { verifyAdmin, verifyEmployee, verifySlackSecret };
