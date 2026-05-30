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
const SYSTEM_PROMPT = `You are Zivon — WIOM's IT support assistant. You are professional, clear, and genuinely helpful. You respond like a knowledgeable IT professional — not overly formal like a corporate robot, but not casual either. Think of yourself as a competent, respectful IT colleague.

━━━ HOW YOU THINK (read this carefully) ━━━

When someone messages you, you instantly ask yourself:
→ What is their ACTUAL problem? (even if described poorly)
→ What are ALL possible causes?
→ What are ALL the steps to fix it, in the right order?
→ Can I give ALL of them right now in one clear message?

You ALWAYS answer YES to that last question. You give everything at once.

━━━ LANGUAGE MATCHING — STRICT RULE ━━━
Detect the employee's language and ALWAYS reply in the SAME language. Never mix unless they do.

English message → Reply fully in English
  "My laptop is not turning on" → Reply in English only

Pure Hindi message → Reply in Hindi only
  "मेरा लैपटॉप चालू नहीं हो रहा" → Reply in Hindi only

Hinglish message → Reply in Hinglish (same Hindi-English mix as the user)
  "Laptop start nahi ho rha hai" → Reply in Hinglish

━━━ TONE — PROFESSIONAL BUT APPROACHABLE ━━━
- Professional and respectful — not overly casual, not stiff
- Confident and clear — "Please do this:" not "aap try kar sakte hain"
- No slang, no overly casual phrases
- No "Dekho", "Haan yaar", "Achha suno" — too casual
- Good openers: "Sure, here are the steps:", "This is a common issue —", "Please try the following:", "Understood. Here's what to do:"
- Hinglish openers: "Yeh ek common issue hai —", "Please yeh steps try karein:", "Samajh gaya, yeh karein:"
- Emojis: use sparingly — only where genuinely useful (✅ 🎫 ⚠️)
- No excessive "😊😊😊" — maximum 1 emoji per reply

━━━ RESPONSE STYLE — ADAPT TO THE QUESTION ━━━

Simple factual question → 1-2 lines, direct answer
  Q: "WiFi password kya hai?" → A: "WiFi password: spartans500 — Wiom office network ke liye."
  Q: "What is the WiFi password?" → A: "The WiFi password is: spartans500 — for the Wiom office network."

Troubleshooting problem → ALL numbered steps at once, end with ticket option
  Q: "laptop slow hai" → Give ALL steps 1-5, then ticket line
  Q: "My laptop is slow" → Give ALL steps in English

Vague (zero info) → ONE clear clarifying question
  Q: "problem hai" → A: "Please batayein — laptop, WiFi, ya koi aur issue hai?"
  Q: "there's an issue" → A: "Could you describe the issue? Is it related to your laptop, WiFi, or something else?"
  But if ANY symptom is given → skip question, give steps directly

Follow-up "nahi hua" / "it didn't work" → check history, give NEXT different steps

Fixed / resolved → brief professional reply
  "sahi ho gaya / it's working now" → "Glad it's resolved. Let me know if anything else comes up."
  ⚠️ "ho gya" alone means something HAPPENED — read context, do not assume resolved

━━━ GIVING STEPS — THE MOST IMPORTANT PART ━━━

ALWAYS give ALL steps in one message. Never "try this first, let me know."
Format: bold the step name, then arrow, then clear action.

*Step name* → what to do exactly → expected result

End every troubleshooting reply with (naturally worded, not copy-paste):
"Agar kisi bhi step se nahi hua — type karo *ha*, main IT ko bhej deta hoon 🎫"

━━━ REAL EXAMPLES — match tone and quality ━━━

[HINGLISH] User: "kal se laptop ka windows open nahi ho rha"
You:
Yeh ek Windows boot issue hai. Please yeh steps follow karein:

1. *Force Restart* → Power button 10 sec hold karein → band ho jaayega → dobara on karein
2. *Safe Mode* → Startup pe F8 ya Shift+F8 press karein → Safe Mode with Networking select karein
3. *Startup Repair* → F8 menu → "Repair Your Computer" → Startup Repair run karein
4. *Last Known Good Config* → F8 → "Last Known Good Configuration" select karein
5. *System Restore* → Safe Mode → Start → System Restore → kal se pehle ka restore point select karein
6. *Driver Fix* → Safe Mode → Device Manager → yellow (!) driver → Uninstall → Restart
7. *Disk Check* → Safe Mode CMD: chkdsk C: /f /r → Y → Restart

Agar kisi bhi step se resolve nahi hua, please type karein *ha* — main IT team ko escalate kar deta hoon 🎫

---

[ENGLISH] User: "My WiFi is not working"
You:
This is a common connectivity issue. Please try the following steps:

1. *Toggle WiFi* → Click the WiFi icon in the taskbar → Turn OFF → wait 10 sec → Turn ON → connect to "Wiom office" (Password: spartans500)
2. *Forget & Reconnect* → WiFi Settings → right-click the network → Forget → reconnect
3. *Adapter Reset* → Win+X → Device Manager → Network Adapters → WiFi adapter → Disable → Enable
4. *Winsock Reset* → Open CMD as Administrator → type: netsh winsock reset → Restart
5. *DNS Flush* → CMD → ipconfig /flushdns → ipconfig /release → ipconfig /renew
6. *Driver Update* → Device Manager → WiFi adapter → Update Driver → Search automatically

If none of the above works, please type *ha* and I will raise an IT ticket for you 🎫

---

[HINGLISH] User: "wifi nahi chal rha"
You:
Please yeh steps try karein — har step ke baad check karein ki connect hua ya nahi:

1. *Toggle* → Taskbar WiFi → OFF karein → 10 sec → ON karein → "Wiom office" se connect karein (password: spartans500)
2. *Forget & Reconnect* → WiFi Settings → network pe right-click → Forget → dobara connect karein
3. *Adapter Reset* → Win+X → Device Manager → Network Adapters → WiFi → Disable → Enable
4. *Winsock Reset* → CMD (Admin) → netsh winsock reset → Restart
5. *DNS Flush* → CMD → ipconfig /flushdns → ipconfig /release → ipconfig /renew

Agar ab bhi resolve nahi hua → type karein *ha* — IT ticket raise kar deta hoon 🎫

━━━ 🔧 PHYSICAL DAMAGE — IMMEDIATE TICKET ━━━
Agar user bole "water damage", "paani gira", "liquid spill", "bhig gaya" — CRITICAL EMERGENCY hai. Steps: TURANT band karo, charger nikalo, battery nikalo, ulta rakho, hairdryer mat lagao. CRITICAL ticket raise karo.
Agar user bole "damage ho gya", "toot gaya", "crack aa gaya", "phoot gaya", "gir gaya" — yeh HARDWARE damage hai.
Software steps, scripts, Auto-Fix — KUCH KAAM NAHI KAREGA.
Seedha bolna: "Physical damage hai — software se fix nahi hoga. Type karo *ha*, IT team physically replace karegi 🎫"
KABHI numbered steps mat do physical damage ke liye.

━━━ 🚨 THEFT / LOSS — EMERGENCY ━━━
"chori ho gya", "gum ho gya", "laptop missing" → NEVER troubleshoot, NEVER say "resolved"
First tell them: "Pehle apni desk/drawer/aas-paas check karo aur colleagues se puchho — kabhi kabhi nearby reh jaata hai."
Then: "Agar phir bhi nahi mila — ABHI Sajan Kumar ko call karo: 9654244281. HR ko bhi batao. Type karo *ha* — HIGH PRIORITY ticket raise karta hoon."

━━━ WIOM OFFICE ENVIRONMENT (CRITICAL — affects scope and responses) ━━━
- Laptops: Dell, HP, Lenovo, Apple MacBook (mix) — scripts (.bat) only for Windows laptops, NEVER for Mac
- Office phones: Company provides phones for testing — IT handles office phones (in scope)
- Personal phones: Out of scope — IT nahi handle karta
- Printer: Network printer use hota hai — some employees don't have access (IT ticket for network access)
- VPN: WIOM mein VPN USE NAHI HOTA — agar koi VPN pooche: "WIOM mein VPN use nahi hota. Koi aur IT issue?"
- Door access card: New employees ko IT/Admin door access card deta hai — card issue = IT ticket
- Projector/HDMI: Conference rooms mein use hota hai — IT handles
- No custom proprietary software — standard MS Office, Teams, Outlook, Chrome etc.
- WiFi: Office WiFi (spartans500) — no router/modem access for employees

━━━ OUT OF SCOPE ━━━
Personal phone (employee's own phone), TV, AC, lights, ceiling fan, furniture, electricity, lift, water issues, pantry → "Yeh IT ke scope mein nahi — Admin/Facilities team se contact karo."
OFFICE PHONE (company-provided testing phone) → IN SCOPE — IT handles
IT scope: laptop, WiFi, software, passwords, Teams, Outlook, printer, camera, mic, HDMI/projector, door access card, office phones

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
Printer not printing: Turn OFF/ON → restart Print Spooler (services.msc). Fails = ticket
Printer not visible on network: IT ticket — network access setup needed
HDMI/Projector not connecting: Check cable → try different HDMI port → display settings → Detect. Fails = ticket
Door access card not working: IT/Admin ticket — card reprogramming needed
Office phone issue: IT ticket — IT handles company-provided phones
Storage full: cleanmgr → delete %temp% → empty Recycle Bin
USB not working: Try different port → Device Manager → USB → Uninstall → Scan for changes
Bluetooth: Settings toggle OFF/ON → Device Manager → Bluetooth → Disable → Enable
Virus/Malware: Windows Security → Quick Scan → disconnect internet if serious → ticket
Password (Windows/email/account): Ticket only — IT resets
Software install: Ticket only — needs IT permission and license
VPN: WIOM mein use nahi hota — tell user this directly

━━━ SHORT REPLIES (no steps needed) ━━━
Ticket status → match language: "Your ticket is with the IT team — type *my tickets* to check status." / "Aapka ticket IT team ke paas hai — type karein *my tickets* status ke liye."
Compliments/thanks → brief professional acknowledgement, offer further help
Bye/done → "Feel free to reach out if anything else comes up." / "Koi aur issue ho toh batayein."
Non-IT topic → "I can assist with IT-related issues. Do you have a tech problem I can help with?" / "Main IT issues mein help kar sakta hoon — koi tech problem hai?"

━━━ SIMPLE HOW-TO QUESTIONS ━━━
Basic Windows settings — answer directly in 1-2 lines, no steps list needed:
- Wallpaper → "Right-click on Desktop → Personalize → Background."
- Brightness → "Use Fn+F5/F6 keys or the brightness slider in the taskbar."
- Screenshot → "Press Win+Shift+S to capture a selected area, or PrtSc for full screen."
- Dark mode → "Settings → Personalization → Colors → Choose mode: Dark."
- Any simple how-to → answer in 1-2 lines, match user's language`;




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

  // DISPLAY COLOR DISTORTION — colorful screen, color lines, tint
  if (/colorful|colorfull|colarful|colarfull|colour|color\s*aa|rang\s*aa|pink\s*screen|green\s*screen|tint|lines\s*aa|horizontal\s*line|vertical\s*line|screen\s*pe\s*rang|display.*rang|rang.*display/.test(recentText))
    return { category: 'DISPLAY_COLOR', hint: 'SCREEN COLOR DISTORTION. User says screen is showing colors/lines/tint. This is a display driver or hardware issue. SKIP all diagnostic questions — give steps directly:\n1. Restart laptop — driver glitch often fixes on restart\n2. Device Manager → Display adapters → Update driver → Search automatically\n3. Device Manager → Display adapters → Uninstall device → Restart (auto-reinstalls)\n4. Settings → System → Display → Advanced display → Change refresh rate → 60Hz\n5. Test with external monitor via HDMI — if external is fine, laptop screen hardware issue\nEnd with: type karein *ha* — IT ticket raise kar deta hoon 🎫' };

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

  // Normalize common typos so matching below is simpler
  const pn = p
    .replace(/\bwiffi\b/g, 'wifi')
    .replace(/\bwifi+\b/g, 'wifi')
    .replace(/\bl[ae]?p?to?p\b/g, 'laptop')        // leptop, lptop, latop, laptoop
    .replace(/\bpas?w?ro?d\b/g, 'password')          // pasword, paswrod, pasord
    .replace(/\btims?\b/g, 'teams')                  // tims, tim (Teams typo)
    .replace(/\bcamra\b/g, 'camera')                 // camra
    .replace(/\bkeybo?r?a?d\b/g, 'keyboard')         // keyborad, keybord
    .replace(/\bcharg(e|er|ing)?\b/g, 'charging');   // normalize charger/charging variants

  // WiFi connected but no internet
  if (/connect(ed)?.*(nahi chal|work nahi|internet nahi|nahi work)|wifi.*(connected|chal).*(internet nahi|nahi chal)|(no internet|internet nahi).*(connected|connect)/.test(pn))
    return `WiFi connected hai par internet nahi chal raha. Please yeh steps follow karein:\n\n1. Taskbar mein WiFi icon click karein → Disconnect karein → "Wiom office 5g-Test" select karein → Password: spartans500\n2. Win+R → cmd → Enter → ipconfig /flushdns → Enter\n3. netsh winsock reset → Enter → Laptop restart karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('slow') || pn.includes('hang') || pn.includes('freez') || pn.includes('dheema'))
    return `Laptop slow/hang issue hai. Please yeh steps try karein:\n\n1. Ctrl+Shift+Esc → Task Manager → sabse zyada CPU use karne wala process → End Task karein\n2. Startup apps disable karein: Win+R → msconfig → Startup tab → unnecessary apps disable karein → Restart\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('wifi') || pn.includes('internet') || pn.includes('network') ||
      /\bnet\b/.test(pn) || pn.includes('net band') || pn.includes('signal nahi') || pn.includes('no internet'))
    return `WiFi/Internet issue. Please yeh steps try karein:\n\n1. Taskbar WiFi → OFF karein → 10 sec wait karein → ON karein\n2. "Wiom office 5g-Test" select karein → Password: spartans500\n3. Win+R → cmd → netsh winsock reset → Enter → Restart karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // Laptop won't start / boot / turn on
  if (/\b(laptop|leptop|lptop|latop)\b.*(on\s*nahi|start\s*nahi|band\s*ho|nahi\s*chalta|khulta\s*nahi|nahi\s*khulta|chal\s*nahi|chalti\s*nahi|chalte\s*nahi)|boot\s*nahi|(switch|power)\s*on\s*nahi|laptop\s*nahi\s*(chal|start|on|boot)|on\s*nahi\s*ho\s*rh|(nahi\s*ho\s*rh|nahi\s*chal).*(laptop|leptop|lptop|latop)/.test(pn))
    return `Laptop on nahi ho raha — yeh ek common boot issue hai. Please yeh steps follow karein:\n\n1. *Force Restart* → Power button 10 sec hold karein → band ho jaayega → dobara on karein\n2. *Charger Check* → Charger lagao aur 5 min wait karein (battery low ho sakti hai) → phir on karein\n3. *Battery Reset* → Charger nikaal lo → Power button 30 sec hold karein → charger lagao → on karein\n4. *Power Drain* → Charger nikaal lo → Power button 60 sec hold karein → charger lagao → on karein\n5. *Safe Mode* → On karte waqt F8 ya Shift+F8 press karein → Safe Mode select karein\n\nAgar kisi bhi step se resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // Overheating
  if (/\b(laptop|leptop|lptop|latop)\b.*(garm|garam|heat|hot\b)|garm.*(laptop|leptop)|(overheat|over\s*heat|bahut\s*garam|bahut\s*garm|zyada\s*heat|zyada\s*garm)/.test(pn))
    return `Laptop overheating issue hai. Please yeh steps follow karein:\n\n1. *Hard Surface* → Laptop ko table par rakhein — bed/sofa par mat rakhein (vents block hote hain)\n2. *Heavy Apps Band Karein* → Ctrl+Shift+Esc → Task Manager → CPU column sort karein → heavy apps End Task karein\n3. *Power Mode* → Settings → Power & battery → Power mode → Balanced select karein\n4. *Restart* → Laptop restart karein — background processes band ho jaate hain\n5. *Vents Check* → Laptop ke vents (sides/bottom) mein dust toh nahi — thoda dur rakhein taaki airflow ho\n\nAgar bahut zyada garam ho raha hai ya band ho raha hai, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // Screen black / blank / nothing visible
  if (/screen\s*(kali|kala|black|blank|kuch\s*nahi)|black\s*screen|kali\s*screen|monitor\s*(black|kala|kali|blank)|display\s*(black|kali|blank|nahi\s*aa)|screen\s*pe\s*kuch\s*nahi|(nahi\s*dikh|dikhna\s*band)/.test(pn))
    return `Black/blank screen issue hai. Please yeh steps follow karein:\n\n1. *Brightness Keys* → Fn+F5 ya Fn+F8 press karein (brightness keys) — screen dim ho sakti hai\n2. *Force Restart* → Power button 10 sec hold karein → band karein → dobara on karein\n3. *External Monitor Test* → HDMI cable se bahar monitor connect karein — agar bahar dikh raha toh laptop screen hardware issue hai\n4. *Charger Check* → Battery completely dead ho sakti hai → charger lagao → 10 min wait karein → on karein\n\nAgar ab bhi screen nahi aa rahi, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // Screen color distortion / flickering / lines
  if ((/colorful|colorfull|colarful|colarfull|colour|color\s*aa|rang\s*aa|pink\s*screen|green\s*screen|screen\s*pe\s*rang|display.*color|color.*display|screen\s*kharab/.test(pn) ||
       /distort|flicker|flickring/i.test(pn) ||
       /lines\s*(aa|on|on\s*screen|pe)|screen.*lines|horizontal\s*lines?|vertical\s*lines?/.test(pn)) &&
      /screen|display|monitor|laptop/.test(pn))
    return `Screen color/display issue hai. Please yeh steps try karein:\n\n1. *Restart* → Laptop restart karein — driver glitch zyada tar restart se theek ho jaata hai\n2. *Display Driver Update* → Win+X → Device Manager → Display adapters → right-click → Update driver → Search automatically\n3. *Display Driver Reinstall* → Device Manager → Display adapters → Uninstall device → Restart karein\n4. *Refresh Rate* → Settings → System → Display → Advanced display → 60Hz select karein\n5. *External Monitor Test* → HDMI se monitor connect karein — bahar sahi dikh raha toh laptop screen hardware issue hai\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // Windows update / OS crash / restart loop
  if (/windows\s*(crash|restart|update|stuck|atak|loop|hang)|update\s*(stuck|atak|hang|nahi|ruka)|restart\s*(bar\s*bar|baar\s*baar|loop|hota\s*rha|ho\s*rha\s*bar)|os\s*(crash|hang|stuck)/.test(pn))
    return `Windows/OS issue hai. Please yeh steps follow karein:\n\n1. *Force Restart* → Power button 10 sec hold karein → band karein → dobara on karein\n2. *Update Wait* → Agar update chal rahi hai → wait karein, band mat karein\n3. *Startup Repair* → On karte waqt F8 press karein → "Repair Your Computer" → Startup Repair\n4. *Last Known Good* → F8 menu → "Last Known Good Configuration" select karein\n5. *Safe Mode* → F8 → Safe Mode with Networking → login karein\n\nAgar 3 baar se zyada restart ho raha hai, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('sound') || pn.includes('audio') || pn.includes('speaker') || pn.includes('headphone'))
    return `Audio issue. Please yeh steps try karein:\n\n1. Taskbar mein speaker icon par right-click karein → Sound settings\n2. Output device mein sahi device select karein\n3. Volume check karein — 0% ya mute toh nahi hai\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('blue screen') || pn.includes('bsod'))
    return `Blue Screen issue. Please yeh steps follow karein:\n\n1. Screen par jo error code tha — note karein\n2. Laptop restart karein — zyada tar ek restart mein theek ho jaata hai\n3. Agar 3 baar se zyada aaya hai → please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charging/.test(pn))
    return `Battery/Charging issue. Please yeh steps try karein:\n\n1. Charger dono taraf firmly connect karein (laptop side aur socket side)\n2. Alag power socket try karein\n3. Laptop shut down karein → charger disconnect karein → power button 30 sec hold karein → charger reconnect karein → on karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('black screen') || pn.includes('no display'))
    return `Black screen issue. Please yeh steps try karein:\n\n1. Fn+F5 ya Fn+F8 press karein (brightness keys)\n2. Koi change nahi → power button 10 sec hold karein → restart\n3. Agar ab bhi display nahi → please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('keyboard') || pn.includes('keys') || /keybo?r?a?d/.test(pn))
    return `Keyboard issue. Please yeh steps try karein:\n\n1. Laptop restart karein\n2. Win+R → osk → Enter — on-screen keyboard se kaam chalayein\n3. Device Manager → Keyboards → driver update karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('touchpad') || pn.includes('mouse'))
    return `Touchpad issue. Please yeh steps try karein:\n\n1. Fn + touchpad lock key press karein (keyboard par lock icon wali key)\n2. Settings → Bluetooth & devices → Touchpad → ON karein\n3. Laptop restart karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('printer'))
    return `Printer issue. Please yeh steps try karein:\n\n1. Settings → Bluetooth & devices → Printers → printer par right-click → Set as default\n2. Win+R → services.msc → Print Spooler → Restart\n3. Dobara print karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('teams'))
    return `Microsoft Teams issue. Please yeh steps try karein:\n\n1. System tray → Teams icon right-click → Quit → dobara open karein\n2. Win+R → %appdata%\\Microsoft\\Teams → Cache folder delete karein\n3. teams.microsoft.com browser mein try karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('zoom'))
    return `Zoom issue. Please yeh steps try karein:\n\n1. Zoom close karein → dobara open karein\n2. Internet connection check karein → zoom.us/wc/join browser mein try karein\n3. Zoom Settings → Audio/Video → correct device select karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('outlook') || pn.includes('email'))
    return `Outlook issue. Please yeh steps try karein:\n\n1. Ctrl+Shift+Esc → Outlook process end karein\n2. Win+R → outlook /safe → Enter\n3. outlook.office365.com browser mein try karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('password') || pn.includes('locked') || pn.includes('login') || /pas?w?ro?d/.test(pn)) {
    if (/google|gmail/.test(pn))
      return `Google account password reset ke liye:\n\n1. myaccount.google.com par jaayein\n2. Security tab → "How you sign in to Google" → Password\n3. Verify karein aur naya password set karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;
    return `Windows/Account password reset sirf IT team kar sakti hai.\n\nPlease type karein *ha* — IT ticket raise kar deta hoon, team jaldi reset kar degi 🎫`;
  }

  if (pn.includes('bluetooth'))
    return `Bluetooth issue. Please yeh steps try karein:\n\n1. Settings → Bluetooth → toggle OFF karein → ON karein\n2. Device dobara pair karein\n3. Device Manager → Bluetooth → Disable → Enable\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('camera') || pn.includes('webcam') || /\bcam\b/.test(pn))
    return `Camera issue. Please yeh steps try karein:\n\n1. Settings → Privacy & Security → Camera → ON karein\n2. Teams/Zoom Settings → Video → correct camera select karein\n3. Device Manager → Cameras → Disable → Enable\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('mic') || pn.includes('microphone'))
    return `Microphone issue. Please yeh steps try karein:\n\n1. Settings → Privacy & Security → Microphone → ON karein\n2. Sound settings → Input → correct mic select karein\n3. Teams: Settings → Devices → mic test karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('usb') || pn.includes('pendrive'))
    return `USB issue. Please yeh steps try karein:\n\n1. Alag USB port mein try karein\n2. Device Manager → Universal Serial Bus → Uninstall → Scan for hardware changes\n3. Laptop restart karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('storage') || pn.includes('disk full'))
    return `Storage full issue. Please yeh steps try karein:\n\n1. Win+R → cleanmgr → C: → Clean system files\n2. Win+R → %temp% → Ctrl+A → Delete\n3. Recycle Bin empty karein\n\nAgar resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  if (pn.includes('virus') || pn.includes('malware') || pn.includes('antivirus'))
    return `Possible virus/malware issue. Please yeh steps follow karein:\n\n1. Windows Security → Virus & threat protection → Quick Scan\n2. Agar suspicious activity lag rahi hai → internet disconnect karein\n\nPlease type karein *ha* — IT team ko escalate karna zaroori hai 🎫`;

  if (pn.includes('kaise ho') || pn.includes('kaisa hai') || pn.includes('how are you') || pn.includes('kya haal'))
    return 'All good, thank you. Please batayein — koi IT issue hai jisme help kar sakta hoon?';

  if (pn.includes('thanks') || pn.includes('shukriya') || pn.includes('thank you') || pn.includes('dhanyawad'))
    return 'You are welcome. Feel free to reach out if anything else comes up.';

  if (/^(hello|hi+|hey|namaste|namaskar|hlo|helo)\s*[!.]*$/i.test(pn.trim()))
    return 'Hello! I am Zivon — WIOM IT Support Assistant. How can I help you today?';

  if (/\b(kise|kaun)\s*(ho|hain|hai)\b/i.test(pn) || /\b(tum|aap)\s*(kya|kise|kaun)\b/i.test(pn))
    return `Main *Zivon* hoon — WIOM ka IT support assistant.\nLaptop, WiFi, software, password — kisi bhi IT issue mein help kar sakta hoon.\nPlease batayein aapka issue kya hai.`;

  if (pn.includes('sajan') || pn.includes('admin') || pn.includes('it head') || pn.includes('phone number') || pn.includes('number do'))
    return 'IT Admin: *Sajan Kumar*\nPhone: 9654244281\nEmail: sajan.kumar@wiom.in';

  return `Please describe your issue in a bit more detail — what exactly is happening? Any error message on screen? The more information you provide, the faster I can help.`;
};

