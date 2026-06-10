const Groq                              = require('groq-sdk');
const { GoogleGenerativeAI }            = require('@google/generative-ai');
const Anthropic                         = require('@anthropic-ai/sdk');

// Conditional init — prevent crash if API keys missing on Railway
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Active model display (logged on first call) ──────────────────────────────
let modelLogged = false;
const activeModel = () => 'Groq llama-3.3-70b → Groq llama-3.1-8b → Claude claude-3-haiku → KB';

// ── WiFi password env vars (moved out of source code) ───────────────────────
const WIFI_PASSWORD       = process.env.WIFI_PASSWORD       || 'spartans500';
const WIFI_PASSWORD_SAKET = process.env.WIFI_PASSWORD_SAKET || 'Password@12345';
const ADMIN_EMAIL_KB      = process.env.ADMIN_EMAIL         || 'sajan.kumar@wiom.in';

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Zivon — WIOM IT Support AI for 300 non-technical office employees.

RULES (follow strictly):
- Language: Reply in same language as user (English/Hindi/Hinglish). Never mix.
- Steps: Max 3-4 SIMPLE steps only. NO CMD, Safe Mode, Device Manager, BIOS, chkdsk — employees have NO admin rights.
- End every troubleshooting reply: "Agar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi."
- NEVER say "type karo" — Messages Tab is disabled, users click buttons only.
- NEVER say ticket is already raised/sent — user must click the button.
- NEVER give phone numbers.
- Physical damage (cracked/water) → NO steps → "Create Ticket button dabao — IT team physically replace karegi 🎫"
- Theft/Loss → "Pehle desk/aas-paas check karo. Agar nahi mila → ${ADMIN_EMAIL_KB} ko email karo, Create Ticket button dabao."

WIOM FACTS:
- WiFi password: ${WIFI_PASSWORD} | Special: "Wiomnet-Saket" → ${WIFI_PASSWORD_SAKET}
- Email: GMAIL only — NEVER suggest Outlook. NEVER say outlook.office365.com
- NO VPN at WIOM
- IT: Sajan Kumar | ${ADMIN_EMAIL_KB}
- Software install/activation/password reset → TICKET ONLY (no admin rights)
- Non-IT (AC, lights, pantry, personal phone) → "Yeh IT scope mein nahi — Admin/Facilities se contact karo."

