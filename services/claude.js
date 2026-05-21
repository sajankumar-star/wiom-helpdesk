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

SCOPE RULE - MOST IMPORTANT:
- IT-related question (hardware, software, network, devices, accounts, security, apps, computers, phones, any tech) -> Answer it FULLY using all your IT knowledge, even if not in the knowledge base below.
- TICKET STATUS question ("mera ticket kab tak hoga", "ticket solve kab hoga", "ticket update", "ticket progress", "kab fix hoga") -> Reply: "Aapka ticket IT team ke paas hai! 📋 Typically same day ya 24h mein resolve hota hai depending on priority.\n\nStatus check karne ke liye type karo: *my tickets* 👀\nUrgent hai toh type karo: *raise ticket* 🎫"
- IDENTITY question ("kise hai", "tum kaun ho", "what are you", "aap kaun ho", "bot hai kya") -> Reply: "Main hoon *WIOM IT Helpdesk Bot!* 🤖\nAapke laptop, WiFi, software — har IT problem mein help karta hoon.\nBatao kya problem hai, turant fix karunga! 😊"
- NON-IT question (cricket, weather, cooking, finance, poetry, movies, general knowledge, personal topics) -> Reply ONLY: "Main sirf WIOM IT Helpdesk ke liye hoon! Laptop, WiFi, software ya koi bhi IT problem ho toh batao - turant help karunga! 😊"

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
❌ "Ticket raised successfully" — BANNED. You cannot create tickets. Only the system can.
❌ "Ticket submitted/created/raised" — BANNED. Never pretend to create a ticket.
❌ Showing fake Ticket IDs like "WIOM-TKT-XXXX" — BANNED. You don't know the ticket ID.
❌ "Steps tried:" section in ticket message — BANNED. Just ask for "ha" confirmation.
❌ "IT Team will contact you soon" after ticket — BANNED. System sends this automatically.

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
  → "Koi baat nahi! 😊 Yeh thoda tricky lag raha hai. Ticket raise karte hain — type karo: *raise ticket* 🎫"

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
Say warmly: "Koi baat nahi! 😊 Yeh thoda complex lag raha hai. Ticket raise karte hain — type karo: *raise ticket* 🎫 IT team turant dekh legi!"

━━━ TICKET ONLY — NO DIY ━━━
These always get a ticket (no steps, just friendly redirect):
- Google account password reset → Give these steps: 1. Go to myaccount.google.com 2. Click Security tab 3. Under "How you sign in to Google" click Password 4. Enter current password or verify via prompt/fingerprint 5. Set new password. If not working → ticket only
- VPN setup, new software install → ticket only
- Windows reinstall, BIOS, hard drive → ticket only
- Liquid damage → "TURANT laptop band ! 🚨 IT ko Slack pe message karo"

━━━ VAGUE MESSAGE ━━━
If problem unclear — ask ONE short question only. No steps yet.
Hindi: "Exactly kya ho raha hai — [option A] ya [option B]?"
English: "What exactly is happening — [option A] or [option B]?"

━━━ TICKET RULE — CRITICAL ━━━
NEVER say "Ticket raised successfully", "Ticket created", "Ticket submitted", or show fake Ticket IDs.
NEVER pretend to create a ticket. You CANNOT create tickets — only the SYSTEM can.

After 2 failed attempts, say EXACTLY this (nothing more):
"Koi baat nahi! 😊 IT team ko ticket bhejte hain. Type karo: *ha* ✅"

When user types *ha* — the SYSTEM creates the ticket automatically. You just ask for confirmation.
Priority: Critical=work stopped, High=can't work, Medium=partial work, Low=minor.

━━━ ALWAYS TICKET — NO DIY ━━━
Never give self-fix steps for:
- Windows reinstall, BIOS, hard drive, data recovery
- New software install, VPN setup, Active Directory
- Password reset / account unlock → Ticket only

