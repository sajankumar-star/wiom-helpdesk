// ── WIOM IT Helpdesk — WhatsApp Bot (Twilio) ──────────────────────────────────
//
// SETUP INSTRUCTIONS:
// 1. Create Twilio account: https://www.twilio.com
// 2. Enable WhatsApp Sandbox: Twilio Console > Messaging > Try WhatsApp
// 3. Add to Railway environment variables:
//    TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//    TWILIO_AUTH_TOKEN  = your_auth_token
//    TWILIO_WHATSAPP_NUMBER = whatsapp:+14155238886  (sandbox number)
// 4. Set webhook URL in Twilio Console:
//    https://web-production-ef6c1.up.railway.app/api/whatsapp/incoming
// 5. For production: get a dedicated WhatsApp number from Twilio
// ─────────────────────────────────────────────────────────────────────────────

const claudeSvc  = require('./claude');
const Employee   = require('../models/Employee');
const Conversation = require('../models/Conversation');

const WA_FROM = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

// ── Lookup employee by phone number ──────────────────────────────────────────
const lookupByPhone = async (waFrom) => {
  const clean = waFrom.replace('whatsapp:', '').replace(/^\+91/, '').replace(/^91/, '');
  return await Employee.findOne({
    phone: { $in: [clean, `+91${clean}`, `91${clean}`, `0${clean}`] }
  });
};

// ── Main handler — called from POST /api/whatsapp/incoming ───────────────────
const handleIncoming = async (req, res, twilioClient) => {
  // Always respond with empty TwiML so Twilio doesn't retry
  res.set('Content-Type', 'text/xml');

  try {
    const text = req.body.Body?.trim();
    const from = req.body.From;           // "whatsapp:+919876543210"
    if (!text || !from) return res.send('<Response></Response>');

    const emp     = await lookupByPhone(from);
    const empId   = emp?.empId   || from.replace('whatsapp:', '');
    const empName = emp?.name    || 'Employee';

    // Load or create session (24h window)
    const cutoff = new Date(Date.now() - 24 * 3600000);
    let conv = await Conversation.findOne({
      empId, source: 'whatsapp', resolved: false, lastActive: { $gte: cutoff }
    }).sort({ lastActive: -1 });

    if (!conv) {
      conv = new Conversation({
        sessionId: `wa-${empId}-${Date.now()}`,
        empId, empName, source: 'whatsapp', messages: []
      });
    }

    // ── Greeting ──────────────────────────────────────────────────────────────
    const isGreeting = /^(hello|hi|hey|namaste|hlo|hii|namaskar|start|help)$/i.test(text);
    if (isGreeting) {
      await Conversation.updateMany({ empId, source: 'whatsapp', resolved: false }, { resolved: true });
      const firstName  = empName.split(' ')[0];
      const laptopInfo = emp?.laptop ? `\n💻 Laptop: ${emp.laptop}` : '';
      const reply = `Hello ${firstName}! 👋 WIOM IT Helpdesk mein aapka swagat hai.${laptopInfo}\n\nAapki kya IT samasya hai? Batayein, main madad karunga.\n\n_Type "reset" nayi baat shuru karne ke liye_`;
      await twilioClient.messages.create({ from: WA_FROM, to: from, body: reply });
      return res.send('<Response></Response>');
    }

    // ── Reset ─────────────────────────────────────────────────────────────────
    if (/^(reset|nayi baat|new|naya)$/i.test(text)) {
      await Conversation.updateMany({ empId, source: 'whatsapp', resolved: false }, { resolved: true });
      await twilioClient.messages.create({
        from: WA_FROM, to: from,
        body: `🔄 Theek hai! Nayi baat shuru karte hain. Aapki nai IT problem kya hai?`
      });
      return res.send('<Response></Response>');
    }

    // ── AI Chat ───────────────────────────────────────────────────────────────
    conv.messages.push({ role: 'user', content: text });
    if (conv.messages.length > 20) conv.messages = conv.messages.slice(-20);
    await conv.save();

    const { reply, shouldCreateTicket, ticketData } = await claudeSvc.chat(
      conv.messages,
      { empId, empName, source: 'whatsapp',
        laptop: emp?.laptop, laptopSN: emp?.laptopSN,
        dept: emp?.department, floor: emp?.floor }
    );

    conv.messages.push({ role: 'assistant', content: reply });
    await conv.save();

    // WhatsApp message limit: 1600 chars
    const safeReply = reply.length > 1550 ? reply.substring(0, 1530) + '...' : reply;
    await twilioClient.messages.create({ from: WA_FROM, to: from, body: safeReply });

    // ── Auto-create ticket if AI suggests it ─────────────────────────────────
    if (shouldCreateTicket && ticketData) {
      try {
        const ticketRes = await fetch(
          `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/tickets`,
          {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
              empId, empName, empEmail: emp?.email,
              empDept: emp?.department, empFloor: emp?.floor,
              laptop: emp?.laptop, ...ticketData,
              description: ticketData.description || text,
              source: 'whatsapp', aiTried: true
            })
          }
        );
        const ticketJson = await ticketRes.json();
        if (ticketJson.ticket) {
          await twilioClient.messages.create({
            from: WA_FROM, to: from,
            body: `🎫 *Ticket Create Ho Gaya!*\nTicket ID: ${ticketJson.ticket.ticketId}\nIT team jaldi contact karegi.\n\nUrgent ho to: IT Helpdesk (Slack)`
          });
        }
      } catch (e) {
        console.error('WhatsApp ticket create error:', e.message);
      }
    }

  } catch (err) {
    console.error('WhatsApp handler error:', err.message);
    // Try to send error message
    try {
      const from = req.body?.From;
      if (from && req.twilioClient) {
        await req.twilioClient.messages.create({
          from: WA_FROM, to: from,
          body: '❌ Kuch technical problem aa gayi. Thodi der baad try karein ya call karein: IT Helpdesk (Slack)'
        });
      }
    } catch (e2) {}
  }

  res.send('<Response></Response>');
};

module.exports = { handleIncoming };