COMMON FIXES (give these steps directly):
- WiFi not working: Toggle OFF→ON → Forget & reconnect "Wiom office" (pw: ${WIFI_PASSWORD}) → Restart
- Laptop slow: Task Manager (Ctrl+Shift+Esc) → End heavy tasks → Close extra tabs → Restart
- Black screen: Fn+F5/F8 brightness → 10sec power hold restart → HDMI external monitor test
- Slack: System tray right-click Quit → Reopen → Help→Troubleshooting→Clear Cache
- Teams: System tray Quit → Reopen → teams.microsoft.com in Chrome
- Zoom: Close → Reopen → zoom.us/wc/join in Chrome
- Gmail issue: gmail.com in Chrome incognito → Ctrl+Shift+Del cache clear
- Camera: Settings→Privacy→Camera→ON → correct camera select in app
- Mic: Settings→Privacy→Microphone→ON → correct mic in app settings
- Password/Account locked: TICKET ONLY — IT resets
- Excel slow: Close other files → disable add-ins (File→Options→Add-ins) → restart Excel`;




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
    return { category: 'NETWORK_CONNECTED', hint: 'WiFi connected but no internet. Max 3 steps: 1) Toggle WiFi off/on. 2) Check if only one site is blocked — try gmail.com and another site. 3) If all sites fail → restart laptop. Agar resolve nahi hua → tell user to click Create Ticket button. Do NOT suggest CMD or ipconfig.' };

  // Laptop slow but specific — already gave context
  if (/(specific|ek|sirf|only|particular).*(app|game|software).*(slow|hang)|(slow|hang).*(specific|ek|sirf)/.test(recentText))
    return { category: 'PERFORMANCE_SPECIFIC', hint: 'User gave specific detail about slow app. Give: End Task in Task Manager for that app → clear browser cache if browser → restart laptop. If still slow → IT ticket.' };

  // Screen black but laptop is on
  if (/(black|kali|blank).*(screen|display).*(on|chal|power)|(on|chal|power).*(black|kali|blank).*(screen|display)/.test(recentText))
    return { category: 'DISPLAY_BLACK_ON', hint: 'User says screen is black but laptop is ON. SKIP question — give steps: 1. Fn+F5 ya Fn+F8 (brightness keys) dabao 2. Win+P dabao → "Extend" select karo 3. Power button 10sec hold → restart. No questions.' };

  // Password forgot — specific type
  if (/(windows|laptop|login|pc).*(password|bhool|forgot)|(password|bhool|forgot).*(windows|laptop|login|pc)/.test(recentText))
    return { category: 'ACCOUNT_WINDOWS', hint: 'Windows login password issue. SKIP question. Say directly: "Windows password sirf IT reset kar sakta hai — *Create Ticket* button dabao, IT team jaldi reset kar degi."' };

  // Outlook/Teams specific error
  if (/(gmail|email|teams).*(nahi khul|not opening|crash|band ho|error|loading|nahi aa rha|nahi chal)/.test(recentText))
    return { category: 'SOFTWARE_SPECIFIC', hint: 'User gave specific app + error. SKIP question. WIOM uses Gmail NOT Outlook. Gmail fix: incognito test → clear Chrome cache → try different browser. Teams fix: system tray quit → reopen. If Teams still fails → tell user to click Create Ticket button (IT cache clear karega). MAX 3 steps. NO %appdata% paths.' };

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

  // MICROSOFT OFFICE — all variants including 365, xlsx, docx
  if (/(ms\s*office|microsoft\s*office|office\s*365|office365|ms365|\bword\b|\bexcel\b|powerpoint|\bppt\b|xlsx|xls|docx|pptx|ms\s*word|ms\s*excel)/.test(recentText) &&
      /(nahi|not|open|crash|hang|freeze|error|issue|kaam|chal|band|stuck|loading)/.test(recentText))
    return { category: 'MICROSOFT_OFFICE', hint: 'MICROSOFT OFFICE ISSUE. Do NOT ask clarifying question. Give steps directly: 1) Force close from Task Manager → End Task → reopen. 2) Restart laptop. 3) If still fails → IT ticket for Office repair. WIOM uses Gmail NOT Outlook. For xlsx/docx file issues, same steps.' };

  // TEAMS
  if (/\bteams\b/.test(recentText) && /(nahi|not|crash|issue|open|chal|hang|error)/.test(recentText))
    return { category: 'TEAMS', hint: 'TEAMS ISSUE. Steps: 1) Right-click Teams in taskbar → Quit → reopen. 2) Restart laptop. 3) Try teams.microsoft.com in Chrome. No %appdata% steps.' };

  // ZOOM
  if (/\bzoom\b/.test(recentText) && /(nahi|not|crash|issue|open|chal|hang|error)/.test(recentText))
    return { category: 'ZOOM', hint: 'ZOOM ISSUE. Steps: 1) Close Zoom → reopen. 2) Try zoom.us in Chrome. 3) Restart laptop. If still failing → IT ticket.' };

  // CHROME / BROWSER
  if (/(chrome|chrmo|browser|edge|firefox)/.test(recentText) && /(nahi|not|crash|slow|hang|open|issue)/.test(recentText))
    return { category: 'BROWSER', hint: 'BROWSER ISSUE. Steps: 1) Force close → reopen. 2) Clear cache Ctrl+Shift+Del. 3) Restart laptop. Do NOT suggest reinstall.' };

  // PRINTER
  if (/\bprinter\b/.test(recentText) && /(nahi|not|offline|issue|print|stuck|error)/.test(recentText))
    return { category: 'PRINTER', hint: 'PRINTER ISSUE. Steps: 1) Restart printer. 2) Restart laptop. 3) IT ticket if still offline. No services.msc steps.' };

  // VPN — WIOM has no VPN
  if (/\bvpn\b/.test(recentText))
    return { category: 'VPN', hint: 'VPN: WIOM mein VPN use nahi hota. Tell user directly: "WIOM mein VPN use nahi hota. Koi aur IT issue?"' };

  // GMAIL / EMAIL
  if (/(gmail|email|mail)/.test(recentText) && /(nahi|not|issue|open|login|password|send|receive|full)/.test(recentText))
    return { category: 'GMAIL', hint: 'GMAIL ISSUE. WIOM uses Gmail NOT Outlook. Steps: 1) Open gmail.com in Chrome incognito. 2) Clear Chrome cache. 3) Try Edge browser. For password issues → IT ticket.' };

  // GOOGLE DRIVE / ONEDRIVE
  if (/(google\s*drive|gdrive|onedrive)/.test(recentText) && /(nahi|not|sync|upload|issue)/.test(recentText))
    return { category: 'CLOUD_STORAGE', hint: 'CLOUD STORAGE ISSUE. Check internet → sign out/in → IT ticket.' };

  // PDF
  if (/\bpdf\b/.test(recentText) && /(nahi|not|open|issue|convert|print)/.test(recentText))
    return { category: 'PDF', hint: 'PDF ISSUE. Open with Chrome/Edge drag-drop. For PDF to Word → Word open karo → File → Open → select PDF. No Adobe install needed.' };

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
  if (/virus|malware|hack|ransomware|suspicious|phishing|data\s*leak|unauthorized|breach|credential/.test(recentText))
    return { category: 'SECURITY', hint: 'SECURITY ISSUE. Urgent — say "Windows Security → Quick Scan karo, aur internet disconnect karo agar serious lage." Then ticket. If query is ambiguous (single word, or unclear context), ask ONE specific clarifying question. If query is clear (has device/app/symptom), give answer directly without asking.' };

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
  // Confidence scoring: short/vague queries → ask clarifying question
  const lastQ = recentText.trim().split(/\s+/).filter(Boolean);
  const hasSpecificKeyword = /\b(wifi|laptop|internet|bluetooth|keyboard|touchpad|mouse|screen|display|camera|mic|microphone|speaker|audio|printer|teams|zoom|chrome|browser|password|windows|excel|word|onedrive|usb|battery|charger|network|slow|hang|crash|headphone|projector|hdmi|monitor|fan)\b/i.test(recentText);
  if (lastQ.length <= 3 && !hasSpecificKeyword) {
    return { category: 'GENERAL_VAGUE', hint: 'Query is ambiguous (3 words or fewer, no specific IT keyword). Ask ONE specific clarifying question: "Kya problem ho rahi hai — laptop, WiFi, software, ya kuch aur?" — do NOT give steps or guess.' };
  }
  return { category: 'GENERAL', hint: 'You are a Desktop Support Engineer. Even if the issue is vague, USE YOUR IT KNOWLEDGE to give a helpful response. Do NOT just say "Thoda aur batao". If you can identify the issue from context — give steps. If truly unclear — ask ONE very specific question like "Kaunsi app mein problem hai?" or "Kab se ho raha hai?" — never a generic "batao". If query is ambiguous (single word, or unclear context), ask ONE specific clarifying question. If query is clear (has device/app/symptom), give answer directly without asking.' };
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
// ── Direct KB answers by rawKey — used BEFORE AI call in vague_pick ─────────
// These bypass AI entirely: guaranteed correct answer, zero tokens, instant
const DIRECT_KB = {
  wifi_not_connect:
    `WiFi nahi chal rha. Yeh try karo:\n\n1. *Toggle* → Taskbar WiFi icon → OFF → 10 sec ruko → ON → "Wiom office" se connect karo (password: ${WIFI_PASSWORD})\n2. *Forget & Reconnect* → WiFi settings → "Wiom office" → Forget → dobara connect karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`,

  no_internet:
    `Internet nahi chal rha (WiFi connected hai). Yeh try karo:\n\n1. *WiFi Toggle* → Taskbar WiFi → OFF → 10 sec → ON\n2. *Chrome reopen* → Chrome band karo → dobara open karo → gmail.com try karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`,

  internet_slow:
    `Internet slow chal rha hai. Yeh try karo:\n\n1. *WiFi Toggle* → Taskbar WiFi → OFF → 10 sec → ON → dobara connect karo\n2. *Chrome tabs* → Extra tabs band karo — zyada tabs se net slow hota hai\n3. *Restart* → Laptop restart karo\n4. *Jagah badlo* → Router ke paas jaao — door hone se signal weak hota hai\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`,

  keys_not_working:
    `Keyboard kaam nahi kar rha. Yeh try karo:\n\n1. *Restart* → Laptop restart karo — aksar restart se theek ho jaata hai\n2. *NumLock check* → NumLock button dabao (agar numbers type ho rahe hain letters ki jagah)\n3. *On-Screen Keyboard* → Start menu → "On-Screen Keyboard" search karo → kaam chalao\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team driver fix karega 🎫`,

  blue_screen:
    `Blue Screen (BSOD) aa rha hai. Yeh karo:\n\n1. *Error code note karo* → Screen pe jo code likha tha (jaise: MEMORY_MANAGEMENT, DRIVER_IRQL etc.)\n2. *Restart karo* → Power button 10 sec hold karo → band karo → dobara on karo\n3. *Baar baar aa rha hai?* → Ticket raise karo turant\n\nAgar theek nahi hua ya 3 baar se zyada aaya → *Create Ticket* button dabao — IT team directly help karegi 🎫`,

  external_monitor:
    `External monitor detect nahi ho rha. Yeh try karo:\n\n1. *Cable check karo* → HDMI cable dono taraf properly lagi hai? Nikal ke dobara lagao\n2. *Win+P* → Windows key + P dabao → "Extend" ya "Duplicate" select karo\n3. *Monitor ON* → External monitor ka power button check karo — on hai?\n4. *Restart* → Sab connected rakhke laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`,

  scanner_issue:
    `Scanner kaam nahi kar rha. Yeh try karo:\n\n1. *Scanner restart* → Scanner band karo → 30 sec ruko → on karo\n2. *USB cable check* → Cable properly lagi hai? Nikal ke dobara lagao\n3. *Laptop restart* → Laptop restart karo → dobara scan try karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT driver install karega 🎫`,

  file_corrupted:
    `File nahi khul rhi. Yeh try karo:\n\n1. *Right-click → Open With* → File pe right-click karo → Open With → sahi app select karo (Word/Excel/Adobe)\n2. *App restart* → App close karo → dobara open karo → phir file open karo\n3. *Laptop restart* → Laptop restart karo → dobara try karo\n\nAgar app missing hai ya file corrupt hai → *Create Ticket* button dabao — IT team install/recover karega 🎫`,

  overheat:
    `Laptop bahut garam ho rha hai. Yeh karo:\n\n1. *Table pe rakho* → Laptop ko hard surface pe rakho — bed/sofa pe mat rakho (hawa nahi milti)\n2. *Task Manager* → Ctrl+Shift+Esc → CPU column → heavy apps End Task karo\n3. *Restart* → Laptop restart karo — background processes band ho jaate hain\n4. *Fan check* → Laptop neeche se bahut garam hai aur fan nahi chal rha? Turant band karo\n\nAgar bahut zyada garam ho rha hai ya band ho rha hai → *Create Ticket* button dabao 🎫`,

  battery_issue:
    `Battery jaldi drain ho rhi hai. Yeh karo:\n\n1. *Power mode* → Taskbar battery icon → "Power saver" ya "Balanced" select karo\n2. *Screen brightness* → Fn+F5/F6 se brightness thodi kam karo\n3. *Apps band karo* → Task Manager → battery zyada use karne wale apps band karo\n\nAgar battery 0% pe bhi charge nahi ho rhi → charger laga ke 10 min wait karo phir on karo.\nAgar phir bhi problem → *Create Ticket* button dabao — IT battery check karega 🎫`,

  battery_not_charging:
    `Battery charge nahi ho rhi. Yeh try karo:\n\n1. *Charger replug* → Dono taraf se charger nikalo → dobara firmly lagao (laptop side + socket side)\n2. *Alag socket* → Doosra power socket try karo\n3. *Power reset* → Laptop band karo → charger nikalo → power button 30 sec hold karo → charger lagao → on karo\n\nAgar LED light bhi nahi aa rhi charger mein → charger kharab ho sakta hai.\nAgar theek nahi hua → *Create Ticket* button dabao — IT charger/battery replace karega 🎫`,

  touchpad_issue:
    `Touchpad/cursor kaam nahi kar rha. Yeh try karo:\n\n1. *Fn key check* → Fn + F5/F6/F7 (touchpad lock key) dabao — keyboard pe touchpad icon wali key\n2. *Settings* → Settings → Bluetooth & devices → Touchpad → ON karo\n3. *Restart* → Laptop restart karo\n\nAgar restart ke baad bhi cursor stuck hai ya nahi chal rha → *Create Ticket* button dabao — IT driver fix karega 🎫`,

  camera_issue:
    `Webcam/Camera kaam nahi kar rha. Yeh try karo:\n\n1. *Privacy settings* → Settings → Privacy & Security → Camera → ON karo\n2. *App settings* → Teams/Zoom → Settings → Video → sahi camera select karo\n3. *Restart app* → App close karo → dobara open karo\n\nAgar privacy ON hai phir bhi nahi aa rha → *Create Ticket* button dabao — IT driver fix karega 🎫`,

  mic_issue:
    `Microphone kaam nahi kar rha. Yeh try karo:\n\n1. *Privacy settings* → Settings → Privacy & Security → Microphone → ON karo\n2. *App settings* → Teams/Zoom → Settings → Audio → sahi microphone select karo → test karo\n3. *Restart app* → App close karo → dobara open karo\n\nAgar privacy ON hai phir bhi nahi sun rahe → *Create Ticket* button dabao — IT driver fix karega 🎫`,

  sound_none:
    `Speaker/Audio se awaaz nahi aa rhi. Yeh try karo:\n\n1. *Volume check* → Taskbar speaker icon pe right-click → Open Sound Settings → Volume 0% ya mute toh nahi?\n2. *Output device* → Sound settings → Output → sahi speakers/headphones select karo\n3. *Restart* → Laptop restart karo\n\nAgar headphone lagane ke baad bhi kuch nahi → *Create Ticket* button dabao — IT sound driver fix karega 🎫`,

  screen_black:
    `Screen black ho gayi. Yeh try karo:\n\n1. *Brightness keys* → Fn+F5 ya Fn+F6 ya Fn+F8 dabao — screen dim ho sakti hai, brightness badhaao\n2. *Force restart* → Power button 10 sec hold karo → band karo → 30 sec wait → dobara on karo\n3. *Charger check* → Battery dead ho sakti hai → charger lagao → 10 min wait karo → on karo\n\nAgar screen ab bhi nahi aayi → *Create Ticket* button dabao — IT team directly help karegi 🎫`,

  lan_issue:
    `LAN/Ethernet cable issue hai. Yeh try karo:\n\n1. *Cable check* → LAN cable dono taraf se nikal ke dobara firmly lagao\n2. *Alag port* → Cable ko dusre LAN port mein lagao (wall ka aur laptop ka dono check karo)\n3. *Restart* → Laptop restart karo — dobara auto-connect ho jaata hai\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT network check karega 🎫`,

  printer_issue:
    `Printer print nahi kar rha. Yeh try karo:\n\n1. *Printer restart* → Printer band karo → 30 sec → on karo\n2. *Laptop restart* → Laptop restart karo → dobara print try karo\n3. *Default printer* → Settings → Bluetooth & devices → Printers → sahi printer default set karo\n\nAgar printer list mein dikh hi nahi rha → *Create Ticket* button dabao — IT network printer setup karega 🎫`,

  website_blocked:
    `Website load nahi ho rhi. Yeh try karo:\n\n1. *Doosri website check karo* → google.com ya gmail.com kholo — woh open hoti hai?\n2. *Incognito try karo* → Ctrl+Shift+N → website dobara kholo\n3. *Cache clear karo* → Ctrl+Shift+Del → All time → Cached images → Clear → website try karo\n4. *Baad mein try karo* → Agar sirf yeh ek website hai → website ka server down ho sakta hai\n\nAgar koi bhi website nahi khul rhi → *Create Ticket* button dabao — IT network check karega 🎫`,

  app_crash:
    `Application nahi khul rha ya crash ho rha hai. Yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → application dhundho → End Task karo → dobara open karo\n2. *Restart* → Laptop restart karo → dobara try karo\n\nAgar app list mein nahi hai ya install karna hai → *Create Ticket* button dabao — IT install karega (admin rights chahiye) 🎫`,

  // ── Previously missing — all added ──────────────────────────────────────────
  network_drive:
    `Network Drive/Mapped Drive nahi dikh rha. Yeh try karo:\n\n1. *Laptop restart karo* → Aksar restart se drive wapas aa jaati hai\n2. *File Explorer* → Left panel mein "This PC" → "Z:" ya mapped drive check karo\n3. *Reconnect* → File Explorer → This PC → Computer tab → Map Network Drive\n\nAgar phir bhi nahi dikh rha → *Create Ticket* button dabao — IT drive remap karega 🎫`,

  gmail_issue:
    `Gmail kaam nahi kar rha. Yeh try karo:\n\n1. *Incognito test* → Chrome → Ctrl+Shift+N → gmail.com kholo — kaam karta hai?\n2. *Cache clear* → Ctrl+Shift+Del → All time → Cookies + Cache → Clear\n3. *Alag browser* → Edge mein gmail.com try karo\n\nAgar login hi nahi ho rha → *Create Ticket* button dabao — IT password reset karega 🎫`,

  email_login:
    `Gmail/Email login nahi ho rha. Yeh karo:\n\n*Create Ticket* button dabao — IT company Gmail account ka password reset karega.\n\nEmployees khud Google account password reset nahi kar sakte — IT karega. 🎫`,

  email_not_sending:
    `Gmail se email nahi bhej pa rhe. Yeh try karo:\n\n1. *Internet check* → Koi aur website khul rhi hai?\n2. *gmail.com directly kholo* → Chrome mein gmail.com → Compose → bhejo\n3. *Sent/Drafts check karo* → Email stuck toh nahi hai?\n\nAgar error message aa rha hai → *Create Ticket* button dabao — IT help karega 🎫`,

  email_not_receiving:
    `Gmail mein emails nahi aa rhe. Yeh check karo:\n\n1. *Spam/Junk folder* → Gmail left sidebar → Spam folder check karo\n2. *Trash folder* → Gmail → Trash mein check karo\n3. *Storage check* → Gmail settings → Storage full toh nahi?\n4. *Incognito try karo* → Ctrl+Shift+N → gmail.com → inbox check karo\n\nAgar phir bhi missing hain → *Create Ticket* button dabao 🎫`,

  calendar_sync:
    `Google Calendar sync nahi ho rha. Yeh try karo:\n\n1. *Browser mein kholo* → Chrome → calendar.google.com → events dikh rahe hain?\n2. *Cache clear* → Ctrl+Shift+Del → All time → Clear\n3. *Incognito try karo* → Ctrl+Shift+N → calendar.google.com\n\nAgar access nahi hai kisi calendar ka → *Create Ticket* button dabao — IT access dega 🎫`,

  teams_issue:
    `Teams kaam nahi kar rha. Yeh try karo:\n\n1. *Quit & Reopen* → Taskbar pe Teams icon right-click → Quit → dobara open karo\n2. *Browser mein try karo* → Chrome → teams.microsoft.com\n3. *Restart* → Laptop restart karo\n\nAgar phir bhi nahi → *Create Ticket* button dabao — IT Teams cache clear karega 🎫`,

  zoom_issue:
    `Zoom kaam nahi kar rha. Yeh try karo:\n\n1. *Close & Reopen* → Zoom band karo → dobara open karo\n2. *Browser se join karo* → Chrome → zoom.us/wc/join → Meeting ID daalo\n3. *Settings* → Zoom → Settings → Audio/Video → correct device select karo\n\nAgar install nahi hai → *Create Ticket* button dabao — IT install karega 🎫`,

  browser_slow:
    `Browser (Chrome/Edge) slow hai. Yeh try karo:\n\n1. *Cache clear* → Ctrl+Shift+Del → "All time" → Cached images & files → Clear\n2. *Extensions disable* → Chrome → Settings → Extensions → sab OFF karo\n3. *Extra tabs band karo* → zyada tabs se browser slow hota hai\n4. *Restart browser* → Band karo → dobara open karo\n\nAgar phir bhi slow hai → *Create Ticket* button dabao 🎫`,

  excel_issue:
    `Excel nahi khul rha ya crash ho rha hai. Yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → Excel dhundho → End Task → dobara open karo\n2. *Restart* → Laptop restart karo → dobara try karo\n3. *Safe Mode* → Nahi karna (admin rights nahi) → Ticket raise karo\n\nAgar phir bhi nahi khul rha → *Create Ticket* button dabao — IT repair karega 🎫`,

  word_issue:
    `Word nahi khul rha ya crash ho rha hai. Yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → Word dhundho → End Task → dobara open karo\n2. *Restart* → Laptop restart karo → dobara try karo\n\nAgar phir bhi nahi khul rha → *Create Ticket* button dabao — IT Office repair karega 🎫`,

  ppt_issue:
    `PowerPoint nahi khul rha ya crash ho rha hai. Yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → PowerPoint → End Task → dobara open karo\n2. *Restart* → Laptop restart karo → dobara try karo\n\nAgar phir bhi nahi khul rha → *Create Ticket* button dabao — IT Office repair karega 🎫`,

  office_activation:
    `MS Office activation error aa rha hai.\n\n*Create Ticket* button dabao — IT Office activate karega. Employees khud activate nahi kar sakte (admin rights nahi hain). 🎫`,

  pdf_issue:
    `PDF file nahi khul rhi. Yeh try karo:\n\n1. *Right-click → Open With* → PDF pe right-click → Open With → Adobe Acrobat select karo\n2. *Chrome mein try karo* → PDF file Chrome browser mein drag karke drop karo\n3. *Restart* → Laptop restart karo → dobara try karo\n\nAgar Adobe nahi hai → *Create Ticket* button dabao — IT install karega 🎫`,

  // ── New issues ────────────────────────────────────────────────────────────
  screen_flicker:
    `Screen flicker/blink kar rhi hai. Yeh try karo:\n\n1. *Restart* → Laptop restart karo — driver glitch aksar restart se theek hota hai\n2. *External monitor* → HDMI se monitor connect karo — bahar sahi dikh rha hai to laptop screen ka hardware issue hai\n3. *Brightness adjust* → Fn+F5/F6 se brightness adjust karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT directly help karegi 🎫`,

  projector_issue:
    `Projector/HDMI connect nahi ho rha. Yeh try karo:\n\n1. *Cable check* → HDMI cable dono taraf properly lagi hai?\n2. *Win+P* → Windows key + P dabao → Extend ya Duplicate select karo\n3. *Detect* → Right-click Desktop → Display Settings → Detect\n4. *Restart* → Sab connected rakh ke laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao 🎫`,

  usb_issue:
    `USB port kaam nahi kar rha. Yeh try karo:\n\n1. *Alag port* → Device ko dusre USB port mein lagao\n2. *Replug* → USB device nikalo → 10 sec ruko → dobara lagao\n3. *Restart* → Laptop restart karo → dobara lagao\n\nAgar koi bhi port kaam nahi kar rha → *Create Ticket* button dabao — IT team directly help karegi 🎫`,

  fan_noise:
    `Fan loud noise kar rha hai. Yeh karo:\n\n1. *Check karo* → Agar smoke, burning smell ya bahut zyada heat → TURANT laptop band karo\n2. *Task Manager* → Ctrl+Shift+Esc → heavy apps End Task karo\n3. *Surface* → Laptop hard table pe rakho, soft surface pe mat\n\nAgar noise band nahi ho rhi → *Create Ticket* button dabao — IT fan check karega 🎫`,

  frequent_disconnect:
    `WiFi baar baar disconnect ho rhi hai. Yeh try karo:\n\n1. *WiFi Toggle* → Taskbar WiFi → OFF → 10 sec → ON → dobara connect karo\n2. *Router ke paas jaao* → Door hone se signal weak hota hai\n3. *Forget & Reconnect* → WiFi settings → "Wiom office" → Forget → dobara connect (pw: ${WIFI_PASSWORD})\n\nAgar baar baar ho rha hai → *Create Ticket* button dabao — IT network check karega 🎫`,

  door_access:
    `Door access card issue. Yeh karo:\n\n*Create Ticket* button dabao — IT/Admin department new card issue karega ya existing card reprogram karega.\nTicket mein likho: kaunsa floor/door ka access chahiye. 🎫`,

  mobile_not_working:
    `**Company Phone Not Working**\n\nYour company phone needs IT support. Please raise a ticket.\n\n**What to include in your ticket:**\n- Phone model and IMEI number\n- Exact problem (won't turn on / screen issue / software problem)\n- When the issue started\n\nIT team will resolve it promptly.`,

  sim_not_working:
    `**Company SIM Not Working**\n\nSIM issues need IT support.\n\n**What to include in your ticket:**\n- Your SIM number (printed on SIM card)\n- Network provider\n- Problem (no signal / calls not working / data not working)\n\nIT team will contact the carrier and resolve it.`,

  mobile_internet:
    `**Mobile Internet Not Working**\n\nTry these steps first:\n1. Toggle Airplane Mode ON → wait 10 seconds → OFF\n2. Settings → Mobile Data → ensure it's ON\n3. APN settings — check with IT if unsure\n4. Restart your phone\n\nIf still not working, raise a ticket with your phone model and carrier.`,

  email_mobile:
    `**Setting Up Company Email on Phone**\n\nCompany email setup requires IT assistance.\n\n**Required:**\n- Your company email address\n- Phone model (Android/iPhone)\n- IT will configure Google Workspace/Gmail on your device\n\nRaise a ticket and IT will set it up for you.`,

  mobile_app:
    `**Company Mobile App Not Working**\n\nTry these steps:\n1. Force close the app → reopen\n2. Clear app cache: Settings → Apps → [App Name] → Clear Cache\n3. Restart your phone\n4. Uninstall and reinstall the app\n\nIf still failing, raise a ticket with: app name, phone model, error message screenshot.`,

  mobile_charging:
    `**Company Phone Not Charging**\n\n1. Try a different USB cable\n2. Try a different charger/power adapter\n3. Clean the charging port gently with a dry brush\n4. Try wireless charging if supported\n\nIf the phone still won't charge, raise a ticket — IT will arrange a replacement charger or send the phone for repair.`,

  mobile_screen_damage:
    `**Company Phone Screen Damaged**\n\nScreen damage requires IT assessment.\n\n**Do not attempt self-repair.**\n\nRaise a ticket immediately with:\n- Photo of the damage\n- How it happened\n- Whether the phone is still functional\n\nIT will arrange repair or replacement per company policy.`,

  google_drive_issue:
    `Google Drive kaam nahi kar rha. Yeh try karo:\n\n1. *Browser mein kholo* → Chrome mein drive.google.com kholo\n2. *Cache clear* → Ctrl+Shift+Del → All time → Clear\n3. *Incognito try karo* → Ctrl+Shift+N → drive.google.com\n\nAgar access nahi hai → *Create Ticket* button dabao — IT access dega 🎫`,

  shared_drive_issue:
    `Shared Drive access nahi hai.\n\n*Create Ticket* button dabao — IT aapko shared drive ka access dega.\nTicket mein likho: kaunsa drive/folder chahiye aur kyun. 🎫`,

  file_sync_issue:
    `Files sync nahi ho rhi. Yeh try karo:\n\n1. *Internet check* → WiFi properly connected hai?\n2. *Browser check* → drive.google.com mein manually dekho\n3. *Sign out/in* → Drive app se sign out → dobara sign in karo\n\nAgar phir bhi nahi → *Create Ticket* button dabao 🎫`,

  storage_full:
    `Storage/disk full hai. Yeh try karo:\n\n1. *Recycle Bin* → Desktop Recycle Bin → Empty Recycle Bin\n2. *Downloads* → File Explorer → Downloads → jo zaruri nahi delete karo\n3. *Google Drive pe move karo* → Files cloud pe upload karo\n\nAgar space kam hai → *Create Ticket* button dabao — IT storage cleanup karega 🎫`,

  phishing_email:
    `Phishing/suspicious email aaya hai!\n\n1. *Link mat dabao* → Email mein koi bhi link ya attachment BILKUL mat dabao\n2. *Gmail mein Report* → Email → 3 dots → Report phishing\n3. *IT ko batao* → *Create Ticket* button dabao — IT investigate karega 🎫\n\n⚠️ Agar link dabao diya → TURANT ticket raise karo!`,

  virus_malware:
    `Virus/Malware suspect ho rha hai!\n\n1. *Internet band karo* → WiFi disconnect karo TURANT\n2. *Create Ticket* → ABHI raise karo — IT directly aayega\n\n⚠️ Kuch bhi mat karo laptop pe — IT aayega 🎫`,

  suspicious_login:
    `Suspicious login hai — TURANT yeh karo:\n\n1. *Create Ticket* → Abhi raise karo — HIGH priority\n2. *IT ko email* → ${ADMIN_EMAIL_KB}\n\nIT aapka account secure karega. Password khud mat badlo — IT karega. 🎫`,

  security_alert:
    `Security alert aa rha hai.\n\n*Create Ticket* button dabao — IT security investigate karega.\nTicket mein exact alert message likho. 🎫`,

  account_hacked:
    `Account hack hua hai — EMERGENCY!\n\n1. *Create Ticket ABHI* → CRITICAL priority\n2. *IT ko email* → ${ADMIN_EMAIL_KB}\n3. *Kuch bhi mat karo* → Account pe koi changes mat karo\n\nIT turant secure karega. 🎫`,

  burning_smell:
    `EMERGENCY! Burning smell ya smoke!\n\n1. *TURANT BAND KARO* — Power button hold karo\n2. *CHARGER NIKALO* — Immediately\n3. *DOOR RAHO* — Laptop chhodo safe jagah rakho\n4. *IT ko batao* → ${ADMIN_EMAIL_KB}\n\n*Create Ticket* dabao → CRITICAL emergency 🎫`,

  battery_swelling:
    `EMERGENCY! Battery swollen/phool gayi!\n\n1. *TURANT BAND KARO* — Power button hold\n2. *CHARGER NIKALO* — Abhi\n3. *LAPTOP DOOR RAKHO* — Fire hazard\n4. *IT ko batao* → ${ADMIN_EMAIL_KB}\n\n*Create Ticket* dabao → CRITICAL emergency 🎫`,

  data_loss:
    `Files/data missing hain. Yeh try karo:\n\n1. *Recycle Bin* → Desktop Recycle Bin mein dekho\n2. *Google Drive Trash* → drive.google.com → Trash folder\n3. *Search karo* → File Explorer mein file name search karo\n\nAgar nahi mili → *Create Ticket* button dabao — IT data recovery try karega 🎫`,

  physical_damage:
    `Laptop physically damage hua hai.\n\nSoftware se fix nahi hoga — *Create Ticket* button dabao TURANT.\nIT physically assess aur repair/replace karega.\nTicket mein damage ka description likho. 🎫`,

  liquid_damage:
    `EMERGENCY! Liquid/Paani gira hai!\n\n1. *TURANT BAND KARO* — Power button hold\n2. *CHARGER NIKALO*\n3. *ULTA RAKHO* → Liquid drain hone do\n4. *Hairdryer mat lagao*\n5. *IT ko batao* → ${ADMIN_EMAIL_KB}\n\n*Create Ticket* dabao → CRITICAL emergency 🎫`,

  device_lost:
    `Device kho gaya hai ya chori hua hai.\n\n1. *Pehle check karo* → Desk/drawer/aas-paas check karo, colleagues se puchho\n2. *Agar nahi mila* → *Create Ticket* button dabao — HIGH PRIORITY\n3. *IT ko email* → ${ADMIN_EMAIL_KB}\n4. *HR ko bhi batao*\n\n⚠️ 24 ghante mein report karna zaruri hai. 🎫`,

  // ── Additional DIRECT_KB entries — bypasses AI for common issues ─────────────
  excel_slow:
    `**Excel Running Slow or Freezing**\n\n1. Close unnecessary Chrome tabs and other applications first\n2. Disable add-ins: Excel → File → Options → Add-ins → Manage: COM Add-ins → Go → uncheck all → OK → restart Excel\n3. Remove heavy conditional formatting: Home → Conditional Formatting → Clear Rules → Clear Rules from Entire Sheet\n4. Save as .xlsx (File → Save As → choose .xlsx format — old .xls format is slower)\n5. If file is very large (>5MB): raise a ticket — IT will check RAM\n\nAgar ab bhi slow hai → *Create Ticket* button dabao 🎫`,

  chrome_issue:
    `**Google Chrome Not Working**\n\n1. Hard refresh: Ctrl + Shift + R (force reload)\n2. Clear cache: Ctrl + Shift + Delete → select "All time" → tick "Cached images and files" + "Cookies" → Clear data\n3. Disable extensions: Menu (⋮) → More tools → Extensions → toggle all OFF → restart Chrome\n4. If Chrome won't open: Ctrl+Shift+Esc → Task Manager → find all "chrome.exe" → End Task → reopen Chrome\n5. Reset Chrome settings: Settings → scroll down → Reset settings → Restore settings to defaults\n\nAgar ab bhi nahi chal rha → *Create Ticket* button dabao 🎫`,

  edge_issue:
    `**Microsoft Edge Not Working**\n\n1. Hard refresh: Ctrl + Shift + R\n2. Clear cache: Ctrl + Shift + Delete → All time → Clear data\n3. Disable extensions: Menu (…) → Extensions → Manage extensions → disable all → restart Edge\n4. Reset Edge: Settings → Reset settings → Restore settings to defaults → Reset\n5. If Edge keeps crashing: raise a ticket — may need reinstall\n\nAgar ab bhi nahi chal rha → *Create Ticket* button dabao 🎫`,

  slack_issue:
    `**Slack Not Working**\n\n1. Quit Slack completely: System tray (bottom-right) → right-click Slack icon → Quit\n2. Reopen Slack from desktop/taskbar\n3. If messages not loading: Slack → Help → Troubleshooting → Clear Cache and Restart\n4. Check internet: open Chrome → try gmail.com — if that also fails, WiFi issue hai\n5. Try Slack Web as backup: open Chrome → slack.com → log in\n\nAgar Slack bilkul nahi khulta → *Create Ticket* button dabao 🎫`,

  password_reset:
    `**Password Reset**\n\n⚠️ Company passwords can only be reset by IT — employees cannot self-reset.\n\n*Raise a ticket* and IT will reset your password within 30 minutes during office hours.\n\n*Include in your ticket:*\n- Which account (Windows login / Gmail / other app)\n- Your employee ID\n- Is your work completely stopped?\n\n*Create Ticket* button dabao — IT turant help karega 🎫`,

  account_locked:
    `**Account Locked**\n\nYour account has been locked due to multiple failed login attempts.\n\n⚠️ Only IT can unlock accounts — you cannot do this yourself.\n\n*Raise a ticket immediately* — IT will unlock within 15 minutes during office hours.\n\n*Include in your ticket:*\n- Which account is locked (Windows / Gmail / app name)\n- Your employee ID\n- Error message you are seeing\n\n*Create Ticket* button dabao — URGENT! 🎫`,

  email_access:
    `**Company Email Access Issue**\n\nNew email account setup or existing access issues are handled by IT only.\n\n*Raise a ticket* with:\n- Your full name and employee ID\n- Type of request (new account / can't login / password reset / other)\n- Is this blocking your work completely?\n\nIT will set up or restore access within 1 working day.\n\n*Create Ticket* button dabao 🎫`,

  shared_folder:
    `**Shared Folder / Drive Access**\n\nShared folder and drive access is managed by IT — you cannot grant it yourself.\n\n*Raise a ticket* with:\n- Name of the shared folder or drive\n- Type of access needed (view only / edit / full access)\n- Your manager's name (manager approval is required)\n\nIT will grant access within 1 working day after manager confirmation.\n\n*Create Ticket* button dabao 🎫`,

  outlook_email:
    `**Email Issue**\n\n⚠️ WIOM uses Gmail (Google Workspace) — NOT Outlook.\n\n*For Gmail issues:*\n1. Go to gmail.com in Chrome and sign in with your company email\n2. If you can't sign in → raise a ticket for IT to reset your password\n3. If Gmail is slow → clear cache: Ctrl+Shift+Delete → All time → Clear data\n4. Check Spam/Junk folder if emails are missing\n\nStill having issues? *Create Ticket* button dabao 🎫`,

  otp_issue:
    `**OTP / Two-Factor Authentication Not Working**\n\n1. Check phone signal — OTP needs network to arrive\n2. OTP expires in 30-60 seconds — enter it immediately after it arrives\n3. Check if your phone time/date is correct (wrong time = wrong OTP in authenticator apps)\n4. Use the "Resend OTP" button and try again\n5. If using Google Authenticator app: open app → tap 3 dots → Sync now (fixes time drift)\n\nIf your registered phone number has changed → *Create Ticket* button dabao — IT will update it 🎫`,

  software_access:
    `**Software / Application Access Required**\n\nAccess to software and applications is granted by IT — you cannot request it directly from the vendor.\n\n*Raise a ticket* and include:\n- Software/application name (e.g. Tally, AutoCAD, Adobe, VPN, etc.)\n- Your employee ID and department\n- Business reason / who asked you to use it\n- Your manager's name (approval may be required)\n\nIT will set up access within 1 working day.\n\n*Create Ticket* button dabao 🎫`,
};

