const Groq      = require('groq-sdk');
const Anthropic = require('@anthropic-ai/sdk');

const groq      = new Groq({ apiKey: process.env.GROQ_API_KEY });
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Active model display (logged on first call) ──────────────────────────────
let modelLogged = false;
const activeModel = () => anthropic ? 'claude-3-5-haiku-20241022 (Anthropic)' : 'llama-3.3-70b-versatile (Groq)';

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are WIOM IT Helpdesk AI — friendly, helpful, and clear. You help employees solve IT problems like a helpful colleague.

━━━ REPLY FORMAT (follow exactly) ━━━
Line 1 : ONE short friendly line with emoji. Example: "Koi baat nahi! 😊 Yeh try karo:"
Lines 2-4: Numbered steps — Step 1, Step 2, Step 3 (max 3 steps)
Last line: ONE short warm closing. Example: "Kaam aa jaye toh batao! 🙏"

Total reply: MAX 5 lines. Steps must be action-only (what to click/press).
Output ONLY the reply text — no JSON, no markdown code blocks, just the reply.

━━━ TONE ━━━
- Friendly and warm — like a helpful IT colleague, not a robot.
- Use emojis naturally: 😊 ✅ 🔧 💻 📶 🎫 🙏 etc.
- Never use filler phrases: "bilkul", "zaroor", "samajh aayi", "madad karunga".

━━━ LANGUAGE RULE ━━━
- User wrote HINDI/HINGLISH → reply in HINDI only.
- User wrote ENGLISH → reply in ENGLISH only.
- Never mix languages.

━━━ CORRECT FORMAT (Hindi) ━━━
"Koi baat nahi! 😊 Yeh try karo:\nStep 1: Ctrl+Shift+Esc → Task Manager → CPU column click karo.\nStep 2: Sabse upar wali heavy app → Right-click → End Task.\nStep 3: Laptop restart karo.\nKaam aa jaye toh batao! 🙏"

━━━ CORRECT FORMAT (English) ━━━
"Let's fix this! 🔧\nStep 1: Press Ctrl+Shift+Esc → Task Manager → click CPU column.\nStep 2: Right-click the top app → End Task.\nStep 3: Restart your laptop.\nLet me know if this helps! ✅"

━━━ NEVER DO THIS ━━━
❌ "Laptop on nahi ho raha hai" as a title/heading before steps — BANNED
❌ "Laptop ki samasya ka samadhan" — BANNED, never write problem name as heading
❌ "Yeh steps follow karein:" — BANNED, just give the steps
❌ Any line that just restates the user's problem — BANNED

━━━ "NAHI HUAA" RULE — MOST IMPORTANT ━━━
When user says ANY of these: "nahi huaa", "nahi hua", "nahi chala", "kaam nahi kiya", "still not working", "nahi ho raha", "NAHI HUAA", "problem abhi bhi hai":
→ They TRIED your steps. Steps FAILED. Now give COMPLETELY DIFFERENT new steps.
→ NEVER repeat what was already said in this conversation.
→ NEVER say "Theek hai!" or "Koi aur problem ho toh batao" — they still have the same problem!
→ After 2 different attempts failed → suggest ticket warmly.

EXAMPLE — WiFi:
  Attempt 1: Taskbar WiFi OFF/ON → forget → reconnect → restart
  User: nahi huaa
  Attempt 2: [NEW] Device Manager → Network Adapters → WiFi → Disable → Enable → reconnect
  User: nahi huaa
  → "Koi baat nahi! 😊 Yeh thoda tricky lag raha hai. Ticket raise karte hain — type karo: *ticket bana do* 🎫"

EXAMPLE — Laptop Slow:
  Attempt 1: Task Manager → End heavy apps → restart
  User: nahi huaa
  Attempt 2: [NEW] Settings → Apps → Startup → disable unnecessary apps → restart
  User: nahi huaa
  → Ticket suggestion

❌ BANNED responses to "nahi huaa":
  ❌ "Theek hai! Koi aur problem ho toh batao." ← NEVER say this when problem not solved
  ❌ Repeating same Task Manager steps
  ❌ Giving same WiFi toggle steps again

