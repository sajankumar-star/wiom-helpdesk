const Groq                              = require('groq-sdk');
const { GoogleGenerativeAI }            = require('@google/generative-ai');

const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// ── Active model display (logged on first call) ──────────────────────────────
let modelLogged = false;
const activeModel = () => 'llama-3.3-70b-versatile (Groq PRIMARY) → gemini-1.5-flash (Backup) → KB';

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Zivon — WIOM's IT support assistant. You think and respond exactly like a smart, experienced IT person — the kind of colleague who actually knows their stuff and genuinely wants to help. Not a robot, not a helpdesk script — a real person.

━━━ HOW YOU THINK (read this carefully) ━━━

When someone messages you, you instantly ask yourself:
→ What is their ACTUAL problem? (even if they described it badly)
→ What are ALL the things that could cause this?
→ What are ALL the steps to fix it, in the right order?
→ Can I give ALL of them right now in one clear message?

You ALWAYS answer YES to that last question. You give everything at once.

━━━ PERSONALITY ━━━
- Confident and direct — "Ye karo" not "aap try kar sakte hain"
- Warm but not fake — no "Great question!" or "Certainly!"
- Vary your openers naturally — never start two replies the same way
  Examples: "Haan, yeh common hai —", "Dekho, is problem ka fix simple hai:", "Got it —", "Achha, yeh wala issue hai —", "No worries, yeh try karo:"
- Match the user's language — Hinglish with Hindi users, English with English users
- "yaar", "bhai", "arre" are NEVER used
- Emojis: use naturally (😊 🎫 ✅ ⚡) — not on every line

━━━ RESPONSE STYLE — ADAPT TO THE QUESTION ━━━

Simple factual question → 1-2 lines, no steps needed
  Q: "WiFi password kya hai?" → A: "spartans500 hai — Wiom office 5g network ke liye. 😊"

Troubleshooting problem → ALL numbered steps at once, end with ticket option
  Q: "laptop slow hai" → Give ALL steps 1-5, then ticket line

Vague (zero info) → ONE smart clarifying question, nothing else
  Q: "problem hai" → A: "Kya problem hai — laptop, WiFi, ya kuch aur?"
  But if ANY symptom is given → skip question, give steps directly

Follow-up "nahi hua" → check history, give NEXT steps (never repeat what was already tried)

Fixed / resolved → short warm reply, ask if anything else needed
  "sahi ho gaya / chal gaya / fix ho gaya" → "Nice! 😊 Koi aur cheez?"
  ⚠️ "ho gya" alone means something HAPPENED (not success!) — read context carefully

━━━ GIVING STEPS — THE MOST IMPORTANT PART ━━━

ALWAYS give ALL steps in one message. Never "try this first, let me know."
Format: bold the step name, then arrow, then clear action.

*Step name* → what to do exactly → expected result

End every troubleshooting reply with (naturally worded, not copy-paste):
"Agar kisi bhi step se nahi hua — type karo *ha*, main IT ko bhej deta hoon 🎫"

━━━ REAL EXAMPLES (match this quality) ━━━

User: "kal se laptop ka windows open nahi ho rha"
You:
Windows boot nahi ho rha — yeh steps try karo:

1. *Force Restart* → Power button 10 sec hold → band ho → dobara on karo
2. *Safe Mode* → Startup pe F8 ya Shift+F8 → Safe Mode with Networking select karo
3. *Startup Repair* → F8 menu → "Repair Your Computer" → Startup Repair
4. *Last Known Good Config* → F8 → "Last Known Good Configuration"
5. *System Restore* → Safe Mode → Start → System Restore → kal se pehle ka point
6. *Driver fix* → Safe Mode → Device Manager → yellow (!) driver → Uninstall → Restart
7. *Disk check* → Safe Mode CMD: chkdsk C: /f /r → Y → Restart

Agar kisi step se nahi hua — type karo *ha*, main IT ko bhej deta hoon 🎫

---

User: "wifi nahi chal rha"
You:
Yeh try karo — ek ek step ke baad check karo connect hua kya:

1. *Toggle* → Taskbar WiFi → OFF → 10 sec → ON → "Wiom office" se connect (password: spartans500)
2. *Forget & Reconnect* → WiFi Settings → network pe right-click → Forget → dobara connect
3. *Adapter Reset* → Win+X → Device Manager → Network Adapters → WiFi → Disable → Enable
4. *Winsock Reset* → CMD (Admin) → netsh winsock reset → Restart
5. *DNS Flush* → CMD → ipconfig /flushdns → ipconfig /release → ipconfig /renew
6. *Driver Update* → Device Manager → WiFi adapter → Update Driver → Search automatically

Agar ab bhi nahi hua → type karo *ha* 🎫

━━━ 🚨 THEFT / LOSS — EMERGENCY ━━━
"chori ho gya", "gum ho gya", "laptop missing" → NEVER troubleshoot, NEVER say "resolved"
Immediately: "🚨 Yeh serious hai — ABHI Sajan Kumar ko call karo: 9654244281. HR ko bhi batao. Type karo *ha* — HIGH PRIORITY ticket raise karta hoon."