const getKBFallback = (problem) => {
  const p = problem.toLowerCase();

  // Normalize common typos so matching below is simpler
  const pn = p
    .replace(/\bwiffi\b/g, 'wifi')
    .replace(/\bwifi+\b/g, 'wifi')
    .replace(/\bl[ae]?p?to?[op]{1,2}\b|\blaotop\b|\blaptoop\b|\blaptp\b/g, 'laptop') // leptop, lptop, latop, laptoop
    .replace(/\bpas?w?ro?d\b|\bpasswrod\b|\bpaswrod\b|\bpasword\b/g, 'password')       // pasword, paswrod
    .replace(/\btims?\b/g, 'teams')                  // tims, tim (Teams typo)
    .replace(/\bcamra\b/g, 'camera')                 // camra
    .replace(/\bkeybo?r?a?d\b|\bkeybord\b|\bkeyborad\b|\bkeybrd\b/g, 'keyboard')       // keyborad, keybord
    .replace(/\bcharg(e|er|ing)?\b/g, 'charging')    // normalize charger/charging variants
    .replace(/\bprinte\b|\bprintr\b|\bpirnt\b|\bprntr\b/g, 'printer')  // printer typos
    .replace(/\bmonitr\b|\bmoniter\b/g, 'monitor')                       // monitor typos
    .replace(/\bbluetoth\b|\bbluethooth\b/g, 'bluetooth')                // bluetooth typos
    .replace(/\bsceern\b|\bscreeen\b|\bscren\b|\bscrren\b|\bscrean\b/g, 'screen')   // screen typos (screeen = 3 e's)
    .replace(/\bmicrofone\b|\bmicrophne\b|\bmicrphone\b/g, 'microphone') // microphone typos
    .replace(/\bspeakr\b|\bspeeker\b|\bspekar\b/g, 'speaker')           // speaker typos
    .replace(/\bheadfone\b|\bheadfoan\b|\bearfone\b/g, 'headphone')     // headphone typos
    .replace(/\bprojekter\b|\bprojetor\b|\bprojctor\b/g, 'projector')   // projector typos
    .replace(/\bscanar\b|\bscaner\b|\bscannr\b/g, 'scanner')            // scanner typos
    .replace(/\brooter\b|\bmodem\b/g, 'router');     // router synonyms

  // WiFi connected but no internet
  if (/connect(ed)?.*(nahi chal|work nahi|internet nahi|nahi work)|wifi.*(connected|chal).*(internet nahi|nahi chal)|(no internet|internet nahi).*(connected|connect)/.test(pn))
    return `WiFi connected hai par internet nahi chal raha. Yeh try karo:\n\n1. *WiFi toggle* → Taskbar WiFi → OFF → 10 sec → ON\n2. *Chrome reopen* → Chrome band karo → dobara open karo → gmail.com try karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Browser slow — check BEFORE generic slow to avoid wrong match
  if ((pn.includes('browser') || pn.includes('chrome') || pn.includes('edge')) &&
      (pn.includes('slow') || pn.includes('hang') || pn.includes('freez') || pn.includes('lagg')))
    return `Browser slow hai. Yeh try karo:\n\n1. *Cache clear* → Ctrl+Shift+Del → "All time" → Cached images & files → Clear\n2. *Extensions band* → Chrome → Settings → Extensions → sab disable karo\n3. *Restart browser* → Band karo → dobara open karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Excel slow — check BEFORE generic slow
  if (pn.includes('excel') && (pn.includes('slow') || pn.includes('hang') || pn.includes('freez')))
    return `Excel slow/hang ho rha hai. Yeh try karo:\n\n1. *Doosri files band karo* → koi aur Excel file khuli hai? Band karo\n2. *Add-ins disable* → File → Options → Add-ins → Manage: COM Add-ins → Go → sabko uncheck karo\n3. *Restart karo* → Excel band karo → laptop restart karo → dobara kholo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT repair karega 🎫`;

  // Teams slow
  if (pn.includes('teams') && (pn.includes('slow') || pn.includes('hang') || pn.includes('lagg')))
    return `Microsoft Teams slow hai. Yeh try karo:\n\n1. *Quit & Reopen* → Taskbar Teams icon → right-click → Quit → dobara open karo\n2. *Browser mein try karo* → teams.microsoft.com Chrome mein open karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Generic laptop slow — only when NO app/browser/software context
  if ((pn.includes('slow') || pn.includes('hang') || pn.includes('freez') || pn.includes('dheema') || pn.includes('lagg')) &&
      !pn.includes('browser') && !pn.includes('chrome') && !pn.includes('edge') && !pn.includes('excel') &&
      !pn.includes('word') && !pn.includes('teams') && !pn.includes('zoom') && !pn.includes('internet') &&
      !pn.includes('wifi') && !pn.includes('website') && !pn.includes('slack') && !pn.includes('gmail') &&
      !pn.includes('outlook') && !pn.includes('app') && !pn.includes('software') && !pn.includes('pdf'))
    return `💻 *Laptop Slow/Hang* — yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → CPU column → jo zyada use kar raha ho End Task karo\n2. *Browser tabs* → unnecessary Chrome/Edge tabs band karo\n3. *Restart* → Laptop properly shut down karo (restart, sleep nahi)\n\nAgar in teeno se theek nahi hua → *Create Ticket* button dabao — IT team RAM ya SSD check karegi 🎫`;

  if (pn.includes('wifi') || pn.includes('internet') || pn.includes('network') ||
      /\bnet\b/.test(pn) || pn.includes('net band') || pn.includes('signal nahi') || pn.includes('no internet'))
    return `WiFi/Internet issue. Yeh try karo:\n\n1. *Toggle* → Taskbar WiFi → OFF → 10 sec → ON → "Wiom office" se connect karo (password: ${WIFI_PASSWORD})\n2. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Laptop won't start / boot / turn on
  // ISSUE 5 fix: added English boot phrases ("won't turn on", "not turning on", "laptop dead")
  if (/\b(laptop|leptop|lptop|latop)\b.*(on\s*nahi|start\s*nahi|band\s*ho|nahi\s*chalta|khulta\s*nahi|nahi\s*khulta|chal\s*nahi|chalti\s*nahi|chalte\s*nahi)|boot\s*nahi|(switch|power)\s*on\s*nahi|laptop\s*nahi\s*(chal|start|on|boot)|on\s*nahi\s*ho\s*rh|(nahi\s*ho\s*rh|nahi\s*chal).*(laptop|leptop|lptop|latop)|won.?t\s*(turn\s*on|start|boot)|not\s*turning\s*on|not\s*starting|laptop\s*(is\s*)?(dead|not\s*starting)|no\s*power\s*laptop/.test(pn))
    return `Yeh 3 cheezein try karo:\n\n1. *Charger check karo* — charger properly laga hai? Alag socket mein try karo\n2. *10 second hold* — power button 10 sec tak dabao → chhoddo → 30 sec wait karo → dobara try karo\n3. *Charger nikaal ke try karo* — charger hatao → power button 30 sec hold karo → charger lagao → on karo\n\n*Create Ticket* button dabao — HIGH PRIORITY ticket raise hoga 🎫`;

  // Overheating
  if (/\b(laptop|leptop|lptop|latop)\b.*(garm|garam|heat|hot\b)|garm.*(laptop|leptop)|(overheat|over\s*heat|bahut\s*garam|bahut\s*garm|zyada\s*heat|zyada\s*garm)/.test(pn))
    return `Laptop overheating issue hai. Yeh try karo:\n\n1. *Table pe rakho* → Laptop ko table par rakho — bed/sofa pe mat rakho (hawa nahi aati)\n2. *Heavy apps band karo* → Ctrl+Shift+Esc → Task Manager → CPU column → heavy apps End Task karo\n3. *Restart* → Laptop restart karo — background processes band ho jaate hain\n\nAgar bahut zyada garam ho raha hai ya band ho raha hai → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Screen black / blank / nothing visible
  if (/screen\s*(kali|kala|black|blank|kuch\s*nahi)|black\s*screen|kali\s*screen|monitor\s*(black|kala|kali|blank)|display\s*(black|kali|blank|nahi\s*aa)|screen\s*pe\s*kuch\s*nahi|(screen|display|monitor|laptop).*(nahi\s*dikh|dikhna\s*band)|(nahi\s*dikh|dikhna\s*band).*(screen|display|monitor|laptop)/.test(pn))
    return `Black/blank screen issue hai. Yeh try karo:\n\n1. *Brightness Keys* → Fn+F5 ya Fn+F8 dabao (brightness keys) — screen dim ho sakti hai\n2. *Force Restart* → Power button 10 sec hold karo → band karo → dobara on karo\n3. *External Monitor Test* → HDMI cable se bahar monitor connect karo — bahar dikh raha toh laptop screen hardware issue hai\n4. *Charger Check* → Battery dead ho sakti hai → charger lagao → 10 min wait karo → on karo\n\nAgar screen ab bhi nahi aayi → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Screen color distortion / flickering / lines
  if ((/colorful|colorfull|colarful|colarfull|colour|color\s*aa|rang\s*aa|pink\s*screen|green\s*screen|screen\s*pe\s*rang|display.*color|color.*display|screen\s*kharab/.test(pn) ||
       /distort|flicker|flickring/i.test(pn) ||
       /lines\s*(aa|on|on\s*screen|pe)|screen.*lines|horizontal\s*lines?|vertical\s*lines?/.test(pn)) &&
      /screen|display|monitor|laptop/.test(pn))
    return `Screen color/display issue hai. Yeh try karo:\n\n1. *Restart* → Laptop restart karo — driver glitch aksar restart se theek ho jaata hai\n2. *External monitor test* → HDMI se monitor connect karo — bahar sahi dikh raha toh laptop screen hardware issue hai\n\nAgar restart se theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Windows update / OS crash / restart loop
  if (/windows\s*(crash|restart|update|stuck|atak|loop|hang)|update\s*(stuck|atak|hang|nahi|ruka)|restart\s*(bar\s*bar|baar\s*baar|loop|hota\s*rha|ho\s*rha\s*bar)|os\s*(crash|hang|stuck)/.test(pn))
    return `Windows issue hai. Yeh try karo:\n\n1. *Restart* → Power button se properly shut down karo → dobara on karo\n2. *Wait* → Agar Windows update chal rahi hai → wait karo, band mat karo\n\nAgar 3 baar se zyada restart ho raha hai ya nahi ruk raha → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if ((pn.includes('sound') || pn.includes('audio') || pn.includes('speaker') || pn.includes('headphone')) && !pn.includes('zoom') && !pn.includes('teams') && !pn.includes('call'))
    return `Audio issue. Yeh try karo:\n\n1. *Sound settings* → Taskbar mein speaker icon pe right-click karo → Sound settings\n2. *Output device* → sahi device select karo\n3. *Volume check* → 0% ya mute toh nahi?\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('blue screen') || pn.includes('bsod'))
    return `Blue Screen issue. Yeh karo:\n\n1. *Error code note karo* — screen pe jo likha tha woh\n2. *Restart karo* — aksar ek restart se theek ho jaata hai\n3. Agar 3 baar se zyada aaya hai → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charging/.test(pn))
    return `Battery/Charging issue. Yeh try karo:\n\n1. *Charger check karo* → dono taraf firmly laga hai? (laptop side + socket side)\n2. *Alag socket try karo*\n3. *Reset karo* → Laptop band karo → charger nikalo → power button 30 sec hold karo → charger lagao → on karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // ISSUE 4 fix: removed dead code — black screen already handled above (line ~361)

  if (pn.includes('keyboard') || pn.includes('keys') || /keybo?r?a?d/.test(pn))
    return `Keyboard issue. Yeh try karo:\n\n1. *Restart* → Laptop restart karo\n2. *On-screen keyboard* → Start menu mein "On-Screen Keyboard" type karo → open karo → kaam chalao\n\n*Create Ticket* button dabao — IT aake fix karega 🎫`;

  if (pn.includes('touchpad') || pn.includes('mouse'))
    return `Touchpad issue. Yeh try karo:\n\n1. *Fn key* → Fn + touchpad lock key dabao (keyboard pe lock icon wali key)\n2. *Settings* → Settings → Bluetooth & devices → Touchpad → ON karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('printer'))
    return `Printer issue. Yeh try karo:\n\n1. *Printer restart* → Printer band karo → 30 sec → on karo\n2. *Laptop restart* → Laptop restart karo → dobara print karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // MS OFFICE NOT WORKING / CRASHING — all variants including 365, xlsx, docx, pptx
  if (
    /\b(ms\s*office|microsoft\s*office|office\s*365|office365|ms365|word|excel|powerpoint|ppt|xlsx|xls|docx|doc\b|pptx|office\s*file|office\s*app|ms\s*word|ms\s*excel)\b/i.test(pn) &&
    /\b(nahi\s*khul|not\s*open|open\s*nahi|nahi\s*chal|crash|hang|ha+g|freeze|freez|error|band\s*ho|kaam\s*nahi|loading|stuck|atak|response\s*nahi|start\s*nahi|nahi\s*start)\b/i.test(pn)
  ) {
    return `⚙️ *MS Office Issue* — yeh try karo:\n\n1. *Force close* → Ctrl+Shift+Esc → Task Manager → Microsoft Word/Excel dhundho → End Task → dobara open karo\n2. *Restart karo* → Laptop restart karo → dobara open karo\n\nAgar phir bhi nahi khul rha → *Create Ticket* button dabao — IT aake repair karega 🎫`;
  }

  // Office 365 subscription/access issue
  if (/\b(office\s*365|microsoft\s*365|ms\s*365|office365)\b/i.test(pn) &&
      /\b(issue|problem|nahi|error|kaam\s*nahi|access\s*nahi|open\s*nahi|chal\s*nahi|activate|license)\b/i.test(pn)) {
    return `⚙️ *Microsoft Office 365 Issue*\n\nYeh try karo:\n\n1. *Restart* → Laptop restart karo\n2. *Internet check karo* → Office 365 ke liye internet chahiye\n\nAgar phir bhi problem → *Create Ticket* button dabao — IT team directly help karegi 🎫`;
  }

  if (pn.includes('slack'))
    return `Slack issue. Yeh try karo:\n\n1. *Quit karo* → Taskbar mein Slack icon right-click → Quit\n2. *Dobara open karo* → Start menu se Slack open karo\n3. *Cache clear* → Agar bhi nahi → Help → Troubleshooting → Clear Cache & Restart\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('teams'))
    return `Teams issue. Yeh try karo:\n\n1. *Quit & Reopen* → Taskbar pe Teams icon right-click → Quit → dobara open karo\n2. *Browser mein try karo* → teams.microsoft.com Chrome mein open karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('zoom'))
    return `Zoom issue. Yeh try karo:\n\n1. *Restart karo* → Zoom close karo → dobara open karo\n2. *Browser mein try karo* → zoom.us/wc/join Chrome mein kholo\n3. *Settings* → Zoom Settings → correct device select karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('calendar'))
    return `Google Calendar issue. Yeh try karo:\n\n1. *Browser mein check karo* → Chrome mein calendar.google.com kholo\n2. *Cache clear karo* → Ctrl+Shift+Del → All time → Clear\n3. *Incognito try karo* → Ctrl+Shift+N → calendar.google.com\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('chrome') && (pn.includes('nahi') || pn.includes('crash') || pn.includes('open')))
    return `Chrome issue. Yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → Chrome dhundho → End Task\n2. *Dobara open karo*\n3. *Laptop restart karo* → Agar bhi nahi\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('edge') && (pn.includes('nahi') || pn.includes('crash') || pn.includes('open')))
    return `Edge browser issue. Yeh try karo:\n\n1. *Task Manager* → Ctrl+Shift+Esc → Edge dhundho → End Task\n2. *Dobara open karo*\n3. *Chrome use karo* → Abhi ke liye Chrome browser use karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  // Phishing/suspicious email — MUST come before generic email check
  if (/phishing|suspicious\s*email|suspicious\s*link|spam\s*mail|fake\s*email|fraud\s*email/.test(pn))
    return `Phishing/suspicious email aaya hai!\n\n1. *Link mat dabao* → Email mein koi bhi link ya attachment BILKUL mat dabao\n2. *Gmail mein Report* → Email → 3 dots → Report phishing\n3. *IT ko batao* → *Create Ticket* button dabao — IT investigate karega 🎫\n\n⚠️ Agar link dabao diya → TURANT ticket raise karo!`;

  // WIOM uses Gmail (Google Workspace) — NOT Outlook
  // "email nahi chal rha", "gmail nahi khul rha", "mail nahi aa rha"
  if (pn.includes('outlook')) {
    return `ℹ️ WIOM mein Outlook use nahi hota — *Gmail* use hoti hai.\n\nGmail se koi problem hai? gmail.com Chrome mein kholo aur batao kya issue aa raha hai.`;
  }
  if (pn.includes('email') || pn.includes('gmail') || pn.includes('mail')) {
    return `📧 *Gmail Issue* — yeh try karo:\n\n1. *Incognito test* → Chrome → Ctrl+Shift+N → gmail.com → dekho khulta hai ya nahi\n2. *Cache clear karo* → Ctrl+Shift+Del → "All time" → Cookies + Cache → Clear\n3. *Alag browser* → Edge mein gmail.com kholo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;
  }

  if (pn.includes('password') || pn.includes('locked') || pn.includes('login') || /pas?w?ro?d/.test(pn)) {
    // Gmail/Google password — IT handles (no admin rights to self-reset company Google accounts)
    if (/google|gmail|email|mail/.test(pn))
      return `🔑 *Gmail/Google Account Password*\n\nCompany Gmail account ka password reset IT karta hai — employees khud reset nahi kar sakte.\n\n*Create Ticket* button dabao — IT jaldi reset kar dega 🎫`;
    return `🔑 *Password/Login Issue*\n\nPassword reset sirf IT team kar sakti hai.\n\n*Create Ticket* button dabao — IT team jaldi reset kar degi 🎫`;
  }

  if (pn.includes('bluetooth'))
    return `Bluetooth issue. Yeh try karo:\n\n1. *Toggle* → Settings → Bluetooth → OFF → ON karo\n2. *Re-pair* → Device remove karo → dobara pair karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('camera') || pn.includes('webcam') || /\bcam\b/.test(pn))
    return `Camera issue. Yeh try karo:\n\n1. *Privacy check* → Settings → Privacy & Security → Camera → ON karo\n2. *App settings* → Teams/Zoom mein Settings → Video → correct camera select karo\n3. *Restart* → Laptop restart karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (/mic|microphone/.test(pn) && !pn.includes('microsoft'))
    return `Microphone issue. Yeh try karo:\n\n1. *Privacy check* → Settings → Privacy & Security → Microphone → ON karo\n2. *Input device* → Sound settings → Input → correct mic select karo\n3. *Teams test* → Teams Settings → Devices → mic test karo\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('usb') || pn.includes('pendrive'))
    return `USB issue. Yeh try karo:\n\n1. *Alag port* → USB device dusre port mein lagao\n2. *Restart* → Laptop restart karo → dobara lagao\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('pdf') || pn.includes('adobe') || pn.includes('acrobat'))
    return `PDF issue. Yeh try karo:\n\n1. *Chrome mein open karo* → PDF file ko Chrome mein drag karke drop karo — bina Adobe bhi khulti hai\n2. *Right-click* → PDF pe right-click → Open With → Adobe Acrobat select karo\n\nAgar Adobe nahi hai → *Create Ticket* button dabao — IT install kar dega 🎫`;

  if (pn.includes('scanner') || pn.includes('scan'))
    return `Scanner issue. Yeh try karo:\n\n1. *Scanner restart karo* → Band karo → 30 sec → on karo\n2. *USB check karo* → Cable properly lagi hai?\n3. *Laptop restart karo* → Dobara scan try karo\n\nAgar detect nahi ho rha → *Create Ticket* button dabao — IT driver install karega 🎫`;

  if (pn.includes('network drive') || pn.includes('shared drive') || /z:\s*drive|mapped\s*drive|shared\s*folder/.test(pn))
    return `Network Drive issue. Yeh try karo:\n\n1. *Laptop restart karo* → Aksar restart se drive wapas aa jaati hai\n2. *File Explorer* → This PC → agar nahi dikh rha → *Create Ticket* button dabao — IT remap kar dega\n\nAgar theek nahi hua → *Create Ticket* button dabao — IT team directly help karegi 🎫`;

  if (pn.includes('shared folder') || pn.includes('folder access') || pn.includes('access nahi'))
    return `Shared Folder Access issue. Yeh karo:\n\n*Create Ticket* button dabao — IT team aapko folder access dega. Ticket mein batao: *kaunsa folder* chahiye aur *kis kaam ke liye* 🎫`;

  if (pn.includes('hdmi') || pn.includes('projector') || pn.includes('second screen') || pn.includes('external monitor') || pn.includes('monitor connect'))
    return `External Monitor/Projector issue. Yeh try karo:\n\n1. *Cable check karo* → HDMI cable dono taraf properly lagi hai?\n2. *Win+P* → Windows + P key dabao → Extend ya Duplicate select karo\n3. *Monitor ON* → External monitor on hai?\n\nAgar detect nahi ho rha → *Create Ticket* button dabao — IT directly help karegi 🎫`;

  if (pn.includes('storage') || pn.includes('disk full'))
    return `Storage/disk full issue. Yeh try karo:\n\n1. *Recycle Bin* → Desktop pe Recycle Bin → Empty Recycle Bin\n2. *Downloads folder* → File Explorer → Downloads → jo files zaruri nahi unhe delete karo\n\nAgar ab bhi issue hai → *Create Ticket* button dabao — IT baaki cleanup karega 🎫`;

  // BUG-FIX: VPN check in getKBFallback (was only in detectIntent, returned generic before)
  if (/\bvpn\b/.test(pn))
    return `ℹ️ WIOM mein VPN use nahi hota.\n\nKoi aur IT issue hai? Batao — help karunga.`;

  // BUG-FIX: liquid damage — "paani gira", "paani gir gaya" etc. (was returning generic)
  if (/paani|liquid|pani\s*gir|water\s*(gir|spill|giray)|coffee\s*gir|chai\s*gir/.test(pn))
    return `EMERGENCY! Liquid/Paani gira hai!\n\n1. *TURANT BAND KARO* — Power button hold karo\n2. *CHARGER NIKALO*\n3. *ULTA RAKHO* → Liquid drain hone do\n4. *Hairdryer mat lagao*\n5. *IT ko batao* → ${ADMIN_EMAIL_KB}\n\n*Create Ticket* button dabao → CRITICAL emergency 🎫`;

  // BUG-FIX: physical damage — "gir gaya", "toot gaya", "damage" (was returning generic)
  if (/gir\s*gaya|toot\s*gaya|toot\s*gai|phoot\s*gaya|crack|damage|broken|screen\s*toot|crack\s*ho|physical/.test(pn) &&
      /laptop|screen|display|phone|tablet/.test(pn))
    return `Laptop physically damage hua hai.\n\nSoftware se fix nahi hoga — *Create Ticket* button dabao TURANT.\nIT physically assess aur repair/replace karega.\nTicket mein damage ka description likho. 🎫`;

  if (pn.includes('virus') || pn.includes('malware') || pn.includes('antivirus'))
    return `Possible virus/malware issue. Yeh karo:\n\n1. *Quick Scan* → Windows Security → Virus & threat protection → Quick Scan\n2. *Internet band karo* → agar suspicious activity lag rahi hai\n\n*Create Ticket* button dabao — yeh serious ho sakta hai, IT team directly help karegi 🎫`;

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
    return `IT contact: *Sajan Kumar* | 📧 ${ADMIN_EMAIL_KB}`;

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

  return `Apni problem thodi detail mein batao — kaunsa app ya device, aur kya ho rha hai exactly?\n\nYa seedha *Create Ticket* button dabao — IT team directly aapki help karegi. 🎫`;
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


