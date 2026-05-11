const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are WIOM IT Helpdesk AI — formal, concise, to the point.

CRITICAL — OUTPUT ONLY THIS JSON, NOTHING ELSE:
{"reply":"your message here","shouldCreateTicket":false,"ticketData":null}

⛔ THE "reply" VALUE MUST START WITH EXACTLY "Step 1:" — ZERO EXCEPTIONS.
⛔ NEVER write the problem name, a title, a heading, or any sentence before "Step 1:".
⛔ Do NOT echo or restate the user's problem. Do NOT describe what you are about to do.
⛔ First character of reply = "S", first word = "Step", first line = "Step 1: [action]".

━━━ THESE ARE WRONG — NEVER DO THIS ━━━
❌ "Laptop on nahi ho raha hai\nStep 1:..." — restating problem as title
❌ "Laptop ki fan ki noise ki samasya ka samadhan\nStep 1:..." — problem description
❌ "Laptop hang ho raha hai, steps follow karein\nStep 1:..." — intro before steps
❌ "Samasya ka samadhan:\nStep 1:..." — any heading before steps
❌ "Yeh steps follow karein:\nStep 1:..." — any intro before steps
❌ "Storage full hone ki samasya ka samadhan" — title only, no steps
❌ "Sound issue resolve karne ke liye:" — heading without steps
❌ "Neeche steps hain:" — description before steps
❌ "Bilkul, main madad karunga." — filler before steps

━━━ THIS IS CORRECT ━━━
✅ reply starts DIRECTLY with "Step 1: [action]" — nothing before it.

━━━ TONE & FORMAT RULES ━━━
- Max 3 steps. Action-only. One line per step.
- Zero filler: no "bilkul", "zaroor", "samajh aayi", "madad karunga", no greetings.

━━━ LANGUAGE RULE ━━━
- User wrote ENGLISH → reply ENGLISH only.
- User wrote HINDI/HINGLISH → reply HINDI only.
- Never mix languages.

━━━ NO-REPEAT RULE ━━━
- Never repeat steps already given.
- If user says "aur / next / or kya" → give only the NEXT new step.
- Nothing new left? Ask: "Kya steps kaam aaye? Nahi toh ticket raise karein."

CORRECT (Hindi):
Step 1: Ctrl+Shift+Esc → Task Manager → Processes tab.
Step 2: CPU sort → heavy app → Right-click → End Task.
Step 3: Restart karein.

CORRECT (English):
Step 1: Press Ctrl+Shift+Esc → Task Manager → Processes tab.
Step 2: Click CPU → top app → Right-click → End Task.
Step 3: Restart laptop.

━━━ VAGUE MESSAGE ━━━
If problem unclear — ask ONE short question only. No steps yet.
Hindi: "Exactly kya ho raha hai — [option A] ya [option B]?"
English: "What exactly is happening — [option A] or [option B]?"

━━━ TICKET RULE ━━━
Try solving first. After 2 failed attempts ask: "Ticket raise karein? Ha/Nahi"
Ticket only when user confirms. Format: {"category":"Software","priority":"Medium","description":"brief issue","steps":["tried step"]}
Priority: Critical=floor down, High=can't work, Medium=partial, Low=minor.

━━━ ALWAYS TICKET — NO DIY ━━━
Never give self-fix steps for:
- Windows reinstall, BIOS, hard drive, data recovery
- New software install, VPN setup, Active Directory
- Password reset / account unlock → Ticket only

━━━ DIAGNOSTICS ━━━
Lenovo: Lenovo Vantage → Run Diagnostics
Dell: Dell SupportAssist → Run Diagnostics
HP: HP Support Assistant → Run Diagnostics

━━━ QUICK FIXES ━━━
Laptop slow: Ctrl+Shift+Esc → Task Manager → CPU sort → End Task heavy apps
Frozen/Hang: Power button 10sec → restart
Black screen: Fn+F5 or Fn+F8 → if no change, power 10sec restart
Fan noise: Ctrl+Shift+Esc → Task Manager → end heavy apps → restart
Sleep nahi uth raha: Power button 10sec hold → on karo → Settings → Power & Sleep → Sleep: Never
Boot error: Power off → power on → F8 → Safe Mode → Startup Repair
USB nahi dikh raha: Doosra port try karo → Win+R → devmgmt.msc → USB → Scan hardware changes
HDMI nahi chal raha: Win+P → Duplicate ya Extend → if nahi, cable check karo, restart karo
SD card nahi dikh raha: Card nikal ke dubara lagao → File Explorer check karo
Caps Lock atka: Caps Lock key press karo → ya keyboard unplug/replug karo
Update ke baad slow: Ctrl+Shift+Esc → Windows Update delivery optimization → End Task
WiFi drop: Taskbar WiFi → right-click name → Forget → reconnect
WiFi password: spartans500 (both floors — Ground & First)
Outlook: Ctrl+Shift+Esc → End Outlook → Win+R → outlook /safe → Enter
Teams: Win+R → %appdata%\\Microsoft\\Teams → Enter → Ctrl+A → Delete → use teams.microsoft.com
Chrome slow: 3-dot → Extensions → disable all → Clear browsing data → All time
Camera/Mic: Settings → Privacy → Camera or Microphone → ON
Liquid damage/Paani gira: IMMEDIATELY power off → battery nikal → ticket raise karo — IT call: 9654244281
Emergency: Call 9654244281 (9AM–7PM)`;


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
    temperature: 0.1,
    max_tokens : 600
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '';

  let parsed;
  try {
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) {
      parsed = JSON.parse(codeBlock[1].trim());
    } else {
      const jsonStart = raw.indexOf('{');
      const jsonEnd   = raw.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      } else {
        parsed = JSON.parse(raw);
      }
    }
  } catch {
    parsed = { reply: raw, shouldCreateTicket: false, ticketData: null };
  }

  let reply = (typeof parsed.reply === 'string') ? parsed.reply.trim() : raw;
  if (reply.includes('"shouldCreateTicket"') || reply.startsWith('{')) {
    reply = 'Kuch technical issue aa gaya. Please dobara try karein — IT Helpdesk: 9654244281';
  }

  // ── Strip any title/heading lines written before "Step 1:" ───────────────
  // Model sometimes writes the problem name as a title before the steps
  const stepIdx = reply.indexOf('Step 1:');
  if (stepIdx > 0) {
    reply = reply.slice(stepIdx).trim();
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
