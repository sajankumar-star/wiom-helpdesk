const Ticket   = require('../models/Ticket');
const emailSvc = require('./email');

// ── Check all open tickets for SLA breaches ───────────────────────────────────
const checkBreaches = async () => {
  try {
    const now = new Date();

    // Find open tickets past their SLA deadline
    const breached = await Ticket.find({
      status      : { $in: ['Open', 'In Progress', 'Waiting'] },
      slaDeadline : { $lte: now },
      slaBreached : false
    });

    for (const ticket of breached) {
      ticket.slaBreached = true;
      await ticket.save();
      await emailSvc.sendSLABreachAlert(ticket);
      console.log(`🚨 SLA breached: ${ticket.ticketId} (${ticket.empName})`);
    }

    // Find tickets approaching SLA (within 1 hour) — send reminder
    const oneHourFromNow = new Date(now.getTime() + 3600000);
    const approaching = await Ticket.find({
      status        : { $in: ['Open', 'In Progress'] },
      slaDeadline   : { $lte: oneHourFromNow, $gt: now },
      reminderSent  : false,
      slaBreached   : false
    });

    for (const ticket of approaching) {
      ticket.reminderSent = true;
      await ticket.save();
      await emailSvc.sendAdminAlert({ ...ticket.toObject(), _slaWarning: true });
      console.log(`⚠️  SLA warning sent: ${ticket.ticketId}`);
    }

    if (breached.length || approaching.length) {
      console.log(`SLA check: ${breached.length} breached, ${approaching.length} approaching`);
    }

  } catch (err) {
    console.error('SLA check error:', err.message);
  }
};

// ── Get SLA status for a ticket ───────────────────────────────────────────────
const getSLAStatus = (ticket) => {
  if (!ticket.slaDeadline) return { status: 'Unknown', hoursLeft: null };
  const now      = new Date();
  const deadline = new Date(ticket.slaDeadline);
  const msLeft   = deadline - now;
  const hoursLeft= Math.round(msLeft / 3600000);

  if (ticket.status === 'Resolved') return { status: 'resolved', label: '✅ Resolved' };
  if (msLeft < 0)                   return { status: 'breached', label: `🔴 Breached (${Math.abs(hoursLeft)}h ago)`, hoursLeft };
  if (hoursLeft <= 1)               return { status: 'critical', label: `🟠 ${hoursLeft}h left`, hoursLeft };
  if (hoursLeft <= 4)               return { status: 'warning',  label: `🟡 ${hoursLeft}h left`, hoursLeft };
  return                                   { status: 'ok',       label: `🟢 ${hoursLeft}h left`, hoursLeft };
};

module.exports = { checkBreaches, getSLAStatus };
