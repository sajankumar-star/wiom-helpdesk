// ============================================
//   WIOM IT HELPDESK — SECURE BACKEND SERVER
//   Node.js + Express
//   API Key yahan hai — employees ko nahi dikhega
// ============================================

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' })); // Production mein apni domain lagao

// ============================================
//   🔑 API KEY — SIRF YAHAN LIKHO
//   .env file mein bhi rakh sakte ho (recommended)
// ============================================
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

// ============================================
//   👥 WIOM EMPLOYEES — Username & Password
//   Jitne chahein add karo
//   Password change karne ke liye neeche edit karo
// ============================================
const EMPLOYEES = {
  'sajan.kumar':    { password: 'Wiom@1234', name: 'Sajan Kumar',    role: 'admin' },
  'employee1':      { password: 'Wiom@5678', name: 'Employee One',   role: 'user'  },
  'employee2':      { password: 'Wiom@9012', name: 'Employee Two',   role: 'user'  },
  // Naya employee add karne ke liye:
  // 'username': { password: 'password', name: 'Full Name', role: 'user' },
};

// ============================================
//   SIMPLE SESSION STORE (memory)
//   Production ke liye Redis ya database use karo
// ============================================
const sessions = {};

function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ============================================
//   MIDDLEWARE — Token check karta hai
// ============================================
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || !sessions[token]) {
    return res.status(401).json({ error: 'Login karein pehle.' });
  }
  req.employee = sessions[token];
  next();
}

// ============================================
//   ROUTES
// ============================================

// Static files serve karo (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Wiom IT Helpdesk Server Running ✅' });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username aur password dono chahiye.' });
  }

  const employee = EMPLOYEES[username.toLowerCase().trim()];

  if (!employee || employee.password !== password) {
    return res.status(401).json({ error: 'Galat username ya password.' });
  }

  // Token banao
  const token = generateToken();
  sessions[token] = {
    username,
    name: employee.name,
    role: employee.role,
    loginTime: new Date().toISOString()
  };

  // 8 ghante baad expire hoga
  setTimeout(() => { delete sessions[token]; }, 8 * 60 * 60 * 1000);

  console.log(`✅ Login: ${employee.name} (${username}) at ${new Date().toLocaleString('en-IN')}`);

  res.json({
    success: true,
    token,
    name: employee.name,
    role: employee.role
  });
});

// LOGOUT
app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.headers['x-auth-token'];
  delete sessions[token];
  res.json({ success: true });
});

// AI CHAT — Anthropic API call (API key yahan safe hai)
app.post('/api/chat', requireAuth, async (req, res) => {
  const { messages, language } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array chahiye.' });
  }

  const SYSTEM_PROMPT_HI = `Aap "Wiom IT Helpdesk Assistant" hain. Sirf Hindi/Hinglish mein jawab dein. IT Admin: sajan.kumar@Wiom.in

LAPTOP: On nahi hona=30sec hold,charger test,hard reset | Screen blink=driver update,ext monitor | Slow=TaskMgr,startup disable,DiskCleanup | Hang=Ctrl+Alt+Del,restart | Auto off=overheating,cooling pad | Charger=doosra charger,port check,ticket | Touchpad=Fn+F7,Settings>Touchpad,driver | Change=reason+ticket,3-5 din

NETWORK: WiFi=airplane off,disable/enable,ipconfig /flushdns | Slow=speedtest,background check | VPN=reinstall,config from sajan.kumar | WiFi pass=sirf IT Admin denge

SOFTWARE: Install=approval+ticket,1-2 din | MS Office=activate,company email | Antivirus=company approved only

PURCHASE: Equipment=reason+specs+ticket, sajan.kumar@Wiom.in approve karenge, 5-7 din

ACCOUNT: Password=Ctrl+Alt+Del ya email settings | ADMIN PASSWORD="Sirf sajan.kumar@Wiom.in pe email karein - naam, ID, reason" | New user=dept approval+ticket | 2FA=admin se reset

TICKET FORMAT:
🎫 TICKET RAISED
ID: TKT-[5 digit random number]
Category: [Hardware/Software/Network/Purchase/Account]
Priority: [Low/Medium/High/Critical]
Assigned To: sajan.kumar@Wiom.in
Status: Open
ETA: [time estimate]

RULES: "Physical check/replacement" line KABHI mat likho | Friendly Hindi/Hinglish | Numbered steps | Sirf IT topics pe jawab do`;

  const SYSTEM_PROMPT_EN = `You are "Wiom IT Helpdesk Assistant". Reply in English only. IT Admin: sajan.kumar@Wiom.in
Handle all IT: laptop issues, network, software, purchases, account management.
For Admin Password: "Contact sajan.kumar@Wiom.in with your name, employee ID and reason."
Ticket format:
🎫 TICKET RAISED
ID: TKT-[5 digits]
Category: [Hardware/Software/Network/Purchase/Account]
Priority: [Low/Medium/High/Critical]
Assigned To: sajan.kumar@Wiom.in
Status: Open
ETA: [estimate]
Rules: Friendly, numbered steps, IT topics only, never say physical check or replacement needed.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_HI,
        messages: messages.slice(-20) // Last 20 messages bhejo (context limit)
      })
    });

    const data = await response.json();

    if (data.content && data.content[0]) {
      console.log(`💬 Chat by ${req.employee.name} — ${new Date().toLocaleString('en-IN')}`);
      res.json({ reply: data.content[0].text });
    } else {
      console.error('Anthropic error:', data);
      res.status(500).json({ error: 'AI response mein problem.' });
    }
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error. Admin se contact karein.' });
  }
});

// Verify token (frontend check ke liye)
app.get('/api/verify', requireAuth, (req, res) => {
  res.json({
    valid: true,
    name: req.employee.name,
    role: req.employee.role
  });
});

// ============================================
//   SERVER START
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   🛡️  WIOM IT HELPDESK SERVER            ║
║   Port: ${PORT}                              ║
║   Status: Running ✅                     ║
║   Admin: sajan.kumar@Wiom.in             ║
╚══════════════════════════════════════════╝
  `);
});