━━━ VAGUE PROBLEM ━━━
Ask ONE friendly question: "Kya ho raha hai exactly — [option A] ya [option B]? 🤔"

━━━ AFTER 2 FAILED ATTEMPTS ━━━
Say warmly: "Koi baat nahi! 😊 Yeh thoda complex lag raha hai. Ticket raise karte hain — type karo: *ticket bana do* 🎫 IT team turant dekh legi!"

━━━ TICKET ONLY — NO DIY ━━━
These always get a ticket (no steps, just friendly redirect):
- Password reset / account unlock → "Yeh main khud reset kar dunga! 🎫 Type karo: ticket bana do"
- VPN setup, new software install → ticket only
- Windows reinstall, BIOS, hard drive → ticket only
- Liquid damage → "TURANT laptop band karo! 🚨 IT ko Slack pe message karo"

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

━━━ DIAGNOSTICS — IMPORTANT ━━━
NEVER say "Lenovo Vantage → Run Diagnostics karo" or "Dell SupportAssist karo" as a manual step.
The system automatically sends a diagnostic script button and can run it via agent.
Instead say: "⬇️ Neeche diagnostic script button hai — click karo, automatic chal jayega! 🤖"
If user says "aap karo" / "ye aap karo" / "tum karo" → system handles it automatically, just say: "Haan! Abhi run kar raha hoon — thoda wait karo! ⚡"

━━━ KNOWLEDGE BASE — ACCURATE STEPS FOR ALL PROBLEMS ━━━

💻 LAPTOP HARDWARE:
Slow (1st attempt): Ctrl+Shift+Esc → CPU sort → End Task heavy apps → restart
Slow (2nd attempt — if 1st failed): Settings → Apps → Startup → disable all non-essential apps → restart laptop
Slow (3rd attempt): Win+R → cleanmgr → C: → Clean system files → Recycle Bin → restart → if still slow = ticket (RAM/SSD issue)
Won't turn on (1st): Hold power 30sec → release → wait 10sec → press power
Won't turn on (2nd attempt): Remove charger → hold power 30sec → plug charger back → wait 30sec → press power. No result = ticket
Blue screen: Note error code shown on screen → restart. Repeats 3x = ticket immediately
Overheating (1st): Ctrl+Shift+Esc → End heavy apps → place laptop on hard flat surface → not on bed/sofa
Overheating (2nd attempt): Settings → Power → choose "Balanced" plan (not High Performance) → Ctrl+Shift+Esc → check CPU % → still 90%+ = ticket
Battery not charging (1st): Replug charger firmly at both ends → try different power socket
Battery not charging (2nd attempt): Shut down laptop → remove charger → hold power button 30sec → reconnect charger → power on. Still no = ticket (charger/battery replace)
Black screen (1st): Fn+F5 or Fn+F8 (brightness keys) → if no change: hold power 10sec → restart
Black screen (2nd attempt): Connect to external monitor via HDMI → Win+P → if external shows image = laptop screen issue = ticket
Keyboard not working (1st): Restart laptop → if same: Win+R → type osk → on-screen keyboard as temporary fix
Keyboard not working (2nd attempt): Device Manager → Keyboards → right-click → Update driver. Persists = ticket (keyboard replace)
Mouse/Touchpad (1st): Fn + touchpad key (lock icon) → Settings → Bluetooth & devices → Touchpad → ON → restart
Mouse/Touchpad (2nd attempt): Device Manager → Mice → right-click touchpad → Uninstall → restart (Windows reinstalls driver)
Charger not working: Try different socket → check cable for visible damage. No charging LED at all = ticket
Freezing/Hanging (1st): Wait 2min → Ctrl+Alt+Del → End Not Responding tasks
Freezing/Hanging (2nd attempt): Hold power 10sec (force shutdown) → restart → Ctrl+Shift+Esc → check what's using high CPU/RAM
Sudden shutdown: Check vents not blocked → Settings → Power → Sleep: Never. Repeats without warning = ticket (battery/thermal issue)
Stuck in restart loop: Power off → hold F8 on boot → Safe Mode → Startup Repair. Can't enter = ticket immediately
Fan loud noise (1st): Ctrl+Shift+Esc → End CPU-heavy apps → place on hard flat surface
Fan loud noise (2nd attempt): Settings → Power → Balanced mode. Grinding/clicking sound = ticket immediately
Screen flickering (1st): Right-click desktop → Display settings → check refresh rate matches "Recommended"
Screen flickering (2nd attempt): Device Manager → Display adapters → right-click → Update driver → restart
Bluetooth (1st): Settings → Bluetooth → toggle OFF → ON → restart
Bluetooth (2nd attempt): Device Manager → Bluetooth → right-click → Disable → Enable → search for device again
USB not working (1st): Try a different USB port on laptop
USB not working (2nd attempt): Win+R → devmgmt.msc → Universal Serial Bus → right-click each → Uninstall → Action → Scan for hardware changes
Won't wake from sleep: Hold power button 10sec → restart. Permanent fix: Settings → Power & Sleep → Sleep = Never
Boot error: Power off → F8/F11 on boot → Startup Repair. No option = ticket immediately
Touchscreen (1st): Settings → Bluetooth & devices → Touch → toggle ON
Touchscreen (2nd attempt): Device Manager → Human Interface Devices → HID-compliant touch screen → right-click → Enable
HDMI (1st): Win+P → select Duplicate or Extend → check if monitor powers on
HDMI (2nd attempt): Restart laptop WITH monitor already plugged in via HDMI → Win+P again
SD card: Remove → reinsert → check File Explorer → devmgmt.msc → Memory card → Scan for changes
Fingerprint: Settings → Accounts → Sign-in options → Windows Hello Fingerprint → Remove → Add again. Fails = ticket
Liquid/Water damage: IMMEDIATELY power off → DO NOT turn on → remove charger → Slack pe IT ko message karo
Slow after update (1st): Ctrl+Shift+Esc → find "Delivery Optimization" or "Windows Update" → End Task
Slow after update (2nd): Settings → Windows Update → Advanced → Delivery Optimization → OFF → restart
Caps Lock/keys stuck: Press Caps Lock once → if blinking LED stops = fixed. Physically jammed key = ticket (keyboard replace)