// ── Call Groq — tries 70b first, falls back to 8b if rate-limited ────────────
const callGroq = async (systemPrompt, history) => {
  if (!groq) throw new Error('GROQ_API_KEY not configured');
  // Primary: llama-3.3-70b-versatile (100K tokens/day)
  // Fallback: llama-3.1-8b-instant (500K tokens/day) — used when 70b hits rate limit
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  let lastErr;
  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages   : [{ role: 'system', content: systemPrompt }, ...history],
        temperature: 0.25,
        max_tokens : 500
      });
      const text = completion.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('Empty response from Groq ' + model);
      if (model !== 'llama-3.3-70b-versatile') console.log('⚡ Using Groq fallback model:', model);
      return text;
    } catch (err) {
      lastErr = err;
      // 429 = rate limit → try next model. Other errors → throw immediately.
      if (!err.message?.includes('429') && !err.message?.includes('rate_limit') && !err.message?.includes('Rate limit')) throw err;
      console.warn('⚠️ Groq ' + model + ' rate limited, trying next...');
    }
  }
  throw lastErr;
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


// ── FALLBACK RESPONSE GENERATOR ────────────────────────────────────────────
// When KB misses AND confidence is low → structured fallback instead of generic "batao"
const getFallbackResponse = (query, intent, category) => {
  const q = query.toLowerCase();

  // Enterprise software — specific error codes, specific apps
  if (/\b(sap|autocad|power\s*bi|vmware|cisco|oracle|tally|quickbooks|solidworks|matlab|tableau|figma|sketch|adobe|photoshop|illustrator|premiere|after\s*effects|jira|confluence|salesforce|hubspot)\b/i.test(q)) {
    const appName = q.match(/\b(sap|autocad|power\s*bi|vmware|cisco|oracle|tally|quickbooks|solidworks|matlab|tableau|figma|sketch|adobe\s*\w+|photoshop|illustrator|premiere|after\s*effects|jira|confluence|salesforce|hubspot)\b/i)?.[0] || 'application';
    return `Yeh ${appName.toUpperCase()} ka issue lag rha hai. IT team ko yeh details share karo:\n\n• *Error message/code* — exactly kya likh raha hai?\n• *Kab se ho rha hai* — aaj pehli baar ya pehle bhi?\n• *Screenshot* — agar le sako\n\n*Create Ticket* button dabao — IT specialist handle karega 🎫`;
  }

  // Error codes — specific format like 0x80045, error 404, etc.
  if (/\b(error\s*[0-9a-fx]{4,}|0x[0-9a-f]+|err\s*\d+|code\s*\d+)\b/i.test(q)) {
    const errCode = q.match(/\b(error\s*[0-9a-fx]{4,}|0x[0-9a-f]+|err\s*\d+|code\s*\d+)\b/i)?.[0] || 'error';
    return `${errCode.toUpperCase()} error — yeh specific error code IT ko dhundhna padega.\n\nPlease share karo:\n• *Kaunsa application* — kis software mein aa rha hai?\n• *Exact error message* — screenshot helpful hogi\n• *Kab se* — koi update/change ke baad?\n\n*Create Ticket* button dabao — HIGH PRIORITY ticket raise hoga 🎫`;
  }

  // Generic unknown but has technical words
  return `Yeh issue meri knowledge base mein nahi hai. IT team better help kar sakti hai.\n\nYeh share karo:\n• *Kaunsa app/device* — exactly kya problem hai?\n• *Error message* — screen pe kya likha hai?\n• *Kab se* — pehle theek tha?\n\n*Create Ticket* button dabao — IT team directly help karegi 🎫`;
};

