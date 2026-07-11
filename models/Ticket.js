const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

const commentSchema = new mongoose.Schema({
  author  : { type: String, required: true },
  role    : { type: String, enum: ['employee','admin','bot'], default: 'admin' },
  message : { type: String, required: true },
  addedAt : { type: Date, default: Date.now }
});

const ticketSchema = new mongoose.Schema({
  // ── Identity ────────────────────────────────────────────────────────────────
  ticketId   : { type: String, unique: true },   // WIOM-TKT-0001
  empId      : { type: String, required: true },  // Keka ID
  empName    : { type: String, required: true },
  empEmail   : { type: String },
  empDept    : { type: String },
  empFloor   : { type: String },
  laptop     : { type: String },                  // Assigned laptop model
  laptopSN   : { type: String },                  // BUG-16 fix: serial number persisted with ticket

  // ── Issue Details ────────────────────────────────────────────────────────────
  category   : {
    type: String,
    // BUG-24 fix: added 'Theft/Loss'; also added Slack bot categories
    enum: ['Hardware','Software','Network','Account','Purchase','Theft/Loss','Asset Request','Software Request','Emergency','Other'],
    default: 'Other'
  },
  priority   : {
    type: String,
    enum: ['Critical','High','Medium','Low'],
    default: 'Medium'
  },
  description: { type: String, required: true },
  source     : { type: String, enum: ['slack','slack-emergency','web','whatsapp','manual','employee-query-bot'], default: 'web' },

  // ── Status ───────────────────────────────────────────────────────────────────
  status     : {
    type: String,
    enum: ['Open','In Progress','Waiting','Resolved','Closed'],
    default: 'Open'
  },
  assignedTo : { type: String, default: 'IT Team' },

  // ── SLA Tracking ────────────────────────────────────────────────────────────
  slaHours       : { type: Number },          // SLA target in hours
  slaDeadline    : { type: Date },            // Exact deadline datetime
  slaBreached    : { type: Boolean, default: false },
  reminderSent   : { type: Boolean, default: false }, // SLA approach warning (admin email)
  empReminderSent: { type: Boolean, default: false }, // Employee 4h Slack reminder (BUG-12 fix)
  escalationSent : { type: Boolean, default: false },

  // ── Resolution ───────────────────────────────────────────────────────────────
  resolvedBy    : { type: String, enum: ['AI','Human'], default: null },
  resolution    : { type: String },
  resolvedAt    : { type: Date },
  closedAt      : { type: Date },
  closedReason  : { type: String },                   // e.g. 'Cancelled by employee via Slack'
  reopenedAt    : { type: Date },
  reopenedBy    : { type: String },                   // Slack user ID who reopened
  userRating    : { type: Number, min: 1, max: 5 },
  userFeedback  : { type: String },

  // ── AI / Slack Meta ──────────────────────────────────────────────────────────
  slackUserId   : { type: String },
  slackChannelId: { type: String },
  slackTs       : { type: String },           // Slack message timestamp
  aiSessionId   : { type: String },           // Linked conversation session
  aiTried       : { type: Boolean, default: false },
  aiSteps       : [{ type: String }],         // Steps AI suggested
  aiNotes       : { type: String },           // Free-text notes from the querying bot (e.g. what it already told the employee)
  screenshots   : [{ type: String }],         // Base64 images attached by employee
  escalated     : { type: Boolean, default: false }, // Employee clicked "Talk to Human"
  escalatedAt   : { type: Date },

  // ── Comments / Updates ───────────────────────────────────────────────────────
  comments      : [commentSchema],

}, { timestamps: true });

// ── Auto-generate ticket ID ──────────────────────────────────────────────────
ticketSchema.pre('save', async function (next) {
  if (!this.ticketId) {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'ticketId' },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    this.ticketId = `WIOM-TKT-${String(counter.seq).padStart(4, '0')}`;
  }

  // Auto-set SLA hours from priority
  if (!this.slaHours) {
    const slaMap = { Critical: 2, High: 8, Medium: 24, Low: 72 };
    this.slaHours = slaMap[this.priority] || 24;
  }

  // Auto-set SLA deadline
  if (!this.slaDeadline) {
    const d = new Date(this.createdAt || Date.now());
    d.setHours(d.getHours() + this.slaHours);
    this.slaDeadline = d;
  }

  next();
});

// ── Virtual: hours open ──────────────────────────────────────────────────────
ticketSchema.virtual('hoursOpen').get(function () {
  const end = this.resolvedAt || new Date();
  return Math.round((end - this.createdAt) / 3600000);
});

ticketSchema.set('toJSON', { virtuals: true });

// ── Indexes ───────────────────────────────────────────────────────────────────
ticketSchema.index({ empId: 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ slaDeadline: 1, status: 1 });

module.exports = mongoose.model('Ticket', ticketSchema);