🌐 NETWORK/INTERNET:
⛔ NEVER mention router, dongle, LAN, ethernet, modem, or cable in any WiFi/internet answer. Only laptop-side Windows steps.
WiFi not working (1st attempt): Taskbar WiFi → toggle OFF → ON → forget network → reconnect with password spartans500 → restart laptop
WiFi not working (2nd attempt — if 1st failed): Device Manager → Network Adapters → right-click WiFi adapter → Disable → wait 5sec → Enable → reconnect to WiFi
WiFi not working (3rd attempt — if 2nd failed): Win+R → cmd → type: netsh winsock reset → Enter → restart laptop → reconnect
Slow internet (1st): Forget network → reconnect (password: spartans500) → close heavy apps (Teams, Chrome) → restart laptop
Slow internet (2nd attempt): Device Manager → Network adapters → WiFi → right-click → Update driver → Search automatically
WiFi password: spartans500 — same for all networks
WiFi networks: "spartans500" (all floors) and "wiom office 5g test" (5GHz, faster) — both use password: spartans500
Hotspot (1st): Phone hotspot OFF → ON → laptop forget hotspot → reconnect → ensure mobile data ON on phone
Hotspot (2nd attempt): Phone → Settings → Hotspot → change frequency to 2.4GHz → laptop reconnect
Website blocked: Try different browser → check internet working → office block = raise ticket
WiFi disconnecting: Device Manager → Network adapters → WiFi → Properties → Power Management → uncheck "Allow PC to turn off this device" → forget network → reconnect
Emails not loading: Check WiFi connected → Win+R → outlook /safe → browser fallback: outlook.office365.com

