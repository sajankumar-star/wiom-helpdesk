const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  // ── Identity ─────────────────────────────────────────────────────────────────
  empId      : { type: String, required: true, unique: true, uppercase: true }, // Keka ID
  name       : { type: String, required: true },
  email      : { type: String, required: true, lowercase: true },
  phone      : { type: String },

  // ── Office Info ───────────────────────────────────────────────────────────────
  department : { type: String },
  designation: { type: String },
  floor      : { type: String },            // "Ground Floor", "First Floor"
  location   : { type: String, default: 'Gurgaon' },

  // ── Asset ─────────────────────────────────────────────────────────────────────
  laptop     : { type: String },            // e.g. "HP 250 G8 SN:XYZ123"
  laptopSN   : { type: String },
  accessories: [{ type: String }],          // ["Mouse","Headset"]

  // ── Slack / Auth ──────────────────────────────────────────────────────────────
  slackUserId: { type: String },
  slackHandle: { type: String },
  isActive   : { type: Boolean, default: true },

  // ── Reporting Manager ─────────────────────────────────────────────────────────
  managerSlackId: { type: String },   // Slack User ID of reporting manager
  managerName   : { type: String },   // Display name of reporting manager
  managerId     : { type: String },   // Keka ID of reporting manager (for cross-ref)

  // ── Auto-Fix Agent ────────────────────────────────────────────────────────────
  agentRegistered : { type: Boolean, default: false },
  agentVersion    : { type: String },
  agentLastSeen   : { type: Date },

  // ── Stats ─────────────────────────────────────────────────────────────────────
  totalTickets    : { type: Number, default: 0 },
  resolvedByAI    : { type: Number, default: 0 },
  lastLogin       : { type: Date },
  lastTicket      : { type: Date },

}, { timestamps: true });

// Note: empId index is already created via unique:true above — no duplicate needed
employeeSchema.index({ email: 1 });
employeeSchema.index({ slackUserId: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
