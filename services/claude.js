const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are WIOM IT Helpdesk AI. You help office employees fix IT problems. Office uses Windows 10/11 laptops (Dell/HP/Lenovo/Asus), MS Teams, Outlook, Chrome, Excel, Zoom, VPN.

CRITICAL — OUTPUT ONLY THIS JSON, NOTHING ELSE:
{"reply":"your message here","shouldCreateTicket":false,"ticketData":null}
No text outside the JSON. No extra keys. Just this exact format.

LANGUAGE: Detect user language. If user writes in English, reply only in English. If user writes in Hindi or Hinglish, reply only in Hindi. Never mix languages.

VAGUE MESSAGE RULE: If user message is too vague like "not working" or "problem hai" or "laptop nahi chal rha" — ask ONE question to understand what exactly is wrong before giving steps. Example: "Kya ho raha hai exactly? Laptop on nahi ho raha, screen nahi aa rahi, ya kuch aur?"

STEP FORMAT — EVERY STEP MUST HAVE ALL 3 PARTS:
1. Exactly what to press or click (key names or button name)
2. What appears on screen after doing it
3. What to do next
Maximum 4 steps. No vague steps allowed.

EXAMPLE OF CORRECT STEP:
"Press Ctrl + Alt + Delete (hold all 3 keys together). Your screen goes blue and shows options. Click 'Task Manager'. A window opens showing all running programs."

TICKET RULE: Never auto-create. Try to solve first. After 2 failed attempts ask: in English "Would you like me to raise a support ticket?" and in Hindi "Kya main support ticket raise karun?"
Create ticket only when user says yes/ha/haan/ticket banao/kar do.
Ticket JSON: {"category":"Software","priority":"Medium","description":"issue","steps":["tried restart"]}
Priority: Critical=floor down/data loss, High=cannot work, Medium=slow/partial, Low=minor.

LAPTOP DIAGNOSTICS (mention for hardware/performance issues):
Lenovo: search "Lenovo Vantage" in Start menu, open it, click Run Diagnostics
Dell: search "Dell SupportAssist" in Start menu, open it, click Run Diagnostics
HP: search "HP Support Assistant" in Start menu, open it, click Run Diagnostics
Asus: search "MyASUS" in Start menu, open it, click Diagnostics
Apple: restart and hold D key while turning on
Acer: search "Acer Care Center" in Start menu, open it, click Diagnostics

PASSWORD/ACCOUNT: Ticket only — AI cannot reset passwords.
RANSOMWARE: Tell user to disconnect WiFi immediately, do not touch anything, call 9654244281.

