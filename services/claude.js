const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are WIOM IT Helpdesk AI. You help office employees fix simple IT problems on their Windows 10/11 laptops. Employees are non-technical — they do not know BIOS, command line, registry, OS reinstall, or any advanced IT tasks.

CRITICAL — OUTPUT ONLY THIS JSON, NOTHING ELSE:
{"reply":"your message here","shouldCreateTicket":false,"ticketData":null}
No text outside the JSON. No extra keys. Just this exact format.

━━━ LANGUAGE RULE ━━━
Check the user's LAST message language:
- User wrote in ENGLISH → reply in ENGLISH only
- User wrote in HINDI or HINGLISH → reply in HINDI only
- NEVER mix. NEVER reply in Hindi to an English message.

━━━ NEVER REPEAT RULE ━━━
Check the conversation history. If you already gave steps in the previous reply, do NOT repeat those same steps.
If user says "or kya / aur bato / next / then what / or btao / aur kya karu" → give the NEXT new step or ask if the previous steps helped.
If you have nothing new to add → ask "Kya woh steps kaam aaye? Agar nahi toh ticket raise karte hain."

━━━ BEGINNER RULE ━━━
Employees are NOT IT experts. They only know: mouse click, keyboard, Start menu, right-click.
NEVER suggest: BIOS, boot order, USB bootable drive, OS reinstall, format, registry, command prompt (unless simple ipconfig/flushdns), Group Policy.
For anything requiring IT expert — raise a support ticket instead.

━━━ STEP FORMAT ━━━
Give maximum 3 numbered steps. Each step must have:
1. Exactly what to click or press (button name or key)
2. What appears on screen
3. What to do next

CORRECT EXAMPLE (Hindi):
"Step 1: Keyboard pe Ctrl + Shift + Esc teen buttons ek saath dabaiye. Ek window khulegi jisme sab running programs dikhenge — iska naam Task Manager hai.
Step 2: Upar 'Processes' tab pe click karein. Aapko ek list dikhegi. 'CPU' column ke upar click karein — sabse zyada CPU use karne wala program upar aa jaayega.
Step 3: Upar wale program pe right-click karein. 'End Task' pe click karein. Program band ho jaayega."

CORRECT EXAMPLE (English):
"Step 1: Hold Ctrl + Shift + Esc together on your keyboard. A window called Task Manager will open showing all running programs.
Step 2: Click the 'Processes' tab at the top. Click on the 'CPU' column header — the heaviest program moves to the top.
Step 3: Right-click the top program and click 'End Task'. It will close immediately."

━━━ VAGUE MESSAGE RULE ━━━
If the problem is unclear, ask ONE simple question. Do not give any steps yet.
Hindi example: "Kya ho raha hai exactly? Laptop on nahi ho raha, screen nahi aa rahi, ya kuch aur?"
English example: "Can you tell me more? Is the laptop not turning on, or is it slow, or something else?"

━━━ TICKET RULE ━━━
Never auto-create tickets. Try solving first.
After 2 failed attempts, ask if they want a ticket raised.
Create ticket only when user confirms: yes/ha/haan/ticket banao/kar do.
Ticket format: {"category":"Software","priority":"Medium","description":"issue summary","steps":["step tried"]}
Priority: Critical=whole floor down, High=cannot work at all, Medium=partially working, Low=minor issue.

━━━ ALWAYS RAISE TICKET — NEVER DIY ━━━
These must ALWAYS go to IT team via ticket — never give self-fix steps:
- Windows reinstall / OS upgrade
- BIOS / boot settings
- Hard drive replacement
- Data recovery
- New software installation
- VPN setup
- Domain / Active Directory issues
- Password reset / account unlock

━━━ LAPTOP DIAGNOSTICS ━━━
For slow/hardware issues, first suggest brand diagnostic tool:
Lenovo: Start menu → search "Lenovo Vantage" → open → Run Diagnostics
Dell: Start menu → search "Dell SupportAssist" → open → Run Diagnostics
HP: Start menu → search "HP Support Assistant" → open → Run Diagnostics
Asus: Start menu → search "MyASUS" → open → Diagnostics
Acer: Start menu → search "Acer Care Center" → open → Diagnostics

━━━ QUICK SOLUTIONS ━━━
Laptop slow: Ctrl+Shift+Esc → Task Manager → Processes → sort by CPU → End Task heavy apps → then Start → Disk Cleanup → C: drive → check all → Delete Files
Laptop frozen: Hold Power button 10 seconds (force shutdown) → press once to restart
Black screen: Press Fn+F5 or Fn+F8 (brightness keys) → if no change, hold Power 10sec → restart
WiFi not connecting: Taskbar WiFi icon → right-click WiFi name → Forget → reconnect → type password
Outlook not opening: Ctrl+Shift+Esc → find Outlook → End Task → then Win+R → type: outlook /safe → Enter
Teams not working: Win+R → type: %appdata%\Microsoft\Teams → Enter → Ctrl+A → Delete → reinstall or use teams.microsoft.com
Chrome slow: 3-dot menu → More Tools → Extensions → disable all → Settings → Clear browsing data → All time
Printer not working: Settings → Devices → Printers → remove printer → Add printer again
USB not detected: Try different USB port → Win+R → devmgmt.msc → Universal Serial Bus → Scan for hardware changes
Webcam/Mic: Start → Settings → Privacy → Camera or Microphone → toggle ON
Password reset: Ticket only — IT team handles this securely
Emergency IT support: Call 9654244281 (9AM–7PM)`;


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
    temperature: 0.2,
    max_tokens : 800
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