// Generic KB fallback string — used to detect when getKBFallback has no specific answer
const KB_GENERIC = `Apni problem thodi detail mein batao`;

// ── Main chat function ────────────────────────────────────────────────────────
const chat = async (messages, { empId, empName, source, laptop, laptopSN, dept, floor }) => {
  if (!modelLogged) {
    console.log(`🤖 AI Model: ${activeModel()}`);
    modelLogged = true;
  }

  // ── KB PRE-CHECK: for known issues, return instantly — no AI needed ──────
  // Only on first/simple messages (not mid-conversation follow-ups like "nahi hua")
  const lastUserQ = messages.filter(m => m.role === 'user').pop()?.content || '';
  const isFollowUp = messages.filter(m => m.role === 'assistant').length >= 1 &&
    /theek nahi hua|nahi hua|still|phir bhi|abhi bhi|aur kuch|dobara|same|work nahi|kaam nahi/i.test(lastUserQ);
  if (!isFollowUp) {
    const kbAnswer = getKBFallback(lastUserQ);
    if (kbAnswer && !kbAnswer.startsWith(KB_GENERIC)) {
      console.log('⚡ KB pre-check hit — skipping AI');
      return {
        reply             : kbAnswer,
        shouldCreateTicket: kbAnswer.includes('Create Ticket'),
        ticketData        : null
      };
    }
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
  // lastUserQ already declared above (KB pre-check block)

  // ── QUESTION READING INSTRUCTION — force AI to understand before answering ──
  const readFirst = `\n\n🔍 EMPLOYEE KA SAWAAL: "${lastUserQ}"\n\nPEHLE YEH SAMJHO:\n- Kya employee kuch MANGWA raha hai? (chahiye/need/request) → equipment/purchase process batao\n- Kya kuch TROUBLESHOOT karna hai? (nahi chal rha/problem) → steps do\n- Kya HOW-TO poochh raha hai? (kaise/how) → seedha batao\n- Kya policy/rule poochh raha hai? → policy se jawab do\nGalat category mein jawab mat do. Sawaal poora padho, phir jawab do.`;

  const intentContext = `\n\n⚡ DETECTED CATEGORY: ${intent.category}\n🎯 INSTRUCTION: ${intent.hint}` + readFirst;

  const systemPrompt = SYSTEM_PROMPT
    + `\n\nUSER CONTEXT: ${userContext}`
    + (laptop ? `\nEmployee laptop: ${laptop}${laptopSN ? ` (SN: ${laptopSN})` : ''}` : '')
    + intentContext
    + triedSteps;

  // ── Routing: Groq 70b → Groq 8b (auto in callGroq) → Gemini → KB ──────────
  let raw;
  const lastMsg = lastUserQ;

  // Timeout wrapper — prevents hanging if AI API is slow/down
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms))
  ]);

  try {
    // callGroq tries 70b first, auto-falls to 8b on rate limit
    raw = await withTimeout(callGroq(systemPrompt, history), 15000, 'Groq');
    console.log('✅ Groq responded OK');
  } catch (err) {
    console.warn('⚠️ Groq failed:', err.message, '— trying Gemini...');
    try {
      raw = await withTimeout(callGemini(systemPrompt, history), 10000, 'Gemini');
      console.log('✅ Gemini (BACKUP) responded OK');
    } catch (err2) {
      console.error('❌ All AI failed — using KB fallback');
      raw = getKBFallback(lastMsg);
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
    .replace(/delete\s+%appdata%[^\n]*/gi, 'Teams cache clear karo (IT ticket raise karo — woh clear kar denge)')
    .replace(/%appdata%[^\s]*/gi, 'Teams cache folder')
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

  // KB removed — no fallback replacement needed, trust AI response

  // Strip robotic title lines before "Step 1:" (keep emoji openers)
  const stepIdx = reply.indexOf('Step 1:');
  if (stepIdx > 0) {
    const preStep = reply.slice(0, stepIdx);
    const hasEmoji = /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|😊|🔧|✅|🙏|🎫|🚨|💻|📶|🤔/u.test(preStep);
    if (!hasEmoji) reply = reply.slice(stepIdx).trim();
  }

  // Check if ticket needed — detect when AI suggests raising a ticket
  // Detection based on button-focused phrases since Messages Tab is disabled
  const shouldCreateTicket =
    // "Create Ticket button dabao" → ticket confirm
    /Create\s*Ticket\s*button/i.test(reply) ||
    // "type karo ha/haan" (legacy, in case old KB response slips through)
    /type\s*karo[:\s]*\*?ha(an|a|n)?\*?/i.test(reply) ||
    // Or: "ticket" word + action keywords
    (reply.toLowerCase().includes('ticket') && (
      /ticket\s*(bana|raise|create|chahiye|bhejte|banana)/i.test(reply) ||
      /ticket\s*(raise\s*karein|karein|bhejta)/i.test(reply)
    )) ||
    // Claude saying "bhej deta hoon" + "IT" (ticket confirmation without "ticket" word)
    (/IT\s*(ko|team)\s*(ko\s*)?bhej/i.test(reply) && /Create\s*Ticket/i.test(reply));

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
      ? `Hardware issue hai — ismein IT team physically help karegi. *Create Ticket* button dabao — IT directly aayegi 🎫`
      : `Samajh gaya. IT team handle kar legi. *Create Ticket* button dabao — ticket raise ho jaayega 🎫`;
  }

  // Normalize: if shouldCreateTicket but no button prompt visible, add it
  if (shouldCreateTicket && !isHallucinated && !/Create\s*Ticket\s*button/i.test(reply)) {
    reply = reply.replace(/\s*$/, '') + '\n\n*Create Ticket* button dabao — IT team directly help karegi 🎫';
  }

  // Final safety: if reply is empty for any reason
  if (!reply || reply.trim().length < 10) {
    reply = `Kuch technical issue aa gaya. Seedha *Create Ticket* button dabao — IT team directly help karegi. 🎫`;
  }

  return {
    reply             : reply,
    shouldCreateTicket: shouldCreateTicket || isHallucinated,
    ticketData        : null
  };
};


