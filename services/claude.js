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
const SYSTEM_PROMPT = `Tu Zivon hai — WIOM ka IT helpdesk assistant. Tu ek real IT colleague ki tarah baat karta hai, koi script padhne wala bot nahi.

━━━ SABSE PEHLE: MESSAGE DHYAN SE PADHO ━━━
User jo likha hai WAHI samjho — assume mat karo.
- "theek hai / normal hai / ho gaya / chal raha hai" → sab theek hai, khushi zahir karo
- Problem bata raha hai → help karo
- "fan normal hai" = good news, problem nahi — positively respond karo
- Context yaad rakho — pehle issue tha, ab "theek" keh raha hai = resolved!

━━━ TU EK REAL IT COLLEAGUE HAI — YEH BHOOL MAT ━━━

Real IT support kaisa lagta hai:
✅ Seedha fix pe aata hai — problem dobara nahi giraata
✅ Ek do step deta hai pehle — sab kuch ek saath nahi
✅ Confident hota hai — "ye karo, ho jaayega" not "usually hota hai"
✅ Acknowledge karta hai — "haan, ye hota hai", "acha samjha"
✅ Natural closer — "try karo batao", "karo dekhte hain", kabhi kuch bhi nahi
✅ Kabhi kabhi poochh leta hai — "kab se ho raha hai?" / "restart kiya tha?"

❌ Bot jaisa nahi lagta:
❌ Problem ka naam repeat nahi karta — "WiFi issue!" "Outlook nahi chal raha!" mat bolo
❌ Har baar same opener nahi — "Acha suno", "Ek kaam karo", "Simple fix hai", "Haan ye common hai"
❌ Har baar same closer nahi — vary karo naturally
❌ "Step 1, Step 2" list format — BANNED, conversationally batao

━━━ TONE ━━━
- Warm, office-appropriate — "yaar", "bhai", "arre" BILKUL nahi
- "Haan", "Acha", "Dekho", "Ek kaam karo", "Try karo" → natural lagta hai
- "Koi baat nahi", "Hota hai sabke saath", "Ho jaayega" → reassuring
- Chhoti problem → 1-2 line
- Fix chahiye → 2-4 lines conversational
- Complex → max 5 lines, phir ticket suggest karo

━━━ LANGUAGE ━━━
- Hindi/Hinglish mein likhe → Hindi/Hinglish mein jawab
- English mein likhe → English mein jawab
- Mix mat karo

━━━ REAL COLLEAGUE TONE — RULES ━━━

RULE 1 — Seedha fix pe aao, problem restate mat karo:
WRONG style: "Laptop Slow Issue! Step 1: ..."
RIGHT style: "Ctrl+Shift+Esc dabao — Task Manager mein heavy apps end karo. Restart karo. Karo batao!"

RULE 2 — User theek hone ki khabar de toh khush hoo:
WRONG style: overheating steps dena jab user "fan normal hai" bole
RIGHT style: "Acha, theek ho gaya! Koi aur cheez hai? 😊"

RULE 3 — Ek do steps pehle, baaki baad mein:
WRONG style: poori list ek saath
RIGHT style: pehla step, phir "karo batao"

RULE 4 — Natural closers — vary karo:
kabhi: "Batao!" / kabhi: "Karo dekhte hain" / kabhi: "Ho gaya?" / kabhi kuch bhi nahi

━━━ SCOPE ━━━
- IT problem → help karo poori
- Ticket status → "IT team dekh rahi hai, same day hota hai usually. Type karo *my tickets* status ke liye 📋"
- "Tum kaun ho" → "Main Zivon hoon — WIOM IT ka assistant. Laptop se wifi tak sab mein help karta hoon. Batao kya hai!"
- Non-IT (cricket, khana, movies) → "Tech problems mein help karta hoon 😊 Koi IT issue hai?"
- Sab theek hai → "Acha! Khushi hui 😊 Koi aur cheez ho toh batao"

━━━ AFTER STEPS FAIL ━━━
Pehli baar fail → Alag steps do, repeat mat karo
Doosri baar fail → "Yeh thoda IT wala case hai — seedha unhe dikhana padega. Type karo *ha*, ticket bhejta hoon 🎫 Screenshot bhi le sako toh bhejo, bahut kaam aayega 📸"

━━━ TICKET RULES ━━━
❌ "Ticket raised successfully" — kabhi mat bolo, tu create nahi karta
❌ Fake IDs (WIOM-TKT-XXXX) — mat dikhao
✅ Sirf itna: "Type karo *ha*, main IT ko bhej deta hoon 🎫"
✅ Pehle message pe seedha fix do — ticket only after 2 failed attempts

━━━ NEVER DO THIS ━━━
❌ "arre yaar", "yaar", "bhai", "arre" — STRICT BAN, office mein nahi chalega, kabhi mat likhna
❌ "Laptop Slow Hone Ki Samasya:" — heading style opener
❌ "Yeh steps follow karein:" — BANNED
❌ "IT Team will contact you soon"
❌ Lenovo Vantage / Dell SupportAssist suggest mat karo
❌ "bilkul", "zaroor", "madad karunga" — robotic lagta hai
❌ Lenovo Vantage / Dell SupportAssist manually suggest mat karo — system khud script bhejta hai
❌ "bilkul", "zaroor", "madad karunga", "samajh aayi" — robotic phrases BANNED

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
  if (p.includes('camera') || p.includes('camra') || p.includes('webcam') || /\bcam\b/.test(p))
    return `Settings → Privacy → Camera → ON karo 📷 Teams/Zoom mein Settings → Video → sahi camera select hai? Device Manager → Cameras → Disable → Enable karo. Batao kaise raha!`;
  if (p.includes('mic') || p.includes('microphone'))
    return `Microphone fix! 🎤\nStep 1: Settings → Privacy → Microphone → ON karo.\nStep 2: Sound settings → Input → sahi mic select karo.\nStep 3: Teams: Settings → Devices → mic test karo.\nClick the script button below! ⬇️`;
  if (p.includes('usb') || p.includes('pendrive'))
    return `USB fix! 🔌\nStep 1: Alag USB port mein try karo.\nStep 2: Device Manager → Universal Serial Bus → Uninstall → Scan for hardware changes.\nStep 3: Laptop restart karo.\nClick the script button below! ⬇️`;
  if (p.includes('storage') || p.includes('disk full'))
    return `Storage cleanup ! 💾\nStep 1: Win+R → cleanmgr → C: → Clean system files.\nStep 2: Win+R → %temp% → Ctrl+A → Delete.\nStep 3: Recycle Bin empty karo.\nClick the script button below! ⬇️`;
  if (p.includes('virus') || p.includes('malware') || p.includes('antivirus'))
    return `Virus scan ! 🦠\nStep 1: Windows Security kholo → Virus & threat protection.\nStep 2: Quick Scan karo → wait karo.\nStep 3: Serious lag raha → raise a ticket: type *raise ticket* 🎫\nClick the script button below! ⬇️`;
  if (p.includes('kaise ho') || p.includes('kaisa hai') || p.includes('how are you') || p.includes('kya haal'))
    return 'Theek hoon! Batao kya IT problem hai, help karta hoon 😊';
  if (p.includes('thanks') || p.includes('shukriya') || p.includes('thank you') || p.includes('dhanyawad'))
    return 'Khushi hui! Koi aur IT problem ho toh batao 😊';
  if (/^(hello|hi+|hey|namaste|namaskar|hlo|helo)\s*[!.]*$/i.test(p.trim()))
    return 'Hello! Kya IT problem hai — batao, abhi help karta hoon 😊';
  if (/\b(kise|kaun)\s*(ho|hain|hai)\b/i.test(p) || /\b(tum|aap)\s*(kya|kise|kaun)\b/i.test(p))
    return `Main *Zivon* hoon — WIOM ka IT helpdesk assistant ⚡\nLaptop, WiFi, software, password — kisi bhi IT problem mein help karta hoon.\nBatao kya issue hai! 😊`;
  if (p.includes('sajan') || p.includes('admin') || p.includes('it head') || p.includes('phone number') || p.includes('number do'))
    return 'Sajan Kumar — WIOM IT Admin\nPhone: 9654244281\nEmail: sajan.kumar@wiom.in\nTicket ke liye type karo: *raise ticket*';
  // Generic fallback — restart covers 80% of issues
  return `Pehle ek baar laptop restart karo 🔄 — zyada tar issues isse theek ho jaate hain. Nahi hua toh thoda aur detail mein batao kya problem hai, main specific help karunga! 😊`;
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
    temperature: 0.2,
    max_tokens : 220   // short = fast response
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

  // ── CRITICAL: Detect system prompt leakage ───────────────────────────────
  // Groq sometimes copies system prompt examples verbatim — catch and replace
  const isLeaked =
    /User:\s*[""“”]/i.test(reply) ||          // 'User: "...' pattern from examples
    /❌\s*(Bot|Step)|✅\s*Real:/i.test(reply) ||         // example diff markers
    /BANNED:|NEVER DO THIS|OFFICE-FRIENDLY TONE/i.test(reply) || // system prompt headings
    /━━━|SABSE ZAROORI|TICKET RULES/i.test(reply);       // prompt section headers
  if (isLeaked) {
    console.warn('⚠️ System prompt leaked in AI response — replacing with fallback');
    const lastUser = history.filter(m => m.role === 'user').pop()?.content || '';
    reply = getKBFallback(lastUser);
  }

  // ── Hard filter: remove informal/banned words no matter what AI says ────
  reply = reply
    .replace(/\barre\s+yaar\b/gi, 'Haan')
    .replace(/\barre\s+bhai\b/gi, 'Haan')
    .replace(/\barre\b/gi, '')
    .replace(/\byaar\b/gi, '')
    .replace(/\bbhai\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,!]+/, '')
    .trim();

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
  const p = problem.toLowerCase().trim();

  // ── User saying issue is resolved / working fine now ───────────────────
  // STRICT: only if NO negative word present AND message is short status update
  const hasNegative = /\b(not|nahi|nahin|nai|nhi|band|kharab|problem|issue|chal nahi|kaam nahi|nahi chal|nahi ho|ho nahi|abhi bhi|still|phir bhi)\b/i.test(p);
  const hasPositive = /\b(normal|noraml|norml|theek|thik|sahi|ho gaya|ho gya|fixed|resolved|kaam kar raha|solve ho|fix ho gaya|theek ho|thik ho|chal raha hai|chal rhi hai|chal gaya|chal gyi|on ho gaya|working|work kar raha|charged|charge ho|connected|connect ho gaya|sorted|done|complete|ho gayi|mil gaya|mil gayi)\b/i.test(p);
  if (hasPositive && !hasNegative && p.split(/\s+/).length <= 8) {
    return `Great! Khushi hui ki resolve ho gaya 😊✅ Aur koi IT help chahiye toh zaroor batao!`;
  }

  // ── Identity questions — broad match, instant reply, no AI needed ───────
  const isIdentityQ =
    /^(kise\s*hai|kise\s*ho|tum\s*kise\s*ho|aap\s*kise\s*ho|tum\s*kaun\s*ho|aap\s*kaun\s*ho|kaun\s*ho|kaun\s*hain|kaun\s*hai|tum\s*kya\s*ho|aap\s*kya\s*ho|kya\s*ho\s*tum|kya\s*hain\s*aap|what\s*are\s*you|who\s*are\s*you|bot\s*hai\s*kya|kya\s*tum\s*bot|are\s*you\s*a\s*bot|introduce|apna\s*parichay|apne\s*bare\s*mein\s*batao)\s*\??$/i.test(p.trim()) ||
    /\b(kise|kaun)\s*(ho|hain|hai)\b/i.test(p) && p.split(/\s+/).length <= 5;
  if (isIdentityQ) {
    return `Main *Zivon* hoon — WIOM ka IT helpdesk assistant ⚡\nLaptop, WiFi, software, password — kisi bhi IT problem mein help karta hoon.\nBatao kya issue hai! 😊`;
  }

  // ── Ticket status / ETA questions (typo-tolerant: tiket/tikket/ticket) ──
  const pTicket = p.replace(/ti+ke+t/gi, 'ticket');
  if (/ticket\s*(kab|kb|kab\s*tak|kab\s*solve|kab\s*hoga|kab\s*fix|status|update|progress|ho\s*gaya|hua\s*kya|abhi\s*tak|kyun\s*nahi|pending)/i.test(pTicket) ||
      /kab\s*tak\s*(hoga|milega|fix\s*hoga|solve\s*hoga|resolve)/i.test(pTicket) ||
      /mera\s*ticket\s*(kab|solve|fix|hoga|ho\s*ga)/i.test(pTicket)) {
    return `Aapka ticket IT team ke paas hai! 📋 Usually same day resolve hota hai — priority ke hisaab se.\nStatus dekhne ke liye type karo: *my tickets* 👀\nUrgent hai toh batao, main priority mark kar deta hoon! 🎫`;
  }

  // ── WiFi password — strict match only ───────────────────────────────────
  const isWifiPassword =
    /wifi\s*(ka|ke|ki)?\s*(password|pass|pwd|pasword|passward)/i.test(p) ||
    /password\s*(wifi|wi-fi|wiom|network)/i.test(p) ||
    /^(wifi|wi-fi|network)\s*(password|pass|pwd)\s*\??$/i.test(p.trim()) ||
    /^(pass|pwd|password)\s*\??$/i.test(p.trim()) ||
    /network\s*ka\s*pass/i.test(p) ||
    /office\s*(wifi|network|wi-fi)\s*(password|pass)/i.test(p);

  if (isWifiPassword) {
    return `WiFi Password! 📶\n\n🔑 *Password:* \`spartans500\` — sabhi networks ke liye same\n\n*Networks:*\n• Wiom office 5g-Test — Ground floor\n• Wiom office Guest\n• Wiom office 3rd floor\n• Wiomnet — Saket office *(Password: \`Password@12345\`)*\n\nHo gaya? Batao! 😊`;
  }

  // ── Instant KB answers — Zivon tone, no Step 1/2/3 ─────────────────────
  // MATCHING RULES:
  //   - Multi-word keys (contains space): exact substring match in p
  //   - Single-word keys: anchored start match (prevents 'mail' matching 'email', etc.)
  //     BUT suffix-flexible so 'charge' still matches 'charger'/'charging'
  // ORDER: specific app/device entries FIRST, general hardware LAST
  // Reason: "teams slow hai" should match 'teams' entry, not 'slow'
  const matchKey = (text, key) => {
    if (key.includes(' ')) return text.includes(key);
    // Word-start boundary only — allows suffixes like charger/charging/charging
    // but prevents mid-word matches like 'mail' inside 'email'
    return new RegExp(`(?<![a-z])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text);
  };

  const quickAnswers = [
    // ── Apps first ────────────────────────────────────────────────────────
    { keys: ['teams','microsoft teams'],
      ans: `System tray se Teams puri tarah close karo — dobara open karo. 90% baar isi se ho jaata hai 📹 Nahi hua? Win+R → \`%appdata%\\Microsoft\\Teams\` → Cache folder delete karo. Karo batao!` },

    { keys: ['outlook','email','mail'],
      ans: `Ctrl+Shift+Esc se Outlook pura close karo, phir Win+R → \`outlook /safe\` → Enter. Safe mode mein khulega 📧 Kaam kiya? File → Account Settings → Repair bhi try karo. Batao!` },

    { keys: ['zoom','meet','video call','video conference'],
      ans: `Puri tarah band karke dobara open karo — simple fix hai ye 🎥 Net theek hai na? Browser se bhi try kar sakte ho directly. Camera/mic nahi chal raha? Settings → Audio/Video → sahi device select karo. Batao kya hua!` },

    { keys: ['excel','word','powerpoint','ms office','microsoft office'],
      ans: `App close karke dobara open karo pehle 📄 File nahi khul rahi? Right-click → Open & Repair. License error aa raha toh type karo *ha*, ticket bhejta hoon 🎫` },

    { keys: ['chrome','browser','firefox','edge','incognito'],
      ans: `Band karke dobara open karo — aur Ctrl+Shift+Del → All time → sab clear karo 🌐 Extension ki wajah se bhi hota hai — Incognito mode (Ctrl+Shift+N) mein try karo. Theek hua?` },

    { keys: ['virus','malware','hack','suspicious','ransomware'],
      ans: `Abhi Windows Security → Virus & threat protection → Quick Scan karo 🦠 Kuch mila? Internet band karo aur type karo *ha* — IT ko turant batata hoon. Wait mat karo is case mein 🎫` },

    { keys: ['windows update','update stuck','update fail'],
      ans: `Restart karo laptop aur dobara try karo — aksar atki update restart se chal jaati hai 🔄 Phir bhi fail? Settings → Windows Update → Check for updates. Baar baar nahi ho raha toh bata, ticket raise karte hain 🎫` },

    { keys: ['vpn','remote access','remote desktop'],
      ans: `VPN aur remote IT setup karta hai, akele nahi hota 😊 Type karo *ha*, ticket bhej deta hoon — jaldi configure ho jaayega 🎫` },

    // ── Hardware ──────────────────────────────────────────────────────────
    { keys: ['blue screen','bsod','bluescreen'],
      ans: `Ghabrao mat — restart karo, 90% baar theek ho jaata hai 💙 Screen pe jo error code tha woh note karo. Baar baar aa raha hai? Batao, ticket raise karte hain 🎫` },

    { keys: ['black screen','screen black','display black','screen nahi aa'],
      ans: `Fn+F5 ya Fn+F8 dabao — brightness keys hain 🖥️ Nahi hua? Power button 10 sec hold karo, force restart. Abhi bhi black? HDMI se monitor lagao — wahan dikh raha hai toh screen ka issue hai, ticket raise karte hain 🎫` },

    { keys: ['overheat','garam ho raha','bahut garam','zyada garam','laptop hot','temperature high'],
      ans: `Laptop ko hard surface pe rakho — bed ya sofa pe mat rakho, heat nahi niklti wahan se 🌡️ Ctrl+Shift+Esc → jo heavy CPU le raha ho End Task karo. Settings → Power → Balanced mode on karo. Thodi der mein thanda ho jaayega. Batao!` },

    { keys: ['fan not working','fan nahi chal','fan band','fan chal nahi','fan kaam nahi'],
      ans: `Fan nahi chal raha — abhi laptop band karo aur charger nikaal do ⚠️ Zyada use kiya toh hardware damage ho sakta hai. Type karo *ha*, ticket abhi bhejta hoon — IT ko seedha dekhna hoga 🎫` },

    { keys: ['fan noise','fan loud','fan ki awaaz','fan bahut','fan sound','fan shor'],
      ans: `Heavy apps Ctrl+Shift+Esc se End Task karo, laptop hard surface pe rakho 🔊 Thodi der mein quieter ho jaata hai. Phir bhi same awaaz hai? Bata dena, ticket raise karte hain 🎫` },

    { keys: ['battery nahi','charging nahi','charge nahi','charger nahi','not charging','charge ho nahi'],
      ans: `Charger dono side se nikaal ke firmly dobara lagao — dusra socket bhi try karo 🔋 Phir bhi nahi? Laptop shut down karo, charger nikalo, power button 30 sec hold karo, phir charger lagao. Nahi hua toh hardware issue hai — ticket raise karte hain 🎫` },

    { keys: ['battery low','battery drain','battery khatam','battery backup'],
      ans: `Settings → Power → Balanced mode on karo, brightness thodi kam karo 🔋 Chrome aur Teams zyada battery lete hain, minimize rakho jab use na ho. 1-2 ghante se bhi kam chal raha hai consistently? Battery replace ka waqt hai — ticket raise karte hain 🎫` },

    { keys: ['keyboard not working','keyboard kaam nahi','keyboard issue','keyboard problem','keys not working','key kaam nahi'],
      ans: `Pehle restart karo — aksar isi se ho jaata hai ⌨️ Nahi hua? Win+R → \`osk\` → on-screen keyboard se kaam chala sakte ho temporarily. Device Manager → Keyboards → Uninstall → restart karo. Physical damage lagta hai? Ticket raise karte hain 🎫` },

    { keys: ['touchpad not working','mouse not working','cursor not moving','cursor stuck','touchpad kaam nahi','mouse kaam nahi'],
      ans: `Fn+F9 dabao — touchpad toggle hota hai 🖱️ Nahi hua? Restart karo. Abhi bhi? Device Manager → Mice → Uninstall → restart, driver khud reinstall ho jaata hai. Kaise raha batana!` },

    { keys: ['printer offline','printer nahi chal','printer kaam nahi','printer issue','printer problem','print nahi ho','print queue'],
      ans: `Printer OFF karo, 10 sec ruko, ON karo 🖨️ Phir Win+R → \`services.msc\` → Print Spooler → Restart karo. Abhi bhi nahi? Batao, ticket raise karte hain 🎫` },

    { keys: ['bluetooth'],
      ans: `Settings → Bluetooth → OFF karo, 5 sec ruko, ON karo 🔵 Device dobara pair karo. Nahi hua? Device Manager → Bluetooth → Disable → Enable. Ho gaya?` },

    { keys: ['camera','camra','webcam','cam'],
      ans: `Settings → Privacy → Camera → ON hai? 📷 Teams/Zoom mein Settings → Video → sahi camera select karo. Phir bhi nahi? Device Manager → Cameras → Disable → Enable karo. Batao! 😊` },

    { keys: ['mic not working','microphone nahi','mic kaam nahi','sound input','awaaz nahi ja'],
      ans: `Settings → Privacy → Microphone → ON hai? 🎤 Sound settings → Input → sahi mic select karo. Teams mein ho toh Settings → Devices → test karo. Theek hua batana!` },

    { keys: ['usb not working','usb nahi','pendrive nahi','usb kaam nahi','device detect nahi'],
      ans: `Alag USB port mein try karo pehle 🔌 Nahi hua? Device Manager → Universal Serial Bus → Uninstall → Action → Scan for hardware changes → restart karo. Kuch hua?` },

    // ── Sound / Storage / Network ─────────────────────────────────────────
    { keys: ['sound nahi','audio nahi','speaker nahi','no sound','awaaz nahi','speaker kaam nahi','sound kaam nahi'],
      ans: `Taskbar speaker icon check karo — mute toh nahi? 🔊 Right-click → Sound settings → sahi output device select hai? Headphone laga hai toh woh bhi check karo. Win+R → \`mmsys.cpl\` se test karo. Batao!` },

    { keys: ['disk full','storage full','storage kam','c drive full','memory full','space nahi','space khatam'],
      ans: `Win+R → \`cleanmgr\` → C: → Clean system files 💾 Phir Win+R → \`%temp%\` → Ctrl+A → Delete. Recycle Bin bhi empty karo. Kaafi space nikal aata hai. Kaam aaya?` },

    { keys: ['wifi nahi','internet nahi','network nahi','wifi connect nahi','internet slow','wifi slow','internet chal nahi','net nahi'],
      ans: `Taskbar se WiFi OFF karo, 10 sec ruko, ON karo 📶 Nahi hua? Network bhool ke dobara connect karo — password \`spartans500\` hai. Phir bhi? Win+R → \`netsh winsock reset\` → Enter → restart karo. Batao!` },

    { keys: ['password bhool','password forgot','password reset','password nahi pata','login nahi ho','login issue'],
      ans: `Koi baat nahi, hota hai 🔑\n• Windows/email → IT reset karega — type karo *ha*, ticket bhejta hoon 🎫\n• Google → khud kar sakte ho: myaccount.google.com → Security → Password\nKonsa wala hai?` },

    { keys: ['laptop on nahi','laptop start nahi','turn on nahi','boot nahi','stuck restarting','restart loop','shutdown nahi'],
      ans: `Power button 10-15 sec hold karo — force shut down ho jaayega 🔄 Phir normal start karo. Baar baar ho raha hai? Boot pe F8 → Safe Mode → Startup Repair. Nahi hua toh type karo *ha*, ticket raise karte hain 🎫` },

    // ── Slow — most general, LAST ─────────────────────────────────────────
    { keys: ['slow','hang','freeze','sluggish','laptop kharab','bahut slow'],
      ans: `Ctrl+Shift+Esc dabao — Task Manager mein jo CPU zyada le raha ho usse End Task karo 💻 Phir Win+R → \`%temp%\` → sab delete karo. Restart karo ek baar. Kaise raha?` },
  ];

  for (const { keys, ans } of quickAnswers) {
    if (keys.some(k => matchKey(p, k))) return ans;
  }

  // ── "steps DO / steps batao" follow-up ─────────────────────────────────
  if (/^(steps?\s*(do|de|batao|dikhao|chahiye|dena|bata)|aur\s*steps?|next\s*steps?|aage\s*(kya|batao)|kya\s*karu(n)?|kuch\s*aur\s*(batao|karo)|more\s*steps?)\s*[?!।]*$/i.test(p.trim())) {
    return `Batao exactly kya ho raha hai — kya error message aa raha hai? Ya screenshot bhejo 📸 Usse main exact steps de sakta hoon. Agar jaldi chahiye toh type karo *ha*, IT team ko bhej deta hoon 🎫`;
  }

  // "Still not working" — only short phrases (not full questions)
  const words = p.trim().split(/\s+/);
  const isShortFailMessage = words.length <= 6 &&
    /still\s*not\s*working|abhi\s*bhi\s*nahi\s*(chal|hua|ho)|nahi\s*(hu[ao]+|chala|chal\s*raha|ho\s*raha|hua)|kaam\s*nahi\s*(kiya|kar\s*raha)|phir\s*bhi\s*nahi|same\s*problem|nhi\s*hu[ao]|nahi\s*h[ou]|ho\s*hi\s*nahi|kuch\s*nahi\s*(hua|ho)/i.test(p);
  if (isShortFailMessage) {
    return `Koi baat nahi — alag steps try karte hain 😊 Thoda aur detail mein batao kya exactly ho raha hai, ya screenshot bhejo — main specific fix dunga! 📸\nPhir bhi nahi hua? Type karo *ha*, IT team ko bhej deta hoon 🎫`;
  }

  return null; // No match — let AI handle it
};

module.exports = { chat, quickReply, getKBAnswer };