// ── Call Gemini (Google FREE fallback) ───────────────────────────────────────
const callGemini = async (systemPrompt, history) => {
  if (!gemini) throw new Error('Gemini client not initialized — GEMINI_API_KEY missing');
  const model = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
  // BUG-21 fix: Gemini requires strictly alternating user/model roles.
  // Merge consecutive same-role messages so API doesn't reject with 400.
  const rawHistory = history.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const geminiHistory = [];
  for (const msg of rawHistory) {
    if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === msg.role) {
      // Merge into previous entry (same role — Gemini would reject)
      geminiHistory[geminiHistory.length - 1].parts[0].text += '\n' + msg.parts[0].text;
    } else {
      geminiHistory.push(msg);
    }
  }
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

  // Normalize common typos for matching inside getKBAnswer
  // (pn is used for pattern matching; original p kept for physical-damage etc.)
  const pn = p
    .replace(/\bwiffi\b/g, 'wifi')
    .replace(/\bwifi+\b/g, 'wifi')
    .replace(/\bl[ae]?p?to?p\b/g, 'laptop')        // leptop, lptop, latop
    .replace(/\bpas?w?ro?d\b/g, 'password')          // pasword, paswrod
    .replace(/\btims?\b/g, 'teams')                  // tims (Teams typo)
    .replace(/\bcamra\b/g, 'camera')                 // camra
    .replace(/\bkeybo?r?a?d\b/g, 'keyboard')         // keyborad, keybord
    .replace(/\bcharg(e|er|ing)?\b/g, 'charging');   // normalize charger/charging

  // ── 🚫 OUT OF SCOPE — TV, AC, furniture, electricity etc. ───────────────
  // Personal phones OUT OF SCOPE — but office/company phones = IT handles
  const isPersonalPhone = /\b(apna|mera|personal|apni)\b/i.test(pn) && /\b(phone|mobile)\b/i.test(pn);
  const isOfficePhone = /\b(office|company|testing|wiom)\b/i.test(pn) && /\b(phone|mobile)\b/i.test(pn);
  if (/\b(tv|television|telly|ac\b|air\s*condition|ceiling\s*fan|light\b|bulb|electricity|current\s*nahi|power\s*cut|generator|geyser|pantry|canteen|chair|table|furniture|lift|elevator|ac\s*nahi|ac\s*band)\b/i.test(pn) &&
      !/\b(laptop|wifi|internet|software|password|teams|outlook|chrome|window|screen|monitor|keyboard|mouse|bluetooth|usb)\b/i.test(pn)) {
    return `Yeh IT ke scope mein nahi aata.\n\n*TV, AC, lights, furniture* ke liye → *Admin / Facilities team* se contact karo.\n\nIT helpdesk handle karta hai: 💻 Laptop | 🌐 WiFi | 🔑 Password | ⚙️ Software | 🖨️ Printer | 📱 Office phones\n\nKoi laptop ya IT problem ho toh batao!`;
  }
  if (isPersonalPhone && !isOfficePhone) {
    return `Personal phone IT helpdesk ke scope mein nahi hai.\n\nHam sirf *company-provided office phones* handle karte hain.\n\nKoi laptop, WiFi, ya software problem ho toh batao — main help karunga! 💻`;
  }

  // ── 🚫 VPN — WIOM mein use nahi hota ─────────────────────────────────────
  if (/\bvpn\b/i.test(pn)) {
    return `ℹ️ WIOM office mein VPN use nahi hota.\n\nKoi aur IT problem hai? Laptop, WiFi, software — main help karunga!`;
  }

  // ── 🪪 DOOR ACCESS CARD — IT/Admin handles ────────────────────────────────
  if (/\b(access\s*card|door\s*card|entry\s*card|id\s*card|biometric|card\s*nahi|card\s*kaam|card\s*chal|swipe|door\s*nahi\s*khul|gate\s*nahi)\b/i.test(pn)) {
    return `🪪 *Door Access Card Issue*\n\nAccess card IT Admin ke paas se milta/reprogram hota hai.\n\n*Sajan Kumar ko contact karo:*\n📞 9654244281 | 📧 sajan.kumar@wiom.in\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 📱 OFFICE PHONE ISSUE — IT handles company phones ────────────────────
  if (isOfficePhone || (/\b(office\s*phone|company\s*phone|testing\s*phone|wiom\s*phone|diya\s*hua\s*phone)\b/i.test(pn))) {
    return `📱 *Office Phone Issue*\n\nCompany-provided phones IT team handle karti hai.\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 🖨️ PRINTER — distinguish between printing issue vs network access ──────
  if (/\b(printer|print)\b/i.test(pn)) {
    const isNetworkAccess = /\b(dikh\s*nahi|nahi\s*dikh|connect\s*nahi|nahi\s*connect|network|add\s*karo|setup|install|access|nahi\s*aa\s*rha|nahi\s*mil\s*rha|find\s*nahi)\b/i.test(pn);
    if (isNetworkAccess) {
      return `🖨️ *Network Printer Access*\n\nPrinter network pe add karna IT team ka kaam hai — direct access nahi diya ja sakta.\nType karo *ha* — IT ticket raise karta hoon, IT team aapko network printer se connect kar degi 🎫`;
    }
    // Printer visible but not printing → give steps
    return `🖨️ *Printer Issue* — yeh steps try karein:\n\n1. *Printer restart karo* → band karo, 30 sec baad on karo\n2. *Print Spooler restart* → Win+R → \`services.msc\` → Print Spooler → Restart\n3. *Pending jobs clear karo* → Devices & Printers → printer → See what's printing → Cancel all\n4. *Default printer check* → Settings → Bluetooth & devices → Printers → correct printer default set karo\n5. *Driver reinstall* → Device Manager → Printers → Uninstall → Scan for hardware changes\n\nAgar resolve nahi hua, type karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 📽️ HDMI / PROJECTOR — conference room ────────────────────────────────
  if (/\b(hdmi|projector|project|screen\s*share|external\s*screen|external\s*monitor|conference\s*room|meeting\s*room|display\s*nahi|second\s*screen|dual\s*screen|extend\s*display)\b/i.test(pn)) {
    return `📽️ *HDMI/Projector Issue* — yeh steps try karein:\n\n1. *Cable check karo* → HDMI cable properly plugged in dono sides\n2. *Win+P* → "Extend" ya "Duplicate" select karo\n3. *Detect karo* → Settings → System → Display → "Detect" button dabao\n4. *Different HDMI port try karo* → laptop ya projector pe dusra port\n5. *Restart karo* → cable laga ke laptop restart karo\n\nAgar phir bhi nahi hua, type karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 💿 SOFTWARE INSTALLATION REQUEST — needs IT admin, no script can install ──
  // "MS Office install karo", "Teams install", "Zoom install kaise karu" etc.
  // Catches: install, insatll, insatall, intsall, instll and all common install typos
  const isInstallQuery = /install|insatl|insatal|instat|instll|intsall|kaise.*instal|instal.*karo|instal.*karu|naya.*softw|softw.*install/i.test(pn);
  if (isInstallQuery) {
    // Identify what they want to install
    const software =
      /\bms\s*office\b|\bmicrosoft\s*office\b/i.test(pn) ? 'MS Office' :
      /\bteams\b/i.test(pn) ? 'Microsoft Teams' :
      /\bzoom\b/i.test(pn) ? 'Zoom' :
      /\boutlook\b/i.test(pn) ? 'Outlook' :
      /\bchrome\b/i.test(pn) ? 'Google Chrome' :
      /\bword\b|\bexcel\b|\bpowerpoint\b/i.test(pn) ? 'MS Office (Word/Excel)' :
      /\bonedrive\b/i.test(pn) ? 'OneDrive' :
      /\bvpn\b/i.test(pn) ? 'VPN' : 'Software';
    return `💿 *${software} Installation*\n\nSoftware install karne ke liye *admin rights aur valid license key* ki zarurat hoti hai — yeh sirf IT team kar sakti hai.\n\nIT team aapke laptop par aake install kar degi.\nType karo *ha* — abhi IT ticket raise karta hoon 🎫`;
  }

  // ── 🖥️ SCREEN COLOR / DISPLAY DISTORTION / FLICKERING / LINES ──────────────
  // "colorful", "colour", "rang aa rha", "pink/green/yellow screen", "lines on screen",
  // "screen flickering", "horizontal/vertical lines", "distorted", "tint"
  if ((/\b(colorful|colorfull|colarful|colarfull|colour|color|rang\s*aa|pink|green|yellow|purple|red\s*screen|tint|hue|display\s*kharab|screen\s*kharab|screen\s*pe\s*rang|puri\s*screen)\b/i.test(pn) ||
       /distort|flicker|flickring/i.test(pn) ||
       /\blines\s*(aa|on|pe)\b/i.test(pn) ||
       /horizontal\s*lines?|vertical\s*lines?/i.test(pn)) &&
      /\b(screen|display|monitor|laptop)\b/i.test(pn)) {
    return `Screen color/display issue hai. Please yeh steps try karein:\n\n1. *Restart* → Laptop restart karein — sometimes driver glitch hota hai jo restart se theek ho jaata hai\n2. *Display Driver Update* → Win+X → Device Manager → Display adapters → right-click → Update driver → Search automatically\n3. *Display Driver Reinstall* → Device Manager → Display adapters → Uninstall device → Restart (Windows automatically reinstall karega)\n4. *Refresh Rate Check* → Settings → System → Display → Advanced display → Change refresh rate → 60Hz select karein\n5. *External Monitor Test* → HDMI se bahar monitor connect karein — agar bahar sahi dikh raha → laptop screen hardware issue hai\n\nAgar kisi bhi step se resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;
  }

  // ── 💧 WATER / LIQUID DAMAGE — CRITICAL EMERGENCY — check BEFORE generic damage ──
  // "water damage", "paani gira", "liquid spill", "bhig gaya", "chai giri" etc.
  if (/\b(water|liquid|paani|chai|coffee|juice|drink|beverage|spill|bhig|wet|geela|geeli|nami|baarish|rain)\b/i.test(pn) &&
      /\b(laptop|keyboard|device|screen|charger|port)\b/i.test(pn)) {
    return `🚨 *LIQUID/WATER DAMAGE — TURANT YEH KARO:*\n\n1. *ABHI laptop band karo* — power button hold karke force shutdown (agar on hai)\n2. *Charger/cable nikalo* — bijli bilkul nahi lagna chahiye\n3. *Battery nikalo* — agar removable hai\n4. *Ulta karo* — laptop ko seedha neeche karke rakho taaki paani bahar aaye\n5. *Hairdryer mat lagao* — heat se aur damage hoga\n6. *Chalane ki koshish MAT karo* — corrosion hoga\n\n⚠️ *IT Admin ko ABHI call karo: Sajan Kumar — 9654244281*\n\nType karo *ha* — CRITICAL PRIORITY emergency ticket raise karta hoon 🎫`;
  }

  // ── 🔧 PHYSICAL DAMAGE — hardware broken, no software fix possible ────────
  // "damage", "toot gaya", "crack", "phoot gaya" → ticket immediately, NO steps
  if (/\b(damage|damag|damagd|toot|tuti|tuta|phoot|foota|crack|cracked|broken|tod|toda|tod\s*di|giir|gir\s*gaya|gir\s*gayi|physically|physical)\b/i.test(pn)) {
    // Identify which part is damaged (use pn so typos like "leptop" are normalized)
    const part =
      /touchpad|trackpad/.test(pn) ? 'Touchpad' :
      /screen|display|monitor/.test(pn) ? 'Screen/Display' :
      /keyboard/.test(pn) ? 'Keyboard' :
      /laptop/.test(pn) ? 'Laptop' :
      /battery/.test(pn) ? 'Battery' :
      /charging/.test(pn) ? 'Charger' :
      /mouse/.test(pn) ? 'Mouse' : 'Hardware';
    return `🔧 *${part} physically damage hai* — software se yeh fix nahi hoga.\n\nIT team ko bhejte hain, woh physically check karke replace karenge.\nType karo *ha* — main abhi HIGH PRIORITY ticket raise karta hoon 🎫`;
  }

  // ── 🚨 THEFT / LOSS — HIGHEST PRIORITY — check BEFORE anything else ────
  // "chori", "gum", "missing", "stolen", "lost" → NEVER say "resolved"
  if (/\b(chori|cori|churai|churaya|churaye|stolen|theft|gum\s*ho|gum\s*gaya|missing|khoya|khoyi|kho\s*gaya|kho\s*gayi|nahi\s*mila|nahi\s*mili|gum\s*gyi|gum\s*gaya)\b/i.test(pn) &&
      /\b(laptop|device|phone|mobile|tab|bag|charging)\b/i.test(pn)) {
    return `🚨 *URGENT — Laptop Chori/Gum Report*\n\nGhabrao mat — pehle yeh karo:\n\n1. *Apni desk, drawer aur aas-paas ek baar achhe se check karo* — kabhi kabhi nearby reh jaata hai\n2. *Colleagues se puchho* — kisi ne temporarily liya ho sakta hai\n\nAgar phir bhi nahi mila:\n\n3. *IT Admin ko call karo ABHI* → Sajan Kumar: *9654244281*\n4. *HR ko bhi batao* → Formal report ke liye\n\n*Main aapke liye HIGH PRIORITY ticket bana raha hoon.*\nType karo *ha* — main IT Admin ko alert karunga iska ticket banata hoon 🎫`;
  }

  // ── User saying issue is resolved / working fine now ───────────────────
  // STRICT: only if NO negative word present AND message is short status update
  // Fix 1: Added nhai/nha (common typos of nahi that users actually type)
  const hasNegative = /\b(not|nahi|nahin|nai|nhi|mahi|nhai|nha|mat|na\b|band|kharab|problem|issue|error|chal nahi|kaam nahi|nahi chal|nahi ho|ho nahi|abhi bhi|still|phir bhi|chal nahi|nai chal|mahi chal|nhai chal|ho nahi rha|nahi ho rha|nahi rha)\b/i.test(pn);
  // "chal raha hai" ONLY counts as positive if NOT preceded by nahi/mahi/na etc.
  const chalRahaPositive = /chal\s*raha\s*hai|chal\s*rhi\s*hai/.test(pn) && !/(\bmahi\b|\bnahi\b|\bnai\b|\bnhi\b|\bnot\b).{0,15}chal/i.test(pn);
  // IMPORTANT: "ho gya" / "ho gaya" alone are too vague — only count if paired with fix/solve/theek/sahi
  // "chori ho gya" / "kharab ho gya" must NOT trigger resolved → removed bare "ho gaya/ho gya" from list
  const hasPositive = chalRahaPositive || /\b(normal|noraml|norml|theek|thik|sahi|fixed|resolved|kaam kar raha|solve ho|fix ho gaya|sahi ho gaya|theek ho gaya|thik ho gaya|chal gaya|chal gyi|on ho gaya|work kar raha|charged|charge ho|connect ho gaya|sorted|done|complete|ho gayi|mil gaya|mil gayi)\b/i.test(pn);
  if (hasPositive && !hasNegative && pn.split(/\s+/).length <= 8) {
    return `Glad to hear it is resolved. ✅ Feel free to reach out if anything else comes up.`;
  }

  // ── Identity questions — broad match, instant reply, no AI needed ───────
  const isIdentityQ =
    /^(kise\s*hai|kise\s*ho|tum\s*kise\s*ho|aap\s*kise\s*ho|tum\s*kaun\s*ho|aap\s*kaun\s*ho|kaun\s*ho|kaun\s*hain|kaun\s*hai|tum\s*kya\s*ho|aap\s*kya\s*ho|kya\s*ho\s*tum|kya\s*hain\s*aap|what\s*are\s*you|who\s*are\s*you|bot\s*hai\s*kya|kya\s*tum\s*bot|are\s*you\s*a\s*bot|introduce|apna\s*parichay|apne\s*bare\s*mein\s*batao)\s*\??$/i.test(pn.trim()) ||
    /\b(kise|kaun)\s*(ho|hain|hai)\b/i.test(pn) && pn.split(/\s+/).length <= 5;
  if (isIdentityQ) {
    return `I am *Zivon* — WIOM IT Support Assistant.\nI can help with laptop, WiFi, software, and account issues.\nPlease describe your issue and I will assist you.`;
  }

  // ── Ticket status / ETA questions (typo-tolerant: tiket/tikket/ticket) ──
  const pTicket = pn.replace(/ti+ke+t/gi, 'ticket');
  if (/ticket\s*(kab|kb|kab\s*tak|kab\s*solve|kab\s*hoga|kab\s*fix|status|update|progress|ho\s*gaya|hua\s*kya|abhi\s*tak|kyun\s*nahi|pending)/i.test(pTicket) ||
      /kab\s*tak\s*(hoga|milega|fix\s*hoga|solve\s*hoga|resolve)/i.test(pTicket) ||
      /mera\s*ticket\s*(kab|solve|fix|hoga|ho\s*ga)/i.test(pTicket)) {
    return `Aapka ticket IT team ke paas hai! 📋 Usually same day resolve hota hai — priority ke hisaab se.\nStatus dekhne ke liye type karo: *my tickets* 👀\nUrgent hai toh batao, main priority mark kar deta hoon! 🎫`;
  }

  // ── WiFi password — strict match only (pn handles wiffi typo) ───────────
  const isWifiPassword =
    /wifi\s*(ka|ke|ki)?\s*(password|pass|pwd|pasword|passward)/i.test(pn) ||
    /password\s*(wifi|wi-fi|wiom|network)/i.test(pn) ||
    /^(wifi|wi-fi|network)\s*(password|pass|pwd)\s*\??$/i.test(pn.trim()) ||
    /^(pass|pwd|password)\s*\??$/i.test(pn.trim()) ||
    /network\s*ka\s*pass/i.test(pn) ||
    /office\s*(wifi|network|wi-fi)\s*(password|pass)/i.test(pn);

  if (isWifiPassword) {
    return `WiFi Password! 📶\n\n🔑 *Password:* \`spartans500\` — sabhi networks ke liye same\n\n*Networks:*\n• Wiom office 5g-Test — Ground floor\n• Wiom office Guest\n• Wiom office 3rd floor\n• Wiomnet — Saket office *(Password: \`Password@12345\`)*\n\nHo gaya? Batao! 😊`;
  }

  // ── Instant KB answers — Zivon tone, no Step 1/2/3 ─────────────────────
  // MATCHING RULES:
  //   - Multi-word keys (contains space): exact substring match in pn
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

  // ── Laptop won't start / turn on / boot ─────────────────────────────────
  // "laptop on nahi ho rha", "leptop start nahi ho rha", "boot nahi ho rha", "khulta nahi"
  if (/\blaptop\b.*(on\s*nahi|start\s*nahi|band\s*ho|nahi\s*chalta|khulta\s*nahi|nahi\s*khulta|chal\s*nahi|chalti\s*nahi|chalte\s*nahi|nahi\s*chal\s*rh)|boot\s*nahi|(switch|power)\s*on\s*nahi|\blaptop\b.*(nahi\s*(chal|start|on|boot)|on\s*ho\s*nahi)|on\s*nahi\s*ho\s*rh/.test(pn))
    return `Laptop on nahi ho raha — yeh ek common boot issue hai. Please yeh steps follow karein:\n\n1. *Force Restart* → Power button 10 sec hold karein → band ho jaayega → dobara on karein\n2. *Charger Check* → Charger lagao aur 5 min wait karein (battery low ho sakti hai) → phir on karein\n3. *Battery Reset* → Charger nikaal lo → Power button 30 sec hold karein → charger lagao → on karein\n4. *Power Drain* → Charger nikaal lo → Power button 60 sec hold karein → charger lagao → on karein\n5. *Safe Mode* → On karte waqt F8 ya Shift+F8 press karein → Safe Mode select karein\n\nAgar kisi bhi step se resolve nahi hua, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // ── Overheating ──────────────────────────────────────────────────────────
  // "laptop bahut garam ho rha", "laptop heat ho rha", "laptop garm hai", "zyada heat"
  if (/\blaptop\b.*(garm|garam|heat|hot\b)|garm.{0,10}laptop|(overheat|over\s*heat|bahut\s*garam|bahut\s*garm|zyada\s*heat|zyada\s*garm|laptop\s*garm)/.test(pn))
    return `Laptop overheating issue hai. Please yeh steps follow karein:\n\n1. *Hard Surface* → Laptop ko table par rakhein — bed/sofa par mat rakhein (vents block hote hain)\n2. *Heavy Apps Band Karein* → Ctrl+Shift+Esc → Task Manager → CPU column sort karein → heavy apps End Task karein\n3. *Power Mode* → Settings → Power & battery → Power mode → Balanced select karein\n4. *Restart* → Laptop restart karein — background processes band ho jaate hain\n5. *Vents Check* → Laptop ke vents (sides/bottom) pe dust toh nahi — taaki airflow ho sake\n\nAgar bahut zyada garam ho raha hai ya band ho raha hai, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // ── Screen black / blank / nothing visible ───────────────────────────────
  // "screen kali ho gyi", "black screen aa gya", "screen pe kuch nahi dikh rha", "monitor black hai"
  if (/screen\s*(kali|kala|black|blank|kuch\s*nahi\s*dikh|pe\s*kuch\s*nahi)|black\s*screen|kali\s*screen|monitor\s*(black|kala|kali|blank)|display\s*(black|kali|blank|nahi\s*aa)|(nahi\s*dikh|dikhna\s*band)\s*(rha|rhi|raha)/.test(pn))
    return `Black/blank screen issue hai. Please yeh steps follow karein:\n\n1. *Brightness Keys* → Fn+F5 ya Fn+F8 press karein (brightness keys) — screen dim ho sakti hai\n2. *Force Restart* → Power button 10 sec hold karein → band karein → dobara on karein\n3. *External Monitor Test* → HDMI cable se bahar monitor connect karein — agar bahar dikh raha toh laptop screen hardware issue hai\n4. *Charger Check* → Battery completely dead ho sakti hai → charger lagao → 10 min wait karein → on karein\n\nAgar ab bhi screen nahi aa rahi, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // ── Windows / OS crash / restart loop / update stuck ────────────────────
  // "windows crash ho gaya", "windows restart ho rha bar bar", "windows update atak gaya/stuck"
  if (/windows\s*(crash|restart|update|stuck|atak|loop|hang)|update\s*(stuck|atak|hang|nahi|ruka)|restart\s*(bar\s*bar|baar\s*baar|loop|hota\s*rha|ho\s*rha\s*bar)|os\s*(crash|hang|stuck)/.test(pn))
    return `Windows/OS issue hai. Please yeh steps follow karein:\n\n1. *Force Restart* → Power button 10 sec hold karein → band karein → dobara on karein\n2. *Update Wait* → Agar update chal rahi hai → wait karein, band mat karein\n3. *Startup Repair* → On karte waqt F8 press karein → "Repair Your Computer" → Startup Repair\n4. *Last Known Good* → F8 menu → "Last Known Good Configuration" select karein\n5. *Safe Mode* → F8 → Safe Mode with Networking → login karein\n\nAgar 3 baar se zyada restart ho raha hai, please type karein *ha* — IT ticket raise kar deta hoon 🎫`;

  // Fan noise/sound (fan IS running but making noise — NOT an emergency)
  // This only runs if hasPositive check above did NOT return (i.e., user is NOT saying "fixed")
  if (/fan\s*(sound|awaaz|baj|noise|shor|loud|kar\s*rha|chal\s*rha|aa\s*rhi)/i.test(pn) ||
      /\bfan\s+(kar|chal|baj|sound)/i.test(pn)) {
    return `Fan ki awaaz aa rahi hai — usually heavy apps se hota hai 🔊\nCtrl+Shift+Esc dabao → CPU column sort karo → koi heavy app End Task karo.\nLaptop hard surface pe rakhho (table pe, bed/sofa pe nahi).\nThodi der mein band ho jaaye toh theek hai. Agar bahut tez awaaz ho ya nahi ruki toh batao 🎫`;
  }

  // Fan emergency — fan NOT working at all (safety critical — instant response)
  if (/fan\s*(nahi\s*chal|band|kaam\s*nahi|not\s*work|chal\s*nahi)/i.test(pn)) {
    return `Fan nahi chal raha — laptop abhi band karo aur charger nikaal do ⚠️ Hardware damage ho sakta hai. Type karo *ha*, ticket abhi bhejta hoon 🎫`;
  }

  // Virus (urgent — must be instant)
  if (/\b(virus|malware|ransomware|hack)\b/i.test(pn)) {
    return `Abhi Windows Security → Virus & threat protection → Quick Scan karo 🦠 Kuch suspicious mila? Internet band karo aur type karo *ha* — IT ko turant batata hoon 🎫`;
  }

  return null; // Everything else → Claude handles with follow-up questions
};

module.exports = { chat, chatStream, quickReply, getKBAnswer };