━━━ DIAGNOSTICS — IMPORTANT ━━━
NEVER say "Lenovo Vantage → Run Diagnostics karo" or "Dell SupportAssist karo" as a manual step.
The system automatically sends a diagnostic script button and can run it via agent.
Instead say: "⬇️ Neeche diagnostic script button hai — click karo, automatic chal jayega! 🤖"
If user says "aap karo" / "ye aap karo" / "tum karo" → system handles it automatically, just say: "Haan! Abhi run kar raha hoon — thoda wait ! ⚡"

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
⚡ WiFi password question (HIGHEST PRIORITY — ANSWER DIRECTLY, NO STEPS):
If anyone asks WiFi password / wifi ka password / pass kya hai / network password → IMMEDIATELY reply:
"WiFi Password 📶
Password: spartans500 (sabhi networks ke liye same)
Networks: Wiom office 5g-Test (Ground floor) | Wiom office Guest | Wiom office 3rd floor | Wiomnet-Saket (Password: Password@12345)"
DO NOT give steps to find password. DO NOT say "Device Manager". Just give the password directly.

WiFi password: spartans500 — same for all networks
WiFi networks: "Wiom office 5g-Test" Ground floor (password: spartans500) | "Wiom office Guest" (password: spartans500) | "Wiom office 3rd floor" 3rd floor (password: spartans500) | "Wiomnet" Saket office (password: Password@12345)
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
Google account password reset: Give steps — 1. myaccount.google.com 2. Security tab 3. Click Password under "How you sign in to Google" 4. Enter current password or verify via fingerprint/prompt 5. Set new password. If still not working = ticket
Windows/laptop login password: Raise ticket ONLY — IT resets
Storage full: Win+R → cleanmgr → C: → Clean system files → check Recycle Bin + Temp. Also: Win+R → %temp% → Ctrl+A → Delete
Virus/Malware: Windows Security → Virus scan → Quick Scan → disconnect internet if serious → raise ticket
Shared drive: Raise ticket — IT grants access, no DIY
Account locked: Raise ticket — IT unlocks, no DIY
2FA/OTP: Check phone signal → check spam/junk folder → wait 2min → retry. Still no = ticket
Antivirus alert: Do NOT click Allow/Ignore → screenshot alert → raise ticket immediately
OneDrive full: Delete unnecessary files from OneDrive folder. Need more space = ticket
Email password: Raise ticket — IT resets email passwords only

🔄 REPLACEMENT:
All replacement requests (laptop, mouse, keyboard, monitor) = Raise ticket only. IT team processes requests.

CASUAL / FRIENDLY MESSAGES:
When user says "kaise ho", "kaisa hai", "how are you", "kya haal" - Reply: "Main bilkul theek hoon! Batao kya IT problem aa rahi hai - help karne ke liye ready hoon!"
When user says "thanks", "shukriya", "thank you", "dhanyawad" - Reply: "Khushi hui! Koi bhi aur IT problem ho toh batao - hamesha yahan hoon!"
When user says "hello", "hi", "hey", "namaste" - Reply: "Hello! WIOM IT Helpdesk mein aapka swagat hai! Kya IT problem hai - batao, turant help karunga!"
When user says "bye", "alvida", "ok bye" - Reply: "Theek hai! Koi bhi IT problem ho toh kabhi bhi message karo - hamesha ready hoon!"

