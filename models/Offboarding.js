const mongoose = require('mongoose');

// ── One step of the exit checklist (Gmail / Slack / Laptop) ─────────────────
const stepSchema = new mongoose.Schema({
  status : { type: String, enum: ['Pending','Done','Failed','Skipped'], default: 'Pending' },
  mode   : { type: String, enum: ['auto','manual'] },   // auto = API se, manual = admin ne khud kiya
  at     : { type: Date },
  by     : { type: String },                            // admin name
  error  : { type: String },
  note   : { type: String },
}, { _id: false });

const offboardingSchema = new mongoose.Schema({
  // ── Employee snapshot (exit ke time ka) ──────────────────────────────────────
  empId       : { type: String, required: true, uppercase: true },
  name        : { type: String, required: true },
  email       : { type: String, lowercase: true },
  department  : { type: String },
  slackUserId : { type: String },
  laptopModel : { type: String },
  laptopSN    : { type: String },

  lastWorkingDay: { type: Date },
  reason        : { type: String },   // Resigned / Terminated / Absconding / Contract End / Other

  // ── Checklist ────────────────────────────────────────────────────────────────
  gmail  : { type: stepSchema, default: () => ({}) },
  slack  : { type: stepSchema, default: () => ({}) },
  laptop : { type: stepSchema, default: () => ({}) },

  // Laptop handover details
  laptopReceived: {
    condition  : { type: String },     // Good / Damaged / Not Returned
    charger    : { type: Boolean, default: false },
    bag        : { type: Boolean, default: false },
    mouse      : { type: Boolean, default: false },
    idCard     : { type: Boolean, default: false },
    other      : { type: String },
  },

  status     : { type: String, enum: ['In Progress','Completed'], default: 'In Progress' },
  startedBy  : { type: String },
  completedAt: { type: Date },
}, { timestamps: true });

offboardingSchema.index({ empId: 1 });
offboardingSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Offboarding', offboardingSchema);
