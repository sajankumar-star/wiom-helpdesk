const mongoose = require('mongoose');

const botResolutionSchema = new mongoose.Schema({
  slackUserId : { type: String, required: true },
  empId       : { type: String, default: '' },
  empName     : { type: String, default: '' },
  resolvedAt  : { type: Date, default: Date.now },
});

botResolutionSchema.index({ resolvedAt: -1 });
botResolutionSchema.index({ slackUserId: 1 });

module.exports = mongoose.models.BotResolution || mongoose.model('BotResolution', botResolutionSchema);