🎤 AUDIO/VIDEO/DISPLAY:
No sound: Right-click speaker icon → Sound settings → Output → select correct device → check not muted
Speaker issue: Check volume not 0% → check nothing plugged in audio jack → restart
Mic not working: Settings → Privacy → Microphone → ON → Sound settings → Input → select mic → test in Teams: Settings → Devices
Camera not working: Settings → Privacy → Camera → ON → Device Manager → Cameras → Enable → restart
External monitor: Win+P → Duplicate/Extend → check HDMI/VGA cable → restart with monitor plugged in
Headphone: Unplug → replug firmly → Sound settings → Output → select Headphones
Projector: Win+P → Duplicate → check cable → restart laptop with projector connected
Wrong resolution: Right-click desktop → Display settings → Resolution → select "Recommended" → Apply
Video call lag: Close unused apps → check internet speed → Teams: Settings → Devices → lower video quality

💿 SOFTWARE/APPS:
Teams issue (1st attempt): System tray → right-click Teams icon → Quit → reopen Teams
Teams issue (2nd attempt): Win+R → %appdata%\Microsoft\Teams → delete Cache, GPUCache, blob_storage folders → reopen Teams. Web fallback: teams.microsoft.com
Zoom: Close → reopen → check internet → web fallback: zoom.us/wc/join → if mic/cam issue: Zoom Settings → Audio/Video → select correct device
Word/Excel (1st): Win+R → winword /safe or excel /safe → Enter
Word/Excel (2nd attempt): Right-click Word/Excel in Start → More → Run as administrator. License error = ticket
Browser slow/crash (1st): Extensions → disable all → Settings → Clear browsing data → All time → All boxes
Browser slow/crash (2nd attempt): Try a completely different browser (Chrome → Edge → Firefox). Still slow = check WiFi
Windows update stuck (1st): Settings → Windows Update → Pause 1 week → resume → retry
Windows update stuck (2nd attempt): Win+R → services.msc → Windows Update → right-click → Restart service → retry update
Software install: Raise ticket — IT permission required, no self-install allowed
Copy paste (1st): Restart laptop (fixes most copy-paste issues)
Copy paste (2nd attempt): Ctrl+Shift+Esc → find rdpclip.exe → End Task → Win+R → type rdpclip → Enter → test copy-paste
Wrong date/time: Right-click clock → Adjust date/time → Set automatically ON → Time zone: India Standard Time → Sync now
Outlook (1st attempt): Ctrl+Shift+Esc → End Outlook process → Win+R → outlook /safe → Enter
Outlook (2nd attempt): File → Account Settings → double-click account → Repair → re-enter credentials → restart Outlook. License error = ticket
OneDrive sync (1st): System tray → OneDrive icon → Pause syncing → Resume syncing
OneDrive sync (2nd attempt): System tray → OneDrive → right-click → Settings → Account → sign out → sign back in
PDF not opening (1st): Right-click PDF → Open with → Microsoft Edge
PDF not opening (2nd attempt): Right-click PDF → Open with → Choose app → Adobe Reader. Not installed = ticket
App crashing (1st): Restart laptop completely → reopen app
App crashing (2nd attempt): Right-click app → Run as administrator. Repeats = ticket (reinstall needed)
Printer (1st attempt): Settings → Bluetooth & devices → Printers → right-click → Set as default → try printing
Printer (2nd attempt): Restart print spooler: Win+R → services.msc → Print Spooler → Restart → retry printing

🔐 ACCOUNT/SECURITY/STORAGE:
Password reset: Raise ticket ONLY — IT resets, no self-service
Storage full: Win+R → cleanmgr → C: → Clean system files → check Recycle Bin + Temp. Also: Win+R → %temp% → Ctrl+A → Delete
Virus/Malware: Windows Security → Virus scan → Quick Scan → disconnect internet if serious → raise ticket
Shared drive: Raise ticket — IT grants access, no DIY
Account locked: Raise ticket — IT unlocks, no DIY
2FA/OTP: Check phone signal → check spam/junk folder → wait 2min → retry. Still no = ticket
Antivirus alert: Do NOT click Allow/Ignore → screenshot alert → raise ticket immediately
OneDrive full: Delete unnecessary files from OneDrive folder. Need more space = ticket
Email password: Raise ticket — IT resets email passwords only