ADMIN / SAJAN CONTACT:
When user asks about admin, Sajan, IT head, IT manager, contact, phone number - Reply with:
"Sajan Kumar se contact karo - WIOM IT Admin
Phone: 9654244281
Email: sajan.kumar@wiom.in
Ya seedha ticket banao - type karo: *raise ticket* - IT team jaldi respond karegi!"`;



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
    return `Laptop slow/hang fix! 🔧\nStep 1: Ctrl+Shift+Esc → CPU column sort karo → heavy app Right-click → End Task.\nStep 2: Win+R → type temp → Ctrl+A → Delete karo.\nStep 3: Laptop restart karo.\nScript button neeche hai — ek click mein automatic fix! ⬇️`;
  if (p.includes('wifi') || p.includes('internet') || p.includes('network'))
    return `WiFi fix! 📶\nStep 1: Taskbar WiFi click → OFF karo → ON karo.\nStep 2: Apna network select karo:\n   Ground floor: "Wiom office 5g-Test" → Password: spartans500\n   Guest: "Wiom office Guest" → Password: spartans500\n   3rd floor: "Wiom office 3rd floor" → Password: spartans500\n   Saket office: "Wiomnet" → Password: Password@12345\nStep 3: Kaam nahi hua toh laptop restart karo.\nClick the script button below! ⬇️`;
  if (p.includes('sound') || p.includes('audio') || p.includes('speaker') || p.includes('headphone'))
    return `Sound fix! 🔊\nStep 1: Taskbar speaker icon Right-click → Sound settings.\nStep 2: Output device → sahi device select karo.\nStep 3: Volume 0% nahi honi chahiye — check karo.\nClick the script button below! ⬇️`;
  if (p.includes('blue screen') || p.includes('bsod'))
    return `Blue Screen fix! 💙\nStep 1: Error code note karo jo screen par tha.\nStep 2: Laptop restart karo — akbar mein theek ho jata hai.\nStep 3: 3 baar se zyada hua toh ticket raise karo.\nClick the script button below! ⬇️`;
  if (p.includes('battery') || p.includes('charg'))
    return `Battery fix! 🔋\nStep 1: Charger dono taraf firmly lagao.\nStep 2: Alag power socket try karo.\nStep 3: Laptop band karo → charger lagao → 30 sec wait → on karo.\nClick the script button below! ⬇️`;
  if (p.includes('black screen') || p.includes('no display'))
    return `Black screen fix! 🖥️\nStep 1: Fn+F5 ya Fn+F8 (brightness keys) dabao.\nStep 2: Koi change nahi → power button 10sec hold → restart.\nStep 3: Baad mein bhi kuch nahi → ticket raise karo.\nClick the script button below! ⬇️`;
  if (p.includes('keyboard') || p.includes('keys'))
    return `Keyboard fix! ⌨️\nStep 1: Laptop restart karo.\nStep 2: Win+R → osk → on-screen keyboard se kaam chalao.\nStep 3: Device Manager → Keyboards → Update driver.\nClick the script button below! ⬇️`;
  if (p.includes('touchpad') || p.includes('mouse'))
    return `Touchpad fix! 🖱️\nStep 1: Fn + touchpad key (lock icon wali) dabao.\nStep 2: Settings → Bluetooth & devices → Touchpad → ON.\nStep 3: Laptop restart karo.\nClick the script button below! ⬇️`;
  if (p.includes('printer'))
    return `Printer fix! 🖨️\nStep 1: Settings → Bluetooth & devices → Printers → right-click → Set as default.\nStep 2: Win+R → services.msc → Print Spooler → Restart.\nStep 3: Dubara print karo.\nClick the script button below! ⬇️`;
  if (p.includes('teams'))
    return `Teams fix! 📹\nStep 1: System tray → Teams icon right-click → Quit → reopen.\nStep 2: Win+R → %appdata%\\Microsoft\\Teams → Cache folder delete karo.\nStep 3: teams.microsoft.com browser mein kholo (web fallback).\nClick the script button below! ⬇️`;
  if (p.includes('zoom'))
    return `Zoom fix! 🎥\nStep 1: Zoom band karo → dobara kholo.\nStep 2: Internet check karo → zoom.us/wc/join browser mein try karo.\nStep 3: Zoom Settings → Audio/Video → sahi device select karo.\nClick the script button below! ⬇️`;
  if (p.includes('outlook') || p.includes('email'))
    return `Outlook fix! 📧\nStep 1: Ctrl+Shift+Esc → Outlook process end karo.\nStep 2: Win+R → outlook /safe → Enter.\nStep 3: outlook.office365.com browser mein try karo.\nClick the script button below! ⬇️`;
  if (p.includes('password') || p.includes('locked') || p.includes('login'))
    return `Google account password reset ! 🔐\nStep 1: myaccount.google.com pe jaao\nStep 2: Security tab click karo\nStep 3: "How you sign in to Google" mein Password click karo\nStep 4: Current password enter karo (ya fingerprint/prompt se verify karo)\nStep 5: Naya password set karo\n\nAgar nahi hua: raise ticket — IT help karega 🎫`;
  if (p.includes('bluetooth'))
    return `Bluetooth fix! 🔵\nStep 1: Settings → Bluetooth → toggle OFF → ON karo.\nStep 2: Device dobara pair karo.\nStep 3: Device Manager → Bluetooth → Disable → Enable.\nClick the script button below! ⬇️`;
  if (p.includes('camera') || p.includes('webcam'))
    return `Camera fix! 📷\nStep 1: Settings → Privacy → Camera → ON karo.\nStep 2: Device Manager → Cameras → right-click → Enable.\nStep 3: Laptop restart karo.\nClick the script button below! ⬇️`;
  if (p.includes('mic') || p.includes('microphone'))
    return `Microphone fix! 🎤\nStep 1: Settings → Privacy → Microphone → ON karo.\nStep 2: Sound settings → Input → sahi mic select karo.\nStep 3: Teams: Settings → Devices → mic test karo.\nClick the script button below! ⬇️`;
  if (p.includes('usb') || p.includes('pendrive'))
    return `USB fix! 🔌\nStep 1: Alag USB port mein try karo.\nStep 2: Device Manager → Universal Serial Bus → Uninstall → Scan for hardware changes.\nStep 3: Laptop restart karo.\nClick the script button below! ⬇️`;
  if (p.includes('storage') || p.includes('disk full'))
    return `Storage cleanup ! 💾\nStep 1: Win+R → cleanmgr → C: → Clean system files.\nStep 2: Win+R → %temp% → Ctrl+A → Delete.\nStep 3: Recycle Bin empty karo.\nClick the script button below! ⬇️`;
  if (p.includes('virus') || p.includes('malware') || p.includes('antivirus'))
    return `Virus scan ! 🦠\nStep 1: Windows Security kholo → Virus & threat protection.\nStep 2: Quick Scan karo → wait karo.\nStep 3: Serious lag raha → raise a ticket: type *raise ticket* 🎫\nClick the script button below! ⬇️`;
  if (p.includes('kaise ho') || p.includes('kaisa hai') || p.includes('how are you') || p.includes('kya haal'))
    return 'Main bilkul theek hoon! Batao kya IT problem aa rahi hai - help ke liye ready hoon!';
  if (p.includes('thanks') || p.includes('shukriya') || p.includes('thank you') || p.includes('dhanyawad'))
    return 'Khushi hui! Koi bhi aur IT problem ho toh batao - hamesha yahan hoon!';
  if (p === 'hello' || p === 'hi' || p === 'hey' || p.includes('namaste') || p.includes('hii'))
    return 'Hello! WIOM IT Helpdesk mein aapka swagat hai! Kya IT problem hai - batao, turant help karunga!';
  if (p.includes('sajan') || p.includes('admin') || p.includes('it head') || p.includes('phone number') || p.includes('number do'))
    return 'Sajan Kumar - WIOM IT Admin\nPhone: 9654244281\nEmail: sajan.kumar@wiom.in\nTicket banana ho toh type karo: *raise ticket*';
  // Generic fallback
  return `Your issue has been noted! 🔧\nStep 1: First restart your laptop — this fixes most issues.\nStep 2: Neeche script button hai — ek click mein automatic fix try ! ⬇️\nStep 3: Still not working? Type your problem in DM for more help! 💬`;
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
    model      : 'llama-3.1-8b-instant',    // fastest Groq model
    messages   : [{ role: 'system', content: systemPrompt }, ...history],
    temperature: 0.15,
    max_tokens : 350   // shorter = faster response
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

  // Use Groq directly (fast) — Claude only if ANTHROPIC_API_KEY set
  let raw;
  try {
    raw = anthropic ? await callClaude(systemPrompt, history) : await callGroq(systemPrompt, history);
    console.log('✅ AI responded OK');
  } catch (err) {
    console.error('❌ AI failed:', err.message);
    try {
      raw = await callGroq(systemPrompt, history);
      console.log('✅ Groq fallback OK');
    } catch {
      const lastMsg = history.filter(m => m.role === 'user').pop()?.content || '';
      raw = getKBFallback(lastMsg);
      console.log('⚠️ Using static KB fallback');
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

  // Check if ticket needed — detect when AI suggests raising a ticket
  // Match: "ticket bhejte hain", "ha type karo", "ticket raise karein", etc.
  const shouldCreateTicket = reply.includes('ticket') && (
    /ticket\s*(bana|raise|create|chahiye|bhejte)/i.test(reply) ||
    /type\s*karo[:\s]*\*?ha\*?/i.test(reply) ||
    /ticket\s*(raise\s*karein|banana|karein)/i.test(reply)
  );

  // Safety: If AI hallucinated "raised successfully" — strip it and set shouldCreateTicket
  const isHallucinated = /ticket\s*(raised|created|submitted)\s*successfully/i.test(reply);
  if (isHallucinated) {
    // Replace with proper confirmation prompt
    reply = 'Koi baat nahi! 😊 IT team ko ticket bhejte hain. Type karo: *ha* ✅';
  }

  return {
    reply             : reply || getKBFallback('generic'),
    shouldCreateTicket: shouldCreateTicket || isHallucinated,
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

// ── Direct KB lookup — instant, no AI call needed ────────────────────────────
const getKBAnswer = (problem) => {
  if (!problem) return null;
  const p = problem.toLowerCase();

  // ── Identity questions ───────────────────────────────────────────────────
  if (/^(kise\s*hai|kise\s*ho|tum\s*kaun\s*ho|aap\s*kaun\s*ho|kaun\s*ho|kaun\s*hain|what\s*are\s*you|who\s*are\s*you|bot\s*hai\s*kya|kya\s*tum\s*bot|are\s*you\s*a\s*bot|introduce|apna\s*parichay)\s*\??$/i.test(p.trim())) {
    return `Main hoon *WIOM IT Helpdesk Bot!* 🤖\nAapke laptop, WiFi, software — har IT problem mein help karta hoon.\nBatao kya problem hai, turant fix karunga! 😊`;
  }

  // ── Ticket status / ETA questions ───────────────────────────────────────
  if (/ticket\s*(kab|kb|kab\s*tak|kab\s*solve|kab\s*hoga|kab\s*fix|status|update|progress|ka\s*kya|ho\s*gaya|hua\s*kya|abhi\s*tak|kyun\s*nahi|pending|lamba)/i.test(p) ||
      /kab\s*tak\s*(hoga|milega|fix|solve|resolve)/i.test(p) ||
      /mera\s*(ticket|kaam|issue|problem)\s*(kab|kb|solve|fix|hoga|ho\s*ga)/i.test(p)) {
    return `Aapka ticket IT team ke paas hai! 📋\nTypically *same day ya 24h* mein resolve hota hai (priority ke hisaab se).\n\nStatus check karne ke liye type karo: *my tickets* 👀\nUrgent hai toh: *raise ticket* 🎫`;
  }

  // ── Special multi-keyword checks FIRST (before single-keyword matches) ──
  const isWifiPassword = (p.includes('wifi') || p.includes('wi-fi') || p.includes('wiom') || p.includes('network')) &&
    (p.includes('password') || p.includes('pass') || p.includes('pwd') || p.includes('pssword') ||
     p.includes('pasword') || p.includes('passward') || p.includes('pasward') ||
     p.includes('kay hai') || p.includes('kya hai') || p.includes('batao') || p.includes('kya h') ||
     p.includes('bata') || p.includes('kya he') || p.includes('kya') || p.includes('hai') ||
     p.includes('bolo') || p.includes('what') || p.includes('tell'));

  // Direct "wifi password" / "password bata" type questions
  const isDirectPasswordQuestion =
    /^(wifi|wi-fi|network|wiom)[\s\-]*(password|pass|pwd|pasword|passward|pasward)/i.test(p.trim()) ||
    /^password[\s\-]*(wifi|wi-fi|network|wiom)/i.test(p.trim()) ||
    /wifi\s*(ka|ke|ki)?\s*(password|pass|pwd)/i.test(p) ||
    /password\s*(kya|kay|kia|ki|ka|ke)?\s*(hai|he|h|hain)/i.test(p) ||
    /^(pass|pwd|password)\s*$/i.test(p.trim());

  if (isWifiPassword || isDirectPasswordQuestion) {
    return `WiFi Password 📶\n\n*Sab networks ka same password hai:*\n🔑 Password: \`spartans500\`\n\n*Available Networks:*\n• *Wiom office 5g-Test* — Ground floor\n• *Wiom office Guest* — Guest network\n• *Wiom office 3rd floor* — 3rd floor\n• *Wiomnet* — Saket office (Password: \`Password@12345\`)\n\nKaam aa gaya toh batao! ✅`;
  }

  // Map of keywords → instant KB answers
  const quickAnswers = [
    { keys: ['slow','speed','hang','freeze','sluggish'], ans: `Koi baat nahi! 🔧 Yeh try karo:\nStep 1: Ctrl+Shift+Esc → CPU column click → top process → End Task\nStep 2: Win+R → %temp% → Ctrl+A → Delete\nStep 3: Restart laptop\nThodi der mein fast ho jayega! ✅` },
    { keys: ['wifi','internet','network','connection'], ans: `Dekho yeh karo! 📶\nStep 1: Taskbar WiFi icon → OFF karo → 10 sec → ON karo\nStep 2: Forget network → dobara password enter karo: spartans500\nStep 3: Laptop restart karo\nKaam aa jaye toh batao! ✅` },
    { keys: ['blue screen','bsod','bluescreen'], ans: `BSOD aa gaya! 💙 Try karo:\nStep 1: Laptop restart karo (mostly fix ho jata hai)\nStep 2: Win+X → Device Manager → Display/Network → Update Driver\nStep 3: Agar baar baar aaye → ticket raise karo\nBatao kya hua! ✅` },
    { keys: ['battery','charging','charge'], ans: `Battery issue! 🔋 Yeh dekho:\nStep 1: Charger plug nikalo → 30 sec wait → dobara lagao\nStep 2: Dusra power socket try karo\nStep 3: Agar nahi charga → ticket raise karo (hardware issue)\nBatao result! ✅` },
    { keys: ['overheat','hot','fan','temperature'], ans: `Laptop garam ho raha hai! 🌡️\nStep 1: Saare tabs/apps band karo → laptop stand use karo\nStep 2: Ctrl+Shift+Esc → CPU → heavy apps End Task karo\nStep 3: Clean karo laptop vents (air blower se)\nBetter feel hoga! ✅` },
    { keys: ['black screen','screen black','display'], ans: `Screen black! 🖥️ Try karo:\nStep 1: Power button 10 sec dabao → release → restart\nStep 2: Fn+F7 ya Fn+F8 (brightness keys)\nStep 3: External monitor lagao → agar dikhta hai toh screen issue → ticket\nBatao! ✅` },
    { keys: ['keyboard','key','type'], ans: `Keyboard issue! ⌨️ Try karo:\nStep 1: Laptop restart karo\nStep 2: Ctrl+Shift+Esc → Driver update check\nStep 3: On-Screen Keyboard: Settings → Accessibility → Keyboard ON\nAgar physical damage hai → ticket raise karo! ✅` },
    { keys: ['touchpad','mouse','cursor'], ans: `Touchpad kaam nahi kar raha! 🖱️\nStep 1: Fn+F9 dabao (touchpad enable/disable toggle)\nStep 2: Restart laptop\nStep 3: Device Manager → Mice → Uninstall → Restart (auto reinstall)\nBatao! ✅` },
    { keys: ['teams','microsoft teams'], ans: `Teams issue! 📹 Try karo:\nStep 1: Teams puri tarah band karo (system tray se) → dobara open\nStep 2: Teams Settings → Clear Cache → restart\nStep 3: Agar nahi chala → ticket raise karo\nKaam aa jaye! ✅` },
    { keys: ['outlook','email','mail'], ans: `Outlook problem! 📧 Try karo:\nStep 1: Ctrl+Shift+Esc → Outlook → End Task → dobara open\nStep 2: Win+R → outlook /safe → Enter (safe mode)\nStep 3: File → Account Settings → Repair\nBatao kya hua! ✅` },
    { keys: ['password','forgot','reset'], ans: `Password reset chahiye! 🔑\nWindows password = Ticket raise karo (IT reset karega)\nEmail password = Ticket raise karo\nGoogle account = myaccount.google.com → Security → Password\nTicket banane ke liye type karo: *ha* ✅` },
    { keys: ['shutdown','restart','stuck restarting','boot'], ans: `Stuck hai laptop! 🔄 Try karo:\nStep 1: Power button 10 sec dabao → force shutdown\nStep 2: Power on karo → F8 → Safe Mode → restart normally\nStep 3: Baar baar hota hai → ticket raise karo\nBatao result! ✅` },
    { keys: ['sound','audio','speaker','no sound'], ans: `Sound nahi aa raha! 🔊 Try karo:\nStep 1: Taskbar speaker icon → volume check → unmute\nStep 2: Right-click speaker → Sound settings → Output device check\nStep 3: Win+R → mmsys.cpl → test speakers\nKaam aa jaye! ✅` },
    { keys: ['camera','webcam'], ans: `Camera issue! 📷 Try karo:\nStep 1: Teams/Zoom Settings → Camera → sahi device select karo\nStep 2: Device Manager → Cameras → Disable → Enable\nStep 3: Privacy Settings → Camera → Apps ko allow karo\nBatao! ✅` },
    { keys: ['storage','disk','full','space'], ans: `Storage full! 💾 Karo yeh:\nStep 1: Win+R → cleanmgr → C: → Clean system files\nStep 2: Win+R → %temp% → Ctrl+A → Delete\nStep 3: Recycle Bin empty karo\nFree space ho jayega! ✅` },
    { keys: ['printer','print'], ans: `Printer issue! 🖨️ Try karo:\nStep 1: Printer OFF → ON karo, USB/WiFi check karo\nStep 2: Win+R → services.msc → Print Spooler → Restart\nStep 3: Agar nahi chala → ticket raise karo\nBatao! ✅` },
    { keys: ['zoom','meet','video call','video conference'], ans: `Zoom/Meet issue! 🎥 Try karo:\nStep 1: Zoom/Meet band karo → dobara open\nStep 2: Internet check karo → browser mein try karo\nStep 3: Settings → Audio/Video → sahi device select karo\nBatao! ✅` },
    { keys: ['excel','word','office','powerpoint'], ans: `MS Office issue! 📄 Try karo:\nStep 1: App puri tarah band karo → restart karo\nStep 2: Win+R → %appdata%\\Microsoft → delete temp files\nStep 3: File → Open & Repair option try karo\nNahi hua → ticket raise karo! ✅` },
    { keys: ['vpn','remote','connect'], ans: `VPN/Remote access ke liye IT ticket raise karo — IT team setup karega.\nType karo: *ha* ✅` },
  ];

  // "Still not working" / failed step follow-up
  const isStillNotWorking = /still\s*not\s*working|abhi\s*bhi\s*nahi|nahi\s*hua|nahi\s*chala|nahi\s*chal\s*raha|kaam\s*nahi\s*kiya|phir\s*bhi\s*nahi|same\s*problem|same\s*issue/i.test(p);
  if (isStillNotWorking) {
    return `Koi baat nahi! 😊 IT team ka sahayata lenge.\n\nTicket raise karo — IT turant dekh legi:\nType karo: *raise ticket* ✅\n\nYa seedha /ticket command use karo.`;
  }

  for (const { keys, ans } of quickAnswers) {
    if (keys.some(k => p.includes(k))) return ans;
  }
  return null; // No match — let AI handle it
};

module.exports = { chat, quickReply, getKBAnswer };

