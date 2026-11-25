// ============================================================
//  services/emailGatekeeper.js
//  sajan.kumar@wiom.in inbox ko watch karta hai aur har nayi mail par:
//    - external (@wiom.in nahi)  → chhod do
//    - boss / exclude list       → chhod do
//    - AI: IT problem hai?
//         HAAN → (LIVE) auto-reply "My HR Buddy par jao" + inbox se hata do
//         NAHI → inbox me rehne do
//
//  MODE:
//    test  → Gmail me KUCH NAHI badalta. Sirf log karta hai ki kya karta.
//            (accuracy check karne ke liye — safe)
//    live  → sach me auto-reply bhejta + mail ko label me move karta.
//
//  Env se control hota hai — niche .env.example dekho.
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fs         = require('fs');
const cron       = require('node-cron');
const nodemailer = require('nodemailer');
const { classify } = require('./classifyIssue');

// ── Config ────────────────────────────────────────────────────
const ENABLED   = String(process.env.GATEKEEPER_ENABLED || 'false') === 'true';
const MODE      = (process.env.GATEKEEPER_MODE || 'test').toLowerCase();   // 'test' | 'live'
const DOMAIN    = (process.env.OFFICE_DOMAIN || 'wiom.in').toLowerCase();
const HR_LINK   = process.env.MY_HR_BUDDY_LINK || '';
const LABEL     = process.env.GATEKEEPER_LABEL || 'IT-Redirected';
const POLL_CRON = process.env.GATEKEEPER_POLL_CRON || '*/2 * * * *';       // har 2 min
const MIN_CONF  = parseFloat(process.env.GATEKEEPER_MIN_CONFIDENCE || '0.6');

