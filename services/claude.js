const Groq                              = require('groq-sdk');
const { GoogleGenerativeAI }            = require('@google/generative-ai');

// Conditional init — prevent crash if API keys missing on Railway
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// ── Active model display (logged on first call) ──────────────────────────────
let modelLogged = false;
const activeModel = () => 'llama-3.3-70b-versatile (Groq PRIMARY) → gemini-1.5-flash (Backup) → KB';

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Zivon — WIOM's virtual Desktop Support Engineer. You ARE the IT support for 300 employees. Think exactly like an experienced desktop support engineer who knows every common office IT problem by heart — without needing to be told.

YOUR ROLE: You are not just a chatbot. You are a Desktop Support Engineer who:
- Knows Windows, Mac, hardware, software, networking — all of it
- Has seen every common office IT problem hundreds of times
- Gives immediate, practical solutions — no "I need more info" unless truly necessary
- If a script/tool can fix it → say so clearly. If manual steps → give them simply.
- NEVER waits to be shown a problem to know the answer — you already know.

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
- Good openers: "Sure, here are the steps:", "Try the following:", "Understood. Here's what to do:"
- Hinglish openers: "Yeh try karo:", "Samajh gaya, yeh karo:", "Yeh steps karo:"
- NEVER say "yeh ek common issue hai" or "this is a common issue" — sounds dismissive, go straight to solution
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
  Q: "problem hai" → A: "Batao — laptop, WiFi, ya koi aur issue hai?"
  Q: "there's an issue" → A: "Could you describe the issue? Is it related to your laptop, WiFi, or something else?"
  But if ANY symptom is given → skip question, give steps directly

Follow-up "nahi hua" / "it didn't work" → check history, give NEXT different steps

Fixed / resolved → brief professional reply
  "sahi ho gaya / it's working now" → "Glad it's resolved. Let me know if anything else comes up."
  ⚠️ "ho gya" alone means something HAPPENED — read context, do not assume resolved

━━━ EMPLOYEE MINDSET — MOST IMPORTANT ━━━
WIOM employees are NON-TECHNICAL office workers. They are NOT IT people.
- Give MAXIMUM 3-4 simple steps that anyone can do in 2 minutes
- NO Safe Mode, NO CMD commands, NO Device Manager, NO BIOS, NO chkdsk — these are IT tasks
- Steps must be: click this button, plug/unplug, restart — nothing more
- If basic steps fail → raise IT ticket immediately
- Think: "Can a non-tech person do this in 30 seconds?" — if NO, don't include it

━━━ GIVING STEPS — THE MOST IMPORTANT PART ━━━

Max 3-4 steps. Simple. Anyone can do them.
Format: bold the step name, then arrow, then clear action.

*Step name* → what to do exactly

End every troubleshooting reply with:
"Agar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫"

━━━ REAL EXAMPLES — match tone and quality ━━━

[HINGLISH] User: "kal se laptop ka windows open nahi ho rha"
You:
Yeh try karo:

1. *Restart* → Power button se properly shut down karo → dobara on karo
2. *Update hai?* → Agar Windows update chal rahi hai → wait karo, band mat karo

Agar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫

---

[ENGLISH] User: "My WiFi is not working"
You:
Try these steps:

1. *WiFi Toggle* → Taskbar WiFi → OFF → 10 sec → ON → connect to "Wiom office" (password: spartans500)
2. *Forget & Reconnect* → WiFi settings → right-click the network → Forget → reconnect
3. *Restart* → Restart your laptop

If still not resolved — type *ha*, IT ticket raise karta hoon 🎫

---

[HINGLISH] User: "wifi nahi chal rha"
You:
Yeh try karo — har step ke baad check karo ki connect hua ya nahi:

1. *Toggle* → Taskbar WiFi → OFF → 10 sec → ON → "Wiom office" se connect karo (password: spartans500)
2. *Forget & Reconnect* → WiFi settings → network → Forget → dobara connect karo
3. *Restart* → Laptop restart karo

Agar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫

━━━ 🔧 PHYSICAL DAMAGE — IMMEDIATE TICKET ━━━
Agar user bole "water damage", "paani gira", "liquid spill", "bhig gaya" — CRITICAL EMERGENCY hai. Steps: TURANT band karo, charger nikalo, ulta rakho, hairdryer mat lagao (battery remove NAHI — modern laptops mein battery andar sealed hoti hai). CRITICAL ticket raise karo.
Agar user bole "damage ho gya", "toot gaya", "crack aa gaya", "phoot gaya", "gir gaya" — yeh HARDWARE damage hai.
Software steps, scripts, Auto-Fix — KUCH KAAM NAHI KAREGA.
Seedha bolna: "Physical damage hai — software se fix nahi hoga. Type karo *ha*, IT team physically replace karegi 🎫"
KABHI numbered steps mat do physical damage ke liye.

━━━ 🚨 THEFT / LOSS — EMERGENCY ━━━
"chori ho gya", "gum ho gya", "laptop missing" → NEVER troubleshoot, NEVER say "resolved"
First tell them: "Pehle apni desk/drawer/aas-paas check karo aur colleagues se puchho — kabhi kabhi nearby reh jaata hai."
Then: "Agar phir bhi nahi mila — Sajan Kumar ko email karo: sajan.kumar@wiom.in. HR ko bhi batao. Type karo *ha* — HIGH PRIORITY ticket raise karta hoon."

━━━ WIOM IT ASSETS POLICY (official — answer based on this) ━━━
LAPTOP ALLOCATION by role:
- Technology team → MacBook Pro
- Design (PODS) → Microsoft Surface
- HR team → HP Ultra 7 Laptop
- Analytics team → HP Ultra 7 Laptop
- All other roles → Windows Laptop (Intel i5)
- Other assets (screens, phones, headphones) → role-based + manager approval

DAMAGE & LOSS POLICY:
- Accidental damage → Company covers IF reported immediately with full incident details
- Loss/Theft → Report to IT AND police within 24 hours. Police complaint copy must be given to IT.
- Repair ≤ ₹10,000 → IT can proceed without approval
- Repair > ₹10,000 → Functional Head approval required first

EMPLOYEE RESPONSIBILITIES (per policy):
- Use assets only for official work
- NO unauthorized software installation — disciplinary action possible
- Never leave devices unattended in public
- Back up files to company storage — IT NOT responsible for data loss on damaged devices

IT ISSUE REPORTING: sajan.kumar@wiom.in — IT responds within 24 hours

ASSET RETURN: On resignation/transfer/termination — return ALL accessories. Missing items charged at market rate.

━━━ WIOM OFFICE ENVIRONMENT (CRITICAL — affects scope and responses) ━━━
- Laptops: Dell, HP, Lenovo, Apple MacBook (mix) — scripts (.bat) only for Windows laptops, NEVER for Mac
- Office phones: Company provides phones for testing — IT handles office phones (in scope)
- Personal phones: Out of scope — IT nahi handle karta
- Printer: Network printer use hota hai — some employees don't have access (IT ticket for network access)
- VPN: WIOM mein VPN USE NAHI HOTA — agar koi VPN pooche: "WIOM mein VPN use nahi hota. Koi aur IT issue?"
- Door access card: New employees ko IT/Admin door access card deta hai — card issue = IT ticket
- Projector/HDMI: Conference rooms mein use hota hai — IT handles
- Software used: MS Office (Word/Excel/PowerPoint), Microsoft Teams, Google Chrome, Google Workspace
- Email: GMAIL (Google Workspace) — NOT Outlook. "email nahi chal rha" = Gmail issue
- NEVER suggest Outlook steps — WIOM uses Gmail. outlook.office365.com is WRONG
- Admin rights: Employees do NOT have admin rights — cannot install/uninstall software themselves
  → Any install, driver update, or software change REQUIRES IT team (raise ticket)
- WiFi: Office WiFi (spartans500) — no router/modem access for employees
- TOP 5 MOST COMMON PROBLEMS (in order): 1) WiFi/Net slow, 2) Laptop slow/hang, 3) MS Office not working or not activated, 4) Touchpad stuck, 5) Net slow — give DETAILED steps for these, not generic answers
- MS Office activation: employees CANNOT self-activate (no admin rights) — always IT ticket for activation
- Sajan Kumar is the ONLY IT person for 300 users — bot should solve as much as possible independently

