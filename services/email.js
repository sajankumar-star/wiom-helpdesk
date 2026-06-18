const nodemailer = require('nodemailer');

// ── Email enabled? (only if SMTP_PASS is a real value, not placeholder) ───────
const EMAIL_ENABLED = !!(
  process.env.SMTP_PASS &&
  process.env.SMTP_PASS !== 'FILL_KARO' &&
  process.env.SMTP_PASS.length > 8 &&
  process.env.SMTP_USER
);

if (!EMAIL_ENABLED) {
  console.log('📧 Email: DISABLED (SMTP_PASS not configured — Slack notifications active)');
}

// ── Transporter (Gmail App Password or SendGrid SMTP) ─────────────────────────
const transporter = EMAIL_ENABLED ? nodemailer.createTransport({
  host  : process.env.SMTP_HOST   || 'smtp.gmail.com',
  port  : process.env.SMTP_PORT   || 587,
  secure: false,
  auth  : {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
}) : null;

const FROM    = `"WIOM IT Helpdesk" <${process.env.SMTP_USER}>`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'it@wiom.in';

// ── Priority colors ───────────────────────────────────────────────────────────
const priColor = { Critical:'#ef4444', High:'#f97316', Medium:'#eab308', Low:'#22c55e' };

const he = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Email template wrapper ────────────────────────────────────────────────────
const wrap = (body) => `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
  <div style="background:linear-gradient(135deg,#1e1b4b,#E8197D);padding:24px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px">🛠 WIOM IT Helpdesk</h1>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0">Automated Ticket Notification</p>
  </div>
  <div style="padding:24px">${body}</div>
  <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">
    WIOM Internet Services | IT Department | Gurgaon | IT Helpdesk (Slack)
  </div>
</div>
</body></html>`;

// ── Send ticket confirmation to employee ──────────────────────────────────────
const sendTicketConfirmation = async (ticket) => {
  if (!EMAIL_ENABLED || !ticket.empEmail) return;

  const color = priColor[ticket.priority] || '#6b7280';
  const html  = wrap(`
    <p style="color:#374151">Hi <strong>${ticket.empName || ticket.empId}</strong>,</p>
    <p style="color:#374151">Aapka IT ticket create ho gaya hai. IT team jald hi aapki problem solve karegi.</p>

    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0;border-left:4px solid ${color}">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Ticket ID</td>
            <td style="padding:4px 0;font-weight:600;color:#1f2937;font-family:monospace">${ticket.ticketId}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Category</td>
            <td style="padding:4px 0;color:#1f2937">${ticket.category}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Priority</td>
            <td style="padding:4px 0"><span style="background:${color};color:#fff;padding:2px 10px;border-radius:20px;font-size:12px">${ticket.priority}</span></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">SLA</td>
            <td style="padding:4px 0;color:#1f2937">Resolution in ${ticket.slaHours} hours</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Issue</td>
            <td style="padding:4px 0;color:#1f2937">${ticket.description}</td></tr>
      </table>
    </div>

    <p style="color:#374151;font-size:14px">Koi bhi update ke liye IT Admin se directly contact karein:<br>
    📱 <strong>IT Helpdesk (Slack)</strong> | 📧 <strong>${ADMIN_EMAIL}</strong></p>
  `);

  if (!transporter) return;
  await transporter.sendMail({
    from   : FROM,
    to     : ticket.empEmail,
    subject: `[${ticket.ticketId}] Aapka IT ticket create ho gaya — ${ticket.category} (${ticket.priority})`,
    html
  });
};

// ── Send alert to ADMIN_EMAIL ───────────────────────────────────────────────────────
const sendAdminAlert = async (ticket) => {
  if (!EMAIL_ENABLED) return;
  const color = priColor[ticket.priority] || '#6b7280';
  const isCrit = ticket.priority === 'Critical' || ticket.priority === 'High';

  const html = wrap(`
    ${isCrit ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:16px;text-align:center"><strong style="color:#dc2626">🚨 URGENT — ${he(ticket.priority)} Priority Ticket</strong></div>` : ''}

    <p style="color:#374151">Naya IT ticket aaya hai:</p>

    <div style="background:#f9fafb;border-radius:8px;padding:16px;border-left:4px solid ${color}">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;width:120px">Ticket ID</td>
            <td style="padding:4px 0;font-weight:700;color:#1f2937;font-family:monospace;font-size:15px">${he(ticket.ticketId)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Employee</td>
            <td style="padding:4px 0;color:#1f2937">${he(ticket.empName || ticket.empId)} (${he(ticket.empId)})</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Department</td>
            <td style="padding:4px 0;color:#1f2937">${he(ticket.empDept || 'N/A')} — ${he(ticket.empFloor || 'N/A')}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Category</td>
            <td style="padding:4px 0;color:#1f2937">${he(ticket.category)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Priority</td>
            <td style="padding:4px 0"><span style="background:${color};color:#fff;padding:2px 10px;border-radius:20px;font-size:12px">${he(ticket.priority)}</span></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">SLA Deadline</td>
            <td style="padding:4px 0;color:#dc2626;font-weight:600">${ticket.slaDeadline ? new Date(ticket.slaDeadline).toLocaleString('en-IN') : 'N/A'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Source</td>
            <td style="padding:4px 0;color:#1f2937">${he(ticket.source)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">AI Tried</td>
            <td style="padding:4px 0;color:#1f2937">${ticket.aiTried ? '✅ Yes — ' + (ticket.aiSteps?.length || 0) + ' steps' : '❌ No'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;vertical-align:top">Issue</td>
            <td style="padding:4px 0;color:#1f2937">${he(ticket.description)}</td></tr>
      </table>
    </div>

    ${ticket.aiSteps?.length ? `
    <div style="margin-top:12px;background:#eff6ff;border-radius:8px;padding:12px;font-size:13px">
      <strong style="color:#1d4ed8">🤖 AI ne ye steps try kiye:</strong>
      <ol style="margin:8px 0 0;padding-left:20px;color:#374151">
        ${ticket.aiSteps.map(s => `<li style="margin-bottom:4px">${he(s)}</li>`).join('')}
      </ol>
    </div>` : ''}
  `);

  if (!transporter) return;
  await transporter.sendMail({
    from   : FROM,
    to     : ADMIN_EMAIL,
    subject: `${isCrit ? '🚨 URGENT ' : ''}[${ticket.ticketId}] ${ticket.category} — ${ticket.empName || ticket.empId} (${ticket.priority})`,
    html
  });
};

// ── Send resolution notification to employee ──────────────────────────────────
const sendResolutionEmail = async (ticket) => {
  if (!EMAIL_ENABLED || !ticket.empEmail) return;

  const html = wrap(`
    <p style="color:#374151">Hi <strong>${ticket.empName || ticket.empId}</strong>,</p>
    <div style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;margin:16px 0;border:1px solid #86efac">
      <div style="font-size:32px">✅</div>
      <h3 style="color:#15803d;margin:8px 0">Aapki problem solve ho gayi!</h3>
      <p style="color:#166534;font-size:14px;margin:0">Ticket <strong>${ticket.ticketId}</strong> resolve kar diya gaya hai</p>
    </div>
    ${ticket.resolution ? `
    <div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:16px">
      <strong style="color:#374151;font-size:13px">Resolution:</strong>
      <p style="color:#1f2937;margin:8px 0 0">${ticket.resolution}</p>
    </div>` : ''}
    <p style="color:#374151;font-size:14px">Agar problem dobara aaye ya kuch aur issue ho toh Slack par ya direct contact karein:<br>
    📱 <strong>IT Helpdesk (Slack)</strong></p>
  `);

  if (!transporter) return;
  await transporter.sendMail({
    from   : FROM,
    to     : ticket.empEmail,
    subject: `✅ [${ticket.ticketId}] Aapka ticket resolve ho gaya — ${ticket.category}`,
    html
  });
};

// ── Send SLA breach warning to ADMIN_EMAIL ─────────────────────────────────────────
const sendSLABreachAlert = async (ticket) => {
  if (!EMAIL_ENABLED) return;
  const html = wrap(`
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
      <div style="font-size:28px">⏰</div>
      <h3 style="color:#dc2626;margin:8px 0">SLA Breach Alert!</h3>
      <p style="color:#7f1d1d;font-size:14px;margin:0">Ticket <strong>${ticket.ticketId}</strong> ka SLA breach ho gaya</p>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:16px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Ticket</td>
            <td style="padding:4px 0;font-weight:700;font-family:monospace">${ticket.ticketId}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Employee</td>
            <td style="padding:4px 0">${ticket.empName} — ${ticket.empDept}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Issue</td>
            <td style="padding:4px 0">${ticket.description}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Open Since</td>
            <td style="padding:4px 0;color:#dc2626;font-weight:600">${ticket.hoursOpen} hours</td></tr>
      </table>
    </div>
  `);

  if (!transporter) return;
  await transporter.sendMail({
    from   : FROM,
    to     : ADMIN_EMAIL,
    subject: `⏰ SLA BREACH — [${ticket.ticketId}] ${ticket.empName} — ${ticket.hoursOpen}h open`,
    html
  });
};

const sendEscalationAlert = async ({ empId, empName, empEmail, dept, floor, laptop, issue }) => {
  if (!EMAIL_ENABLED) return;
  const html = wrap(`
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin-bottom:16px;text-align:center">
      <strong style="color:#92400e">🧑‍💼 Employee wants to TALK TO A HUMAN</strong>
    </div>
    <p style="color:#374151">Ek employee ne AI se help lene ke baad human support request kiya hai:</p>
    <div style="background:#f9fafb;border-radius:8px;padding:16px;border-left:4px solid #f59e0b">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;width:120px">Employee</td>
            <td style="padding:4px 0;font-weight:700;color:#1f2937">${empName || empId} (${empId})</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Email</td>
            <td style="padding:4px 0;color:#1f2937">${empEmail || 'N/A'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Department</td>
            <td style="padding:4px 0;color:#1f2937">${dept || 'N/A'} — Floor ${floor || 'N/A'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px">Laptop</td>
            <td style="padding:4px 0;color:#1f2937">${laptop || 'N/A'}</td></tr>
        ${issue ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;vertical-align:top">Issue</td>
            <td style="padding:4px 0;color:#1f2937">${issue}</td></tr>` : ''}
      </table>
    </div>
    <p style="margin-top:16px;color:#374151;font-size:13px">Please contact this employee directly for support.</p>
  `);

  if (!transporter) return;
  await transporter.sendMail({
    from   : FROM,
    to     : ADMIN_EMAIL,
    subject: `🧑‍💼 Human Support Request — ${empName || empId} (${dept || 'Unknown Dept'})`,
    html
  });
};

module.exports = {
  sendTicketConfirmation,
  sendAdminAlert,
  sendResolutionEmail,
  sendSLABreachAlert,
  sendEscalationAlert
};