const EXCLUDE = String(process.env.GATEKEEPER_EXCLUDE || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const IMAP = {
  host  : process.env.IMAP_HOST || 'imap.gmail.com',
  port  : parseInt(process.env.IMAP_PORT || '993', 10),
  secure: true,
  auth  : { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  logger: false,
};

const LOG_FILE = path.join(__dirname, '../logs/gatekeeper.log');

// in-memory: is process me jo mails process ho chuki (dobara log/act na ho)
const processed = new Set();

// ── Logging helper ────────────────────────────────────────────
function log(line) {
  const stamp = new Date().toISOString();
  const msg = `[${stamp}] ${line}`;
  console.log('📧 [Gatekeeper]', line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, msg + '\n');
  } catch { /* log file optional */ }
}

// ── Auto-reply transporter (sirf live mode me use hoga) ───────
const transporter = (process.env.SMTP_USER && process.env.SMTP_PASS)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

function autoReplyHtml(name) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;color:#374151;line-height:1.6">
    <p>Hi ${name || 'there'},</p>
    <p>Aapne jo IT/technical problem batayi hai, uske liye humne ab ek faster system banaya hai —
       <b>My HR Buddy</b> (Slack par). Wahan aapko turant help milegi aur zaroorat ho to ticket bhi
       ban jayega (jo IT team directly dekhti hai).</p>
    <p style="margin:18px 0">
      👉 <a href="${HR_LINK}" style="background:#E8197D;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">My HR Buddy par jao</a>
    </p>
    <p style="font-size:13px;color:#6b7280">Bas apni problem wahan likh dein — Wi-Fi, laptop, login/password,
       software, printer, ya koi bhi IT issue. Ye email ka jawab dene ki zaroorat nahi.</p>
    <p style="font-size:13px;color:#6b7280">— WIOM IT Helpdesk (automated)</p>
  </div>`;
}

// ── Ek mail ko handle karo ────────────────────────────────────
async function handleMessage(client, msg) {
  const uid  = msg.uid;
  const env  = msg.envelope || {};
  const from = (env.from && env.from[0] && env.from[0].address || '').toLowerCase();
  const fromName = (env.from && env.from[0] && env.from[0].name) || from.split('@')[0];
  const subject  = env.subject || '(no subject)';
  const key = env.messageId || `uid-${uid}`;

  if (processed.has(key)) return;        // is process me ho chuki
  processed.add(key);

  // 1) External mail? (office domain nahi) → chhod do
  if (!from.endsWith('@' + DOMAIN)) {
    log(`SKIP (external): ${from} | "${subject}"`);
    return;
  }
  // 2) Boss / exclude list → chhod do
  if (EXCLUDE.includes(from)) {
    log(`SKIP (excluded/boss): ${from} | "${subject}"`);
    return;
  }
  // 3) Automated / no-reply → chhod do
  if (/no-?reply|mailer-daemon|postmaster|notification|automated/i.test(from)
      || /^(re|auto):/i.test(subject) && /auto/i.test(subject)) {
    log(`SKIP (automated): ${from} | "${subject}"`);
    return;
  }

  // 4) Body text nikaalo (source se parse)
  let bodyText = '';
  try {
    if (msg.source) {
      const { simpleParser } = require('mailparser');
      const parsed = await simpleParser(msg.source);
      bodyText = (parsed.text || '').slice(0, 3000);
    }
  } catch (e) {
    bodyText = ''; // subject ke basis par hi classify kar lenge
  }

  // 5) Classify
  const result = await classify(`${subject}\n\n${bodyText}`);
  const decideIT = result.isIT && result.confidence >= MIN_CONF;

  const tag = `${result.isIT ? 'IT' : 'NON-IT'} (${result.category}, conf ${result.confidence.toFixed(2)}, via ${result.via})`;

  if (!decideIT) {
    log(`KEEP  → ${tag} | ${from} | "${subject}"  [inbox me rahega]`);
    return;
  }

  // IT problem hai
  if (MODE !== 'live') {
    log(`WOULD-REDIRECT → ${tag} | ${from} | "${subject}"  [TEST: kuch nahi badla]`);
    return;
  }

  // ---- LIVE mode: auto-reply + inbox se hata do ----
  try {
    if (transporter && HR_LINK) {
      await transporter.sendMail({
        from: `"WIOM IT Helpdesk" <${process.env.SMTP_USER}>`,
        to: from,
        subject: `Re: ${subject} — IT help yahan milega 👇`,
        html: autoReplyHtml(fromName),
      });
    }
    // Gmail label me move (inbox se hat jayega)
    try { await client.mailboxCreate(LABEL); } catch { /* already exists */ }
    await client.messageMove(uid, LABEL, { uid: true });
    log(`REDIRECTED → ${tag} | ${from} | "${subject}"  [auto-reply bheja + ${LABEL} me move]`);
  } catch (e) {
    log(`ERROR redirect: ${from} | "${subject}" | ${e.message}`);
  }
}

// ── Ek poll cycle ─────────────────────────────────────────────
async function runOnce() {
  if (!IMAP.auth.user || !IMAP.auth.pass
      || /YAHAN_APP_PASSWORD|FILL_KARO|xxxx/i.test(IMAP.auth.pass)) {
    log('⚠️ SMTP_PASS set nahi hai (placeholder). .env me asli Gmail App Password daalo, aur Gmail me IMAP ON karo. Phir dobara chalao.');
    return;
  }
  let client;
  try {
    const { ImapFlow } = require('imapflow');
    client = new ImapFlow(IMAP);
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // sirf UNSEEN (nayi/anpadhi) mails
      for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true, source: true })) {
        await handleMessage(client, msg);
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    log(`POLL ERROR: ${e.message}`);
  } finally {
    if (client) { try { await client.logout(); } catch {} }
  }
}

// ── Start (cron) ──────────────────────────────────────────────
function start() {
  if (!ENABLED) {
    console.log('📧 [Gatekeeper] DISABLED (GATEKEEPER_ENABLED=false). Skip.');
    return;
  }
  log(`START — mode=${MODE.toUpperCase()}, domain=@${DOMAIN}, exclude=${EXCLUDE.length}, cron="${POLL_CRON}"`);
  if (MODE !== 'live') log('⚠️  TEST MODE: Gmail me kuch nahi badlega — sirf log hoga (logs/gatekeeper.log).');
  runOnce();                        // turant ek baar
  cron.schedule(POLL_CRON, runOnce); // phir har interval par
}

module.exports = { start, runOnce, classify };

// Agar seedha `node services/emailGatekeeper.js` chalayein
if (require.main === module) start();