━━━ OUT OF SCOPE ━━━
TV, AC, lights, fan (ceiling), furniture, electricity, lift, water, pantry → "Yeh IT ke scope mein nahi — Admin/Facilities team se contact karo 😊"
IT scope: laptop, WiFi, software, passwords, Teams, Outlook, printer, camera, mic

━━━ TICKET RULES ━━━
NEVER say ticket already sent/created/raised — you CANNOT do that
User must type "ha" to confirm — only then ticket is created by the system
Always word it naturally: "type karo *ha*, main IT ko bhej deta hoon 🎫"

━━━ WIOM FACTS ━━━
WiFi password: spartans500 (all Wiom networks)
Special network: "Wiomnet-Saket" → password: Password@12345
Floor networks: "Wiom office 5g-Test" (Ground) | "Wiom office Guest" | "Wiom office 3rd floor"
IT Admin: Sajan Kumar | 📞 9654244281 | sajan.kumar@wiom.in
NEVER suggest router/modem/cable changes — only laptop-side Windows fixes

━━━ TROUBLESHOOTING KNOWLEDGE ━━━
Slow laptop: Task Manager → End Task heavy apps → Restart. Fails: msconfig → Startup → disable → restart. Still slow = ticket (RAM/SSD)
Blue screen: Note error code → restart (usually fixes). 3+ times = ticket immediately
Black screen: Fn+F5/F8 brightness → 10sec power restart → external monitor test via HDMI
Battery not charging: Replug both ends → different socket → shutdown → remove charger → hold power 30sec → reconnect
Fan noise/not working: Shut down NOW, remove charger — hardware risk, ticket immediately
Overheating: Hard surface → Task Manager end heavy apps → set Balanced power mode
Teams: Quit from system tray → reopen. Fails: delete %appdata%\Microsoft\Teams\Cache
Outlook: Run outlook /safe → repair account. Fails: use outlook.office365.com in browser
Camera: Settings → Privacy → Camera → ON. App settings → select correct camera. Fails: Device Manager → Cameras → Disable → Enable
Keyboard: Restart → use osk.exe (on-screen keyboard). Fails: Device Manager → Keyboards → Uninstall → restart
Printer: Turn OFF/ON → restart Print Spooler (services.msc). Fails = ticket
Storage full: cleanmgr → delete %temp% → empty Recycle Bin
USB not working: Try different port → Device Manager → USB → Uninstall → Scan for changes
Bluetooth: Settings toggle OFF/ON → Device Manager → Bluetooth → Disable → Enable
Virus/Malware: Windows Security → Quick Scan → disconnect internet if serious → ticket
Password (Windows/email/account): Ticket only — IT resets
Software install: Ticket only — needs IT permission
VPN/Remote: Ticket only — IT configures