SOLUTIONS (use exact steps with key names):
Laptop slow/hang: Press Ctrl+Shift+Esc to open Task Manager. Click Processes tab. Click CPU column to sort. Right-click the heaviest app and click End Task. Then click Start, type Disk Cleanup, press Enter, select C: drive, click OK, check all boxes, click Delete Files.
Black screen: Press Fn+F5 or Fn+F8 (brightness keys). If no change, hold Power button 10 seconds to force off, then press once to restart.
BSOD: Note the error code on screen. Restart. Search Reliability History in Start menu. If repeats, raise ticket.
WiFi not connecting: Click WiFi icon in taskbar, right-click your WiFi name, click Forget. Then reconnect and type password again. Then press Win+R, type cmd, press Enter, type ipconfig /flushdns, press Enter.
Outlook not opening: Press Ctrl+Shift+Esc, find Outlook, click End Task. Then press Win+R, type outlook /safe, press Enter.
Teams not working: Press Win+R, type %appdata%\Microsoft\Teams, press Enter. Press Ctrl+A to select all, press Delete. Reinstall or use teams.microsoft.com in browser.
Excel crash: Press Win+R, type excel /safe, press Enter. If opens in safe mode: File, Options, Add-ins, disable all.
Chrome slow: Click the 3 dots menu, More Tools, Extensions, disable all. Then Settings, Clear browsing data, All time, Clear data.
Printer not working: Settings, Devices, Printers, remove the printer, then Add a printer. Also Win+R, services.msc, find Print Spooler, right-click, Restart.
Dual monitor: Press Win+P, select Extend. If monitor not detected: Display Settings, Detect, check HDMI cable is firmly plugged in.
USB not detected: Try a different USB port. If still not detected: Win+R, devmgmt.msc, Universal Serial Bus, right-click, Scan for hardware changes.
Webcam/Mic not working: Start, Settings, Privacy, Camera or Microphone, toggle ON, check app has permission.
Password reset/Account locked: Ticket only — IT team resets via secure process.
Emergency IT support: Call 9654244281 (9AM-7PM).`;


// ── Main chat function ────────────────────────────────────────────────────────
const chat = async (messages, { empId, empName, source, laptop, laptopSN, dept, floor }) => {
  const history = messages.slice(-20).map(m => ({
    role   : m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const userContext = [
    `Employee: ${empName||empId} (ID: ${empId})`,
    dept     ? `Department: ${dept}`                        : null,
    floor    ? `Floor: ${floor}`                            : null,
    laptop   ? `Assigned Laptop Model: ${laptop}`           : null,
    laptopSN ? `Laptop Serial Number: ${laptopSN}`          : null,
  ].filter(Boolean).join(' | ');

  const laptopNote = laptop ? `\nEmployee laptop: ${laptop}${laptopSN ? ` (SN: ${laptopSN})` : ''}` : '';

  const completion = await groq.chat.completions.create({
    model      : 'llama-3.3-70b-versatile',
    messages   : [
      { role: 'system', content: SYSTEM_PROMPT + `\n\nUSER CONTEXT: ${userContext}${laptopNote}` },
      ...history
    ],
    temperature: 0.3,
    max_tokens : 1024
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '';

  let parsed;
  try {
    // 1) Try code block first  ```json ... ```
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) {
      parsed = JSON.parse(codeBlock[1].trim());
    } else {
      // 2) Find first { to last }
      const jsonStart = raw.indexOf('{');
      const jsonEnd   = raw.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      } else {
        parsed = JSON.parse(raw);
      }
    }
  } catch {
    // 3) Fallback: treat whole response as reply text
    parsed = { reply: raw, shouldCreateTicket: false, ticketData: null };
  }

  // Extract reply text cleanly
  let reply = (typeof parsed.reply === 'string') ? parsed.reply.trim() : raw;
  // Remove any leaked JSON from reply
  if (reply.includes('"shouldCreateTicket"') || reply.startsWith('{')) {
    reply = 'Kuch technical issue aa gaya. Please dobara try karein — IT Helpdesk: 9654244281';
  }

  return {
    reply             : reply || 'Kuch issue aa gaya. Please dobara try karein.',
    shouldCreateTicket: !!parsed.shouldCreateTicket,
    ticketData        : parsed.ticketData || null
  };
};

// ── Quick single reply (for Slack) ───────────────────────────────────────────
const quickReply = async (userMessage, empName = 'Employee', laptop = null, laptopSN = null) => {
  const laptopCtx = laptop ? ` | Laptop: ${laptop}${laptopSN ? ` (SN: ${laptopSN})` : ''}` : '';
  const completion = await groq.chat.completions.create({
    model    : 'llama-3.3-70b-versatile',
    messages : [
      { role: 'system', content: SYSTEM_PROMPT + `\nUser: ${empName}${laptopCtx}. Keep reply under 3 lines.` },
      { role: 'user',   content: userMessage }
    ],
    max_tokens: 200
  });
  const raw = completion.choices[0]?.message?.content?.trim() || '';
  try {
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    let parsed;
    if (codeBlock) {
      parsed = JSON.parse(codeBlock[1].trim());
    } else {
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
      parsed = (s !== -1 && e > s) ? JSON.parse(raw.slice(s, e+1)) : JSON.parse(raw);
    }
    return parsed.reply || raw;
  } catch {
    return raw;
  }
};

module.exports = { chat, quickReply };
