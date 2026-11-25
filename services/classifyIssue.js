// ============================================================
//  services/classifyIssue.js
//  Ek hi classifier — Gmail aur Slack dono ke liye.
//  Kaam: diye gaye text (subject + body) ko padh kar batana
//        ki ye IT se judi problem hai ya nahi.
//
//  AI order: Groq → Gemini → Claude (jo key ho).  Koi na ho / fail →
//  keyword backup. Result hamesha ek jaisa shape:
//     { isIT: Boolean, category: String, confidence: 0..1, via: String }
// ============================================================

// ── AI clients init (jo key env me hai, wahi banega) ─────────────
let groq = null, gemini = null, anthropic = null;
try { const Groq = require('groq-sdk'); if (process.env.GROQ_API_KEY) groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); } catch {}
try { const { GoogleGenerativeAI } = require('@google/generative-ai'); if (process.env.GEMINI_API_KEY) gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); } catch {}
try { const Anthropic = require('@anthropic-ai/sdk'); if (process.env.ANTHROPIC_API_KEY) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); } catch {}

const SYS =
  'You are a triage classifier for an office helpdesk at an ISP company (WIOM). ' +
  'Decide if a message is an IT/technical support issue (laptop, computer, Wi-Fi, ' +
  'internet, network, VPN, software, apps, email client, login/password, Wiom ID, ' +
  'printer, hardware, access) OR something non-IT (HR, salary, leave, finance, ' +
  'vendor, facilities like AC/furniture, general queries). Reply ONLY with compact ' +
  'JSON, no prose: {"isIT": true|false, "category": "Wi-Fi/Internet|Login/Password|' +
  'Hardware|Software|Printer|Other|Non-IT", "confidence": 0.0-1.0}';

// ── JSON nikaalne ka helper ───────────────────────────────────
function parseJSON(raw) {
  const m = String(raw || '').replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json in model output');
  const j = JSON.parse(m[0]);
  return {
    isIT: !!j.isIT,
    category: j.category || (j.isIT ? 'Other' : 'Non-IT'),
    confidence: typeof j.confidence === 'number' ? j.confidence : 0.75,
  };
}

// ── IT keywords (backup ke liye) ──────────────────────────────
const IT_KEYWORDS = [
  'laptop', 'desktop', 'computer', 'system', ' pc ', 'screen', 'display', 'monitor',
  'keyboard', 'mouse', 'charger', 'charging', 'battery', 'webcam', 'camera', 'speaker',
  'headphone', 'usb', 'hard disk', 'hdd', 'ssd', ' ram ', 'motherboard', 'cpu', ' hang ',
  'wifi', 'wi-fi', 'internet', ' net ', 'network', ' lan ', 'ethernet', 'vpn', 'proxy',
  'slow net', 'connection', 'router', ' ip ',
  'software', ' app ', 'application', 'install', 'update', 'outlook', 'email not',
  'excel', 'word', 'powerpoint', 'ms office', 'office 365', 'teams', 'zoom', 'chrome',
  'browser', 'driver', 'antivirus', 'virus', 'malware', 'blue screen', 'bsod', 'crash',
  'error', 'not opening', 'not working', 'freeze', 'slow',
  'password', 'login', 'log in', 'sign in', 'locked', 'unlock', 'account', 'reset',
  'wiom id', 'wiom login', 'id card', 'access', 'otp', 'authentication', '2fa',
  'printer', 'print', 'scanner', ' scan ', 'cartridge',
  'laptop me problem', 'net nahi', 'wifi nahi', 'slow chal', 'band ho gaya',
  'kaam nahi kar raha', 'open nahi ho raha', 'chal nahi raha', 'format', 'backup',
];

const NON_IT_KEYWORDS = [
  'salary', 'payslip', 'pay slip', 'leave', 'holiday', 'attendance', 'hr ', 'reimburse',
  'appraisal', 'increment', 'offer letter', 'resignation', 'policy', 'pf ',
  'esi', 'insurance', 'invoice', 'payment', 'vendor', 'purchase order',
  'meeting', 'interview', 'recruit', 'onboarding form', ' ac ', 'furniture',
  'chair', 'desk ', 'canteen', 'washroom', 'parking',
];

function guessCategory(t) {
  if (/wifi|wi-fi|internet|\bnet\b|network|vpn|lan|router/.test(t)) return 'Wi-Fi/Internet';
  if (/password|login|log in|locked|unlock|reset|wiom id|account|otp|access/.test(t)) return 'Login/Password';
  if (/printer|print|scanner|scan|cartridge/.test(t)) return 'Printer';
  if (/screen|keyboard|mouse|charger|battery|hardware|laptop|hang|webcam|speaker/.test(t)) return 'Hardware';
  if (/software|app|install|outlook|excel|word|office|teams|zoom|chrome|driver|update|virus/.test(t)) return 'Software';
  return 'Other';
}

function keywordClassify(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let itHits = 0, nonItHits = 0;
  for (const k of IT_KEYWORDS)     if (t.includes(k)) itHits++;
  for (const k of NON_IT_KEYWORDS) if (t.includes(k)) nonItHits++;
  const isIT = itHits > 0 && itHits >= nonItHits;
  const confidence = Math.min(0.5 + itHits * 0.12, 0.9);
  return {
    isIT,
    category: isIT ? guessCategory(t) : 'Non-IT',
    confidence: isIT ? confidence : 0.6,
    via: 'keyword',
  };
}

// ── AI providers ──────────────────────────────────────────────
async function viaGroq(text) {
  const c = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant', temperature: 0, max_tokens: 100,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }],
  });
  return { ...parseJSON(c.choices?.[0]?.message?.content), via: 'ai:groq' };
}
async function viaGemini(text) {
  const model = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const r = await model.generateContent(`${SYS}\n\nMessage:\n${text}`);
  return { ...parseJSON(r.response.text()), via: 'ai:gemini' };
}
async function viaClaude(text) {
  const r = await anthropic.messages.create({
    model: 'claude-3-5-haiku-latest', max_tokens: 100, system: SYS,
    messages: [{ role: 'user', content: text }],
  });
  return { ...parseJSON(r.content?.[0]?.text), via: 'ai:claude' };
}

// ── Main: classify(text) ──────────────────────────────────────
async function classify(text) {
  const clean = String(text || '').trim().slice(0, 4000);
  if (!clean) return { isIT: false, category: 'Non-IT', confidence: 0.5, via: 'keyword' };

  const providers = [];
  if (groq)      providers.push(viaGroq);
  if (gemini)    providers.push(viaGemini);
  if (anthropic) providers.push(viaClaude);

  for (const p of providers) {
    try { return await p(clean); }
    catch (err) { console.warn(`[classifyIssue] ${p.name} fail: ${err.message}`); }
  }
  return keywordClassify(clean); // koi AI nahi / sab fail
}

module.exports = { classify, keywordClassify };