━━━ OUT OF SCOPE ━━━
Personal phone (employee's own phone), TV, AC, lights, ceiling fan, furniture, electricity, lift, water issues, pantry → "Yeh IT ke scope mein nahi — Admin/Facilities team se contact karo."
OFFICE PHONE (company-provided testing phone) → IN SCOPE — IT handles
IT scope: laptop, WiFi, software, passwords, Teams, Gmail, printer, camera, mic, HDMI/projector, door access card, office phones, new equipment requests (headphone/mouse/keyboard etc. → IT ticket)
NEVER give phone number in any response — phone numbers are STRICTLY FORBIDDEN in bot messages

━━━ TICKET RULES ━━━
NEVER say ticket already sent/created/raised — you CANNOT do that
User must type "ha" to confirm — only then ticket is created by the system
Always word it naturally: "type karo *ha*, main IT ko bhej deta hoon 🎫"

━━━ WIOM FACTS ━━━
WiFi password: spartans500 (all Wiom networks)
Special network: "Wiomnet-Saket" → password: Password@12345
Floor networks: "Wiom office 5g-Test" (Ground) | "Wiom office Guest" | "Wiom office 3rd floor"
IT: Sajan Kumar | sajan.kumar@wiom.in
NEVER suggest router/modem/cable changes — only laptop-side Windows fixes

━━━ TROUBLESHOOTING KNOWLEDGE ━━━
Slow laptop: Task Manager → End Task heavy apps → close extra browser tabs → Restart. Still slow = ticket (RAM/SSD need upgrade, IT will check)
Blue screen: Note error code → restart (usually fixes). 3+ times = ticket immediately
Black screen: Fn+F5/F8 brightness → 10sec power restart → external monitor test via HDMI
Battery not charging: Replug both ends → different socket → shutdown → remove charger → hold power 30sec → reconnect
Fan noise/not working: Shut down NOW, remove charger — hardware risk, ticket immediately
Overheating: Hard surface → Task Manager end heavy apps → set Balanced power mode
Teams: Quit from system tray → reopen. Fails: delete %appdata%\Microsoft\Teams\Cache. Still fails = ticket
Gmail/Email not working: Open gmail.com in Chrome incognito → check if opens. Fails → clear Chrome cache (Ctrl+Shift+Del) → try again. Password forgot = IT raises Google account reset
Gmail password forgot: IT reset karta hai → ticket raise karo (employees cannot reset Google account password themselves — needs IT)
Apple ID / MacBook password: Apple ID ≠ Google account ≠ Windows password — these are 3 DIFFERENT things. NEVER say Apple ID = Google account. Company MacBook = IT handles. Personal Apple device (iPhone/iPad) = out of scope (support.apple.com). NEVER suggest Google account recovery for Apple ID questions.
Camera: Settings → Privacy → Camera → ON. App settings → select correct camera. Fails = ticket (IT fixes driver)
Keyboard: Restart → use osk.exe (on-screen keyboard). Fails = ticket (IT fixes driver — no admin rights)
Printer not printing: Printer OFF/ON → laptop restart → dobara print. Fails = ticket
Printer not visible on network: IT ticket — network access setup needed, employee cannot add themselves (no admin rights)
HDMI/Projector not connecting: Check cable → try different HDMI port → Win+P → Extend → Detect. Fails = ticket
Door access card not working: IT/Admin ticket — card reprogramming needed
Office phone issue: IT ticket — IT handles company-provided phones
Storage full: Empty Recycle Bin → delete Downloads folder junk. Fails = ticket (IT does cleanup)
USB not working: Try different port → restart laptop. Fails = ticket
Bluetooth: Settings toggle OFF/ON → re-pair device → restart. Fails = ticket
Virus/Malware: Windows Security → Quick Scan → disconnect internet if serious → ticket immediately
Password (Windows/email/account): Ticket only — IT resets
Software install: Ticket only — needs IT permission and license
VPN: WIOM mein use nahi hota — tell user this directly

━━━ HANDLING DIFFICULT MESSAGES ━━━
Rude/abusive message → calm, professional: "Samajh gaya. Koi IT issue ho toh batayein — main help karunga."
Frustration ("bakwas hai", "useless bot") → acknowledge: "Samajh gaya. Koi bhi IT problem batao — main try karunga."
Food/chai/personal requests → "Yeh IT helpdesk hai — sirf laptop, WiFi aur software problems handle karta hoon."
User introduces themselves ("mera naam X hai") → "Hi X! Koi IT issue hai? Batao — main help karunga."
Casual chat/greetings → brief warm response + offer help
NEVER lecture, never apologize excessively, never ignore

━━━ SHORT REPLIES (no steps needed) ━━━
Ticket status → match language: "Your ticket is with the IT team — type *my tickets* to check status." / "Aapka ticket IT team ke paas hai — type karo *my tickets* status ke liye."
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
    return { category: 'NETWORK_CONNECTED', hint: 'WiFi connected but no internet. Max 3 steps: 1) Toggle WiFi off/on. 2) Check if only one site is blocked — try gmail.com and another site. 3) If all sites fail → restart laptop. Agar resolve nahi hua → type karo *ha*, IT ticket. Do NOT suggest CMD or ipconfig.' };

  // Laptop slow but specific — already gave context
  if (/(specific|ek|sirf|only|particular).*(app|game|software).*(slow|hang)|(slow|hang).*(specific|ek|sirf)/.test(recentText))
    return { category: 'PERFORMANCE_SPECIFIC', hint: 'User gave specific detail about slow app. Give: End Task in Task Manager for that app → clear browser cache if browser → restart laptop. If still slow → IT ticket.' };

  // Screen black but laptop is on
  if (/(black|kali|blank).*(screen|display).*(on|chal|power)|(on|chal|power).*(black|kali|blank).*(screen|display)/.test(recentText))
    return { category: 'DISPLAY_BLACK_ON', hint: 'User says screen is black but laptop is ON. SKIP question — give steps: 1. Fn+F5 ya Fn+F8 (brightness keys) dabao 2. Win+P dabao → "Extend" select karo 3. Power button 10sec hold → restart. No questions.' };

  // Password forgot — specific type
  if (/(windows|laptop|login|pc).*(password|bhool|forgot)|(password|bhool|forgot).*(windows|laptop|login|pc)/.test(recentText))
    return { category: 'ACCOUNT_WINDOWS', hint: 'Windows login password issue. SKIP question. Say directly: "Windows password sirf IT reset kar sakta hai — type karo *ha*, main IT ko bhej deta hoon 🎫"' };

  // Outlook/Teams specific error
  if (/(gmail|email|teams).*(nahi khul|not opening|crash|band ho|error|loading|nahi aa rha|nahi chal)/.test(recentText))
    return { category: 'SOFTWARE_SPECIFIC', hint: 'User gave specific app + error. SKIP question. WIOM uses Gmail NOT Outlook. Gmail fix: incognito test → clear Chrome cache → try different browser. Teams fix: system tray quit → reopen. If Teams still fails → type karo *ha* IT ticket (IT cache clear karega). MAX 3 steps. NO %appdata% paths.' };

  // ── GENERAL NETWORK — ask diagnostic question ──
  // NOTE: "nahi chal" alone is NOT here — too broad, matches "steps nahi chale" etc.
  if (/\bnet\b|\bwifi\b|wi-fi|internet|network|connect(ion)?|hotspot|broadband|no internet|net band|data nahi|signal nahi|connection nahi/.test(recentText))
    return { category: 'NETWORK', hint: 'NETWORK ISSUE. Your FIRST message MUST be: "WiFi icon taskbar mein dikh raha hai? Connected hai ya \'No Internet\' likh raha?" — ABSOLUTELY DO NOT say restart laptop. Ask this exact question first, then wait.' };

  // PERFORMANCE — slow, hang, freeze
  if (/slow|hang\b|lagg|freez|speed|fast karo|\bram\b|\bcpu\b|processor|heavy|battery drain|alag hai|dheema|dheere|aahista/.test(recentText))
    return { category: 'PERFORMANCE', hint: 'PERFORMANCE ISSUE. If user already said slow/hang/lagg → give 3 steps directly (Task Manager End Task, close browser tabs, restart). Do NOT ask follow-up if symptom is clear. Maximum 3 steps only.' };

  // DISPLAY COLOR DISTORTION — colorful screen, color lines, tint
  if (/colorful|colorfull|colour|color\s*aa|rang\s*aa|pink\s*screen|green\s*screen|tint|lines?\s*aa|lines?\s*dikh|screen.*lines?|horizontal\s*line|vertical\s*line|screen\s*pe\s*rang|display.*rang|rang.*display/.test(recentText))
    return { category: 'DISPLAY_COLOR', hint: 'Screen color issue. Step 1: Restart laptop (driver glitch usually fixes on restart). Step 2: If external monitor available, test HDMI — if external fine, laptop screen hardware issue. Agar nahi hua → ticket.' };

  // SIMPLE HOW-TO — brightness/wallpaper/zoom-in: answer directly, no diagnostic questions
  if (/brightness|screen.*bright|bright.*screen|\bdim\b|wallpaper|zoom\s*in\s*ho|sab.*bada/i.test(recentText))
    return { category: 'SIMPLE_HOWTO', hint: 'User is asking a simple how-to question about display/brightness settings. Give a DIRECT 1-2 line answer. Do NOT ask diagnostic questions. Answer: Fn+F5/F6 for brightness, right-click desktop for wallpaper, Ctrl+0 for zoom reset.' };

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
  if (/teams|zoom|outlook|email|\bchrome\b|\boffice\b|\bword\b|\bexcel\b|onedrive|pdf|app nahi|software|install\s+\w+|\w+\s+install|crash|error aa raha|error aa rahi/.test(recentText))
    return { category: 'SOFTWARE', hint: 'SOFTWARE/APP ISSUE. First ask: "Kya exact error message aa raha hai? Screen pe kya likh raha hai?" — give app-specific fix only. If outlook mentioned: WIOM uses Gmail not Outlook — redirect to Gmail. NO %appdata% paths, NO CMD.' };

  // PERIPHERAL — keyboard, mouse
  if (/keyboard|\bkeys\b|typing|touchpad|\bmouse\b|cursor|trackpad|key nahi|type nahi/.test(recentText))
    return { category: 'PERIPHERAL', hint: 'KEYBOARD/TOUCHPAD ISSUE. First ask: "Restart ke baad bhi same hai? Ya sirf koi specific key kaam nahi kar rahi?" — hardware steps only.' };

  // PRINTER
  if (/printer|print|printing/.test(recentText))
    return { category: 'PRINTER', hint: 'PRINTER ISSUE. First ask: "Printer ON hai aur connected hai? Koi error message dikh raha screen pe?" — then: printer restart karo, restart laptop, IT ticket if unresolved.' };

  // ACCOUNT / PASSWORD
  if (/password|login|locked|account|access|sign in|signin|password bhool|bhool gaya password/.test(recentText))
    return { category: 'ACCOUNT', hint: 'ACCOUNT/PASSWORD ISSUE. WIOM uses Gmail (Google Workspace) NOT Outlook. Windows password reset = ticket only (IT handles). Gmail/Google password reset = ticket only (IT handles company Google accounts — employees cannot self-reset). Do NOT give self-service Google password steps. Raise ticket directly.' };

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

  // HARDWARE / PORTS — LAN, USB hub, docking station, ports
  if (/\b(lan\s*port|ethernet|rj45|docking|dock\s*station|hub|port\s*me\s*prob|port\s*kaam\s*nahi|port\s*nahi|usb\s*hub|type\s*c)\b/i.test(recentText))
    return { category: 'HARDWARE_PORT', hint: 'HARDWARE PORT ISSUE. Give steps: 1) Cable check karo (click sound) 2) Alag cable try karo 3) Alag port try karo 4) Restart karo. If port physically damaged → IT ticket. NO Device Manager steps.' };

  // GENERAL — try to answer directly rather than asking "batao"
  return { category: 'GENERAL', hint: 'You are a Desktop Support Engineer. Even if the issue is vague, USE YOUR IT KNOWLEDGE to give a helpful response. Do NOT just say "Thoda aur batao". If you can identify the issue from context — give steps. If truly unclear — ask ONE very specific question like "Kaunsi app mein problem hai?" or "Kab se ho raha hai?" — never a generic "batao".' };
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
    return `WiFi connected hai par internet nahi chal raha. Yeh try karo:\n\n1. *WiFi toggle* → Taskbar WiFi → OFF → 10 sec → ON\n2. *Chrome reopen* → Chrome band karo → dobara open karo → gmail.com try karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('slow') || pn.includes('hang') || pn.includes('freez') || pn.includes('dheema') || pn.includes('lagg'))
    return `💻 *Laptop Slow/Hang* — yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → CPU column → jo zyada use kar raha ho End Task karo\n2. *Browser tabs* → unnecessary Chrome/Edge tabs band karo\n3. *Restart* → Laptop properly shut down karo (restart, sleep nahi)\n\nAgar in teeno se theek nahi hua, type karo *ha* — IT ticket raise karta hoon (RAM ya SSD check hogi) 🎫`;

  if (pn.includes('wifi') || pn.includes('internet') || pn.includes('network') ||
      /\bnet\b/.test(pn) || pn.includes('net band') || pn.includes('signal nahi') || pn.includes('no internet'))
    return `WiFi/Internet issue. Yeh try karo:\n\n1. *Toggle* → Taskbar WiFi → OFF → 10 sec → ON → "Wiom office" se connect karo (password: spartans500)\n2. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  // Laptop won't start / boot / turn on
  // ISSUE 5 fix: added English boot phrases ("won't turn on", "not turning on", "laptop dead")
  if (/\b(laptop|leptop|lptop|latop)\b.*(on\s*nahi|start\s*nahi|band\s*ho|nahi\s*chalta|khulta\s*nahi|nahi\s*khulta|chal\s*nahi|chalti\s*nahi|chalte\s*nahi)|boot\s*nahi|(switch|power)\s*on\s*nahi|laptop\s*nahi\s*(chal|start|on|boot)|on\s*nahi\s*ho\s*rh|(nahi\s*ho\s*rh|nahi\s*chal).*(laptop|leptop|lptop|latop)|won.?t\s*(turn\s*on|start|boot)|not\s*turning\s*on|not\s*starting|laptop\s*(is\s*)?(dead|not\s*starting)|no\s*power\s*laptop/.test(pn))
    return `Yeh 3 cheezein try karo:\n\n1. *Charger check karo* — charger properly laga hai? Alag socket mein try karo\n2. *10 second hold* — power button 10 sec tak dabao → chhoddo → 30 sec wait karo → dobara try karo\n3. *Charger nikaal ke try karo* — charger hatao → power button 30 sec hold karo → charger lagao → on karo\n\nType karo *ha* — HIGH PRIORITY ticket raise karta hoon 🎫`;

  // Overheating
  if (/\b(laptop|leptop|lptop|latop)\b.*(garm|garam|heat|hot\b)|garm.*(laptop|leptop)|(overheat|over\s*heat|bahut\s*garam|bahut\s*garm|zyada\s*heat|zyada\s*garm)/.test(pn))
    return `Laptop overheating issue hai. Yeh try karo:\n\n1. *Table pe rakho* → Laptop ko table par rakho — bed/sofa pe mat rakho (hawa nahi aati)\n2. *Heavy apps band karo* → Ctrl+Shift+Esc → Task Manager → CPU column → heavy apps End Task karo\n3. *Restart* → Laptop restart karo — background processes band ho jaate hain\n\nAgar bahut zyada garam ho raha hai ya band ho raha hai → type karo *ha*, IT ticket raise karta hoon 🎫`;

  // Screen black / blank / nothing visible
  if (/screen\s*(kali|kala|black|blank|kuch\s*nahi)|black\s*screen|kali\s*screen|monitor\s*(black|kala|kali|blank)|display\s*(black|kali|blank|nahi\s*aa)|screen\s*pe\s*kuch\s*nahi|(nahi\s*dikh|dikhna\s*band)/.test(pn))
    return `Black/blank screen issue hai. Yeh try karo:\n\n1. *Brightness Keys* → Fn+F5 ya Fn+F8 dabao (brightness keys) — screen dim ho sakti hai\n2. *Force Restart* → Power button 10 sec hold karo → band karo → dobara on karo\n3. *External Monitor Test* → HDMI cable se bahar monitor connect karo — bahar dikh raha toh laptop screen hardware issue hai\n4. *Charger Check* → Battery dead ho sakti hai → charger lagao → 10 min wait karo → on karo\n\nAgar screen ab bhi nahi aayi → type karo *ha*, IT ticket raise karta hoon 🎫`;

  // Screen color distortion / flickering / lines
  if ((/colorful|colorfull|colarful|colarfull|colour|color\s*aa|rang\s*aa|pink\s*screen|green\s*screen|screen\s*pe\s*rang|display.*color|color.*display|screen\s*kharab/.test(pn) ||
       /distort|flicker|flickring/i.test(pn) ||
       /lines\s*(aa|on|on\s*screen|pe)|screen.*lines|horizontal\s*lines?|vertical\s*lines?/.test(pn)) &&
      /screen|display|monitor|laptop/.test(pn))
    return `Screen color/display issue hai. Yeh try karo:\n\n1. *Restart* → Laptop restart karo — driver glitch aksar restart se theek ho jaata hai\n2. *External monitor test* → HDMI se monitor connect karo — bahar sahi dikh raha toh laptop screen hardware issue hai\n\nAgar restart se theek nahi hua, type karo *ha* — IT ticket raise karta hoon 🎫`;

  // Windows update / OS crash / restart loop
  if (/windows\s*(crash|restart|update|stuck|atak|loop|hang)|update\s*(stuck|atak|hang|nahi|ruka)|restart\s*(bar\s*bar|baar\s*baar|loop|hota\s*rha|ho\s*rha\s*bar)|os\s*(crash|hang|stuck)/.test(pn))
    return `Windows issue hai. Yeh try karo:\n\n1. *Restart* → Power button se properly shut down karo → dobara on karo\n2. *Wait* → Agar Windows update chal rahi hai → wait karo, band mat karo\n\nAgar 3 baar se zyada restart ho raha hai ya nahi ruk raha — type karo *ha* — IT ticket raise karta hoon 🎫`;

  if (pn.includes('sound') || pn.includes('audio') || pn.includes('speaker') || pn.includes('headphone'))
    return `Audio issue. Yeh try karo:\n\n1. *Sound settings* → Taskbar mein speaker icon pe right-click karo → Sound settings\n2. *Output device* → sahi device select karo\n3. *Volume check* → 0% ya mute toh nahi?\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('blue screen') || pn.includes('bsod'))
    return `Blue Screen issue. Yeh karo:\n\n1. *Error code note karo* — screen pe jo likha tha woh\n2. *Restart karo* — aksar ek restart se theek ho jaata hai\n3. Agar 3 baar se zyada aaya hai → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charging/.test(pn))
    return `Battery/Charging issue. Yeh try karo:\n\n1. *Charger check karo* → dono taraf firmly laga hai? (laptop side + socket side)\n2. *Alag socket try karo*\n3. *Reset karo* → Laptop band karo → charger nikalo → power button 30 sec hold karo → charger lagao → on karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  // ISSUE 4 fix: removed dead code — black screen already handled above (line ~361)

  if (pn.includes('keyboard') || pn.includes('keys') || /keybo?r?a?d/.test(pn))
    return `Keyboard issue. Yeh try karo:\n\n1. *Restart* → Laptop restart karo\n2. *On-screen keyboard* → Start menu mein "On-Screen Keyboard" type karo → open karo → kaam chalao\n\nType karo *ha* — IT ticket raise karta hoon, IT aake fix karega 🎫`;

  if (pn.includes('touchpad') || pn.includes('mouse'))
    return `Touchpad issue. Yeh try karo:\n\n1. *Fn key* → Fn + touchpad lock key dabao (keyboard pe lock icon wali key)\n2. *Settings* → Settings → Bluetooth & devices → Touchpad → ON karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('printer'))
    return `Printer issue. Yeh try karo:\n\n1. *Printer restart* → Printer band karo → 30 sec → on karo\n2. *Laptop restart* → Laptop restart karo → dobara print karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('teams'))
    return `Microsoft Teams issue. Yeh try karo:\n\n1. *Quit & Reopen* → Taskbar pe Teams icon right-click → Quit → dobara open karo\n2. *Browser mein try karo* → teams.microsoft.com Chrome mein open karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('zoom'))
    return `Zoom issue. Yeh try karo:\n\n1. *Restart karo* → Zoom close karo → dobara open karo\n2. *Browser mein try karo* → zoom.us/wc/join Chrome mein kholо\n3. *Settings* → Zoom Settings → Audio/Video → correct device select karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  // WIOM uses Gmail (Google Workspace) — NOT Outlook
  // "email nahi chal rha", "gmail nahi khul rha", "mail nahi aa rha"
  if (pn.includes('outlook')) {
    return `ℹ️ WIOM mein Outlook use nahi hota — *Gmail* use hoti hai.\n\nGmail se koi problem hai? gmail.com Chrome mein kholo aur batao kya issue aa raha hai.`;
  }
  if (pn.includes('email') || pn.includes('gmail') || pn.includes('mail')) {
    return `📧 *Gmail Issue* — yeh try karo:\n\n1. *Incognito test* → Chrome → Ctrl+Shift+N → gmail.com → dekho khulta hai ya nahi\n2. *Cache clear karo* → Ctrl+Shift+Del → "All time" → Cookies + Cache → Clear\n3. *Alag browser* → Edge mein gmail.com kholo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  if (pn.includes('password') || pn.includes('locked') || pn.includes('login') || /pas?w?ro?d/.test(pn)) {
    // Gmail/Google password — IT handles (no admin rights to self-reset company Google accounts)
    if (/google|gmail|email|mail/.test(pn))
      return `🔑 *Gmail/Google Account Password*\n\nCompany Gmail account ka password reset IT karta hai — employees khud reset nahi kar sakte.\n\nType karo *ha* — IT ticket raise karta hoon, jaldi reset ho jaayega 🎫`;
    return `🔑 *Password/Login Issue*\n\nPassword reset sirf IT team kar sakti hai.\n\nType karo *ha* — IT ticket raise karta hoon, team jaldi reset kar degi 🎫`;
  }

  if (pn.includes('bluetooth'))
    return `Bluetooth issue. Yeh try karo:\n\n1. *Toggle* → Settings → Bluetooth → OFF → ON karo\n2. *Re-pair* → Device remove karo → dobara pair karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('camera') || pn.includes('webcam') || /\bcam\b/.test(pn))
    return `Camera issue. Yeh try karo:\n\n1. *Privacy check* → Settings → Privacy & Security → Camera → ON karo\n2. *App settings* → Teams/Zoom mein Settings → Video → correct camera select karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('mic') || pn.includes('microphone'))
    return `Microphone issue. Yeh try karo:\n\n1. *Privacy check* → Settings → Privacy & Security → Microphone → ON karo\n2. *Input device* → Sound settings → Input → correct mic select karo\n3. *Teams test* → Teams Settings → Devices → mic test karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('usb') || pn.includes('pendrive'))
    return `USB issue. Yeh try karo:\n\n1. *Alag port* → USB device dusre port mein lagao\n2. *Restart* → Laptop restart karo → dobara lagao\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

  if (pn.includes('storage') || pn.includes('disk full'))
    return `Storage/disk full issue. Yeh try karo:\n\n1. *Recycle Bin* → Desktop pe Recycle Bin → Empty Recycle Bin\n2. *Downloads folder* → File Explorer → Downloads → jo files zaruri nahi unhe delete karo\n\nAgar ab bhi issue hai, type karo *ha* — IT ticket raise karta hoon (IT baaki cleanup karega) 🎫`;

  if (pn.includes('virus') || pn.includes('malware') || pn.includes('antivirus'))
    return `Possible virus/malware issue. Yeh karo:\n\n1. *Quick Scan* → Windows Security → Virus & threat protection → Quick Scan\n2. *Internet band karo* → agar suspicious activity lag rahi hai\n\nType karo *ha*, IT ticket raise karta hoon — yeh serious ho sakta hai 🎫`;

  if (pn.includes('kaise ho') || pn.includes('kaisa hai') || pn.includes('how are you') || pn.includes('kya haal'))
    return 'Sab theek hai, shukriya. Koi IT issue hai? Batao — help karunga.';

  if (pn.includes('thanks') || pn.includes('shukriya') || pn.includes('thank you') || pn.includes('dhanyawad'))
    return 'You are welcome. Feel free to reach out if anything else comes up.';

  if (/^(hello|hi+|hey|namaste|namaskar|hlo|helo)\s*[!.]*$/i.test(pn.trim()))
    return 'Hello! I am Zivon — WIOM IT Support Assistant. How can I help you today?';

  if (/\b(kise|kaun)\s*(ho|hain|hai)\b/i.test(pn) || /\b(tum|aap)\s*(kya|kise|kaun)\b/i.test(pn))
    return `Main *Zivon* hoon — WIOM ka IT support assistant.\nLaptop, WiFi, software, password — kisi bhi IT issue mein help kar sakta hoon.\nBatao kya problem hai.`;

  // FIX: "sajan" only for contact-intent, not when user introduces themselves
  if ((pn.includes('sajan') && /contact|email|se\s*baat|number|kaun\s*hai|it\s*wala/.test(pn)) ||
      pn.includes('it head') || pn.includes('phone number') || pn.includes('number do'))
    return 'IT contact: *Sajan Kumar* | 📧 sajan.kumar@wiom.in';

  // Conversational / non-IT responses
  if (/^(bye|goodbye|exit|quit|close|band\s*karo|niklo|alvida|baad\s*mein|chalte\s*hain|nikalta\s*hoon|nikal\s*rha)\s*[!.]*$/i.test(pn.trim()))
    return 'Theek hai! Koi aur IT issue ho toh batayein. 👍';

  if (/\b(ok\b|okay|theek\s*hai|accha|achha|haan\s*theek|kal\s*bataunga|dekh\s*leta)\b/i.test(pn))
    return 'Theek hai. Koi aur IT issue ho toh batayein.';

  if (/good\s*(morning|evening|night|afternoon)|subah|shaam\s*ko|kal\s*milte|good\s*day/i.test(pn))
    return 'Hello! Koi IT issue hai? Batao — main help karunga.';

  if (/\b(haha|hehe|lol|lmao|xd|😂|😄)\b/i.test(pn))
    return 'Koi IT issue ho toh batayein — main help karunga. 😊';

  if (/\b(call\s*karo|phone\s*karo|ring\s*karo|call\s*karna\s*hai)\b/i.test(pn))
    return 'Yeh bot text-based support hai. Apni problem yahan type karo — main help karunga.';

  if (/\b(bhook|khaana|khana|chai|coffee|pani|water|pantry|canteen|lunch|dinner|breakfast)\b/i.test(pn) &&
      !/\blaptop\b|\bwifi\b|\bscreen\b/.test(pn))
    return 'Yeh IT helpdesk hai — sirf laptop, WiFi aur software problems handle karta hoon. Koi IT issue ho toh batayein!';

  if (/\b(bakwas|useless|bekar|faltu|kaam\s*nahi|farq\s*nahi|chodo|ignore)\b/i.test(pn))
    return 'Samajh gaya. Koi bhi IT issue ho toh batayein — main help karunga.';

  if (/ticket\s*(kahan|ka\s*kya\s*hua|raise\s*kiya|status|kab\s*tak)|kab\s*tak\s*(kaam|resolve|theek|fix)/i.test(pn))
    return 'Aapka ticket IT team ke paas hai. Status dekhne ke liye type karo: *my tickets*';

  if (/are\s*you\s*(ai|human|bot|robot)|kya\s*aap\s*(human|ai|bot|robot|real)\s*hain/i.test(pn))
    return `Main *Zivon* hoon — WIOM ka IT support AI assistant.\nLaptop, WiFi, software, password — kisi bhi IT issue mein help kar sakta hoon.`;

  return `Thoda aur batao — kya problem ho rahi hai? Main help karunga.`;
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
  if (!groq) throw new Error('GROQ_API_KEY not configured');
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
    .replace(/\barre\b/gi, ' ')
    .replace(/\byaar\b/gi, ' ')
    .replace(/\bbhai\b/gi, ' ')
    // Remove phone number — never show in any bot message
    .replace(/📞?\s*9654244281/g, '')
    .replace(/\b9654244281\b/g, '')
    // Remove casual/banned words the system prompt bans
    .replace(/\bDekho\b/gi, '')
    .replace(/\bAchha\s+suno\b/gi, 'Please note:')
    .replace(/\bHaan\s+yaar\b/gi, 'Haan,')
    // Remove admin-only tools if AI slips them through
    .replace(/\bosk\.exe\b/gi, 'On-Screen Keyboard')
    .replace(/%appdata%[^\s]*/gi, '')
    .replace(/\bcleanmgr\b/gi, '')
    .replace(/\bservices\.msc\b/gi, '')
    .replace(/\bDevice Manager\b[^.!?\n]*/gi, 'IT ticket raise karo')
    .replace(/\bHP Support Assistant\b[^.!?\n]*/gi, '')
    .replace(/\bDell\s+(Support|SupportAssist|Diagnostics)[^.!?\n]*/gi, '')
    .replace(/\bLenovo\s+(Vantage|Support)[^.!?\n]*/gi, '')
    .replace(/Update\s+[Dd]river[^.!?\n]*/gi, 'IT ticket raise karo (driver update IT karega)')
    // Remove Safe Mode / F8 / Diagnostic Tool suggestions — IT only
    .replace(/safe\s*mode\s*(mein|me|boot|open|karo|se)[^.!?\n]*/gi, 'IT ticket raise karo')
    .replace(/F8\s*(key|dabao|press)[^.!?\n]*/gi, '')
    .replace(/diagnostic\s*tool[^.!?\n]*/gi, 'IT ticket raise karo')
    .replace(/advanced\s*boot\s*options[^.!?\n]*/gi, '')
    // Remove "common issue/problem" openers — go straight to solution
    .replace(/yeh\s+ek\s+(common\s+)?(boot|wifi|network|laptop|hardware|software|display|screen|password|account|printer|teams|email|gmail)?\s*(issue|problem|error)\s+hai[.!,—–-]?\s*/gi, '')
    .replace(/this\s+is\s+a\s+(common\s+)?(issue|problem|error)[.!,—–-]?\s*/gi, '')
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
      : `Samajh gaya. IT team ko bhejte hain — woh handle kar lenge. Type karo *ha*, ticket raise karta hoon 🎫`;
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

  // ── 📁 FILE EXPLORER / FOLDER / DRIVE NOT OPENING ───────────────────────
  // Normalize folder/drive typos for matching
  const pnFile = pn.replace(/\bfoldar\b/gi, 'folder').replace(/\bfoldor\b/gi, 'folder')
                   .replace(/\bc\s*drivr\b/gi, 'c drive').replace(/\bexpolrer\b/gi, 'explorer');

  if (/\b(folder|file\s*explorer|c\s*drive|d\s*drive|my\s*computer|this\s*pc|drive\b|explorer)\b/i.test(pnFile) &&
      /\b(not\s*open|nahi\s*khul|open\s*nahi|nahi\s*open|khul\s*nahi|kholna|open\s*nahi\s*ho|nahi\s*ho\s*rha|chal\s*nahi|access\s*nahi|dikh\s*nahi)\b/i.test(pnFile)) {
    return `📁 *Folder / Drive nahi khul raha* — yeh try karo:\n\n1. *Windows + E* → keyboard pe Windows key + E dabao → File Explorer directly khulega\n2. *Restart karo* → Laptop restart karo — File Explorer khud theek ho jaata hai\n\nAgar phir bhi nahi khula — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🔒 FOLDER LOCK — needs IT (admin rights required) ──────────────
  // "folder lock kaise karu", "foldar look kise karu" (typos handled)
  if (/\b(folder|foldar|foldor|file|drive)\b.*(lock|look|password|protect|secure|band\s*karna|chupa|hide)\b/i.test(pn) ||
      /\b(lock|look|password|protect)\b.*(folder|foldar|file|drive)\b/i.test(pn)) {
    return `🔒 *Folder Lock / Password Protection*\n\nFolder lock karne ke liye admin rights chahiye — yeh sirf IT kar sakta hai.\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 🗜️ ZIP / RAR / 7-ZIP — file extraction issues ───────────────────────
  if (/\b(zip|rar|7zip|7-zip|winrar|winzip|extract|extraction|compressed|archive|\.zip|\.rar)\b/i.test(pn)) {
    const isInstall = /instal|chahiye|nahi\s*hai|need/i.test(pn);
    if (isInstall) {
      return `🗜️ *ZIP/RAR Extractor chahiye?*\n\nInstallation ke liye IT ticket raise karo — admin rights chahiye.\nType karo *ha* — IT ticket raise karta hoon 🎫`;
    }
    return `🗜️ *ZIP File open nahi ho rhi?* — yeh try karo:\n\n1. *Right-click* karo ZIP file pe → *"Extract All"* select karo → OK\n2. *Windows mein hi ZIP support hai* — alag software ki zarurat nahi\n3. *Alag folder mein extract karo* — Desktop pe try karo\n\nAgar phir bhi nahi khuli (RAR file hai?) — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📄 PDF — file open issues ──────────────────────────────────────────────
  if (/\b(pdf|adobe|acrobat|\.pdf)\b/i.test(pn)) {
    const isInstall = /install|chahiye|nahi\s*hai|reader|adobe/i.test(pn);
    const isConvert = /to\s*word|to\s*excel|convert|word\s*mein|word\s*me\s*kaise|word\s*banana|change\s*karna|badaln/i.test(pn);
    const isEdit = /edit\s*karna|edit\s*kaise|type\s*karna|likhna|fill\s*karna/i.test(pn);
    const isPrint = /print\s*nahi|print\s*kaise|print\s*ho/i.test(pn);

    if (isInstall) return `📄 *Adobe/PDF Reader chahiye?*\n\nInstallation ke liye IT ticket raise karo — admin rights chahiye.\nType karo *ha* — IT ticket raise karta hoon 🎫`;

    if (isConvert) return `📄 *PDF to Word convert karna hai?*\n\n*Option 1 — Microsoft Word se (Free):*\n1. Word open karo → File → Open → PDF file select karo\n2. Word automatically convert kar dega → Save As → Word Document\n\n*Option 2 — Online tool (Free):*\n• ilovepdf.com ya smallpdf.com kholo\n• "PDF to Word" select karo → file upload karo → Download\n\nKoi problem ho → type karo *ha*, IT ticket raise karta hoon 🎫`;

    if (isEdit) return `📄 *PDF mein editing karna hai?*\n\n*Method 1:* PDF ko Word mein convert karo (Word → File → Open → PDF) → edit karo → save karo\n*Method 2:* Online: ilovepdf.com → "Edit PDF" tool\n\nNote: Company documents ke liye IT se poochho pehle.`;

    if (isPrint) return `📄 *PDF print nahi ho rha?*\n\n1. Chrome mein PDF kholo → Ctrl+P → printer select karo → Print\n2. Alag PDF try karo — file corrupt ho sakti hai\n\nAgar phir bhi nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;

    return `📄 *PDF issue?* — yeh try karo:\n\n1. *Chrome/Edge mein open karo* → PDF file pe right-click → "Open with" → Chrome ya Edge\n2. *Browser pe drag karo* → Chrome kholo → PDF file drag & drop karo\n\nAgar phir bhi nahi khula → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💼 KEKA — HR software issues ──────────────────────────────────────────
  if (/\b(keka|keka\.me|keka\s*app|hrms|hr\s*portal|attendance|payslip|leave\s*apply|salary\s*slip)\b/i.test(pn)) {
    const isPassword = /password|login\s*nahi|access\s*nahi|sign\s*in/i.test(pn);
    const isDownload = /download|install|app\s*chahiye|mobile\s*app/i.test(pn);
    const isPayslip = /payslip|salary\s*slip|payroll|slip\s*download/i.test(pn);
    const isLeave = /leave|chutti|chhutti|leave\s*apply|leave\s*request/i.test(pn);

    if (isPassword) return `💼 *Keka Login Issue*\n\nKeka password reset ke liye IT ticket raise karo.\nType karo *ha* — IT ticket raise karta hoon 🎫`;

    if (isDownload) return `💼 *Keka App Download kaise karo:*\n\n📱 *Mobile:*\n• Android: Play Store mein "Keka HR" search karo → Install\n• iPhone: App Store mein "Keka HR" search karo → Install\n\n💻 *Laptop/PC:*\nApp download ki zarurat nahi — *keka.me* browser mein kholo (Chrome ya Edge)\n\nLogin ID aur password HR se milega. Nahi mila? Type karo *ha* — IT ticket 🎫`;

    if (isPayslip) return `💼 *Payslip download kaise karo:*\n\n1. *keka.me* browser mein kholo → Login karo\n2. *"Payroll"* section mein jao\n3. Month select karo → *"Download"* button dabao\n\nAgar access nahi hai — type karo *ha*, IT ticket raise karta hoon 🎫`;

    if (isLeave) return `💼 *Keka mein Leave apply kaise karo:*\n\n1. *keka.me* kholo → Login karo\n2. *"Time & Attendance"* → *"Leave"* section\n3. *"Apply Leave"* → dates select karo → Submit\n\nAgar issue aa raha hai — type karo *ha*, IT ticket raise karta hoon 🎫`;

    return `💼 *Keka Issue?* — yeh try karo:\n\n1. *Browser cache clear karo* → Chrome → Ctrl+Shift+Del → All time → Clear\n2. *Incognito mein try karo* → Chrome → Ctrl+Shift+N → keka.me kholo\n3. *Alag browser try karo* → Edge mein keka.me kholo\n\nAgar phir bhi nahi chal rha — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── 🆕 COMMON INDIAN OFFICE SOFTWARE — added for 300-user coverage ────────
  // ══════════════════════════════════════════════════════════════════════════

  // ── 💬 WHATSAPP WEB — "whatsapp web nahi chal rha", "scan nahi ho rha" ──────
  if (/\b(whatsapp|whats\s*app|wa\b)\b.*(web|scan|qr|desktop|nahi\s*chal|chal\s*nahi|nahi\s*khul|nahi\s*ho\s*rha|connect)/i.test(pn) ||
      /whatsapp.*nahi|whatsapp.*scan|whatsapp.*qr/i.test(pn)) {
    return `💬 *WhatsApp Web Issue* — yeh try karo:\n\n1. *web.whatsapp.com kholo* → Chrome mein kholo → QR code aayega\n2. *Phone camera se scan karo* → WhatsApp app open karo → top-right menu (3 dots) → Linked Devices → Link a Device → QR scan karo\n3. *Refresh karo* → Agar QR expire ho gaya toh page refresh karo → dobara scan karo\n4. *Phone internet check karo* → Phone ka data/WiFi on hai?\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🎥 GOOGLE MEET — "meet nahi chal rha", "meet join nahi ho rha" ──────────
  if (/\b(google\s*meet|gmeet|meet\.google)\b/i.test(pn) ||
      (/\bmeet\b/i.test(pn) && /nahi\s*chal|join\s*nahi|nahi\s*khul|camera|mic|audio|video|nahi\s*ho|problem/i.test(pn))) {
    return `🎥 *Google Meet Issue* — yeh try karo:\n\n1. *Chrome mein kholo* → meet.google.com Chrome browser mein kholo (Chrome recommended hai)\n2. *Camera/Mic allow karo* → Browser mein permission maange toh "Allow" karo\n3. *Link se join karo* → Meeting link pe click karo → "Join Now" dabao\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── ☁️ ONEDRIVE — "onedrive sync nahi", "onedrive file nahi aa rhi" ──────────
  if (/\b(onedrive|one\s*drive|one-drive)\b/i.test(pn)) {
    return `☁️ *OneDrive Issue* — yeh try karo:\n\n1. *Taskbar icon* → Taskbar mein OneDrive cloud icon dhundho → click karo → status check karo\n2. *Pause & Resume* → OneDrive icon → "Pause syncing" → 2 min baad → "Resume syncing"\n3. *Sign out & Sign in* → OneDrive icon → Settings → Account → "Sign out" → dobara sign in karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🔄 WINDOWS UPDATE STUCK / FAILING ───────────────────────────────────────
  // "windows update stuck 0%", "update install nahi ho rha" (basic variant already in KB above;
  //  this catches 0% stuck, "download nahi", "error" variants)
  if (/windows\s*update.*(stuck|0\s*%|zero|nahi\s*ho|install\s*nahi|download\s*nahi|fail|error|ruka|atak)|update.*(stuck\s*0|0\s*%|install\s*fail|nahi\s*install)/i.test(pn)) {
    return `🔄 *Windows Update Stuck* — yeh karo:\n\n1. *30 min wait karo* → Kabhi kabhi update slowly download hoti hai — band mat karo\n2. *Agar ab bhi stuck hai* → Laptop restart karo (Update apne aap resume ho jaayegi)\n\nAgar restart ke baad bhi koi error aa raha hai — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🗂️ NETWORK / SHARED / MAPPED DRIVE — "network drive nahi dikh rha" ───────
  if (/\b(network\s*drive|mapped\s*drive|shared\s*drive|shared\s*folder|network\s*folder|server\s*path|\\\\server|\\\\[a-z])\b/i.test(pn) ||
      (/\b(drive|folder)\b/i.test(pn) && /\b(network|mapped|disconnect|nahi\s*dikh|dikh\s*nahi|nahi\s*aa\s*rha|gaya)\b/i.test(pn))) {
    return `🗂️ *Network / Shared Drive Issue* — yeh try karo:\n\n1. *This PC check karo* → File Explorer open karo → "This PC" → dekho drive visible hai ya nahi\n2. *Restart karo* → Laptop restart karo — drive aksar restart se reconnect ho jaati hai\n3. *Dobara connect karo* → File Explorer → address bar mein server path type karo (IT se path lo)\n\nAgar phir bhi nahi dikh rhi → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🖥️ REMOTE DESKTOP / RDP — "remote desktop nahi chal rha" ────────────────
  if (/\b(remote\s*desktop|rdp|remote\s*access|remote\s*connect|anydesk|teamviewer)\b/i.test(pn) &&
      /nahi\s*chal|connect\s*nahi|nahi\s*ho\s*rha|fail|error|nahi\s*khul/i.test(pn)) {
    return `🖥️ *Remote Desktop (RDP) Issue* — yeh try karo:\n\n1. *Internet check karo* → WiFi properly connected hai?\n2. *Dobara try karo* → Remote Desktop band karo → dobara open karo → connect try karo\n\nAgar phir bhi connect nahi ho rha — yeh network/firewall issue ho sakta hai.\nType karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📹 SCREEN RECORDING — "screen record kaise karu", "screen capture" ────────
  if (/screen\s*(record|recording|capture|video)|record.*screen|capture.*screen/i.test(pn) &&
      !/cctv|surveillance|footage|security\s*camera/i.test(pn)) {
    return `📹 *Screen Record / Capture* — built-in tools hain:\n\n• *Screen Record:* Windows + G dabao → Xbox Game Bar → Record button\n• *Screenshot (area):* Windows + Shift + S dabao → area select karo\n• *Full screenshot:* PrtSc key dabao → Paint mein paste karo\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🎤 TEAMS MEETING — CAMERA / MIC NAHI — meeting-specific ─────────────────
  // (general camera/mic already handled above; this catches meeting-context specifically)
  if (/\b(teams)\b.*(meeting|call|join|joining).*(camera|mic|audio|video|nahi|nahi\s*aa|nahi\s*chal)|teams.*(camera|mic).*(meeting|call)/i.test(pn) ||
      /(meeting|call).*(camera|mic).*(nahi|nahi\s*aa|band|work\s*nahi)/i.test(pn)) {
    return `🎤 *Teams Meeting Camera/Mic Issue* — yeh try karo:\n\n1. *Join karne se pehle* → "Device settings" check karo — camera aur mic select karo\n2. *Settings* → Teams → Settings → Devices → sahi camera aur mic select karo\n3. *Permission check karo* → Windows Settings → Privacy → Camera / Microphone → Teams ke liye ON karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📄 EXCEL / WORD FILE CORRUPT — "file corrupt", "file damaged" ────────────
  if ((/\b(excel|word|powerpoint|office)\b/i.test(pn) || /\b(file|document|doc|sheet)\b/i.test(pn)) &&
      /\b(corrupt|damaged|kharab\s*ho\s*gaya|kharab\s*ho\s*gyi|open\s*nahi\s*ho\s*rhi|nahi\s*khul\s*rhi|invalid|repai|repair)\b/i.test(pn)) {
    return `📄 *File Corrupt / Damaged* — yeh try karo:\n\n1. *Repair try karo* → File ko open karo → agar error aaye → "Repair" option milega, click karo\n2. *MS Office mein:* File → Info → "Check for Issues" → Repair\n3. *Previous version* → File pe right-click → "Restore previous versions" → dekho backup hai?\n\nAgar data recover nahi hua → type karo *ha*, IT ticket raise karta hoon — data recovery possible hai 🎫`;
  }

  // ── 🚨 SPAM / PHISHING EMAIL — "suspicious email", "fraud email" ─────────────
  if (/\b(spam|phishing|phising|fraud|suspicious|fake|scam|suspicious\s*email|fraud\s*email|scam\s*email|dubious|unknown\s*email)\b/i.test(pn) ||
      (/\b(email|mail)\b/i.test(pn) && /\b(suspicious|fraud|fake|scam|link|click|karna\s*chahiye|kya\s*karu|karna\s*chahiye)\b/i.test(pn))) {
    return `🚨 *Suspicious / Phishing Email* — TURANT yeh karo:\n\n1. *Link pe CLICK MAT KARO* — koi bhi link ya attachment mat kholna\n2. *Email delete karo* — directly Trash/Spam mein bhejo\n3. *IT ko batao* — yeh important hai\n\nType karo *ha*, IT ko URGENT batata hoon 🎫`;
  }

  // ── 🔐 WINDOWS HELLO / FINGERPRINT / FACE RECOGNITION / PIN ─────────────────
  if (/\b(fingerprint|finger\s*print|face\s*recognition|face\s*id|windows\s*hello|pin\s*bhool|pin\s*forgot|pin\s*nahi|biometric\s*login|hello\s*nahi)\b/i.test(pn)) {
    return `🔐 *Windows Hello / Fingerprint / PIN Issue* — yeh try karo:\n\n1. *Password se login karo* → Login screen pe "Sign-in options" → Password select karo\n2. *Fingerprint re-enroll karo* → Settings → Accounts → Sign-in options → Windows Hello Fingerprint → Remove → Setup again\n3. *PIN bhool gaye?* → PIN reset ke liye admin rights chahiye — IT karega\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🦠 ANTIVIRUS ALERT / WINDOWS DEFENDER WARNING ───────────────────────────
  if (/\b(antivirus|anti\s*virus|windows\s*defender|defender|windows\s*security)\b.*(alert|warning|notification|threat|detected|aa\s*rha|aa\s*rhi|popup|pop\s*up)/i.test(pn) ||
      /\b(virus\s*detected|threat\s*detected|malware\s*detected|antivirus\s*aa|defender\s*aa)\b/i.test(pn)) {
    return `🦠 *Antivirus / Defender Alert* — IMPORTANT:\n\n1. *Ignore MAT karo* — yeh serious ho sakta hai\n2. *Windows Security kholo* → Start → Windows Security → check karo kya warning hai\n3. *IT ko batao* — alert dismiss mat karo\n\nType karo *ha*, IT URGENT ticket raise karta hoon 🎫`;
  }

  // ── 📊 EXCEL / GOOGLE SHEETS FORMULA ISSUE ───────────────────────────────────
  if (/\b(formula|vlookup|hlookup|pivot|index\s*match|sumif|countif|iferror|xlookup)\b/i.test(pn) &&
      /\b(kaam\s*nahi|nahi\s*chal|error|nahi\s*ho|problem|wrong|galat|result\s*nahi)\b/i.test(pn)) {
    return `📊 *Excel / Sheets Formula Issue*\n\nYeh software usage ka sawal hai, IT issue nahi hai.\n\n• *Formula syntax check karo* → = sign se start, brackets theek se lage hain?\n• *VLOOKUP help:* =VLOOKUP(lookup_value, table_array, col_index, FALSE)\n• *Online help:* support.microsoft.com ya Google pe formula naam search karo\n\nAgar Excel khud crash ya open nahi ho rha — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🌐 INTERNET EXPLORER / EDGE ISSUE ───────────────────────────────────────
  if (/\b(internet\s*explorer|ie\b|msie)\b/i.test(pn) ||
      (/\b(edge|microsoft\s*edge)\b/i.test(pn) && /\b(crash|nahi\s*chal|nahi\s*khul|band|slow|error|problem)\b/i.test(pn))) {
    return `🌐 *Browser Issue* — yeh try karo:\n\n1. *Chrome use karo* → Internet Explorer outdated hai aur sites nahi kholta — Google Chrome use karo\n2. *Edge crash?* → Edge band karo → dobara open karo → agar phir bhi crash → cache clear karo: Ctrl+Shift+Del → All time → Clear\n\nAgar Chrome bhi nahi chal rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💬 SLACK — "slack nahi chal rha", "slack messages nahi aa rhe" ────────────
  if (/\b(slack)\b/i.test(pn) &&
      /\b(nahi\s*chal|nahi\s*aa\s*rhe|nahi\s*aa\s*rha|messages\s*nahi|crash|band|error|problem|slow|nahi\s*khul|login\s*nahi)\b/i.test(pn)) {
    return `💬 *Slack Issue* — yeh try karo:\n\n1. *Quit & Reopen* → Taskbar mein Slack icon pe right-click → Quit → dobara open karo\n2. *Restart karo* → Laptop restart karo → Slack khud reconnect ho jaata hai\n3. *Browser mein try karo* → app.slack.com Chrome mein kholo\n\nAgar phir bhi nahi chal rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🌐 COMMON OFFICE APPS — Teams, Zoom, Chrome (already in KB) ───────────
  // ── 🎬 MEDIA FILES — video/audio not playing ──────────────────────────────
  if (/\b(video\s*nahi|audio\s*nahi|mp4\s*nahi|mp3\s*nahi|media\s*player|vlc|codec|mkv|avi)\b/i.test(pn)) {
    return `🎬 *Media file nahi chal rhi?* — yeh try karo:\n\n1. *VLC chahiye* → VLC ek free media player hai jo sab format chal karta hai\n   IT ticket raise karo — admin rights se install hoga\n2. *Online try karo* → file ko browser mein open karo (MP4 support hota hai)\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 🔑 BIOS / FIRMWARE — IT only, employees should not touch ──────────────
  if (/\b(bios|firmware|uefi|boot\s*order|bios\s*update|bios\s*password)\b/i.test(pn)) {
    return `⚙️ *BIOS/Firmware* — yeh IT ka kaam hai, employees khud mat karo.\nGalti se kuch change ho gaya toh laptop kharab ho sakta hai.\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 📝 NOTEPAD / TEXT FILES ────────────────────────────────────────────────
  if (/\b(notepad|text\s*file|\.txt|wordpad)\b/i.test(pn) && /nahi\s*khul|open\s*nahi|issue|problem/i.test(pn)) {
    return `📝 *Text file nahi khul rhi?*\n\nFile pe right-click karo → "Open with" → Notepad select karo\n\nAgar phir bhi nahi khula — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── 🆕 ADDITIONAL INDIAN OFFICE IT KB ENTRIES ─────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  // ── 📸 SCREENSHOT — "screenshot kaise lu", "printscreen kaise karu" ────────
  if (/\b(screenshot|screen\s*shot|printscreen|print\s*screen|screen\s*capture|capture\s*karna|capture\s*kaise)\b/i.test(pn) &&
      !/record|video|cctv|surveillance/i.test(pn)) {
    return `📸 *Screenshot kaise lo:*\n\n• *Area select karke:* Win+Shift+S dabao → mouse se area select karo → clipboard mein aa jaayega, paste karo (Ctrl+V)\n• *Full screen:* PrtSc key dabao → Paint mein paste karo (Ctrl+V) → save karo\n• *Active window only:* Alt+PrtSc dabao → Paint mein paste karo\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── ✏️ FILE RENAME — "file rename kaise karu", "rename karna hai" ──────────
  if (/\b(rename|naam\s*change|file\s*ka\s*naam|naam\s*badalna|file\s*rename|folder\s*rename)\b/i.test(pn)) {
    return `✏️ *File/Folder rename karna:*\n\nFile ya folder pe *right-click karo* → *"Rename"* select karo → naya naam type karo → Enter dabao\n\n💡 Shortcut: File select karo → *F2* key dabao → naam type karo → Enter`;
  }

  // ── 📁 NEW FOLDER CREATE — "folder kaise banau", "new folder banana" ────────
  if (/\b(new\s*folder|naya\s*folder|folder\s*bana|folder\s*kaise\s*bana|create\s*folder|folder\s*create)\b/i.test(pn)) {
    return `📁 *Naya folder banao:*\n\nJahan folder banana hai wahan *right-click karo* → *"New"* → *"Folder"* → naam type karo → Enter\n\n💡 Shortcut: Ctrl+Shift+N (File Explorer mein)`;
  }

  // ── 👁️ FILE/FOLDER HIDE — "file hide kaise karu", "folder hide karna" ───────
  if (/\b(file|folder)\b.*(hide|chupa|chupana|invisible|hidden)\b|\b(hide|chupa|chupana)\b.*(file|folder)\b/i.test(pn)) {
    return `👁️ *File/Folder hide karna:*\n\n1. File ya folder pe *right-click karo* → *"Properties"*\n2. *"Hidden"* checkbox tick karo → *"Apply"* → OK\n\n⚠️ Note: Yeh sirf basic hide hai — koi bhi "View → Hidden items" se dekh sakta hai. Secure lock chahiye toh type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🖥️ DESKTOP ICONS MISSING — "icons nahi dikh rahe", "desktop icons gayab" ─
  if (/\b(desktop\s*icon|icon.*desktop|icons?\s*nahi\s*dikh|icons?\s*gayab|icons?\s*gaye|shortcut\s*nahi\s*dikh|desktop\s*pe\s*kuch\s*nahi)\b/i.test(pn)) {
    return `🖥️ *Desktop icons nahi dikh rahe?*\n\n1. Desktop pe *right-click karo*\n2. *"View"* → *"Show desktop icons"* pe click karo (tick aana chahiye)\n\nSab icons wapas aa jaayenge! Koi aur IT issue ho toh batayein.`;
  }

  // ── 📌 TASKBAR MISSING — "taskbar nahi dikh rha", "taskbar gayab ho gaya" ────
  if (/\b(taskbar\s*nahi|taskbar\s*gayab|taskbar\s*gaya|taskbar\s*dikh\s*nahi|taskbar\s*miss|start\s*bar\s*nahi|bottom\s*bar\s*nahi)\b/i.test(pn)) {
    return `📌 *Taskbar nahi dikh rha?*\n\n1. Mouse cursor screen ke bilkul *neeche* le jao — taskbar auto-hide mein hoga toh aayega\n2. Agar nahi aaya → Taskbar pe *right-click karo* → *"Taskbar settings"* → *"Automatically hide the taskbar"* OFF karo\n\nAgar phir bhi nahi dikh rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── ⌨️ KEYBOARD LANGUAGE CHANGED — "language change ho gayi", "hindi aa rhi" ─
  if (/\b(keyboard\s*language|language\s*change|hindi\s*type|english\s*type|language\s*switch|lang\s*change|keyboard.*hindi|keyboard.*english|typing.*hindi|typing.*galat)\b/i.test(pn) ||
      /\b(win\s*space|language.*aa\s*rhi|language.*aa\s*gyi|keyboard.*aa\s*rha)\b/i.test(pn)) {
    return `⌨️ *Keyboard language change ho gayi?*\n\nEk baar *Win+Space* dabao — language switch ho jaayegi (Hindi ↔ English)\n\nYa Taskbar mein neeche right-side mein language icon (ENG/HIN) pe click karo → English select karo\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🕐 DATE/TIME WRONG — "date galat hai", "time galat aa rha" ──────────────
  if (/\b(date|time|clock|ghadi)\b.*(galat|wrong|sahi\s*nahi|theek\s*nahi|glt|change|set\s*karna|sync|adjust)\b|\b(galat|wrong)\b.*(date|time|clock)\b/i.test(pn)) {
    return `🕐 *Date/Time galat hai?*\n\n1. Taskbar mein *clock pe right-click karo*\n2. *"Adjust date/time"* select karo\n3. *"Set time automatically"* toggle ON karo → *"Sync now"* dabao\n\nDate/time apne aap sahi ho jaayega. Koi aur IT issue ho toh batayein!`;
  }

  // ── 🌐 DEFAULT BROWSER CHANGE — "default browser kaise change karu" ──────────
  if (/\b(default\s*browser|browser\s*change|chrome.*default|edge.*default|default.*chrome|default.*edge|browser\s*default\s*kaise)\b/i.test(pn)) {
    return `🌐 *Default browser change karna:*\n\n1. *Settings* kholo (Win+I)\n2. *"Apps"* → *"Default apps"*\n3. *"Web browser"* dhundho → *Google Chrome* select karo\n\nAb sab links Chrome mein khulenge. Koi aur IT issue ho toh batayein!`;
  }

  // ── ◧ SPLIT SCREEN / TWO WINDOWS SIDE BY SIDE — "window side by side" ────────
  if (/\b(side\s*by\s*side|split\s*screen|do\s*window|two\s*window|dono\s*window|aadha\s*screen|window\s*split|snap|do\s*cheezen\s*ek\s*saath)\b/i.test(pn)) {
    return `◧ *Do windows side by side kaise karo:*\n\n• Ek window pe *Win+Left arrow* dabao → left half mein aa jaayegi\n• Doosri window pe *Win+Right arrow* dabao → right half mein aa jaayegi\n\nDono ek saath dikh jaayengi! Koi aur IT issue ho toh batayein!`;
  }

  // ── 📡 HOTSPOT CONNECTION — "hotspot se connect nahi ho rha" ─────────────────
  if (/\b(hotspot|hot\s*spot)\b.*(connect|nahi|chal|ho\s*nahi|nahi\s*ho|problem)/i.test(pn) ||
      /connect.*(hotspot|hot\s*spot)/i.test(pn)) {
    return `📡 *Hotspot connect nahi ho rha?* — yeh try karo:\n\n1. *Phone pe check karo* → Hotspot ON hai? Settings → Personal Hotspot → ON karo\n2. *Visible hai?* → Laptop WiFi mein hotspot ka naam dikh raha hai?\n3. *Forget & reconnect* → WiFi → hotspot pe right-click → Forget → dobara connect karo\n\nAgar phir bhi nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🔌 LAN CABLE — request vs issue ────────────────────────────────────────
  if (/\b(lan\s*cable|ethernet|rj45|network\s*cable|wired.*connect)\b/i.test(pn)) {
    const isRequest = /\b(chahiye|need|ki\s*need|mangwana|de\s*do|milega|request|lana)\b/i.test(pn);
    if (isRequest) return `🛒 *LAN Cable Request*\n\nNaya LAN cable lene ke liye:\n1. Reporting Manager ko email karo\n2. CC: sajan.kumar@wiom.in\n3. Kya chahiye likho\n\nApproval ke baad IT arrange kar dega.`;
    return `🔌 *LAN cable issue?* — yeh try karo:\n\n1. *Cable dono ends check karo* — laptop aur wall socket dono mein firmly laga hai?\n2. *Alag port try karo* — doosra LAN socket try karo\n3. *Restart* → Laptop restart karo cable laga ke\n\nAgar phir bhi nahi chal rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💾 PEN DRIVE NOT DETECTED — "pen drive nahi dikh rhi" ────────────────────
  // (USB not working is already covered — this is pen drive specific detection)
  if (/\b(pen\s*drive|pendrive|flash\s*drive|thumb\s*drive)\b.*(nahi\s*dikh|dikh\s*nahi|detect\s*nahi|nahi\s*detect|nahi\s*aa\s*rha|aa\s*nahi|show\s*nahi|nahi\s*show)\b/i.test(pn)) {
    return `💾 *Pen drive nahi dikh rhi?* — yeh try karo:\n\n1. *Alag USB port try karo* — dusre port mein lagao\n2. *Laptop restart karo* → pen drive laga ke restart karo\n3. *Doosre laptop mein check karo* — pen drive theek hai ya nahi\n\nAgar phir bhi nahi dikh rhi → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📝 PEN DRIVE WRITE PROTECTED — "pen drive mein file transfer nahi" ─────────
  if (/\b(pen\s*drive|pendrive|usb)\b.*(write\s*protect|transfer\s*nahi|copy\s*nahi|save\s*nahi|nahi\s*copy|nahi\s*transfer|likhna\s*nahi|paste\s*nahi)/i.test(pn) ||
      /write\s*protect.*(pen\s*drive|pendrive|usb)/i.test(pn)) {
    return `📝 *Pen drive mein file copy nahi ho rhi?*\n\n1. *Write protection switch check karo* → Pen drive ke side mein ek chhota switch hota hai → Lock position se Unlock pe slide karo\n2. *Different file try karo* → Koi aur file copy karne ki koshish karo\n3. *Pen drive format check karo* → Sirf IT kar sakta hai format change\n\nAgar phir bhi nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💿 SD CARD NOT DETECTED — "SD card nahi dikh rha" ───────────────────────
  if (/\b(sd\s*card|sdcard|memory\s*card|micro\s*sd)\b.*(nahi\s*dikh|dikh\s*nahi|detect\s*nahi|nahi\s*aa|show\s*nahi|read\s*nahi)\b/i.test(pn)) {
    return `💿 *SD Card nahi dikh rha?* — yeh try karo:\n\n1. *Card nikaal ke dobara lagao* — properly push karo\n2. *Card saaf karo* — card ke contacts (gold strip) ko saaf kapde se wipe karo\n3. *Doosre device mein try karo* — card theek hai ya nahi check karo\n\nAgar phir bhi nahi dikh rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🗑️ RECYCLE BIN EMPTY — "recycle bin empty kaise karu" ───────────────────
  if (/\b(recycle\s*bin|recycle|trash)\b.*(empty|khaali|saaf|delete|clear)/i.test(pn) ||
      /empty.*(recycle\s*bin|trash)/i.test(pn)) {
    return `🗑️ *Recycle Bin empty karna:*\n\nDesktop pe *Recycle Bin pe right-click karo* → *"Empty Recycle Bin"* → Yes\n\nSab permanently delete ho jaayega. Koi aur IT issue ho toh batayein!`;
  }

  // ── 📤 FILE TOO LARGE TO SEND — "file size bahut bada hai" ──────────────────
  if (/\b(file\s*size|attachment\s*large|file\s*bada|badi\s*file|large\s*file|heavy\s*file|send\s*nahi\s*ho\s*rha|attach\s*nahi|attachment\s*nahi)\b/i.test(pn) ||
      /file.*(send\s*nahi|bhej\s*nahi|limit).*(size|bada|large)/i.test(pn)) {
    return `📤 *File bahut badi hai send karne ke liye?*\n\n*Option 1 — ZIP compress karo (free):*\nFile pe right-click → "Compress to ZIP" → ZIP file bhejo\n\n*Option 2 — Google Drive se bhejo:*\n1. drive.google.com → file upload karo\n2. File pe right-click → "Share" → email type karo → Send\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🔄 DISPLAY ROTATE — "display rotate ho gayi", "screen teri ho gayi" ──────
  if (/\b(display|screen)\b.*(rotate|ulta|seedha\s*nahi|90\s*degree|sideways|tedi|teri|palta)\b|\b(rotate|ulta|teda|teri)\b.*(display|screen)\b/i.test(pn)) {
    return `🔄 *Screen/Display rotate ho gayi?*\n\n*Shortcut se theek karo:*\n• Normal (seedha): *Ctrl+Alt+Up Arrow*\n• Left rotate: Ctrl+Alt+Left Arrow\n• Right rotate: Ctrl+Alt+Right Arrow\n\nYa: Desktop pe right-click → Display settings → Orientation → *"Landscape"* select karo\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🖱️ MOUSE SPEED — "mouse cursor bahut fast hai", "pointer slow hai" ─────────
  if (/\b(mouse|cursor|pointer)\b.*(fast|slow|speed|bahut\s*tez|bahut\s*dheema|adjust|change|speed\s*change)\b|\b(mouse\s*speed|pointer\s*speed|cursor\s*speed)\b/i.test(pn)) {
    return `🖱️ *Mouse pointer speed adjust karna:*\n\n1. *Settings* kholo (Win+I)\n2. *"Bluetooth & devices"* → *"Mouse"*\n3. *"Pointer speed"* slider adjust karo — left = slow, right = fast\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🌙 NIGHT MODE / DARK MODE — "night mode kaise karu", "dark mode" ──────────
  if (/\b(night\s*mode|night\s*light|dark\s*mode|dark\s*theme|eye\s*strain|aankhein\s*dard|blue\s*light|warm\s*light|screen\s*warm)\b/i.test(pn)) {
    return `🌙 *Night Mode / Dark Mode:*\n\n*Night Light (warm color for eyes):*\nSettings → System → Display → *"Night light"* → ON karo\n\n*Dark Mode (dark background everywhere):*\nSettings → Personalization → Colors → *"Choose your mode"* → *"Dark"* select karo\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🪟 WINDOWS ACTIVATION — "Windows activate nahi hai" ─────────────────────
  if (/\b(windows\s*activ|activate\s*windows|windows\s*license|windows\s*genuine|windows\s*not\s*activ|activate\s*karna\s*hai)\b/i.test(pn)) {
    return `🪟 *Windows Activation*\n\nWindows activate karne ke liye company license key chahiye — employees khud nahi kar sakte.\n\nType karo *ha* — IT ticket raise karta hoon, IT aake activate kar dega 🎫`;
  }

  // ── 💻 LAPTOP SLOW AFTER WINDOWS UPDATE ─────────────────────────────────────
  if (/\b(update\s*ke\s*baad|after\s*update|update\s*hone\s*ke\s*baad)\b.*(slow|hang|dheema|chal\s*nahi)|\b(slow|hang)\b.*(update\s*ke\s*baad|after\s*update)/i.test(pn)) {
    return `💻 *Laptop update ke baad slow ho gaya?*\n\n1. *Ek baar restart karo* → Update ke baad restart zaroori hoti hai\n2. *10 minute wait karo* → Windows background mein kaam karta hai update ke baad, apne aap normal ho jaayega\n\nAgar 10 min baad bhi slow hai — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── ℹ️ SYSTEM INFO / RAM / LAPTOP SPECS ─────────────────────────────────────
  if (/\b(system\s*info|system\s*properties|ram\s*kitni|kitni\s*ram|processor\s*kya|specs\s*kya|laptop\s*specs|configuration|config\s*kya|about\s*this\s*pc|this\s*pc.*properties)\b/i.test(pn)) {
    return `ℹ️ *Laptop info kaise dekhein:*\n\n*Win+Pause/Break* dabao — System Properties seedha khulega\n\nYa: Desktop pe *"This PC"* pe right-click → *"Properties"* → RAM, processor sab dikh jaayega\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🔢 SERIAL NUMBER — "laptop serial number kaise dekhun" ──────────────────
  if (/\b(serial\s*number|serial\s*no|service\s*tag|model\s*number|asset\s*tag|laptop\s*ka\s*number)\b/i.test(pn)) {
    return `🔢 *Laptop serial number kaise dekhein:*\n\n• *Sabse easy:* Laptop palatao — neeche sticker pe serial number likha hota hai\n• *Settings se:* Settings → System → About → "Device specifications" → Serial number\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🕐 TIME ZONE — "time zone galat hai", "IST nahi hai" ────────────────────
  if (/\b(time\s*zone|timezone|ist\s*nahi|india\s*time|galat\s*time\s*zone|time\s*zone\s*change)\b/i.test(pn)) {
    return `🕐 *Time zone change karna:*\n\n1. Taskbar mein *clock pe right-click karo*\n2. *"Adjust date/time"* → *"Time zone"*\n3. *"(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi"* select karo\n\nIST sahi ho jaayega. Koi aur IT issue ho toh batayein!`;
  }

  // ── ⌨️ KEYBOARD SHORTCUT NOT WORKING — "Fn key kaam nahi kar rhi" ─────────────
  if (/\b(fn\s*key|function\s*key|shortcut\s*kaam\s*nahi|hotkey\s*nahi|keyboard\s*shortcut\s*nahi|fn\s*lock)\b/i.test(pn)) {
    return `⌨️ *Keyboard shortcut / Fn key kaam nahi kar rhi?*\n\n1. *Fn Lock check karo* → Keyboard pe *Fn+Esc* dabao (Fn Lock toggle hoga)\n2. *Dobara try karo* → shortcut kaam karta hai ab?\n\nAgar phir bhi nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🌐 GOOGLE CHROME SLOW — "Chrome slow hai", "browser slow" ────────────────
  if (/\b(chrome|browser)\b.*(slow|hang|dheema|lagg|speed\s*nahi)\b|\b(slow|hang|dheema)\b.*(chrome|browser)\b/i.test(pn)) {
    return `🌐 *Chrome/Browser slow hai?* — yeh try karo:\n\n1. *Cache clear karo* → Chrome → Ctrl+Shift+Del → "All time" → Cached images + Cookies → Clear data\n2. *Extra tabs band karo* → Sirf zaroori tabs khule rakho\n3. *Extensions check karo* → Chrome → top-right 3 dots → Extensions → jo zaroori nahi woh disable karo\n\nAgar phir bhi slow → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💥 CHROME NOT OPENING / CRASH ────────────────────────────────────────
  // chrmo/chrme/chome = typo for chrome
  const pnChrome = pn.replace(/\bchrmo\b|\bchrme\b|\bchome\b|\bchorme\b/gi, 'chrome');
  if (/\b(chrome|browser)\b.*(nahi\s*khul|not\s*open(ing)?|open\s*nahi|crash|aw\s*snap|response\s*nahi|band\s*ho|kaam\s*nahi|not\s*working|not\s*start)\b/i.test(pnChrome) ||
      /\b(chrome|browser)\b.*(khul\s*nahi|nahi\s*chal|start\s*nahi)\b/i.test(pnChrome) ||
      /(google\s*chrome|chrome)\s*(not\s*open|not\s*start|nahi\s*khul|khul\s*nahi)/i.test(pnChrome) ||
      /\baw\s*snap\b/i.test(pn)) {
    return `🌐 *Chrome nahi khul rha / crash?* — yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → "Google Chrome" dhundho → End Task → dobara open karo\n2. *Restart karo* → Laptop restart karo — aksar restart se theek ho jaata hai\n3. *Cache clear karo* → Chrome khulne pe Ctrl+Shift+Del → All time → Clear\n\nAgar phir bhi nahi khulta → type karo *ha*, IT ticket raise karta hoon 🎫\n\n⚠️ *Chrome reinstall mat karo khud se* — admin rights chahiye, IT karega`;
  }

  // ── ☁️ GOOGLE DRIVE UPLOAD — "Google Drive upload nahi ho rha" ───────────────
  if (/\b(google\s*drive|gdrive|drive\.google)\b.*(upload\s*nahi|upload\s*fail|upload\s*ho\s*nahi|upload\s*error|nahi\s*upload)\b/i.test(pn)) {
    return `☁️ *Google Drive upload nahi ho rha?* — yeh try karo:\n\n1. *Internet check karo* → WiFi connected hai?\n2. *File size check karo* → 5GB se badi file upload nahi hoti free account mein\n3. *Drive storage check karo* → drive.google.com → neeche storage dikh jaata hai — full toh nahi?\n4. *Alag browser try karo* → Chrome mein nahi ho rha? Edge mein try karo\n\nAgar phir bhi nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📤 GOOGLE DRIVE FILE SHARE — "Google Drive file share kaise karu" ─────────
  if (/\b(google\s*drive|gdrive)\b.*(share\s*kaise|share\s*karna|share\s*karo|share\s*link|link\s*share|share\s*file|file\s*share)\b/i.test(pn) ||
      /share.*(google\s*drive|gdrive)/i.test(pn)) {
    return `📤 *Google Drive file share kaise karo:*\n\n1. *drive.google.com* kholo → file dhundho\n2. File pe *right-click karo* → *"Share"*\n3. Email address type karo → *"Editor"* ya *"Viewer"* select karo → *"Send"*\n\nYa: *"Copy link"* karo → link email/WhatsApp pe bhejo\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 📥 GMAIL ATTACHMENT DOWNLOAD FAIL — "attachment download nahi" ────────────
  if (/\b(gmail|email|mail)\b.*(attachment\s*nahi|download\s*nahi|attachment\s*download|download.*attachment)\b/i.test(pn)) {
    return `📥 *Gmail attachment download nahi ho rha?* — yeh try karo:\n\n1. *Incognito mein try karo* → Chrome → Ctrl+Shift+N → gmail.com → dobara try karo\n2. *Storage check karo* → laptop mein Downloads folder full toh nahi?\n3. *Cache clear karo* → Ctrl+Shift+Del → All time → Clear\n\nAgar phir bhi nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📧 GMAIL STORAGE FULL — "Gmail storage full hai" ────────────────────────
  if (/\b(gmail|google)\b.*(storage\s*full|storage\s*khatam|space\s*nahi|storage\s*nahi|no\s*storage|quota|space\s*full)\b|\b(storage\s*full|storage\s*khatam)\b.*(gmail|google|email|drive)\b/i.test(pn)) {
    return `📧 *Gmail/Google storage full hai?*\n\n1. *Attachment wale emails delete karo* → Gmail mein search karo: "has:attachment" → bade attachment wale emails delete karo\n2. *Trash empty karo* → Gmail left sidebar → "Trash" → "Empty Trash now"\n3. *Google Drive check karo* → drive.google.com → badi files delete karo\n\nAgar company account ka storage full hai — type karo *ha*, IT ticket raise karta hoon (IT Google Workspace storage badha sakta hai) 🎫`;
  }

  // ── 🔋 CHARGER PIN DAMAGED — "charger ka pin toot gaya" ─────────────────────
  if (/\b(charger|charging\s*pin|pin\s*toot|charging\s*port|charging.*damaged|charger.*kharab|charger.*toot)\b/i.test(pn) &&
      /\b(toot|toota|tuta|broken|damage|kharab|bend|muda)\b/i.test(pn)) {
    return `🔋 *Charger damaged / pin toot gaya?*\n\nYeh hardware replacement hai — charger khud replace mat karo (wrong charger se laptop kharab ho sakta hai).\n\nType karo *ha* — IT ticket raise karta hoon, IT sahi charger arrange karega 🎫`;
  }

  // ── 🎧 HEADPHONE MIC NOT WORKING — "headphone ka mic kaam nahi" ───────────────
  if (/\b(headphone|earphone|headset)\b.*(mic|microphone|nahi\s*sun|nahi\s*aa\s*rhi|kaam\s*nahi)\b|\b(mic|microphone)\b.*(headphone|earphone|headset)\b/i.test(pn)) {
    return `🎧 *Headphone mic kaam nahi kar rha?* — yeh try karo:\n\n1. *Input device check karo* → Taskbar pe speaker icon pe right-click → Sound settings → *"Input"* → headphone mic select karo\n2. *3.5mm jack theek se laga hai?* → properly push karo\n3. *Teams/Zoom settings check karo* → Settings → Devices → Microphone → headphone mic select karo\n\nAgar phir bhi nahi chal rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── ⌨️ EXTERNAL KEYBOARD NOT WORKING ────────────────────────────────────────
  if (/\b(external\s*keyboard|bahar\s*wala\s*keyboard|usb\s*keyboard|wired\s*keyboard)\b.*(nahi\s*chal|kaam\s*nahi|type\s*nahi|work\s*nahi)\b/i.test(pn)) {
    return `⌨️ *External keyboard kaam nahi kar rha?* — yeh try karo:\n\n1. *Alag USB port try karo* — dusre port mein lagao\n2. *Keyboard unplug/replug karo* — nikalo → 5 sec → dobara lagao\n3. *Restart karo* — laptop restart karo keyboard laga ke\n\nAgar phir bhi nahi chal rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🖱️ WIRELESS MOUSE NOT WORKING ───────────────────────────────────────────
  if (/\b(wireless\s*mouse|wifi\s*mouse|bluetooth\s*mouse|cordless\s*mouse)\b.*(nahi\s*chal|kaam\s*nahi|work\s*nahi|band)\b/i.test(pn)) {
    return `🖱️ *Wireless mouse nahi chal rha?* — yeh try karo:\n\n1. *Battery check karo* → mouse ke andar ki batteries replace karo\n2. *USB receiver check karo* → chhota USB dongle (receiver) laptop mein laga hai? Alag port mein lagao\n3. *Mouse ON/OFF button* → mouse ke neeche switch OFF → ON karo\n\nAgar phir bhi nahi chal rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💡 LAPTOP NOT CHARGING (extended) — different socket + adapter LED ────────
  // Note: Battery/charging is already covered broadly above. This catches the specific
  // "different socket / adapter LED" variant not in the main KB.
  if (/\b(charging\s*nahi|charge\s*nahi|nahi\s*charge|laptop\s*charge|charger\s*nahi\s*chal|charger.*kaam\s*nahi)\b/i.test(pn) &&
      !/toot|broken|damage|kharab|pin/i.test(pn)) {
    return `🔌 *Laptop charge nahi ho rha?* — yeh try karo:\n\n1. *Charger dono ends check karo* — laptop aur socket dono mein firmly laga hai?\n2. *Alag wall socket try karo* — extension board nahi, seedha wall socket\n3. *Adapter ki LED check karo* — charger ka light on hai? Off hai toh charger kharab ho sakta hai\n4. *Reset karo* → Laptop band karo → charger nikalo → power button 30 sec hold karo → charger lagao → on karo\n\nAgar phir bhi charge nahi ho rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🌐 INTERNET SPEED TEST — "speed test kaise karu" ────────────────────────
  if (/\b(speed\s*test|internet\s*speed\s*test|net\s*speed\s*test|check\s*speed|bandwidth\s*test|fast\.com|speedtest)\b/i.test(pn)) {
    return `🌐 *Internet speed test karna:*\n\nChrome mein *fast.com* ya *speedtest.net* kholo — automatically speed check ho jaayega\n\n💡 Sirf aapka slow hai ya sab ka? Sab ka slow → floor ka network issue hai — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🔒 PROXY SETTINGS — "proxy settings change karna" ───────────────────────
  if (/\b(proxy|proxy\s*settings|proxy\s*change|proxy\s*kya|network\s*proxy)\b/i.test(pn)) {
    return `🔒 *Proxy settings*\n\nProxy settings employees khud change nahi kar sakte — galat setting se internet band ho sakta hai.\n\nType karo *ha* — IT ticket raise karta hoon, IT handle karega 🎫`;
  }

  // ── 🔒 FIREWALL BLOCKING — "firewall blocking", "site block hai" ─────────────
  if (/\b(firewall|site\s*block|website\s*block|block\s*hai|blocked|access\s*denied|forbidden|403\s*error)\b/i.test(pn)) {
    return `🔒 *Website blocked / Firewall issue?*\n\nKuch websites company network pe restricted hoti hain. Agar koi zaroori site block hai:\n\nType karo *ha* — IT ticket raise karta hoon, IT check karega ki site access dena safe hai ya nahi 🎫`;
  }

  // ── 🖊️ DIGITAL SIGNATURE — "digital signature chahiye" ──────────────────────
  if (/\b(digital\s*signature|e-signature|esign|dsc|digital\s*sign)\b/i.test(pn)) {
    return `🖊️ *Digital Signature chahiye?*\n\nDigital signature setup karna IT ka kaam hai — token, driver sab IT install karta hai.\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 📧 NEW EMAIL ID — "naya email ID chahiye company ka" ─────────────────────
  if (/\b(naya\s*email|new\s*email|email\s*id\s*chahiye|company\s*email|wiom\s*email|company\s*gmail|new\s*account|naya\s*account)\b/i.test(pn)) {
    return `📧 *New company email ID chahiye?*\n\nCompany Gmail accounts sirf IT create karta hai — HR approval ke baad.\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 💻 LAPTOP UPGRADE REQUEST — "laptop upgrade chahiye" ────────────────────
  if (/\b(laptop\s*upgrade|upgrade\s*laptop|new\s*laptop\s*chahiye|laptop\s*badalna|laptop\s*purana|replace\s*laptop|laptop\s*replace)\b/i.test(pn)) {
    return `💻 *Laptop upgrade / replacement chahiye?*\n\nLaptop upgrade ke liye:\n\n1. *Apne Reporting Manager ko email karo* — reason explain karo\n2. *CC karo:* sajan.kumar@wiom.in\n\nManager approval ke baad IT assess karega aur arrange karega.`;
  }

  // ── 📦 SOFTWARE PURCHASE — "software purchase karna hai" ────────────────────
  if (/\b(software\s*purchase|software\s*kharidna|software\s*license|license\s*chahiye|buy\s*software|naya\s*software\s*chahiye)\b/i.test(pn)) {
    return `📦 *Software purchase / new license chahiye?*\n\n1. *Manager ko email karo* — software ka naam aur reason likho\n2. *CC karo:* sajan.kumar@wiom.in\n\nManager approval ke baad IT purchase aur install kar dega.`;
  }

  // ── 🔐 TWO-FACTOR AUTHENTICATION — "2FA setup karna hai" ────────────────────
  if (/\b(two\s*factor|2fa|2-fa|two-factor|multifactor|mfa|otp\s*setup|authenticator\s*app|google\s*authenticator|microsoft\s*authenticator)\b/i.test(pn)) {
    return `🔐 *Two-Factor Authentication (2FA) setup?*\n\nCompany accounts pe 2FA setup IT karega — employee khud galti se account lock ho sakta hai.\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 🔑 PASSWORD MANAGER — "password manager recommend karo" ─────────────────
  if (/\b(password\s*manager|password\s*save|save\s*password|password\s*bhool\s*jaata|paassword\s*yaad\s*nahi|password\s*store)\b/i.test(pn)) {
    return `🔑 *Password kaise yaad rakhe?*\n\nSabse easy tarika: *Browser ka built-in password manager use karo*\n\n• Chrome: Password save karne ke liye "Save password" pe click karo jab prompt aaye\n• Saved passwords dekhne ke liye: Chrome → Settings → Passwords\n\nNote: Company accounts ke passwords browser mein save karna generally OK hai company devices pe.\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🖥️ WIN+P / DISPLAY MODE — explicit Win+P shortcut question ───────────────
  if (/\b(win\s*[+]\s*p|win\s*p\s*kya|display\s*mode|extend\s*karna|duplicate\s*karna|second\s*screen\s*kaise|monitor\s*kaise\s*connect)\b/i.test(pn)) {
    return `🖥️ *Display mode change karna (Win+P):*\n\n*Win+P* dabao → 4 options aayenge:\n• *PC screen only* — sirf laptop screen\n• *Duplicate* — same screen dono pe\n• *Extend* — alag workspace dono screen pe (most useful)\n• *Second screen only* — sirf bahar wala monitor\n\nKoi aur IT issue ho toh batayein!`;
  }

  // ── 🛒 HARDWARE PURCHASE / NEW EQUIPMENT REQUEST ─────────────────────────
  // "headphone chahiye", "mouse ki zarurat hai", "new keyboard chahiye"
  if (/\b(chahiye|ki\s*need|ki\s*zarurat|naya|new|purchase|buy|kharidna|request|mangwana|milega|doge|de\s*do)\b/i.test(pn) &&
      /\b(headphone|earphone|mouse|keyboard|monitor|screen|webcam|charger|cable|laptop|bag|stand|hub|adapter|pendrive|hard\s*disk|ssd|ram|headset|mobile|phone|tablet)\b/i.test(pn)) {
    return `🛒 *New Equipment Request*\n\nNaya equipment lene ke liye:\n\n1. *Apne Reporting Manager ko email karo*\n2. *CC mein add karo:* sajan.kumar@wiom.in\n3. Email mein likho — kaunsa equipment chahiye aur kyun\n\nManager approval ke baad IT arrange kar dega.`;
  }

  // ── 🔆 BRIGHTNESS — simple how-to, no IT needed ─────────────────────────
  if (/brightness|screen.*bright|bright.*screen|screen.*dark|dark.*screen|aankhein.*dard|screen.*dim\b|\bdim\b.*screen/i.test(pn)) {
    return `🔆 *Brightness adjust karo:*\n\nKeyboard pe *Fn + F5* (kam) ya *Fn + F6* (zyada) dabao\nYa: Taskbar mein sun icon → slider se adjust karo`;
  }

  // ── 🖼️ WALLPAPER — simple how-to, no IT needed ───────────────────────────
  if (/wallpaper|background.*change|desktop.*change|background.*laptop/i.test(pn)) {
    return `🖼️ *Wallpaper change karna hai?*\n\nDesktop pe right-click karo → *"Personalize"* → Background → apni photo select karo`;
  }

  // ── 📋 COPY-PASTE — simple fix ───────────────────────────────────────────
  if (/copy\s*paste|ctrl\s*[+]\s*c|ctrl\s*[+]\s*v|copy\s*nahi|paste\s*nahi/i.test(pn)) {
    return `📋 *Copy-Paste nahi ho rha* — yeh try karo:\n\n1. *App restart karo* — jo app mein problem hai usse band karo → dobara open karo\n2. *Laptop restart karo* — aksar restart se theek ho jaata hai\n\nAgar phir bhi nahi hua — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── ⌨️ CAPS LOCK / NUM LOCK / SCROLL LOCK ────────────────────────────────
  if (/caps\s*lock|num\s*lock|scroll\s*lock|numlock|capslock/i.test(pn)) {
    const key = /caps/i.test(pn) ? 'Caps Lock' : /num/i.test(pn) ? 'Num Lock' : 'Scroll Lock';
    return `⌨️ *${key} Issue*\n\n*${key}* key ek baar dabao — on/off toggle hoga.\nAgar kaam nahi kiya → laptop restart karo.\n\nAgar phir bhi problem hai — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🔍 SCREEN ZOOM IN / EVERYTHING BIG ───────────────────────────────────
  if (/zoom\s*in\s*ho|sab.*bada\s*ho|bada\s*ho\s*gaya|font.*bada|text.*bada|screen.*zoom|display.*zoom|zoom.*screen/i.test(pn)) {
    return `🔍 *Screen zoom in ho gayi?* — yeh try karo:\n\n1. *Browser mein:* Ctrl + 0 dabao (zoom reset)\n2. *Poori screen badi lag rhi hai:* Ctrl + Scroll wheel neeche (zoom out)\n3. *Settings se:* Settings → Display → Scale → 100% set karo\n\nAgar theek nahi hua — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📹 CCTV — not IT scope, Admin handles ────────────────────────────────
  if (/\b(cctv|camera\s*footage|security\s*camera|recording|footage|surveillance)\b/i.test(pn)) {
    return `📹 CCTV access IT helpdesk ke scope mein nahi aata.\n\nCCTV ke liye *Admin team* se contact karo.\nKoi laptop ya IT problem ho toh batao.`;
  }

  // ── 🚫 OUT OF SCOPE — TV, AC, furniture, electricity etc. ───────────────
  // Personal phones OUT OF SCOPE — but office/company phones = IT handles
  const isPersonalPhone = /\b(apna|mera|personal|apni)\b/i.test(pn) && /\b(phone|mobile)\b/i.test(pn);
  const isOfficePhone = /\b(office|company|testing|wiom)\b/i.test(pn) && /\b(phone|mobile)\b/i.test(pn);
  // Food/pantry/personal requests — completely out of scope
  if (/\b(bhook|khaana|khana|chai\b|coffee|pani\b|water|pantry|canteen|lunch|dinner|breakfast|snack|biscuit|mujhe\s*chahiye)\b/i.test(pn) &&
      !/\b(laptop|wifi|screen|keyboard|password|teams|gmail|printer)\b/i.test(pn)) {
    return `Yeh IT helpdesk hai — sirf laptop, WiFi aur software problems handle karta hoon.\nKoi IT issue ho toh batayein!`;
  }

  if (/\b(tv|television|telly|ac\b|air\s*condition|ceiling\s*fan|light\b|bulb|electricity|current\s*nahi|power\s*cut|generator|geyser|pantry|canteen|chair|table|furniture|lift|elevator|ac\s*nahi|ac\s*band)\b/i.test(pn) &&
      !/\b(laptop|wifi|internet|software|password|teams|outlook|chrome|window|screen|monitor|keyboard|mouse|bluetooth|usb)\b/i.test(pn)) {
    return `Yeh IT ke scope mein nahi aata.\n\n*TV, AC, lights, furniture* ke liye → *Admin / Facilities team* se contact karo.\n\nIT helpdesk handle karta hai: 💻 Laptop | 🌐 WiFi | 🔑 Password | ⚙️ Software | 🖨️ Printer | 📱 Office phones\n\nKoi laptop ya IT problem ho toh batao.`;
  }
  if (isPersonalPhone && !isOfficePhone) {
    return `Personal phone IT helpdesk ke scope mein nahi hai.\n\nHam sirf *company-provided office phones* handle karte hain.\n\nKoi laptop, WiFi, ya software problem ho toh batao — main help karunga! 💻`;
  }

  // ── 📋 IT POLICY — laptop allocation, damage, return ─────────────────────
  if (/\b(policy|it\s*policy|asset\s*policy|kaun\s*sa\s*laptop|kaunsa\s*laptop|konsa\s*laptop|laptop\s*milega|laptop\s*milta|laptop\s*allocation|kaun\s*sa\s*device|which\s*laptop)\b/i.test(pn)) {
    return `📋 *WIOM Laptop Allocation Policy:*\n\n• *Technology team* → MacBook Pro\n• *Design (PODS)* → Microsoft Surface\n• *HR team* → HP Ultra 7\n• *Analytics team* → HP Ultra 7\n• *Sab baaki roles* → Windows Laptop (Intel i5)\n\nRole-based exception chahiye? Functional Head approval required.\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  if (/\b(damage.*policy|damage.*report|accidental.*damage|laptop.*toot.*policy|damage.*cover|coverage|company.*cover|kitna.*cover)\b/i.test(pn)) {
    return `📋 *Damage Policy:*\n\n• *Accidental damage* → Company cover karta hai — immediately IT ko batao with full details\n• *Loss/Theft* → 24 hours mein IT + police report → police complaint copy IT ko do\n• *Repair ≤ ₹10,000* → IT direct proceed kar sakta hai\n• *Repair > ₹10,000* → Functional Head approval pehle\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  if (/\b(laptop.*wapas|asset.*return|return.*policy|resign.*laptop|quit.*laptop|leave.*laptop|transfer.*laptop|laptop.*jama|jama.*karna|exit.*laptop)\b/i.test(pn)) {
    return `📋 *Asset Return Process:*\n\nResignation, termination, ya transfer pe:\n1. *Sab accessories ke saath* return karo (charger, mouse, bag, cables)\n2. IT condition check karega\n3. Missing accessories → market rate pe charge hoga\n4. IT clearance ke baad HR exit formalities complete hongi\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  if (/\b(unauthorized.*software|software.*install.*nahi|install.*allowed|policy.*software|software.*rule|software.*permission)\b/i.test(pn)) {
    return `⚠️ *Unauthorized Software Policy:*\n\nPolicy ke hisaab se company laptop pe *sirf approved software* install kar sakte ho.\nUnauthorized software install karna disciplinary action ka karan ban sakta hai.\n\nKoi software chahiye? Type karo *ha* — IT ticket raise karta hoon (IT approve karke install karega) 🎫`;
  }

  // ── 🔌 LAN CABLE / PORT ISSUES ───────────────────────────────────────────
  if (/\b(lan|ethernet|rj45|network\s*cable|lan\s*cable|wired)\b/i.test(pn)) {
    // REQUEST: "LAN cable chahiye / need hai / mangwana" = equipment request
    const isRequest = /\b(chahiye|need|ki\s*need|mangwana|dedo|de\s*do|milega|request|lana|kharidna)\b/i.test(pn);
    if (isRequest) return `🛒 *LAN Cable Request*\n\nNaya LAN cable lene ke liye:\n\n1. *Apne Reporting Manager ko email karo*\n2. *CC mein add karo:* sajan.kumar@wiom.in\n3. Email mein likho — kya equipment chahiye aur kyun\n\nManager approval ke baad IT arrange kar dega.`;

    // ISSUE: cable/port not working
    const isPhysical = /damage|toot|broken|kharab\s*ho\s*gaya/i.test(pn);
    if (isPhysical) return `🔌 *LAN Port/Cable physically damage hai*\n\nType karo *ha* — HIGH PRIORITY IT ticket raise karta hoon 🎫`;

    return `🔌 *LAN/Ethernet issue?* — yeh try karo:\n\n1. *Cable dono ends check karo* — click sound aana chahiye\n2. *Alag cable try karo* — cable kharab ho sakti hai\n3. *Alag port try karo* — switch/router ka dusra port\n4. *Restart karo* — cable laga ke laptop restart karo\n\nAgar phir bhi nahi chal rha → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💤 SLEEP MODE / SCREEN OFF / POWER SETTINGS ─────────────────────────
  // "laptop sleep mode me ja rha hai", "screen band ho jaati hai", "sleep band kaise karu"
  if (/\b(sleep\s*mode|sleep\s*me\s*ja|screen\s*off\s*ho|screen\s*band\s*ho|hibernate|screen\s*saver|auto.*off|automatically.*off|khud.*sleep|sleep.*band|power\s*setting|neend\s*mode)\b/i.test(pn)) {
    const isTurnOff = /band\s*karna|band\s*karo|hatana|disable|nahi\s*chahiye|rok\s*do|rukna/i.test(pn);
    if (isTurnOff || true) { // always give settings steps
      return `💤 *Laptop sleep mode se kaise rokein:*\n\n1. *Settings* kholo → *System* → *Power & Sleep*\n2. *"Sleep"* section mein → dono dropdowns → *"Never"* select karo\n3. *"Screen"* section mein bhi → *"Never"* ya zyada time set karo → OK\n\nAb laptop automatically sleep mein nahi jaayega. 👍`;
    }
  }

  // ── 💾 DATA LOSS / DELETED FILES / RECOVERY ──────────────────────────────
  // "data lost", "file delete ho gayi", "C drive ka data nahi mil rha", "recover karna"
  if (/\b(data\s*lost|data\s*loss|data\s*delete|data\s*nahi\s*mil|data\s*gum|file\s*delete|files?\s*gum|files?\s*nahi\s*mil|recover|recovery|deleted?\s*data|deleted?\s*files?|c\s*drive.*data|data.*c\s*drive|recycle|nekal\s*sakta|wapas\s*lana|wapas\s*aa)\b/i.test(pn)) {
    const isRecover = /recover|wapas|nekal|restore|delete.*wapas|wapas.*delete/i.test(pn);
    if (isRecover) {
      return `💾 *Deleted data recover karna hai?*\n\n1. *Recycle Bin check karo* — Desktop pe Recycle Bin kholo → file dhundho → right-click → Restore\n2. *Permanently delete hua?* → Recycle Bin mein nahi hai? → IT ticket raise karo — data recovery possible hai\n\nType karo *ha* — HIGH PRIORITY IT ticket raise karta hoon 🎫\n\n⚠️ *Abhi laptop use karna band karo* — jitna zyada use karoge, recover hone ke chances kam honge`;
    }
    return `💾 *Data nahi mil rha?* — yeh check karo:\n\n1. *Recycle Bin* → Desktop pe Recycle Bin kholo → deleted files wahan milti hain\n2. *Hidden files* → File Explorer → View → Show → Hidden items ON karo → dobara check karo\n3. *Alag drive check karo* → D: ya E: drive mein check karo\n\nAgar wahan bhi nahi → type karo *ha* — IT ticket raise karta hoon, data recovery try karenge 🎫`;
  }

  // ── Exit/close/bye ────────────────────────────────────────────────────────
  if (/^(bye|goodbye|exit|quit|close|band\s*karo|alvida|chalte\s*hain|nikalta)\s*[!.]*$/i.test(pn.trim()))
    return 'Theek hai! Koi aur IT issue ho toh batayein. 👍';

  // ── Brand name only (no problem) → ask what problem ──────────────────────
  // "hp laptop", "dell laptop", "lenovo" alone = vague, ask for problem
  const isBrandOnly = /^(hp|dell|lenovo|apple|macbook|thinkpad|latitude|inspiron|elitebook|probook)\s*(laptop|pc|computer|m[0-9]|gen\s*\d+)?\s*$/i.test(pn.trim());
  if (isBrandOnly) {
    return `Kya problem ho rahi hai laptop mein? Thoda describe karo — main help karunga.`;
  }

  // ── 🚫 VPN — WIOM mein use nahi hota ─────────────────────────────────────
  if (/\bvpn\b/i.test(pn)) {
    return `ℹ️ WIOM office mein VPN use nahi hota.\n\nKoi aur IT problem hai? Laptop, WiFi, software — main help karunga!`;
  }

  // ── 🪪 DOOR ACCESS CARD — IT/Admin handles ────────────────────────────────
  if (/\b(access\s*card|door\s*card|entry\s*card|id\s*card|biometric|card\s*nahi|card\s*kaam|card\s*chal|swipe|door\s*nahi\s*khul|gate\s*nahi)\b/i.test(pn)) {
    return `🪪 *Door Access Card Issue*\n\nAccess card IT ke paas se milta/reprogram hota hai.\n\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 📱 OFFICE PHONE ISSUE — IT handles company phones ────────────────────
  if (isOfficePhone || (/\b(office\s*phone|company\s*phone|testing\s*phone|wiom\s*phone|diya\s*hua\s*phone)\b/i.test(pn))) {
    return `📱 *Office Phone Issue*\n\nCompany-provided phones IT team handle karti hai.\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 🖨️ PRINTOUT REQUEST — "mujhe printout chahiye" vs printer issue ──────
  if (/\b(printout|print\s*out)\b/i.test(pn) && /need|chahiye|karo|dena|lena|nikalna|i\s*need|mujhe/i.test(pn)) {
    return `🖨️ *Printout ke liye:*\n\n1. File open karo\n2. *Ctrl+P* dabao → printer select karo → Print\n\nAgar printer nahi dikh raha ya connect nahi ho raha — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 🖨️ PRINTER — distinguish between printing issue vs network access ──────
  if (/\b(printer|print)\b/i.test(pn)) {
    const isNetworkAccess = /\b(dikh\s*nahi|nahi\s*dikh|connect\s*nahi|nahi\s*connect|network|add\s*karo|setup|install|access|nahi\s*aa\s*rha|nahi\s*mil\s*rha|find\s*nahi)\b/i.test(pn);
    if (isNetworkAccess) {
      return `🖨️ *Network Printer Access*\n\nPrinter network pe add karna IT team ka kaam hai — direct access nahi diya ja sakta.\nType karo *ha* — IT ticket raise karta hoon, IT team aapko network printer se connect kar degi 🎫`;
    }
    // Printer visible but not printing → give steps
    return `🖨️ *Printer Issue* — yeh try karo:\n\n1. *Printer restart* → Printer band karo → 30 sec → on karo\n2. *Pending jobs cancel* → Taskbar mein printer icon → cancel all pending jobs\n3. *Default printer* → Settings → Bluetooth & devices → Printers → correct printer default set karo\n4. *Laptop restart* → Laptop restart karo → dobara print karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📺 SCREEN SHARE — Teams / Zoom (software, not HDMI) ─────────────────
  if (/screen\s*share|share\s*screen|present\s*karna|presentation\s*nahi/i.test(pn) && !/hdmi|projector|external|monitor/i.test(pn)) {
    return `📺 *Screen Share Issue* — yeh try karo:\n\n1. *Teams mein:* Meeting join karo → bottom mein "Share" button → "Screen" select karo\n2. *Zoom mein:* Meeting mein "Share Screen" button dabao → window select karo\n3. *Allow karo* → agar permission maange toh "Allow" karo\n\nAgar share nahi ho rha — type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 📽️ HDMI / PROJECTOR — conference room ────────────────────────────────
  if (/\b(hdmi|projector|project|external\s*screen|external\s*monitor|conference\s*room|meeting\s*room|display\s*nahi|second\s*screen|dual\s*screen|extend\s*display)\b/i.test(pn)) {
    return `📽️ *HDMI/Projector Issue* — yeh try karo:\n\n1. *Cable check karo* → HDMI cable properly plugged in dono sides\n2. *Win+P* → keyboard pe Win+P dabao → "Extend" ya "Duplicate" select karo\n3. *Alag port try karo* → laptop ya projector pe dusra HDMI port lagao\n4. *Restart karo* → cable laga ke laptop restart karo\n\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💿 SOFTWARE INSTALLATION REQUEST — needs IT, no script can install ──
  // ── 🗑️ UNINSTALL — employees can't do this (no admin rights) ────────────────
  if (/\b(uninstall|remove\s*karna|hatana\s*hai|delete\s*karna|software\s*hata)\b/i.test(pn)) {
    const sw = /chrome/i.test(pn) ? 'Chrome' : /teams/i.test(pn) ? 'Teams' : /zoom/i.test(pn) ? 'Zoom' : 'Software';
    return `💿 *${sw} Uninstall/Remove*\n\nUninstall karne ke liye admin rights chahiye — employees khud nahi kar sakte.\n\nType karo *ha* — IT ticket raise karta hoon, IT aake handle karega 🎫`;
  }

  // "MS Office install karo", "Teams install", "Zoom install kaise karu" etc.
  // Catches: install, insatll, insatall, instaal, intsall, instll and all common install typos
  // NOTE: uninstall checked ABOVE — this only fires for fresh installation requests
  const isInstallQuery = /(?<!un)install|insatl|insatal|instaal|instat|instll|intsall|kaise.*instal|instal.*karo|instal.*karu|naya.*softw|softw.*install/i.test(pn);
  if (isInstallQuery) {
    // Identify what they want to install
    const software =
      /\bms\s*office\b|\bmicrosoft\s*office\b/i.test(pn) ? 'MS Office' :
      /\bteams\b/i.test(pn) ? 'Microsoft Teams' :
      /\bzoom\b/i.test(pn) ? 'Zoom' :
      /\boutlook\b/i.test(pn) ? 'Outlook' :  // Rare — WIOM uses Gmail but someone may ask
      /\bchrome\b/i.test(pn) ? 'Google Chrome' :
      /\bword\b|\bexcel\b|\bpowerpoint\b/i.test(pn) ? 'MS Office (Word/Excel)' :
      /\bgmail\b|\bgoogle\b/i.test(pn) ? 'Google Workspace' :
      /\bvpn\b/i.test(pn) ? 'VPN' : 'Software';
    return `💿 *${software} Installation*\n\nSoftware install karne ke liye *admin rights aur valid license key* ki zarurat hoti hai — yeh sirf IT team kar sakti hai.\n\nIT team aapke laptop par aake install kar degi.\nType karo *ha* — abhi IT ticket raise karta hoon 🎫`;
  }

  // ── 🖥️ SCREEN COLOR / DISPLAY DISTORTION / FLICKERING / LINES ──────────────
  // "colorful screen", "colour aa rha", "rang aa rha", "pink/green/yellow screen", "lines on screen"
  // ISSUE 2 fix: \bcolor\b alone too broad (matches "color theme") — require color+distortion context
  // ISSUE 3 fix: screen\s*kharab removed — "screen kharab" = physical damage, not distortion
  if ((/\b(colorful|colorfull|colarful|colarfull|colour|color\s*aa|color\s*ho|color\s*dikh|rang\s*aa|rang\s*ho|pink\s*screen|green\s*screen|yellow\s*screen|purple\s*screen|red\s*screen|tint|hue|screen\s*pe\s*rang|puri\s*screen)\b/i.test(pn) ||
       /distort|flicker|flickring/i.test(pn) ||
       /\blines?\s*(aa|on|pe|dikh|nazar)\b/i.test(pn) ||
       /screen.*\blines?\b|\blines?\b.*screen/i.test(pn) ||
       /horizontal\s*lines?|vertical\s*lines?/i.test(pn)) &&
      /\b(screen|display|monitor|laptop)\b/i.test(pn)) {
    return `Screen color/display issue hai. Yeh try karo:\n\n1. *Restart* → Laptop restart karo — driver glitch aksar restart se theek ho jaata hai\n2. *External monitor test* → HDMI se monitor connect karo — bahar sahi dikh raha toh laptop screen hardware issue hai\n\nAgar restart se theek nahi hua, type karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── 💧 WATER / LIQUID DAMAGE — CRITICAL EMERGENCY — check BEFORE generic damage ──
  // "water damage", "paani gira", "liquid spill", "bhig gaya", "chai giri" etc.
  if (/\b(water|liquid|paani|chai|coffee|juice|drink|beverage|spill|bhig|wet|geela|geeli|nami|baarish|rain)\b/i.test(pn) &&
      /\b(laptop|keyboard|device|screen|charger|port)\b/i.test(pn)) {
    return `🚨 *LIQUID/WATER DAMAGE — TURANT YEH KARO:*\n\n1. *ABHI laptop band karo* — power button hold karke force shutdown (agar on hai)\n2. *Charger/cable nikalo* — bijli bilkul nahi lagna chahiye\n3. *Ulta karo* — laptop ko seedha neeche karke rakho taaki paani bahar nikal sake\n4. *Hairdryer mat lagao* — heat se aur damage hoga\n5. *Chalane ki koshish MAT karo* — corrosion hoga, laptop permanently kharab ho sakta hai\n\nType karo *ha* — CRITICAL PRIORITY emergency ticket raise karta hoon 🎫`;
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

  // ── 🍎 APPLE ID / MACBOOK — separate from Google account & Windows password ──
  // "Apple ID bhool gaya", "MacBook ka password", "Apple M4 login nahi ho rha"
  // IMPORTANT: Apple ID ≠ Google account ≠ Windows password — completely different things
  if (/\b(apple\s*id|appleid|apple\s*account|icloud|macbook|mac\s*book|mac\s*os|macos|apple\s*m[1-4]|apple\s*password|apple.*login|apple.*password)\b/i.test(pn)) {
    return `🍎 *Apple ID / MacBook Issue*\n\nApple ID aur Google account alag hote hain — inhe mix mat karo.\n\n*Company MacBook hai?*\nIT company Apple devices manage karta hai — woh reset kar denge.\nType karo *ha* — IT ticket raise karta hoon 🎫\n\n*Personal iPhone/iPad ke liye Apple ID bhool gaye?*\nYeh personal device hai — IT scope mein nahi aata.\nApple support se help lo: *support.apple.com/en-in/forgot-password*`;
  }

  // ── 🚨 THEFT / LOSS — HIGHEST PRIORITY — check BEFORE anything else ────
  // "chori", "gum", "missing", "stolen", "lost" → NEVER say "resolved"
  if (/\b(chori|cori|churai|churaya|churaye|stolen|theft|gum\s*ho|gum\s*gaya|missing|khoya|khoyi|kho\s*gaya|kho\s*gayi|nahi\s*mila|nahi\s*mili|gum\s*gyi|gum\s*gaya)\b/i.test(pn) &&
      /\b(laptop|device|phone|mobile|tab|bag|charging)\b/i.test(pn)) {
    return `🚨 *URGENT — Laptop Chori/Gum Report*\n\nPehle yeh karo:\n\n1. *Apni desk, drawer aur aas-paas ek baar achhe se check karo* — kabhi kabhi nearby reh jaata hai\n2. *Colleagues se puchho* — kisi ne temporarily liya ho sakta hai\n\nAgar phir bhi nahi mila:\n\n3. *HR ko bhi batao* → Formal report ke liye\n\n*Main aapke liye HIGH PRIORITY ticket bana raha hoon.*\nType karo *ha* — IT ticket raise karta hoon 🎫`;
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
    return `Main *Zivon* hoon — WIOM IT Helpdesk assistant.\nLaptop, WiFi, software, password — kisi bhi IT problem mein help kar sakta hoon.\nApni problem type karo, main help karunga.`;
  }

  // ── Ticket status / ETA questions (typo-tolerant: tiket/tikket/ticket) ──
  const pTicket = pn.replace(/ti+ke+t/gi, 'ticket');
  if (/ticket\s*(kab|kb|kab\s*tak|kab\s*solve|kab\s*hoga|kab\s*fix|status|update|progress|ho\s*gaya|hua\s*kya|abhi\s*tak|kyun\s*nahi|pending)/i.test(pTicket) ||
      /kab\s*tak\s*(hoga|milega|fix\s*hoga|solve\s*hoga|resolve)/i.test(pTicket) ||
      /mera\s*ticket\s*(kab|solve|fix|hoga|ho\s*ga)/i.test(pTicket)) {
    return `Aapka ticket IT team ke paas hai. 📋 Usually same day resolve hota hai — priority ke hisaab se.\nStatus dekhne ke liye type karo: *my tickets*\nUrgent hai toh batao, IT team ko priority deta hoon. 🎫`;
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
    return `WiFi Password! 📶\n\n🔑 *Password:* \`spartans500\` — sabhi networks ke liye same\n\n*Networks:*\n• Wiom office 5g-Test — Ground floor\n• Wiom office Guest\n• Wiom office 3rd floor\n• Wiomnet — Saket office *(Password: \`Password@12345\`)*\n\nKoi aur IT issue ho toh batayein.`;
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
  // Hindi/Hinglish + English variants (ISSUE 1 fix: added English patterns)
  // FIX: exclude "wifi/net/internet nahi chal rha" from laptop won't start (greedy .* bug)
  const noWifiInMsg = !/\b(wifi|net|internet|browser|chrome|teams|outlook|gmail)\b/.test(pn);
  if (noWifiInMsg && /\blaptop\b.*(on\s*nahi|start\s*nahi|band\s*ho|nahi\s*chalta|khulta\s*nahi|nahi\s*khulta|chal\s*nahi|chalti\s*nahi|chalte\s*nahi|nahi\s*chal\s*rh)|boot\s*nahi|(switch|power)\s*on\s*nahi|\blaptop\b.*(nahi\s*(chal|start|on|boot)|on\s*ho\s*nahi)|on\s*nahi\s*ho\s*rh|won.?t\s*(turn\s*on|start|boot)|not\s*turning\s*on|not\s*starting|laptop\s*(is\s*)?(dead|not\s*starting|won.?t\s*start)|no\s*power\s*laptop/.test(pn))
    return `Yeh 3 cheezein try karo:\n\n1. *Charger check karo* — charger properly laga hai? Alag socket mein try karo\n2. *10 second hold* — power button 10 sec tak dabao → chhoddo → 30 sec wait karo → dobara try karo\n3. *Charger nikaal ke try karo* — charger hatao → power button 30 sec hold karo → charger lagao → on karo\n\nType karo *ha* — HIGH PRIORITY ticket raise karta hoon 🎫`;

  // ── Laptop automatic off/on / sudden shutdown / restart loop ────────────
  // "laptop automatic off on ho rha hai", "laptop khud band ho jaata hai", "sudden shutdown"
  // "band ho rha hai", "20 min me band", "laptop off ho jata hai", "shut down ho rha"
  if (/automatic.*off|automatic.*on|auto.*band|auto.*restart|khud.*band|band.*ho\s*ja|sudden.*shut|achanak.*band|band\s*ho\s*ja\s*rha|\d+\s*(min|mint|minute).*band|band.*\d+\s*(min|mint)|laptop.*band\s*ho\s*rh|band\s*ho\s*rh.*laptop|shut.*down.*ho\s*rh|restart\s*(ho\s*rha|kar\s*rha|loop)|off\s*on\s*ho\s*rha|on\s*off\s*ho\s*rha|laptop.*off\s*ho\s*(ja|rh)|off\s*ho\s*(ja|rh).*laptop/i.test(pn)) {
    return `⚠️ *Laptop automatically off/restart ho rha hai*\n\nYeh usually overheating ya battery issue hota hai. Yeh try karo:\n\n1. *Table pe rakho* — laptop soft surface (bed/sofa) pe mat rakho, table pe rakho taaki hawa aaye\n2. *Heavy apps band karo* → Ctrl+Shift+Esc → Task Manager → jo zyada CPU use kar raha ho End Task karo\n3. *Charger check karo* — charger properly laga hai? Alag socket try karo\n\nAgar yeh teeno karke bhi band ho raha hai — hardware issue hai, IT ko aana padega.\nType karo *ha* — HIGH PRIORITY ticket raise karta hoon 🎫`;
  }

  // ── System hang + file save — "system hang ho gya file kaise save karu" ──
  // IMPORTANT: Only fires if "save/save karna" is in the message — otherwise Excel hang goes to Excel KB
  if ((/han+g|ha+g|freeze|freez|hung|atak|stuck/i.test(pn)) &&
      (/save|bachao|data\s*bachana|save\s*kaise|save\s*karna|save\s*nahi\s*hua/i.test(pn))) {
    return `💾 *System hang hai, file save karne ke liye yeh karo — order mein:*\n\n1. *Pehle Ctrl+S try karo* — kabhi kabhi mild hang mein bhi kaam karta hai, 30 sec wait karo\n2. *2-3 minute wait karo* — system khud recover ho sakta hai, memory free hoti hai\n3. *Ctrl+Alt+Del dabao* → Task Manager → sabse zyada RAM/CPU use karne wala doosra app End Task karo → system recover ho sakta hai → phir Ctrl+S\n4. *MS Word/Excel hai?* → AutoSave ON hogi — last autosaved version automatically bach jaata hai\n5. *Agar kuch kaam nahi kiya* → Force restart karna padega (Power button 10 sec hold) → MS Word/Excel khud AutoRecover pop-up dega agle start pe\n\n⚠️ *Data loss se bachne ke liye aage se:*\nMS Office → File → Options → Save → "Save AutoRecover every ___ minutes" → *1 minute* set karo\n\nAgar baar baar hang hota hai, type karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── Overheating ──────────────────────────────────────────────────────────
  // "laptop bahut garam ho rha", "laptop heat ho rha", "laptop garm hai", "zyada heat"
  if (/\blaptop\b.*(garm|garam|heat|hot\b)|garm.{0,10}laptop|(overheat|over\s*heat|bahut\s*garam|bahut\s*garm|zyada\s*heat|zyada\s*garm|laptop\s*garm)/.test(pn))
    return `Laptop overheating issue hai. Yeh try karo:\n\n1. *Table pe rakho* → Laptop ko table par rakho — bed/sofa pe mat rakho (hawa nahi aati)\n2. *Heavy apps band karo* → Ctrl+Shift+Esc → Task Manager → CPU column → heavy apps End Task karo\n3. *Restart* → Laptop restart karo — background processes band ho jaate hain\n\nAgar bahut zyada garam ho raha hai ya band ho raha hai → type karo *ha*, IT ticket raise karta hoon 🎫`;

  // ── Screen black / blank / nothing visible ───────────────────────────────
  // "screen kali ho gyi", "black screen aa gya", "screen pe kuch nahi dikh rha", "monitor black hai"
  if (/screen\s*(kali|kala|black|blank|kuch\s*nahi\s*dikh|pe\s*kuch\s*nahi)|black\s*screen|kali\s*screen|monitor\s*(black|kala|kali|blank)|display\s*(black|kali|blank|nahi\s*aa)|(nahi\s*dikh|dikhna\s*band)\s*(rha|rhi|raha)/.test(pn))
    return `Black/blank screen issue hai. Yeh try karo:\n\n1. *Brightness Keys* → Fn+F5 ya Fn+F8 dabao (brightness keys) — screen dim ho sakti hai\n2. *Force Restart* → Power button 10 sec hold karo → band karo → dobara on karo\n3. *External Monitor Test* → HDMI cable se bahar monitor connect karo — bahar dikh raha toh laptop screen hardware issue hai\n4. *Charger Check* → Battery dead ho sakti hai → charger lagao → 10 min wait karo → on karo\n\nAgar screen ab bhi nahi aayi → type karo *ha*, IT ticket raise karta hoon 🎫`;

  // ── Windows Diagnosis / Safe Mode / Diagnostic Tool — IT only ─────
  // Employee sees "Windows Diagnosis" screen or asks about Safe Mode/Diagnostic Tool
  if (/\b(safe\s*mode|safemode|diagnostic\s*tool|windows\s*diagno|diagno.*tool|f8\s*key|advanced\s*boot|startup\s*repair|last\s*known\s*good)\b/i.test(pn)) {
    return `Yeh IT ka kaam hai — aap khud mat karo, kuch aur kharab ho sakta hai.\n\nType karo *ha* — IT ticket raise karta hoon, IT team aake fix karega 🎫`;
  }

  // ── Windows / OS crash / restart loop / update stuck ────────────────────
  // "windows crash ho gaya", "windows restart ho rha bar bar", "windows update atak gaya/stuck"
  if (/windows\s*(crash|restart|update|stuck|atak|loop|hang|diagno)|update\s*(stuck|atak|hang|nahi|ruka)|restart\s*(bar\s*bar|baar\s*baar|loop|hota\s*rha|ho\s*rha\s*bar)|os\s*(crash|hang|stuck)|windows\s*diagno/.test(pn))
    return `Windows issue aa raha hai. Yeh try karo:\n\n1. *Restart* → Power button se properly shut down karo → dobara on karo\n2. *Update hai?* → Agar Windows update chal rahi hai → wait karo, band mat karo\n\nAgar baar baar ho raha hai ya screen pe koi error aa raha hai — type karo *ha* — IT ticket raise karta hoon 🎫`;

  // ════════════════════════════════════════════════════════════════════════
  // TOP 5 MOST COMMON WIOM PROBLEMS — optimized for 300 users, 1 IT
  // ════════════════════════════════════════════════════════════════════════

  // ── 📶 WIFI / NET SLOW — most common WIOM issue ─────────────────────────
  // "wifi slow hai", "net slow hai", "internet slow", "speed nahi"
  if (/\b(net|wifi|internet|speed|bandwidth)\b.*(slow|dheema|dheemi|kam|bahut\s*slow|bahut\s*dheema|bura|bekar|nahi\s*chal\s*rha\s*theek)|slow.*(net|wifi|internet|speed)|(internet|wifi|net)\s*(bahut)?\s*(slow|dheema|weak|poor)/i.test(pn)) {
    return `📶 *WiFi/Net Slow* — yeh try karo:\n\n1. *Background apps* → Ctrl+Shift+Esc → Network column → bandwidth kha rahe apps End Task karo\n2. *WiFi toggle* → Taskbar WiFi → OFF → 10 sec → ON → "Wiom office" se connect karo\n3. *Browser cache* → Chrome → Ctrl+Shift+Del → All time → Cache → Clear\n4. *Restart* → Laptop restart karo\n\n💡 Sirf aapka slow hai ya sab ka? Sab ka slow → floor ka network issue hai.\nAgar theek nahi hua → type karo *ha*, IT ticket raise karta hoon 🎫`;
  }

  // ── 💻 MS OFFICE NOT ACTIVATED — separate from "not working" ────────────
  // "MS Office activate nahi hai", "office activated nahi", "product key chahiye"
  if (/\b(office|word|excel|powerpoint|ms\s*office)\b.*(activ|activat|license|product\s*key|register|genuine|unactivat|not\s*activ|nahi\s*activ|activation\s*error|unlicensed)/i.test(pn) ||
      /activ.*(office|word|excel|ms\s*office)/i.test(pn)) {
    return `🔑 *MS Office Activation Issue*\n\nEmployees khud MS Office activate nahi kar sakte — admin rights aur valid license key IT ke paas hoti hai.\n\nIT aapke laptop pe aake activate kar denge.\nType karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // ── ⚙️ MS OFFICE NOT WORKING / CRASHING ─────────────────────────────────
  // "word nahi khul rha", "excel crash ho rha", "laptop hag ho jata hai excel se"
  // hag/hagg = typo for hang; jab bhi + app + hang = app-specific freeze
  if (/\b(word|excel|powerpoint|ms\s*office|microsoft\s*office)\b.*(nahi\s*khul|not\s*open|crash|band\s*ho|error|kaam\s*nahi|loading|atak|stuck|response\s*nahi|han+g|ha+g|freeze|freez)/i.test(pn) ||
      /(nahi\s*khul|crash|error|han+g|ha+g|freeze).*(word|excel|powerpoint|office)/i.test(pn) ||
      (/\b(excel|word|powerpoint|office)\b/i.test(pn) && /\b(han+g|ha+g|freeze|atak|stuck|slow|ruk)\b/i.test(pn))) {
    return `⚙️ *MS Office Issue* — yeh try karo:\n\n1. *Force close* → Ctrl+Shift+Esc → Task Manager → 'Microsoft Word' ya 'Microsoft Excel' dhundho → End Task karo → dobara open karo\n2. *Restart* → Laptop restart karo → dobara open karo\n\nAgar ab bhi nahi khul raha — type karo *ha* — IT ticket raise karta hoon (IT aake repair karega) 🎫`;
  }

  // ── 🖱️ TOUCHPAD STUCK / NOT WORKING — 4th most common ──────────────────
  // "touchpad kaam nahi kar rha", "cursor stuck", "mouse nahi chal rha"
  if (/\b(touchpad|trackpad|cursor|mouse)\b.*(nahi|stuck|freeze|chal\s*nahi|kaam\s*nahi|band|work\s*nahi|move\s*nahi|response\s*nahi|hilta\s*nahi|ek\s*jagah)|cursor\s*(stuck|freeze|hilta\s*nahi|ek\s*jagah\s*hai)/i.test(pn) ||
      /(touchpad|trackpad)\s*(nahi|band|stuck|kharab)/i.test(pn)) {
    return `🖱️ *Touchpad Issue* — yeh try karo:\n\n1. *Fn key* → Keyboard pe touchpad lock key dabao:\n   • Dell: Fn+F5 | HP: Fn+F12 | Lenovo: Fn+F6\n2. *Settings* → Settings → Bluetooth & devices → Touchpad → toggle ON karo\n3. *Restart* → Laptop restart karo\n4. *External mouse* → USB mouse lagao aur type karo *ha* — IT ticket raise karta hoon 🎫`;
  }

  // Fan noise/sound (fan IS running but making noise — NOT an emergency)
  // This only runs if hasPositive check above did NOT return (i.e., user is NOT saying "fixed")
  if (/fan\s*(sound|awaaz|baj|noise|shor|loud|kar\s*rha|chal\s*rha|aa\s*rhi)/i.test(pn) ||
      /\bfan\s+(kar|chal|baj|sound)/i.test(pn)) {
    return `Fan ki awaaz aa rahi hai — usually heavy apps se hota hai 🔊\nCtrl+Shift+Esc dabao → CPU column sort karo → koi heavy app End Task karo.\nLaptop table pe rakhho (bed/sofa pe nahi).\nThodi der mein band ho jaaye toh theek hai. Agar bahut tez awaaz ho ya nahi ruki — type karo *ha*, IT ticket raise karta hoon 🎫`;
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