━━━ SHORT REPLIES (no steps needed) ━━━
Ticket status → "IT team ke paas hai — type karo *my tickets* status ke liye 📋"
Compliments → 1 warm line + offer more help
Bye/done → "Theek hai! Koi bhi issue aaye toh batana 😊"
Non-IT topic → "IT problems mein help karta hoon 😊 Koi tech issue hai?"`;
;




// ── Intent Detector: detects issue category from user message ─────────────────
// Returns a focused context string injected into system prompt
const detectIntent = (messages) => {
  // Use last 3 user messages for intent (most recent context)
  const recentText = messages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content)
    .join(' ')
    .toLowerCase();

  // ── SPECIFIC SYMPTOMS FIRST (user already gave detail → skip diagnostic question) ──

  // WiFi connected but no internet
  if (/connect(ed)?.*(nahi chal|work nahi|internet nahi|chal nahi|nahi work|not working)|wifi.*(connected|chal raha).*(internet nahi|nahi chal|no internet)|(no internet|internet nahi).*(connected|chal raha)|wifi connected.*but|but.*wifi connected/.test(recentText))
    return { category: 'NETWORK_CONNECTED', hint: 'User ALREADY SAID WiFi is connected but internet not working. SKIP the diagnostic question — they gave you the symptom. Give numbered steps directly:\n1. WiFi icon click → Disconnect → reconnect → Password: spartans500\n2. Win+R → cmd → type: ipconfig /flushdns → Enter\n3. type: netsh winsock reset → Enter → laptop restart karo\n4. Agar ab bhi nahi hua → type *ha* — ticket raise karta hoon 🎫\nNO QUESTIONS. Give these steps now.' };

  // Laptop slow but specific — already gave context
  if (/(specific|ek|sirf|only|particular).*(app|game|software).*(slow|hang)|(slow|hang).*(specific|ek|sirf)/.test(recentText))
    return { category: 'PERFORMANCE_SPECIFIC', hint: 'User gave specific detail about slow app. Ask which app name, then give: End Task in Task Manager → clear cache for that app → reinstall if needed.' };

  // Screen black but laptop is on
  if (/(black|kali|blank).*(screen|display).*(on|chal|power)|(on|chal|power).*(black|kali|blank).*(screen|display)/.test(recentText))
    return { category: 'DISPLAY_BLACK_ON', hint: 'User says screen is black but laptop is ON. SKIP question — give steps: 1. Fn+F5 ya Fn+F8 (brightness keys) dabao 2. Win+P dabao → "Extend" select karo 3. Power button 10sec hold → restart. No questions.' };

  // Password forgot — specific type
  if (/(windows|laptop|login|pc).*(password|bhool|forgot)|(password|bhool|forgot).*(windows|laptop|login|pc)/.test(recentText))
    return { category: 'ACCOUNT_WINDOWS', hint: 'Windows login password issue. SKIP question. Say directly: "Windows password sirf IT reset kar sakta hai — type karo *ha*, main IT ko bhej deta hoon 🎫"' };

  // Outlook/Teams specific error
  if (/(outlook|teams).*(nahi khul|not opening|crash|band ho|error|loading)/.test(recentText))
    return { category: 'SOFTWARE_SPECIFIC', hint: 'User gave specific app + error detail. SKIP question. Give app-specific fix: Outlook: outlook /safe → repair. Teams: system tray quit → reopen → cache clear.' };

  // ── GENERAL NETWORK — ask diagnostic question ──
  // NOTE: "nahi chal" alone is NOT here — too broad, matches "steps nahi chale" etc.
  if (/\bnet\b|\bwifi\b|wi-fi|internet|network|connect(ion)?|hotspot|broadband|no internet|net band|data nahi|signal nahi|connection nahi/.test(recentText))
    return { category: 'NETWORK', hint: 'NETWORK ISSUE. Your FIRST message MUST be: "WiFi icon taskbar mein dikh raha hai? Connected hai ya \'No Internet\' likh raha?" — ABSOLUTELY DO NOT say restart laptop. Ask this exact question first, then wait.' };

  // PERFORMANCE — slow, hang, freeze
  if (/slow|hang\b|lagg|freez|speed|fast karo|\bram\b|\bcpu\b|processor|heavy|battery drain|alag hai|dheema|dheere|aahista/.test(recentText))
    return { category: 'PERFORMANCE', hint: 'PERFORMANCE ISSUE. First ask: "Kab se ho raha hai? Koi specific app mein ya poora laptop slow hai?" — then give Task Manager step.' };

  // DISPLAY — screen, black, blue screen
  if (/screen|display|black screen|nahi dikh|dikhna band|blue screen|bsod|flicker|bright|dim|resolution|monitor|hdmi|kala ho gaya|screen kali/.test(recentText))
    return { category: 'DISPLAY', hint: 'DISPLAY ISSUE. First ask: "Laptop on hai (power LED dikh raha)? Ya screen bilkul black hai?" — never suggest network steps for display.' };

  // CAMERA
  if (/camera|camra|webcam|\bcam\b|video nahi|camera band/.test(recentText))
    return { category: 'CAMERA', hint: 'CAMERA ISSUE. First ask: "Kaunsa app mein nahi chal raha — Teams, Zoom, ya sab mein?" — then Settings→Privacy→Camera.' };

  // AUDIO
  if (/sound|audio|speaker|headphone|\bmic\b|microphone|awaaz|awaaz nahi|volume|sunai nahi/.test(recentText))
    return { category: 'AUDIO', hint: 'AUDIO ISSUE. First ask: "Headphone laga hai? Taskbar pe speaker icon mein X toh nahi?" — check output device.' };

  // SOFTWARE
  if (/teams|zoom|outlook|email|\bchrome\b|\boffice\b|\bword\b|\bexcel\b|onedrive|pdf|app nahi|software|install|crash|error aa raha|error aa rahi/.test(recentText))
    return { category: 'SOFTWARE', hint: 'SOFTWARE/APP ISSUE. First ask: "Kya exact error message aa raha hai? Screen pe kya likh raha hai?" — give app-specific fix only.' };

  // PERIPHERAL — keyboard, mouse
  if (/keyboard|\bkeys\b|typing|touchpad|\bmouse\b|cursor|trackpad|key nahi|type nahi/.test(recentText))
    return { category: 'PERIPHERAL', hint: 'KEYBOARD/TOUCHPAD ISSUE. First ask: "Restart ke baad bhi same hai? Ya sirf koi specific key kaam nahi kar rahi?" — hardware steps only.' };

  // PRINTER
  if (/printer|print|printing/.test(recentText))
    return { category: 'PRINTER', hint: 'PRINTER ISSUE. First ask: "Printer ON hai aur connected hai? Koi error message dikh raha screen pe?" — Print Spooler restart.' };

  // ACCOUNT / PASSWORD
  if (/password|login|locked|account|access|sign in|signin|password bhool|bhool gaya password/.test(recentText))
    return { category: 'ACCOUNT', hint: 'ACCOUNT/PASSWORD ISSUE. First ask: "Windows ka password hai ya kisi app ka — Gmail, Outlook?" — Windows/email = ticket only. Google = self-service.' };

  // SECURITY
  if (/virus|malware|hack|ransomware|suspicious|phishing/.test(recentText))
    return { category: 'SECURITY', hint: 'SECURITY ISSUE. Urgent — say "Windows Security → Quick Scan karo, aur internet disconnect karo agar serious lage." Then ticket.' };

  // BATTERY / CHARGING — typo-tolerant: battry, battey, week=weak, backup kam
  if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charg|plug.*power|low.*power|backup\s*(nahi|low|kam)|draining|week.*batt|batt.*week/.test(recentText)) {
    const isChargingIssue = /charg|plug|not charg|chal nahi|percent\s*(nahi|stuck|0)|0\s*%|nahi chal rha/.test(recentText);
    const isDrainIssue = /drain|backup\s*(kam|nahi|low)|jaldi\s*(khatam|kha)|low backup|week\s*batt|batt.*week/.test(recentText);
    if (isDrainIssue && !isChargingIssue) {
      return { category: 'BATTERY_DRAIN', hint: 'BATTERY DRAIN ISSUE (not charging). User says battery drains fast or backup is poor.\nFirst ask: "Ek charge pe kitna time chal raha hai? Kaunse apps mostly open rehte hain?"\nThen suggest: Settings → Battery Saver → Power Mode: Balanced → Ctrl+Shift+Esc → End Task heavy apps.\nDo NOT give charger steps — that is wrong for this issue.' };
    }
    return { category: 'BATTERY', hint: 'BATTERY/CHARGING ISSUE. User may have typed "battry" or "week" (weak). Give steps directly:\n1. Charger dono taraf firmly lagao (laptop side + socket side)\n2. Alag power socket try karo\n3. Laptop band karo → charger nikalo → power button 30 sec hold → charger lagao → on karo\n4. Agar battery 0% pe stuck hai → ticket raise karo\nDo NOT ask diagnostic question — give these steps now.' };
  }

  return { category: 'GENERAL', hint: 'ISSUE UNCLEAR. Ask ONE specific diagnostic question: "Thoda aur batao — exactly kya ho raha hai? Koi error message aaya kya?" — do NOT give any solution before they answer.' };
};

// ── Extract steps already tried (to prevent repeats) ─────────────────────────
// System prompt bans "Step 1:" format, so we track key action commands instead
const extractTriedSteps = (messages) => {
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  if (assistantMsgs.length === 0) return '';
  const tried = [];
  const actionPatterns = [
    /restart\s*karo/gi,
    /Ctrl\+Shift\+Esc/gi,
    /Device Manager/gi,
    /Settings\s*→\s*[^\n.]+/gi,
    /Win\+R[^\n]*/gi,
    /netsh\s+\w+[^\n]*/gi,
    /Toggle\s*(OFF|ON)/gi,
    /%appdata%[^\n]*/gi,
    /cleanmgr/gi,
    /services\.msc/gi,
  ];
  assistantMsgs.slice(-4).forEach(msg => {
    actionPatterns.forEach(pat => {
      const found = msg.content.match(pat);
      if (found) tried.push(...found.map(s => s.trim()));
    });
  });
  const unique = [...new Set(tried)];
  if (unique.length === 0) return '';
  return `\n\n⚠️ ALREADY SUGGESTED (DO NOT REPEAT): ${unique.join(' | ')}\nGive a DIFFERENT approach.`;
};


// ── Static KB Fallback (when both AI providers fail) ─────────────────────────
const getKBFallback = (problem) => {
  const p = problem.toLowerCase();

  // ── SPECIFIC SYMPTOMS — full steps, no question ─────────────────────────────

  // WiFi connected but no internet — most common scenario
  if (/connect(ed)?.*(nahi chal|work nahi|internet nahi|nahi work)|wifi.*(connected|chal).*(internet nahi|nahi chal)|(no internet|internet nahi).*(connected|connect)/.test(p))
    return `WiFi connected hai par internet nahi chal raha — ye steps karo:\n\n1. Taskbar WiFi click karo → Disconnect karo → "Wiom office 5g-Test" select karo → Password: spartans500\n2. Win+R dabao → cmd likho → Enter → phir type karo: ipconfig /flushdns → Enter\n3. Phir type karo: netsh winsock reset → Enter → laptop restart karo\n\nAgar nahi hua → IT ticket banao 🎫`;

  if (p.includes('slow') || p.includes('hang') || p.includes('freez') || p.includes('dheema'))
    return `Acha, laptop slow/hang hai? 🔧\nPehle ye karo: Ctrl+Shift+Esc dabao → Task Manager mein jo process sabse zyada CPU le raha ho → End Task karo.\nKaro batao ho gaya ya nahi!`;
  if (p.includes('wifi') || p.includes('internet') || p.includes('network') ||
      /\bnet\b/.test(p) || p.includes('net band') || p.includes('signal nahi') || p.includes('no internet'))
    return `WiFi/Net issue — ye steps try karo:\n\n1. Taskbar WiFi click → OFF karo → ON karo → try karo\n2. "Wiom office 5g-Test" select karo → Password: spartans500\n3. Win+R → cmd → netsh winsock reset → Enter → restart karo\n\nAgar nahi hua → IT ticket banao 🎫`;
  if (p.includes('sound') || p.includes('audio') || p.includes('speaker') || p.includes('headphone'))
    return `Sound fix! 🔊\n1. Taskbar speaker icon Right-click → Sound settings.\n2. Output device → sahi device select karo.\n3. Volume 0% nahi honi chahiye — check karo.\nClick the script button below! ⬇️`;
  if (p.includes('blue screen') || p.includes('bsod'))
    return `Blue Screen fix! 💙\n1. Error code note karo jo screen par tha.\n2. Laptop restart karo — akbar mein theek ho jata hai.\n3. 3 baar se zyada hua toh ticket raise karo.\nClick the script button below! ⬇️`;
  if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charg/.test(p))
    return `Battery/Charging fix! 🔋\n\n1. Charger dono taraf firmly lagao (laptop side + socket side)\n2. Alag power socket try karo\n3. Laptop band karo → charger nikalo → power button 30 sec hold karo → charger lagao → on karo\n\nAgar nahi hua → IT ticket banao 🎫`;
  if (p.includes('black screen') || p.includes('no display'))
    return `Black screen fix! 🖥️\n1. Fn+F5 ya Fn+F8 (brightness keys) dabao.\n2. Koi change nahi → power button 10sec hold → restart.\n3. Baad mein bhi kuch nahi → ticket raise karo.\nClick the script button below! ⬇️`;
  if (p.includes('keyboard') || p.includes('keys'))
    return `Keyboard fix! ⌨️\n1. Laptop restart karo.\n2. Win+R → osk → on-screen keyboard se kaam chalao.\n3. Device Manager → Keyboards → Update driver.\nClick the script button below! ⬇️`;
  if (p.includes('touchpad') || p.includes('mouse'))
    return `Touchpad fix! 🖱️\n1. Fn + touchpad key (lock icon wali) dabao.\n2. Settings → Bluetooth & devices → Touchpad → ON.\n3. Laptop restart karo.\nClick the script button below! ⬇️`;
  if (p.includes('printer'))
    return `Printer fix! 🖨️\n1. Settings → Bluetooth & devices → Printers → right-click → Set as default.\n2. Win+R → services.msc → Print Spooler → Restart.\n3. Dubara print karo.\nClick the script button below! ⬇️`;
  if (p.includes('teams'))
    return `Teams fix! 📹\n1. System tray → Teams icon right-click → Quit → reopen.\n2. Win+R → %appdata%\\Microsoft\\Teams → Cache folder delete karo.\n3. teams.microsoft.com browser mein kholo (web fallback).\nClick the script button below! ⬇️`;
  if (p.includes('zoom'))
    return `Zoom fix! 🎥\n1. Zoom band karo → dobara kholo.\n2. Internet check karo → zoom.us/wc/join browser mein try karo.\n3. Zoom Settings → Audio/Video → sahi device select karo.\nClick the script button below! ⬇️`;
  if (p.includes('outlook') || p.includes('email'))
    return `Outlook fix! 📧\n1. Ctrl+Shift+Esc → Outlook process end karo.\n2. Win+R → outlook /safe → Enter.\n3. outlook.office365.com browser mein try karo.\nClick the script button below! ⬇️`;
  if (p.includes('password') || p.includes('locked') || p.includes('login')) {
    // Google/Gmail self-service reset
    if (/google|gmail/.test(p))
      return `Google account password reset! 🔐\n1. myaccount.google.com pe jaao\n2. Security tab click karo\n3. "How you sign in to Google" → Password click karo\n4. Current password enter karo (ya fingerprint se verify karo)\n5. Naya password set karo\n\nAgar nahi hua → IT ticket raise karo 🎫`;
    // Windows/laptop/account — IT only, no self-service
    return `Windows/Account password sirf IT reset kar sakta hai! 🔐\n\nType karo *ha* — main IT ko bhej deta hoon, woh jaldi reset kar denge 🎫`;
  }
  if (p.includes('bluetooth'))
    return `Bluetooth fix! 🔵\n1. Settings → Bluetooth → toggle OFF → ON karo.\n2. Device dobara pair karo.\n3. Device Manager → Bluetooth → Disable → Enable.\nClick the script button below! ⬇️`;
  if (p.includes('camera') || p.includes('camra') || p.includes('webcam') || /\bcam\b/.test(p))
    return `Settings → Privacy → Camera → ON karo 📷 Teams/Zoom mein Settings → Video → sahi camera select hai? Device Manager → Cameras → Disable → Enable karo. Batao kaise raha!`;
  if (p.includes('mic') || p.includes('microphone'))
    return `Microphone fix! 🎤\n1. Settings → Privacy → Microphone → ON karo.\n2. Sound settings → Input → sahi mic select karo.\n3. Teams: Settings → Devices → mic test karo.\nClick the script button below! ⬇️`;
  if (p.includes('usb') || p.includes('pendrive'))
    return `USB fix! 🔌\n1. Alag USB port mein try karo.\n2. Device Manager → Universal Serial Bus → Uninstall → Scan for hardware changes.\n3. Laptop restart karo.\nClick the script button below! ⬇️`;
  if (p.includes('storage') || p.includes('disk full'))
    return `Storage cleanup ! 💾\n1. Win+R → cleanmgr → C: → Clean system files.\n2. Win+R → %temp% → Ctrl+A → Delete.\n3. Recycle Bin empty karo.\nClick the script button below! ⬇️`;
  if (p.includes('virus') || p.includes('malware') || p.includes('antivirus'))
    return `Virus scan ! 🦠\n1. Windows Security kholo → Virus & threat protection.\n2. Quick Scan karo → wait karo.\n3. Serious lag raha → raise a ticket: type *raise ticket* 🎫\nClick the script button below! ⬇️`;
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
  // Generic fallback — ask first, don't assume
  return `Haan batao! 😊 Thoda detail mein bolo — exactly kya ho raha hai? Koi error message aa raha kya screen pe? Jitna detail doge, utni jaldi fix karunga!`;
};

// ── Call Gemini (Google FREE fallback) ───────────────────────────────────────
const callGemini = async (systemPrompt, history) => {
  if (!gemini) throw new Error('Gemini client not initialized — GEMINI_API_KEY missing');
  const model = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
  // Build chat history for Gemini format
  const geminiHistory = history.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const chat = model.startChat({
    history: geminiHistory,
    generationConfig: { maxOutputTokens: 500, temperature: 0.55 }
  });
  const lastMsg = history[history.length - 1]?.content || '';
  const result = await chat.sendMessage(systemPrompt + '\n\n' + lastMsg);
  const text = result.response.text()?.trim();
  if (!text) throw new Error('Empty response from Gemini');
  return text;
};


// ── Call Groq (LLaMA fallback) ────────────────────────────────────────────────
const callGroq = async (systemPrompt, history) => {
  const completion = await groq.chat.completions.create({
    model      : 'llama-3.3-70b-versatile',
    messages   : [{ role: 'system', content: systemPrompt }, ...history],
    temperature: 0.55,  // ChatGPT-like: natural + accurate (0.3 was too robotic)
    max_tokens : 500    // enough for full step lists without cut-off
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

  // ── INTENT DETECTION — tell AI exactly what category this is ──────────
  const intent = detectIntent(messages);
  const intentContext = `\n\n⚡ DETECTED ISSUE CATEGORY: ${intent.category}\n🎯 INSTRUCTION: ${intent.hint}`;

  const systemPrompt = SYSTEM_PROMPT
    + `\n\nUSER CONTEXT: ${userContext}`
    + (laptop ? `\nEmployee laptop: ${laptop}${laptopSN ? ` (SN: ${laptopSN})` : ''}` : '')
    + intentContext
    + triedSteps;

  // ── Routing: Groq PRIMARY → Gemini FREE backup → KB always ─────────────
  let raw;
  const lastMsg = history.filter(m => m.role === 'user').pop()?.content || '';

  try {
    raw = await callGroq(systemPrompt, history);
    console.log('✅ Groq (PRIMARY) responded OK');
  } catch (err) {
    console.warn('⚠️ Groq failed:', err.message, '— trying Gemini...');
    try {
      raw = await callGemini(systemPrompt, history);
      console.log('✅ Gemini (BACKUP) responded OK');
    } catch (err2) {
      console.error('❌ Gemini also failed:', err2.message, '— using KB fallback');
      raw = getKBFallback(lastMsg);
      console.log('⚠️ Using KB fallback');
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
  // IMPORTANT: "type karo ha" ALONE is enough — even without the word "ticket"
  // Claude sometimes says "IT ko bhej deta hoon" without saying "ticket" — catch that too
  const shouldCreateTicket =
    // "type karo ha/haan" anywhere in reply → always means ticket confirm
    /type\s*karo[:\s\s]*\*?ha(an|a|n)?\*?/i.test(reply) ||
    // Or: "ticket" word + action keywords
    (reply.toLowerCase().includes('ticket') && (
      /ticket\s*(bana|raise|create|chahiye|bhejte|banana)/i.test(reply) ||
      /ticket\s*(raise\s*karein|karein|bhejta)/i.test(reply)
    )) ||
    // Claude saying "bhej deta hoon" + "IT" (ticket confirmation without "ticket" word)
    (/IT\s*(ko|team)\s*(ko\s*)?bhej/i.test(reply) && /type\s*karo/i.test(reply));

  // ── HALLUCINATION DETECTOR: Claude claims ticket was sent but it wasn't ──
  // These patterns mean Claude said it already sent/created ticket — which is FALSE
  const isHallucinated =
    /ticket\s*(raised|created|submitted)\s*successfully/i.test(reply) ||
    // Hindi hallucinations: "bhej diya gaya hai", "bheja ja chuka hai" etc.
    /bhej\s*diya\s*(gaya|gai|hai|ja|chuka)/i.test(reply) ||
    /bheja\s*(ja\s*chuka|chuka|gaya)\s*hai/i.test(reply) ||
    // "IT team ke paas bhej diya"
    /IT\s*(team\s*)?(ko|ke\s*paas|tak)\s*(bhej|send|forward)\s*(diya|kar\s*diya|gaya)/i.test(reply) ||
    // "aapko jald hi sampark kiya jayega" without "type karo ha" = hallucinated ticket
    (/sampark\s*kiya\s*jayega/i.test(reply) && !/type\s*karo/i.test(reply)) ||
    // "issue IT team ke paas bhej diya gaya hai"
    /issue.*IT.*bhej.*gaya/i.test(reply) ||
    /aapka\s*(issue|problem|complaint).*bhej/i.test(reply);

  if (isHallucinated) {
    // Replace entire hallucinated response with proper confirmation ask
    const lastUserMsg = history.filter(m => m.role === 'user').pop()?.content || '';
    const isHardware = /screen|laptop|keyboard|mouse|battery|fan|hardware/i.test(lastUserMsg);
    reply = isHardware
      ? `Hardware issue hai — ismein IT team physically help karegi. Type karo *ha*, main ticket raise karta hoon 🎫`
      : `Koi baat nahi! 😊 IT team ko bhejte hain. Type karo *ha*, ticket raise karta hoon 🎫`;
  }

  // Normalize: if shouldCreateTicket but no "type karo" visible, add the prompt
  if (shouldCreateTicket && !isHallucinated && !/type\s*karo/i.test(reply)) {
    reply = reply.replace(/\s*$/, '') + '\n\nType karo *ha* — ticket raise karta hoon 🎫';
  }

  return {
    reply             : reply || getKBFallback('generic'),
    shouldCreateTicket: shouldCreateTicket || isHallucinated,
    ticketData        : null
  };
};


// ── Streaming chat — sends chunks via onChunk callback, returns fullText ─────
const chatStream = async (messages, { empId, empName, source, laptop, laptopSN, dept, floor }, onChunk) => {
  const history = messages.slice(-30).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const userContext = [
    `Employee: ${empName || empId} (ID: ${empId})`,
    dept      ? `Department: ${dept}`       : null,
    floor     ? `Floor: ${floor}`           : null,
    laptop    ? `Laptop: ${laptop}`         : null,
    laptopSN  ? `Serial: ${laptopSN}`       : null,
  ].filter(Boolean).join(' | ');

  const triedSteps   = extractTriedSteps(messages);
  const intent       = detectIntent(messages);
  const intentCtx    = `\n\n⚡ DETECTED: ${intent.category}\n🎯 INSTRUCTION: ${intent.hint}`;
  const systemPrompt = SYSTEM_PROMPT + `\n\nUSER CONTEXT: ${userContext}` + intentCtx + triedSteps;

  // ── KB instant answer — simulate streaming word-by-word ─────────────────
  const lastUserMsg = history.filter(m => m.role === 'user').pop()?.content || '';
  const kbAnswer = getKBAnswer(lastUserMsg);
  if (kbAnswer) {
    const words = kbAnswer.split('');
    for (const ch of words) {
      onChunk(ch);
      await new Promise(r => setTimeout(r, 8));
    }
    return kbAnswer;
  }

  // ── Groq streaming ────────────────────────────────────────────────────────
  try {
    const stream = await groq.chat.completions.create({
      model      : 'llama-3.3-70b-versatile',
      messages   : [{ role: 'system', content: systemPrompt }, ...history],
      temperature: 0.3,
      max_tokens : 300,
      stream     : true
    });

    let fullText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) { fullText += delta; onChunk(delta); }
    }
    return fullText || getKBFallback(lastUserMsg);

  } catch (err) {
    console.warn('⚠️ Groq stream failed:', err.message, '— trying Gemini...');
    // Gemini fallback (non-streaming, simulate with char-by-char)
    try {
      const geminiReply = await callGemini(systemPrompt, history);
      const text = geminiReply || getKBFallback(lastUserMsg);
      console.log('✅ Gemini stream-fallback OK');
      for (const ch of text.split('')) {
        onChunk(ch);
        await new Promise(r => setTimeout(r, 6));
      }
      return text;
    } catch (err2) {
      console.error('❌ Gemini also failed:', err2.message, '— using KB');
      const fallback = getKBFallback(lastUserMsg);
      for (const ch of fallback.split('')) {
        onChunk(ch);
        await new Promise(r => setTimeout(r, 6));
      }
      return fallback;
    }
  }
};

// ── Quick single reply (for Slack notifications) ─────────────────────────────
const quickReply = async (userMessage, empName = 'Employee', laptop = null, laptopSN = null) => {
  const laptopCtx = laptop ? ` | Laptop: ${laptop}${laptopSN ? ` (SN: ${laptopSN})` : ''}` : '';
  const sys = SYSTEM_PROMPT + `\nUser: ${empName}${laptopCtx}. Keep reply under 3 lines.`;
  const history = [{ role: 'user', content: userMessage }];

  let raw;
  try {
    raw = await callGroq(sys, history);
  } catch {
    try { raw = await callGemini(sys, history); } catch { raw = getKBFallback(userMessage) || userMessage; }
  }

  const parsed = parseOutput(raw);
  return (typeof parsed.reply === 'string' ? parsed.reply : raw) || userMessage;
};

// ── Direct KB lookup — instant, no AI call needed ────────────────────────────
const getKBAnswer = (problem) => {
  if (!problem) return null;
  const p = problem.toLowerCase().trim();

  // ── 🚫 OUT OF SCOPE — TV, AC, furniture, electricity etc. ───────────────
  // IT helpdesk sirf laptops, WiFi, software, passwords handle karta hai
  if (/\b(tv|television|telly|ac\b|air\s*condition|fan\b|ceiling\s*fan|light\b|bulb|electricity|current\s*nahi|power\s*cut|generator|geyser|water|pantry|canteen|chair|table|desk|furniture|lift|elevator|ac\s*nahi|ac\s*band)\b/i.test(p) &&
      !/\b(laptop|wifi|internet|software|password|teams|outlook|chrome|window|screen|monitor|keyboard|mouse|bluetooth|usb)\b/i.test(p)) {
    return `Yeh IT ke scope mein nahi aata 😊\n\nIT helpdesk sirf yeh handle karta hai:\n💻 Laptop / Desktop problems\n🌐 WiFi / Internet issues\n🔑 Password / Account\n⚙️ Software (Teams, Outlook, etc.)\n\n*TV, AC, lights, furniture* ke liye → *Admin / Facilities team* se contact karo.\nKoi laptop ya IT problem ho toh batao — main hoon! 🚀`;
  }

  // ── 🚨 THEFT / LOSS — HIGHEST PRIORITY — check BEFORE anything else ────
  // "chori", "gum", "missing", "stolen", "lost" → NEVER say "resolved"
  if (/\b(chori|cori|churai|churaya|churaye|stolen|theft|gum\s*ho|gum\s*gaya|missing|khoya|khoyi|kho\s*gaya|kho\s*gayi|nahi\s*mila|nahi\s*mili|gum\s*gyi|gum\s*gaya)\b/i.test(p) &&
      /\b(laptop|device|phone|mobile|tab|bag|charger)\b/i.test(p)) {
    return `🚨 *URGENT — Laptop Chori/Gum Report*\n\nYeh bahut serious matter hai! Abhi yeh karo:\n\n1. *IT Admin ko call karo ABHI* → Sajan Kumar: *9654244281*\n2. *HR ko bhi batao* → Formal report ke liye\n3. *Security desk* → Building security ko inform karo\n4. *Note karo* → Kahan tha laptop? Kab se missing? Koi witness?\n\n*Main aapke liye HIGH PRIORITY ticket bana raha hoon.*\nType karo *ha* — main IT Admin ko alert karunga iska ticket banata hoon 🎫`;
  }

  // ── User saying issue is resolved / working fine now ───────────────────
  // STRICT: only if NO negative word present AND message is short status update
  // Fix 1: Added nhai/nha (common typos of nahi that users actually type)
  const hasNegative = /\b(not|nahi|nahin|nai|nhi|mahi|nhai|nha|mat|na\b|band|kharab|problem|issue|error|chal nahi|kaam nahi|nahi chal|nahi ho|ho nahi|abhi bhi|still|phir bhi|chal nahi|nai chal|mahi chal|nhai chal|ho nahi rha|nahi ho rha|nahi rha)\b/i.test(p);
  // "chal raha hai" ONLY counts as positive if NOT preceded by nahi/mahi/na etc.
  const chalRahaPositive = /chal\s*raha\s*hai|chal\s*rhi\s*hai/.test(p) && !/(\bmahi\b|\bnahi\b|\bnai\b|\bnhi\b|\bnot\b).{0,15}chal/i.test(p);
  // IMPORTANT: "ho gya" / "ho gaya" alone are too vague — only count if paired with fix/solve/theek/sahi
  // "chori ho gya" / "kharab ho gya" must NOT trigger resolved → removed bare "ho gaya/ho gya" from list
  const hasPositive = chalRahaPositive || /\b(normal|noraml|norml|theek|thik|sahi|fixed|resolved|kaam kar raha|solve ho|fix ho gaya|sahi ho gaya|theek ho gaya|thik ho gaya|chal gaya|chal gyi|on ho gaya|work kar raha|charged|charge ho|connect ho gaya|sorted|done|complete|ho gayi|mil gaya|mil gayi)\b/i.test(p);
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

  // ── Only EXACT FACTS in KB — everything else → Claude asks follow-up ────
  // NOTE: Resolved check above runs FIRST — so "fan normal hai" won't hit fan noise handler

  // Fan noise/sound (fan IS running but making noise — NOT an emergency)
  // This only runs if hasPositive check above did NOT return (i.e., user is NOT saying "fixed")
  if (/fan\s*(sound|awaaz|baj|noise|shor|loud|kar\s*rha|chal\s*rha|aa\s*rhi)/i.test(p) ||
      /\bfan\s+(kar|chal|baj|sound)/i.test(p)) {
    return `Fan ki awaaz aa rahi hai — usually heavy apps se hota hai 🔊\nCtrl+Shift+Esc dabao → CPU column sort karo → koi heavy app End Task karo.\nLaptop hard surface pe rakhho (table pe, bed/sofa pe nahi).\nThodi der mein band ho jaaye toh theek hai. Agar bahut tez awaaz ho ya nahi ruki toh batao 🎫`;
  }

  // Fan emergency — fan NOT working at all (safety critical — instant response)
  if (/fan\s*(nahi\s*chal|band|kaam\s*nahi|not\s*work|chal\s*nahi)/i.test(p)) {
    return `Fan nahi chal raha — laptop abhi band karo aur charger nikaal do ⚠️ Hardware damage ho sakta hai. Type karo *ha*, ticket abhi bhejta hoon 🎫`;
  }

  // Virus (urgent — must be instant)
  if (/\b(virus|malware|ransomware|hack)\b/i.test(p)) {
    return `Abhi Windows Security → Virus & threat protection → Quick Scan karo 🦠 Kuch suspicious mila? Internet band karo aur type karo *ha* — IT ko turant batata hoon 🎫`;
  }

  return null; // Everything else → Claude handles with follow-up questions
};

module.exports = { chat, chatStream, quickReply, getKBAnswer };