🔄 REPLACEMENT:
All replacement requests (laptop, mouse, keyboard, monitor) = Raise ticket only. IT team processes requests.`;


// ── Extract steps already tried (to prevent repeats) ─────────────────────────
const extractTriedSteps = (messages) => {
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  if (assistantMsgs.length === 0) return '';
  const steps = [];
  assistantMsgs.forEach(msg => {
    const matches = msg.content.match(/Step \d+:[^\n]+/g);
    if (matches) steps.push(...matches.map(s => s.trim()));
  });
  if (steps.length === 0) return '';
  return `\n\n⚠️ STEPS ALREADY TRIED IN THIS CONVERSATION (DO NOT REPEAT ANY OF THESE):\n${steps.join('\n')}\nGive completely different steps from the above.`;
};


// ── Static KB Fallback (when both AI providers fail) ─────────────────────────
const getKBFallback = (problem) => {
  const p = problem.toLowerCase();
  if (p.includes('slow') || p.includes('hang') || p.includes('freez'))
    return `Laptop slow/hang fix karo! 🔧\nStep 1: Ctrl+Shift+Esc → CPU column sort karo → heavy app Right-click → End Task.\nStep 2: Win+R → type temp → Ctrl+A → Delete karo.\nStep 3: Laptop restart karo.\nScript button neeche hai — ek click mein automatic fix! ⬇️`;
  if (p.includes('wifi') || p.includes('internet') || p.includes('network'))
    return `WiFi fix karo! 📶\nStep 1: Taskbar WiFi click → OFF karo → ON karo.\nStep 2: "wiom office 5g test" ya "spartans500" select karo | Password: spartans500\nStep 3: Kaam nahi hua toh laptop restart karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('sound') || p.includes('audio') || p.includes('speaker') || p.includes('headphone'))
    return `Sound fix karo! 🔊\nStep 1: Taskbar speaker icon Right-click → Sound settings.\nStep 2: Output device → sahi device select karo.\nStep 3: Volume 0% nahi honi chahiye — check karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('blue screen') || p.includes('bsod'))
    return `Blue Screen fix karo! 💙\nStep 1: Error code note karo jo screen par tha.\nStep 2: Laptop restart karo — akbar mein theek ho jata hai.\nStep 3: 3 baar se zyada hua toh ticket raise karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('battery') || p.includes('charg'))
    return `Battery fix karo! 🔋\nStep 1: Charger dono taraf firmly lagao.\nStep 2: Alag power socket try karo.\nStep 3: Laptop band karo → charger lagao → 30 sec wait → on karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('black screen') || p.includes('no display'))
    return `Black screen fix karo! 🖥️\nStep 1: Fn+F5 ya Fn+F8 (brightness keys) dabao.\nStep 2: Koi change nahi → power button 10sec hold → restart.\nStep 3: Baad mein bhi kuch nahi → ticket raise karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('keyboard') || p.includes('keys'))
    return `Keyboard fix karo! ⌨️\nStep 1: Laptop restart karo.\nStep 2: Win+R → osk → on-screen keyboard se kaam chalao.\nStep 3: Device Manager → Keyboards → Update driver.\nScript button neeche hai! ⬇️`;
  if (p.includes('touchpad') || p.includes('mouse'))
    return `Touchpad fix karo! 🖱️\nStep 1: Fn + touchpad key (lock icon wali) dabao.\nStep 2: Settings → Bluetooth & devices → Touchpad → ON.\nStep 3: Laptop restart karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('printer'))
    return `Printer fix karo! 🖨️\nStep 1: Settings → Bluetooth & devices → Printers → right-click → Set as default.\nStep 2: Win+R → services.msc → Print Spooler → Restart.\nStep 3: Dubara print karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('teams'))
    return `Teams fix karo! 📹\nStep 1: System tray → Teams icon right-click → Quit → reopen.\nStep 2: Win+R → %appdata%\\Microsoft\\Teams → Cache folder delete karo.\nStep 3: teams.microsoft.com browser mein kholo (web fallback).\nScript button neeche hai! ⬇️`;
  if (p.includes('zoom'))
    return `Zoom fix karo! 🎥\nStep 1: Zoom band karo → dobara kholo.\nStep 2: Internet check karo → zoom.us/wc/join browser mein try karo.\nStep 3: Zoom Settings → Audio/Video → sahi device select karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('outlook') || p.includes('email'))
    return `Outlook fix karo! 📧\nStep 1: Ctrl+Shift+Esc → Outlook process end karo.\nStep 2: Win+R → outlook /safe → Enter.\nStep 3: outlook.office365.com browser mein try karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('password') || p.includes('locked') || p.includes('login'))
    return `Password reset ke liye IT se contact karo! 🔐\nYeh self-service nahi hai — IT ke paas jaana hoga.\nType karo: *ticket bana do* → IT turant help karega! 🎫`;
  if (p.includes('bluetooth'))
    return `Bluetooth fix karo! 🔵\nStep 1: Settings → Bluetooth → toggle OFF → ON karo.\nStep 2: Device dobara pair karo.\nStep 3: Device Manager → Bluetooth → Disable → Enable.\nScript button neeche hai! ⬇️`;
  if (p.includes('camera') || p.includes('webcam'))
    return `Camera fix karo! 📷\nStep 1: Settings → Privacy → Camera → ON karo.\nStep 2: Device Manager → Cameras → right-click → Enable.\nStep 3: Laptop restart karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('mic') || p.includes('microphone'))
    return `Microphone fix karo! 🎤\nStep 1: Settings → Privacy → Microphone → ON karo.\nStep 2: Sound settings → Input → sahi mic select karo.\nStep 3: Teams: Settings → Devices → mic test karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('usb') || p.includes('pendrive'))
    return `USB fix karo! 🔌\nStep 1: Alag USB port mein try karo.\nStep 2: Device Manager → Universal Serial Bus → Uninstall → Scan for hardware changes.\nStep 3: Laptop restart karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('storage') || p.includes('disk full'))
    return `Storage cleanup karo! 💾\nStep 1: Win+R → cleanmgr → C: → Clean system files.\nStep 2: Win+R → %temp% → Ctrl+A → Delete.\nStep 3: Recycle Bin empty karo.\nScript button neeche hai! ⬇️`;
  if (p.includes('virus') || p.includes('malware') || p.includes('antivirus'))
    return `Virus scan karo! 🦠\nStep 1: Windows Security kholo → Virus & threat protection.\nStep 2: Quick Scan karo → wait karo.\nStep 3: Serious lag raha → ticket raise karo: type karo *ticket bana do* 🎫\nScript button neeche hai! ⬇️`;
  // Generic fallback
  return `Aapki problem note kar li! 🔧\nStep 1: Pehle laptop restart karo — bahut problems resolve ho jaati hain.\nStep 2: Neeche script button hai — ek click mein automatic fix try karo! ⬇️\nStep 3: Kaam nahi hua → DM mein detail mein type karo — main help karunga! 💬`;
};

// ── Call Claude (Anthropic) ───────────────────────────────────────────────────
const callClaude = async (systemPrompt, history) => {
  if (!anthropic) throw new Error('Anthropic client not initialized');
  const response = await anthropic.messages.create({
    model     : 'claude-3-haiku-20240307',   // stable model
    max_tokens: 600,
    system    : systemPrompt,
    messages  : history
  });
  const text = response.content?.[0]?.text?.trim();
  if (!text) throw new Error('Empty response from Claude');
  return text;
};


// ── Call Groq (LLaMA fallback) ────────────────────────────────────────────────
const callGroq = async (systemPrompt, history) => {
  const completion = await groq.chat.completions.create({
    model      : 'llama-3.1-8b-instant',    // fast + always available on Groq
    messages   : [{ role: 'system', content: systemPrompt }, ...history],
    temperature: 0.2,
    max_tokens : 500
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from Groq');
  return text;
};


// ── Parse JSON from raw model output ─────────────────────────────────────────
const parseOutput = (raw) => {
  try {
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) return JSON.parse(codeBlock[1].trim());
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s !== -1 && e > s) return JSON.parse(raw.slice(s, e + 1));
    return JSON.parse(raw);
  } catch {
    return { reply: raw, shouldCreateTicket: false, ticketData: null };
  }
};


// ── Main chat function ────────────────────────────────────────────────────────
const chat = async (messages, { empId, empName, source, laptop, laptopSN, dept, floor }) => {
  if (!modelLogged) {
    console.log(`🤖 AI Model: ${activeModel()}`);
    modelLogged = true;
  }

  // Last 30 messages for full context (was 20 before)
  const history = messages.slice(-30).map(m => ({
    role   : m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const userContext = [
    `Employee: ${empName || empId} (ID: ${empId})`,
    dept     ? `Department: ${dept}`                   : null,
    floor    ? `Floor: ${floor}`                        : null,
    laptop   ? `Assigned Laptop: ${laptop}`             : null,
    laptopSN ? `Serial Number: ${laptopSN}`             : null,
  ].filter(Boolean).join(' | ');

  // Build steps-already-tried list so model never repeats them
  const triedSteps = extractTriedSteps(messages);

  const systemPrompt = SYSTEM_PROMPT
    + `\n\nUSER CONTEXT: ${userContext}`
    + (laptop ? `\nEmployee laptop: ${laptop}${laptopSN ? ` (SN: ${laptopSN})` : ''}` : '')
    + triedSteps;

  // Call Claude first, fall back to Groq, then static KB
  let raw;
  try {
    raw = await callClaude(systemPrompt, history);
    console.log('✅ Claude responded OK');
  } catch (claudeErr) {
    console.error('❌ Claude failed:', claudeErr.message);
    try {
      raw = await callGroq(systemPrompt, history);
      console.log('✅ Groq fallback responded OK');
    } catch (groqErr) {
      console.error('❌ Groq also failed:', groqErr.message);
      // Static KB fallback — look up problem in last user message
      const lastMsg = history.filter(m => m.role === 'user').pop()?.content || '';
      raw = getKBFallback(lastMsg);
      console.log('⚠️  Using static KB fallback');
    }
  }

  // raw is now plain text (no JSON parsing needed)
  let reply = (raw || '').trim();

  // Safety: if somehow JSON slipped through, extract reply field or use raw
  if (reply.startsWith('{') || reply.includes('"shouldCreateTicket"')) {
    try {
      const s = reply.indexOf('"reply"');
      if (s !== -1) {
        const parsed = JSON.parse(reply.slice(reply.indexOf('{')));
        reply = parsed.reply || reply;
      }
    } catch { /* ignore */ }
    if (reply.startsWith('{')) reply = getKBFallback(history.filter(m=>m.role==='user').pop()?.content||'');
  }

  // Strip robotic title lines before "Step 1:" (keep emoji openers)
  const stepIdx = reply.indexOf('Step 1:');
  if (stepIdx > 0) {
    const preStep = reply.slice(0, stepIdx);
    const hasEmoji = /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|😊|🔧|✅|🙏|🎫|🚨|💻|📶|🤔/u.test(preStep);
    if (!hasEmoji) reply = reply.slice(stepIdx).trim();
  }

  // Check if ticket needed (simple keyword check on raw text)
  const shouldCreateTicket = /ticket\s*(bana|raise|create|chahiye)/i.test(reply) && reply.includes('ticket');

  return {
    reply             : reply || getKBFallback('generic'),
    shouldCreateTicket: shouldCreateTicket,
    ticketData        : null
  };
};


// ── Quick single reply (for Slack notifications) ─────────────────────────────
const quickReply = async (userMessage, empName = 'Employee', laptop = null, laptopSN = null) => {
  const laptopCtx = laptop ? ` | Laptop: ${laptop}${laptopSN ? ` (SN: ${laptopSN})` : ''}` : '';
  const sys = SYSTEM_PROMPT + `\nUser: ${empName}${laptopCtx}. Keep reply under 3 lines.`;
  const history = [{ role: 'user', content: userMessage }];

  let raw;
  try {
    raw = anthropic ? await callClaude(sys, history) : await callGroq(sys, history);
  } catch {
    raw = await callGroq(sys, history);
  }

  const parsed = parseOutput(raw);
  return (typeof parsed.reply === 'string' ? parsed.reply : raw) || userMessage;
};

module.exports = { chat, quickReply };