// ── Streaming chat — sends chunks via onChunk callback, returns fullText ─────
const chatStream = async (messages, { empId, empName, source, laptop, laptopSN, dept, floor }, onChunk) => {
  // FIX: lastUserMsg must be defined here — NOT inherited from outer scope (was ReferenceError)
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';

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

  // ── Groq streaming ────────────────────────────────────────────────────────
  try {
    const stream = await groq.chat.completions.create({
      model      : 'llama-3.3-70b-versatile',
      messages   : [{ role: 'system', content: systemPrompt }, ...history],
      temperature: 0.25,
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

// ── getKBAnswer: sync DIRECT_KB lookup (kept for backward compat) ─────────────
const getKBAnswer = (problem) => {
  if (!problem) return null;
  const p = problem.toLowerCase().trim();
  // Check DIRECT_KB keys by exact match first, then partial substring match
  for (const [key, answer] of Object.entries(DIRECT_KB)) {
    const keyWords = key.replace(/_/g, ' ');
    if (p.includes(keyWords) || keyWords.includes(p)) return answer;
  }
  return null;
};

// ── getKBAnswerDB: async MongoDB KB lookup (fallback after DIRECT_KB miss) ────
const mongoose = require('mongoose');
const getKBAnswerDB = async (problem) => {
  if (!problem) return null;
  try {
    const KnowledgeBase = mongoose.models.KnowledgeBase || require('../models/KnowledgeBase');
    const entry = await KnowledgeBase.findOne({
      $or: [
        { keywords: { $elemMatch: { $regex: problem.substring(0, 30), $options: 'i' } } },
        { question: { $regex: problem.substring(0, 30), $options: 'i' } }
      ],
      isActive: { $ne: false }
    }).sort({ useCount: -1 }).lean();
    if (entry) {
      // Increment usage count in background
      KnowledgeBase.findByIdAndUpdate(entry._id, { $inc: { useCount: 1 } }).catch(() => {});
      return entry.answer;
    }
  } catch (err) {
    console.warn('⚠️ getKBAnswerDB error:', err.message);
  }
  return null;
};

// ── Lightweight stubs for detectQueryIntent / processQuery (used by routes) ──
const detectQueryIntent = (problem) => {
  if (!problem) return { intent: 'unknown', confidence: 50, category: 'unknown' };
  const p = problem.toLowerCase();
  if (/virus|malware|hack|breach/i.test(p)) return { intent: 'security', confidence: 90, category: 'security' };
  if (/password|bhool|forgot|login|locked/i.test(p)) return { intent: 'access', confidence: 90, category: 'access' };
  if (/chahiye|replace|upgrade|new\s*laptop/i.test(p)) return { intent: 'asset', confidence: 90, category: 'asset' };
  if (/kaise|how\s*to|steps|guide/i.test(p)) return { intent: 'information', confidence: 70, category: 'howto' };
  if (/nahi\s*chal|hang|crash|error|problem/i.test(p)) return { intent: 'incident', confidence: 70, category: 'incident' };
  return { intent: 'unknown', confidence: 50, category: 'unknown' };
};

const processQuery = (problem, empInfo = {}) => {
  const { intent, confidence, category } = detectQueryIntent(problem);
  return { intent, confidence, category, kbAnswer: null };
};

module.exports = { chat, chatStream, quickReply, detectQueryIntent, processQuery, getKBFallback, getKBAnswer, getKBAnswerDB, DIRECT_KB };

