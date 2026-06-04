const mongoose = require('mongoose');
const unknownQuerySchema = new mongoose.Schema({
  query: { type: String, required: true },
  normalizedQuery: { type: String },
  detectedIntent: { type: String, default: 'unknown' },
  detectedCategory: { type: String, default: 'unknown' },
  confidence: { type: Number, default: 0 },
  empId: { type: String },
  empName: { type: String },
  source: { type: String, default: 'slack' },
  attempts: { type: Number, default: 1 },
  escalated: { type: Boolean, default: false },
  resolved: { type: Boolean, default: false },
}, { timestamps: true });
unknownQuerySchema.index({ createdAt: -1 });
unknownQuerySchema.index({ normalizedQuery: 1 });
module.exports = mongoose.model('UnknownQuery', unknownQuerySchema);
