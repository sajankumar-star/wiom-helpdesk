const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  empId    : { type: String, required: true },
  empName  : { type: String, required: true },
  empEmail : { type: String },
  slackUserId: { type: String },
  date     : { type: String, required: true },  // "2024-01-15"
  timeSlot : { type: String, required: true },  // "10:00 AM"
  reason   : { type: String, required: true },
  status   : { type: String, enum: ['Pending','Confirmed','Cancelled','Done'], default: 'Pending' },
  notes    : { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);
