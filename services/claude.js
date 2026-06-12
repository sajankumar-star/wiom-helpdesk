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
const SYSTEM_PROMPT = `You are WIOM IT Assistant — WIOM IT Support AI for 300 non-technical office employees.

RULES (follow strictly):
- Language: Always reply in English only. Never use Hindi or Hinglish.
- Steps: Max 3-4 SIMPLE steps only. NO CMD, Safe Mode, Device Manager, BIOS, chkdsk — employees have NO admin rights.
- End every troubleshooting reply: "If not resolved → click the *Create Ticket* button — IT team will help you directly."
- NEVER say "type here" or similar — Messages Tab is disabled, users click buttons only.
- NEVER say ticket is already raised/sent — user must click the button.
- NEVER give phone numbers.
- Physical damage (cracked/water) → NO steps → "Click the Create Ticket button — IT team will physically replace it 🎫"
- Theft/Loss → "First check your desk and surroundings. If not found → email ${ADMIN_EMAIL_KB}, click Create Ticket button."

WIOM FACTS:
- WiFi password: ${WIFI_PASSWORD} | Special: "Wiomnet-Saket" → ${WIFI_PASSWORD_SAKET}
- Email: GMAIL only — NEVER suggest Outlook. NEVER say outlook.office365.com
- NO VPN at WIOM
- IT: Sajan Kumar | ${ADMIN_EMAIL_KB}
- Software install/activation/password reset → TICKET ONLY (no admin rights)
- Non-IT (AC, lights, pantry, personal phone) → "This is outside IT scope — please contact Admin/Facilities."

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
    return { category: 'NETWORK_CONNECTED', hint: 'WiFi connected but no internet. Max 3 steps: 1) Toggle WiFi off/on. 2) Check if only one site is blocked — try gmail.com and another site. 3) If all sites fail → restart laptop. If not resolved → tell user to click Create Ticket button. Do NOT suggest CMD or ipconfig.' };

  // Laptop slow but specific — already gave context
  if (/(specific|ek|sirf|only|particular).*(app|game|software).*(slow|hang)|(slow|hang).*(specific|ek|sirf)/.test(recentText))
    return { category: 'PERFORMANCE_SPECIFIC', hint: 'User gave specific detail about slow app. Give: End Task in Task Manager for that app → clear browser cache if browser → restart laptop. If still slow → IT ticket.' };

  // Screen black but laptop is on
  if (/(black|kali|blank).*(screen|display).*(on|chal|power)|(on|chal|power).*(black|kali|blank).*(screen|display)/.test(recentText))
    return { category: 'DISPLAY_BLACK_ON', hint: 'User says screen is black but laptop is ON. SKIP question — give steps: 1. Press Fn+F5 or Fn+F8 (brightness keys) 2. Press Win+P → select "Extend" 3. Hold power button 10sec → restart. No questions.' };

  // Password forgot — specific type
  if (/(windows|laptop|login|pc).*(password|bhool|forgot)|(password|bhool|forgot).*(windows|laptop|login|pc)/.test(recentText))
    return { category: 'ACCOUNT_WINDOWS', hint: 'Windows login password issue. SKIP question. Say directly: "Windows login password can only be reset by IT — click the *Create Ticket* button, IT team will reset it quickly."' };

  // Outlook/Teams specific error
  if (/(gmail|email|teams).*(nahi khul|not opening|crash|band ho|error|loading|nahi aa rha|nahi chal)/.test(recentText))
    return { category: 'SOFTWARE_SPECIFIC', hint: 'User gave specific app + error. SKIP question. WIOM uses Gmail NOT Outlook. Gmail fix: incognito test → clear Chrome cache → try different browser. Teams fix: system tray quit → reopen. If Teams still fails → tell user to click Create Ticket button (IT will clear cache). MAX 3 steps. NO %appdata% paths.' };

  // ── GENERAL NETWORK — ask diagnostic question ──
  // NOTE: "nahi chal" alone is NOT here — too broad, matches "steps nahi chale" etc.
  if (/\bnet\b|\bwifi\b|wi-fi|internet|network|connect(ion)?|hotspot|broadband|no internet|net band|data nahi|signal nahi|connection nahi/.test(recentText))
    return { category: 'NETWORK', hint: 'NETWORK ISSUE. Your FIRST message MUST be: "Is the WiFi icon showing in the taskbar? Is it connected or showing \'No Internet\'?" — ABSOLUTELY DO NOT say restart laptop. Ask this exact question first, then wait.' };

  // PERFORMANCE — slow, hang, freeze
  if (/slow|hang\b|lagg|freez|speed|fast karo|\bram\b|\bcpu\b|processor|heavy|battery drain|alag hai|dheema|dheere|aahista/.test(recentText))
    return { category: 'PERFORMANCE', hint: 'PERFORMANCE ISSUE. If user already said slow/hang/lagg → give 3 steps directly (Task Manager End Task, close browser tabs, restart). Do NOT ask follow-up if symptom is clear. Maximum 3 steps only.' };

  // DISPLAY COLOR DISTORTION — colorful screen, color lines, tint
  if (/colorful|colorfull|colour|color\s*aa|rang\s*aa|pink\s*screen|green\s*screen|tint|lines?\s*aa|lines?\s*dikh|screen.*lines?|horizontal\s*line|vertical\s*line|screen\s*pe\s*rang|display.*rang|rang.*display/.test(recentText))
    return { category: 'DISPLAY_COLOR', hint: 'Screen color issue. Step 1: Restart laptop (driver glitch usually fixes on restart). Step 2: If external monitor available, test HDMI — if external fine, laptop screen hardware issue. If not resolved → ticket.' };

  // SIMPLE HOW-TO — brightness/wallpaper/zoom-in: answer directly, no diagnostic questions
  if (/brightness|screen.*bright|bright.*screen|\bdim\b|wallpaper|zoom\s*in\s*ho|sab.*bada/i.test(recentText))
    return { category: 'SIMPLE_HOWTO', hint: 'User is asking a simple how-to question about display/brightness settings. Give a DIRECT 1-2 line answer. Do NOT ask diagnostic questions. Answer: Fn+F5/F6 for brightness, right-click desktop for wallpaper, Ctrl+0 for zoom reset.' };

  // DISPLAY — screen, black, blue screen
  if (/screen|display|black screen|nahi dikh|dikhna band|blue screen|bsod|flicker|bright|dim|resolution|monitor|hdmi|kala ho gaya|screen kali/.test(recentText))
    return { category: 'DISPLAY', hint: 'DISPLAY ISSUE. First ask: "Is the laptop on (can you see the power LED)? Or is the screen completely black?" — never suggest network steps for display.' };

  // CAMERA
  if (/camera|camra|webcam|\bcam\b|video nahi|camera band/.test(recentText))
    return { category: 'CAMERA', hint: 'CAMERA ISSUE. First ask: "Which app is it not working in — Teams, Zoom, or all apps?" — then Settings→Privacy→Camera.' };

  // AUDIO
  if (/sound|audio|speaker|headphone|\bmic\b|microphone|awaaz|awaaz nahi|volume|sunai nahi/.test(recentText))
    return { category: 'AUDIO', hint: 'AUDIO ISSUE. First ask: "Is a headphone plugged in? Is there an X on the speaker icon in the taskbar?" — check output device.' };

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
    return { category: 'VPN', hint: 'VPN: WIOM does not use VPN. Tell user directly: "WIOM does not use VPN. Any other IT issue?"' };

  // GMAIL / EMAIL
  if (/(gmail|email|mail)/.test(recentText) && /(nahi|not|issue|open|login|password|send|receive|full)/.test(recentText))
    return { category: 'GMAIL', hint: 'GMAIL ISSUE. WIOM uses Gmail NOT Outlook. Steps: 1) Open gmail.com in Chrome incognito. 2) Clear Chrome cache. 3) Try Edge browser. For password issues → IT ticket.' };

  // GOOGLE DRIVE / ONEDRIVE
  if (/(google\s*drive|gdrive|onedrive)/.test(recentText) && /(nahi|not|sync|upload|issue)/.test(recentText))
    return { category: 'CLOUD_STORAGE', hint: 'CLOUD STORAGE ISSUE. Check internet → sign out/in → IT ticket.' };

  // PDF
  if (/\bpdf\b/.test(recentText) && /(nahi|not|open|issue|convert|print)/.test(recentText))
    return { category: 'PDF', hint: 'PDF ISSUE. Open with Chrome/Edge drag-drop. For PDF to Word → open Word → File → Open → select PDF. No Adobe install needed.' };

  // SOFTWARE
  if (/teams|zoom|outlook|email|\bchrome\b|\boffice\b|\bword\b|\bexcel\b|onedrive|pdf|app nahi|software|install\s+\w+|\w+\s+install|crash|error aa raha|error aa rahi/.test(recentText))
    return { category: 'SOFTWARE', hint: 'SOFTWARE/APP ISSUE. First ask: "What is the exact error message? What does the screen say?" — give app-specific fix only. If outlook mentioned: WIOM uses Gmail not Outlook — redirect to Gmail. NO %appdata% paths, NO CMD.' };

  // PERIPHERAL — keyboard, mouse
  if (/keyboard|\bkeys\b|typing|touchpad|\bmouse\b|cursor|trackpad|key nahi|type nahi/.test(recentText))
    return { category: 'PERIPHERAL', hint: 'KEYBOARD/TOUCHPAD ISSUE. First ask: "Is it the same after restart? Or is only one specific key not working?" — hardware steps only.' };

  // PRINTER
  if (/printer|print|printing/.test(recentText))
    return { category: 'PRINTER', hint: 'PRINTER ISSUE. First ask: "Is the printer on and connected? Any error message on screen?" — then: restart the printer, restart laptop, IT ticket if unresolved.' };

  // ACCOUNT / PASSWORD
  if (/password|login|locked|account|access|sign in|signin|password bhool|bhool gaya password/.test(recentText))
    return { category: 'ACCOUNT', hint: 'ACCOUNT/PASSWORD ISSUE. WIOM uses Gmail (Google Workspace) NOT Outlook. Windows password reset = ticket only (IT handles). Gmail/Google password reset = ticket only (IT handles company Google accounts — employees cannot self-reset). Do NOT give self-service Google password steps. Raise ticket directly.' };

  // SECURITY
  if (/virus|malware|hack|ransomware|suspicious|phishing|data\s*leak|unauthorized|breach|credential/.test(recentText))
    return { category: 'SECURITY', hint: 'SECURITY ISSUE. Urgent — say "Windows Security → Virus & threat protection → Quick Scan, and disconnect internet if it seems serious." Then ticket. If query is ambiguous (single word, or unclear context), ask ONE specific clarifying question. If query is clear (has device/app/symptom), give answer directly without asking.' };

  // BATTERY / CHARGING — typo-tolerant: battry, battey, week=weak, backup kam
  if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charg|plug.*power|low.*power|backup\s*(nahi|low|kam)|draining|week.*batt|batt.*week/.test(recentText)) {
    const isChargingIssue = /charg|plug|not charg|chal nahi|percent\s*(nahi|stuck|0)|0\s*%|nahi chal rha/.test(recentText);
    const isDrainIssue = /drain|backup\s*(kam|nahi|low)|jaldi\s*(khatam|kha)|low backup|week\s*batt|batt.*week/.test(recentText);
    if (isDrainIssue && !isChargingIssue) {
      return { category: 'BATTERY_DRAIN', hint: 'BATTERY DRAIN ISSUE (not charging). User says battery drains fast or backup is poor.\nFirst ask: "How long does one charge last? Which apps are mostly open?"\nThen suggest: Settings → Battery Saver → Power Mode: Balanced → Ctrl+Shift+Esc → End Task heavy apps.\nDo NOT give charger steps — that is wrong for this issue.' };
    }
    return { category: 'BATTERY', hint: 'BATTERY/CHARGING ISSUE. User may have typed "battry" or "week" (weak). Give steps directly:\n1. Plug charger firmly on both sides (laptop side + socket side)\n2. Try a different power socket\n3. Shut down laptop → unplug charger → hold power button 30 sec → plug charger → turn on\n4. If battery stuck at 0% → raise ticket\nDo NOT ask diagnostic question — give these steps now.' };
  }

  // HARDWARE / PORTS — LAN, USB hub, docking station, ports
  if (/\b(lan\s*port|ethernet|rj45|docking|dock\s*station|hub|port\s*me\s*prob|port\s*kaam\s*nahi|port\s*nahi|usb\s*hub|type\s*c)\b/i.test(recentText))
    return { category: 'HARDWARE_PORT', hint: 'HARDWARE PORT ISSUE. Give steps: 1) Check cable (should click in firmly) 2) Try a different cable 3) Try a different port 4) Restart. If port physically damaged → IT ticket. NO Device Manager steps.' };

  // GENERAL — try to answer directly rather than asking "batao"
  // Confidence scoring: short/vague queries → ask clarifying question
  const lastQ = recentText.trim().split(/\s+/).filter(Boolean);
  const hasSpecificKeyword = /\b(wifi|laptop|internet|bluetooth|keyboard|touchpad|mouse|screen|display|camera|mic|microphone|speaker|audio|printer|teams|zoom|chrome|browser|password|windows|excel|word|onedrive|usb|battery|charger|network|slow|hang|crash|headphone|projector|hdmi|monitor|fan)\b/i.test(recentText);
  if (lastQ.length <= 3 && !hasSpecificKeyword) {
    return { category: 'GENERAL_VAGUE', hint: 'Query is ambiguous (3 words or fewer, no specific IT keyword). Ask ONE specific clarifying question: "What is the problem — laptop, WiFi, software, or something else?" — do NOT give steps or guess.' };
  }
  return { category: 'GENERAL', hint: 'You are a Desktop Support Engineer. Even if the issue is vague, USE YOUR IT KNOWLEDGE to give a helpful response. Do NOT just say "Tell me more". If you can identify the issue from context — give steps. If truly unclear — ask ONE very specific question like "Which app has the problem?" or "When did this start?" — never a generic question. If query is ambiguous (single word, or unclear context), ask ONE specific clarifying question. If query is clear (has device/app/symptom), give answer directly without asking.' };
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
    `WiFi not working. Try these steps:\n\n1. *Toggle* → Taskbar WiFi icon → OFF → wait 10 sec → ON → connect to "Wiom office" (password: ${WIFI_PASSWORD})\n2. *Forget & Reconnect* → WiFi settings → "Wiom office" → Forget → reconnect\n3. *Restart* → Restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`,

  no_internet:
    `No internet (WiFi is connected). Try these steps:\n\n1. *WiFi Toggle* → Taskbar WiFi → OFF → 10 sec → ON\n2. *Reopen Chrome* → Close Chrome → reopen → try gmail.com\n3. *Restart* → Restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`,

  internet_slow:
    `Internet is slow. Try these steps:\n\n1. *WiFi Toggle* → Taskbar WiFi → OFF → 10 sec → ON → reconnect\n2. *Close tabs* → Close extra Chrome tabs — too many tabs slows the connection\n3. *Restart* → Restart your laptop\n4. *Move closer* → Move closer to the router — distance weakens the signal\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`,

  keys_not_working:
    `Keyboard not working. Try these steps:\n\n1. *Restart* → Restart your laptop — usually fixes on restart\n2. *NumLock check* → Press NumLock (if numbers are typing instead of letters)\n3. *On-Screen Keyboard* → Start menu → search "On-Screen Keyboard" → use it temporarily\n\nIf not resolved → click *Create Ticket* button — IT team will fix the driver 🎫`,

  blue_screen:
    `Blue Screen (BSOD) is appearing. Do this:\n\n1. *Note the error code* → Write down what was on the screen (e.g. MEMORY_MANAGEMENT, DRIVER_IRQL etc.)\n2. *Restart* → Hold power button 10 sec → shut down → turn back on\n3. *Happening repeatedly?* → Raise a ticket immediately\n\nIf not resolved or appears more than 3 times → click *Create Ticket* button — IT team will help you directly 🎫`,

  external_monitor:
    `External monitor not detected. Try these steps:\n\n1. *Check cable* → Is the HDMI cable properly connected on both ends? Unplug and replug\n2. *Win+P* → Press Windows key + P → select "Extend" or "Duplicate"\n3. *Monitor ON* → Check the power button on the external monitor — is it on?\n4. *Restart* → Keep everything connected and restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`,

  scanner_issue:
    `Scanner not working. Try these steps:\n\n1. *Restart scanner* → Turn scanner off → wait 30 sec → turn back on\n2. *Check USB cable* → Is the cable properly connected? Unplug and replug\n3. *Restart laptop* → Restart your laptop → try scanning again\n\nIf not resolved → click *Create Ticket* button — IT will install the driver 🎫`,

  file_corrupted:
    `File not opening. Try these steps:\n\n1. *Right-click → Open With* → Right-click the file → Open With → select the correct app (Word/Excel/Adobe)\n2. *Restart app* → Close the app → reopen it → try opening the file again\n3. *Restart laptop* → Restart your laptop → try again\n\nIf the app is missing or the file is corrupted → click *Create Ticket* button — IT team will install/recover it 🎫`,

  overheat:
    `Laptop is overheating. Do this:\n\n1. *Place on a table* → Put the laptop on a hard flat surface — not on a bed/sofa (blocks airflow)\n2. *Task Manager* → Ctrl+Shift+Esc → CPU column → End Task heavy apps\n3. *Restart* → Restart your laptop — stops background processes\n4. *Fan check* → Is the bottom very hot and the fan not spinning? Turn it off immediately\n\nIf overheating badly or shutting off → click *Create Ticket* button 🎫`,

  battery_issue:
    `Battery drains quickly. Do this:\n\n1. *Power mode* → Click battery icon in taskbar → select "Power saver" or "Balanced"\n2. *Screen brightness* → Press Fn+F5/F6 to lower the brightness a bit\n3. *Close apps* → Task Manager → close apps that use a lot of battery\n\nIf battery stuck at 0% and not charging → plug in the charger and wait 10 min then turn on.\nIf still a problem → click *Create Ticket* button — IT will check the battery 🎫`,

  battery_not_charging:
    `Battery not charging. Try these steps:\n\n1. *Replug charger* → Unplug charger from both ends → plug back in firmly (laptop side + socket side)\n2. *Different socket* → Try a different power socket\n3. *Power reset* → Shut down laptop → unplug charger → hold power button 30 sec → plug charger → turn on\n\nIf the charger LED is also not lighting up → charger may be faulty.\nIf not resolved → click *Create Ticket* button — IT will replace the charger/battery 🎫`,

  touchpad_issue:
    `Touchpad/cursor not working. Try these steps:\n\n1. *Fn key check* → Press Fn + F5/F6/F7 (touchpad lock key) — the key with the touchpad icon on keyboard\n2. *Settings* → Settings → Bluetooth & devices → Touchpad → turn ON\n3. *Restart* → Restart your laptop\n\nIf cursor is still stuck after restart → click *Create Ticket* button — IT will fix the driver 🎫`,

  camera_issue:
    `Webcam/Camera not working. Try these steps:\n\n1. *Privacy settings* → Settings → Privacy & Security → Camera → turn ON\n2. *App settings* → Teams/Zoom → Settings → Video → select the correct camera\n3. *Restart app* → Close the app → reopen it\n\nIf privacy is ON and still not working → click *Create Ticket* button — IT will fix the driver 🎫`,

  mic_issue:
    `Microphone not working. Try these steps:\n\n1. *Privacy settings* → Settings → Privacy & Security → Microphone → turn ON\n2. *App settings* → Teams/Zoom → Settings → Audio → select the correct microphone → test it\n3. *Restart app* → Close the app → reopen it\n\nIf privacy is ON and still not audible → click *Create Ticket* button — IT will fix the driver 🎫`,

  sound_none:
    `No sound from speakers/audio. Try these steps:\n\n1. *Volume check* → Right-click speaker icon in taskbar → Open Sound Settings → is volume at 0% or muted?\n2. *Output device* → Sound settings → Output → select the correct speakers/headphones\n3. *Restart* → Restart your laptop\n\nIf still no sound after plugging in headphones → click *Create Ticket* button — IT will fix the sound driver 🎫`,

  screen_black:
    `Screen went black. Try these steps:\n\n1. *Brightness keys* → Press Fn+F5 or Fn+F6 or Fn+F8 — screen may be dimmed, increase brightness\n2. *Force restart* → Hold power button 10 sec → shut down → wait 30 sec → turn back on\n3. *Check charger* → Battery may be dead → plug in charger → wait 10 min → turn on\n\nIf screen still does not come back → click *Create Ticket* button — IT team will help you directly 🎫`,

  lan_issue:
    `LAN/Ethernet cable issue. Try these steps:\n\n1. *Check cable* → Unplug the LAN cable from both ends and firmly plug back in\n2. *Different port* → Try a different LAN port (check both wall and laptop ports)\n3. *Restart* → Restart your laptop — it will auto-connect again\n\nIf not resolved → click *Create Ticket* button — IT will check the network 🎫`,

  printer_issue:
    `Printer not printing. Try these steps:\n\n1. *Restart printer* → Turn printer off → wait 30 sec → turn back on\n2. *Restart laptop* → Restart your laptop → try printing again\n3. *Default printer* → Settings → Bluetooth & devices → Printers → set the correct printer as default\n\nIf printer not showing in the list at all → click *Create Ticket* button — IT will set up the network printer 🎫`,

  website_blocked:
    `Website not loading. Try these steps:\n\n1. *Check another website* → Open google.com or gmail.com — does that open?\n2. *Try Incognito* → Ctrl+Shift+N → try opening the website again\n3. *Clear cache* → Ctrl+Shift+Del → All time → Cached images → Clear → try the website again\n4. *Try later* → If only this one website → the website server may be down\n\nIf no websites are opening → click *Create Ticket* button — IT will check the network 🎫`,

  app_crash:
    `Application not opening or crashing. Try these steps:\n\n1. *Task Manager* → Ctrl+Shift+Esc → find the application → End Task → reopen it\n2. *Restart* → Restart your laptop → try again\n\nIf the app is not in the list or needs to be installed → click *Create Ticket* button — IT will install it (admin rights required) 🎫`,

  // ── Previously missing — all added ──────────────────────────────────────────
  network_drive:
    `Network Drive/Mapped Drive not visible. Try these steps:\n\n1. *Restart laptop* → Usually the drive comes back after restart\n2. *File Explorer* → Left panel → "This PC" → check for "Z:" or the mapped drive\n3. *Reconnect* → File Explorer → This PC → Computer tab → Map Network Drive\n\nIf still not visible → click *Create Ticket* button — IT will remap the drive 🎫`,

  gmail_issue:
    `Gmail not working. Try these steps:\n\n1. *Incognito test* → Chrome → Ctrl+Shift+N → open gmail.com — does it work?\n2. *Clear cache* → Ctrl+Shift+Del → All time → Cookies + Cache → Clear\n3. *Different browser* → Try gmail.com in Edge\n\nIf you cannot login at all → click *Create Ticket* button — IT will reset the password 🎫`,

  email_login:
    `Gmail/Email login not working. Do this:\n\nClick the *Create Ticket* button — IT will reset your company Gmail account password.\n\nEmployees cannot self-reset Google account passwords — IT handles this. 🎫`,

  email_not_sending:
    `Cannot send emails from Gmail. Try these steps:\n\n1. *Check internet* → Can any other website open?\n2. *Open gmail.com directly* → Chrome → gmail.com → Compose → send\n3. *Check Sent/Drafts* → Is the email stuck somewhere?\n\nIf there is an error message → click *Create Ticket* button — IT will help 🎫`,

  email_not_receiving:
    `Not receiving emails in Gmail. Check this:\n\n1. *Spam/Junk folder* → Gmail left sidebar → check Spam folder\n2. *Trash folder* → Gmail → check Trash\n3. *Storage check* → Gmail settings → is storage full?\n4. *Try Incognito* → Ctrl+Shift+N → gmail.com → check inbox\n\nIf still missing → click *Create Ticket* button 🎫`,

  calendar_sync:
    `Google Calendar not syncing. Try these steps:\n\n1. *Open in browser* → Chrome → calendar.google.com → are events showing?\n2. *Clear cache* → Ctrl+Shift+Del → All time → Clear\n3. *Try Incognito* → Ctrl+Shift+N → calendar.google.com\n\nIf you do not have access to a calendar → click *Create Ticket* button — IT will grant access 🎫`,

  teams_issue:
    `Teams not working. Try these steps:\n\n1. *Quit & Reopen* → Right-click Teams icon in taskbar → Quit → reopen\n2. *Try in browser* → Chrome → teams.microsoft.com\n3. *Restart* → Restart your laptop\n\nIf still not working → click *Create Ticket* button — IT will clear Teams cache 🎫`,

  zoom_issue:
    `Zoom not working. Try these steps:\n\n1. *Close & Reopen* → Close Zoom → reopen it\n2. *Join via browser* → Chrome → zoom.us/wc/join → enter Meeting ID\n3. *Settings* → Zoom → Settings → Audio/Video → select the correct device\n\nIf not installed → click *Create Ticket* button — IT will install it 🎫`,

  browser_slow:
    `Browser (Chrome/Edge) is slow. Try these steps:\n\n1. *Clear cache* → Ctrl+Shift+Del → "All time" → Cached images & files → Clear\n2. *Disable extensions* → Chrome → Settings → Extensions → turn all OFF\n3. *Close extra tabs* → Too many tabs slow down the browser\n4. *Restart browser* → Close it → reopen\n\nIf still slow → click *Create Ticket* button 🎫`,

  excel_issue:
    `Excel not opening or crashing. Try these steps:\n\n1. *Task Manager* → Ctrl+Shift+Esc → find Excel → End Task → reopen it\n2. *Restart* → Restart your laptop → try again\n3. *Safe Mode* → Not applicable (no admin rights) → Raise a ticket\n\nIf still not opening → click *Create Ticket* button — IT will repair it 🎫`,

  word_issue:
    `Word not opening or crashing. Try these steps:\n\n1. *Task Manager* → Ctrl+Shift+Esc → find Word → End Task → reopen it\n2. *Restart* → Restart your laptop → try again\n\nIf still not opening → click *Create Ticket* button — IT will repair Office 🎫`,

  ppt_issue:
    `PowerPoint not opening or crashing. Try these steps:\n\n1. *Task Manager* → Ctrl+Shift+Esc → find PowerPoint → End Task → reopen it\n2. *Restart* → Restart your laptop → try again\n\nIf still not opening → click *Create Ticket* button — IT will repair Office 🎫`,

  office_activation:
    `MS Office activation error.\n\nClick the *Create Ticket* button — IT will activate Office. Employees cannot activate it themselves (no admin rights). 🎫`,

  pdf_issue:
    `PDF not opening. Try these steps:\n\n1. *Right-click → Open With* → Right-click the PDF → Open With → select Adobe Acrobat\n2. *Try in Chrome* → Drag and drop the PDF file into the Chrome browser\n3. *Restart* → Restart your laptop → try again\n\nIf Adobe is not installed → click *Create Ticket* button — IT will install it 🎫`,

  // ── New issues ────────────────────────────────────────────────────────────
  screen_flicker:
    `Screen is flickering/blinking. Try these steps:\n\n1. *Restart* → Restart your laptop — driver glitch usually fixes on restart\n2. *External monitor* → Connect monitor via HDMI — if external looks fine then laptop screen is a hardware issue\n3. *Adjust brightness* → Press Fn+F5/F6 to adjust brightness\n\nIf not resolved → click *Create Ticket* button — IT will help directly 🎫`,

  projector_issue:
    `Projector/HDMI not connecting. Try these steps:\n\n1. *Check cable* → Is the HDMI cable properly connected on both ends?\n2. *Win+P* → Press Windows key + P → select Extend or Duplicate\n3. *Detect* → Right-click Desktop → Display Settings → Detect\n4. *Restart* → Keep everything connected and restart your laptop\n\nIf not resolved → click *Create Ticket* button 🎫`,

  usb_issue:
    `USB port not working. Try these steps:\n\n1. *Different port* → Plug the device into a different USB port\n2. *Replug* → Remove USB device → wait 10 sec → plug back in\n3. *Restart* → Restart your laptop → plug back in\n\nIf no port is working at all → click *Create Ticket* button — IT team will help you directly 🎫`,

  fan_noise:
    `Fan making loud noise. Do this:\n\n1. *Check* → If there is smoke, burning smell or extreme heat → IMMEDIATELY turn off the laptop\n2. *Task Manager* → Ctrl+Shift+Esc → End Task heavy apps\n3. *Surface* → Place laptop on a hard table, not a soft surface\n\nIf noise does not stop → click *Create Ticket* button — IT will check the fan 🎫`,

  frequent_disconnect:
    `WiFi keeps disconnecting. Try these steps:\n\n1. *WiFi Toggle* → Taskbar WiFi → OFF → 10 sec → ON → reconnect\n2. *Move closer* → Move closer to the router — distance weakens signal\n3. *Forget & Reconnect* → WiFi settings → "Wiom office" → Forget → reconnect (pw: ${WIFI_PASSWORD})\n\nIf keeps happening → click *Create Ticket* button — IT will check the network 🎫`,

  door_access:
    `Door access card issue. Do this:\n\nClick the *Create Ticket* button — IT/Admin department will issue a new card or reprogram the existing one.\nIn the ticket, write: which floor/door access you need. 🎫`,

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
    `Google Drive not working. Try these steps:\n\n1. *Open in browser* → Open drive.google.com in Chrome\n2. *Clear cache* → Ctrl+Shift+Del → All time → Clear\n3. *Try Incognito* → Ctrl+Shift+N → drive.google.com\n\nIf you do not have access → click *Create Ticket* button — IT will grant access 🎫`,

  shared_drive_issue:
    `No access to Shared Drive.\n\nClick the *Create Ticket* button — IT will grant you access to the shared drive.\nIn the ticket, write: which drive/folder you need and why. 🎫`,

  file_sync_issue:
    `Files not syncing. Try these steps:\n\n1. *Check internet* → Is WiFi properly connected?\n2. *Check browser* → Manually check drive.google.com\n3. *Sign out/in* → Sign out of Drive app → sign back in\n\nIf still not syncing → click *Create Ticket* button 🎫`,

  storage_full:
    `Storage/disk is full. Try these steps:\n\n1. *Recycle Bin* → Desktop Recycle Bin → Empty Recycle Bin\n2. *Downloads* → File Explorer → Downloads → delete files you no longer need\n3. *Move to Google Drive* → Upload files to the cloud\n\nIf still low on space → click *Create Ticket* button — IT will do a storage cleanup 🎫`,

  phishing_email:
    `Phishing/suspicious email received!\n\n1. *Do NOT click any link* → ABSOLUTELY do not click any link or attachment in the email\n2. *Report in Gmail* → Email → 3 dots → Report phishing\n3. *Notify IT* → Click *Create Ticket* button — IT will investigate 🎫\n\n⚠️ If you already clicked the link → raise a ticket IMMEDIATELY!`,

  virus_malware:
    `Virus/Malware suspected!\n\n1. *Disconnect internet* → Disconnect WiFi IMMEDIATELY\n2. *Create Ticket* → Raise one NOW — IT will come directly\n\n⚠️ Do not do anything on the laptop — IT is coming 🎫`,

  suspicious_login:
    `Suspicious login detected — do this IMMEDIATELY:\n\n1. *Create Ticket* → Raise one now — HIGH priority\n2. *Email IT* → ${ADMIN_EMAIL_KB}\n\nIT will secure your account. Do NOT change the password yourself — IT will do it. 🎫`,

  security_alert:
    `Security alert is appearing.\n\nClick the *Create Ticket* button — IT will investigate the security issue.\nIn the ticket, write the exact alert message. 🎫`,

  account_hacked:
    `Account has been hacked — EMERGENCY!\n\n1. *Create Ticket NOW* → CRITICAL priority\n2. *Email IT* → ${ADMIN_EMAIL_KB}\n3. *Do nothing* → Do not make any changes to the account\n\nIT will secure it immediately. 🎫`,

  burning_smell:
    `EMERGENCY! Burning smell or smoke!\n\n1. *TURN OFF IMMEDIATELY* — Hold the power button\n2. *UNPLUG CHARGER* — Immediately\n3. *KEEP AWAY* — Leave the laptop in a safe place\n4. *Notify IT* → ${ADMIN_EMAIL_KB}\n\nClick *Create Ticket* → CRITICAL emergency 🎫`,

  battery_swelling:
    `EMERGENCY! Battery is swollen/bloated!\n\n1. *TURN OFF IMMEDIATELY* — Hold power button\n2. *UNPLUG CHARGER* — Now\n3. *KEEP LAPTOP AWAY* — Fire hazard\n4. *Notify IT* → ${ADMIN_EMAIL_KB}\n\nClick *Create Ticket* → CRITICAL emergency 🎫`,

  data_loss:
    `Files/data are missing. Try these steps:\n\n1. *Recycle Bin* → Check the Desktop Recycle Bin\n2. *Google Drive Trash* → drive.google.com → Trash folder\n3. *Search* → Search for the file name in File Explorer\n\nIf not found → click *Create Ticket* button — IT will attempt data recovery 🎫`,

  physical_damage:
    `Laptop has been physically damaged.\n\nThis cannot be fixed with software — click *Create Ticket* button IMMEDIATELY.\nIT will physically assess and repair/replace it.\nIn the ticket, describe the damage. 🎫`,

  liquid_damage:
    `EMERGENCY! Liquid/Water spilled!\n\n1. *TURN OFF IMMEDIATELY* — Hold the power button\n2. *UNPLUG CHARGER*\n3. *TURN UPSIDE DOWN* → Let the liquid drain out\n4. *Do NOT use a hairdryer*\n5. *Notify IT* → ${ADMIN_EMAIL_KB}\n\nClick *Create Ticket* → CRITICAL emergency 🎫`,

  device_lost:
    `Device is lost or stolen.\n\n1. *Check first* → Check desk/drawer/surroundings, ask colleagues\n2. *If not found* → Click *Create Ticket* button — HIGH PRIORITY\n3. *Email IT* → ${ADMIN_EMAIL_KB}\n4. *Inform HR as well*\n\n⚠️ Must be reported within 24 hours. 🎫`,

  // ── Additional DIRECT_KB entries — bypasses AI for common issues ─────────────
  excel_slow:
    `**Excel Running Slow or Freezing**\n\n1. Close unnecessary Chrome tabs and other applications first\n2. Disable add-ins: Excel → File → Options → Add-ins → Manage: COM Add-ins → Go → uncheck all → OK → restart Excel\n3. Remove heavy conditional formatting: Home → Conditional Formatting → Clear Rules → Clear Rules from Entire Sheet\n4. Save as .xlsx (File → Save As → choose .xlsx format — old .xls format is slower)\n5. If file is very large (>5MB): raise a ticket — IT will check RAM\n\nIf still slow → click *Create Ticket* button 🎫`,

  chrome_issue:
    `**Google Chrome Not Working**\n\n1. Hard refresh: Ctrl + Shift + R (force reload)\n2. Clear cache: Ctrl + Shift + Delete → select "All time" → tick "Cached images and files" + "Cookies" → Clear data\n3. Disable extensions: Menu (⋮) → More tools → Extensions → toggle all OFF → restart Chrome\n4. If Chrome won't open: Ctrl+Shift+Esc → Task Manager → find all "chrome.exe" → End Task → reopen Chrome\n5. Reset Chrome settings: Settings → scroll down → Reset settings → Restore settings to defaults\n\nIf still not working → click *Create Ticket* button 🎫`,

  edge_issue:
    `**Microsoft Edge Not Working**\n\n1. Hard refresh: Ctrl + Shift + R\n2. Clear cache: Ctrl + Shift + Delete → All time → Clear data\n3. Disable extensions: Menu (…) → Extensions → Manage extensions → disable all → restart Edge\n4. Reset Edge: Settings → Reset settings → Restore settings to defaults → Reset\n5. If Edge keeps crashing: raise a ticket — may need reinstall\n\nIf still not working → click *Create Ticket* button 🎫`,

  slack_issue:
    `**Slack Not Working**\n\n1. Quit Slack completely: System tray (bottom-right) → right-click Slack icon → Quit\n2. Reopen Slack from desktop/taskbar\n3. If messages not loading: Slack → Help → Troubleshooting → Clear Cache and Restart\n4. Check internet: open Chrome → try gmail.com — if that also fails, WiFi issue hai\n5. Try Slack Web as backup: open Chrome → slack.com → log in\n\nIf Slack won't open at all → click *Create Ticket* button 🎫`,

  password_reset:
    `**Password Reset**\n\n⚠️ Company passwords can only be reset by IT — employees cannot self-reset.\n\n*Raise a ticket* and IT will reset your password within 30 minutes during office hours.\n\n*Include in your ticket:*\n- Which account (Windows login / Gmail / other app)\n- Your employee ID\n- Is your work completely stopped?\n\nClick *Create Ticket* button — IT will help you right away 🎫`,

  account_locked:
    `**Account Locked**\n\nYour account has been locked due to multiple failed login attempts.\n\n⚠️ Only IT can unlock accounts — you cannot do this yourself.\n\n*Raise a ticket immediately* — IT will unlock within 15 minutes during office hours.\n\n*Include in your ticket:*\n- Which account is locked (Windows / Gmail / app name)\n- Your employee ID\n- Error message you are seeing\n\nClick *Create Ticket* button — URGENT! 🎫`,

  email_access:
    `**Company Email Access Issue**\n\nNew email account setup or existing access issues are handled by IT only.\n\n*Raise a ticket* with:\n- Your full name and employee ID\n- Type of request (new account / can't login / password reset / other)\n- Is this blocking your work completely?\n\nIT will set up or restore access within 1 working day.\n\nClick *Create Ticket* button 🎫`,

  shared_folder:
    `**Shared Folder / Drive Access**\n\nShared folder and drive access is managed by IT — you cannot grant it yourself.\n\n*Raise a ticket* with:\n- Name of the shared folder or drive\n- Type of access needed (view only / edit / full access)\n- Your manager's name (manager approval is required)\n\nIT will grant access within 1 working day after manager confirmation.\n\nClick *Create Ticket* button 🎫`,

  outlook_email:
    `**Email Issue**\n\n⚠️ WIOM uses Gmail (Google Workspace) — NOT Outlook.\n\n*For Gmail issues:*\n1. Go to gmail.com in Chrome and sign in with your company email\n2. If you can't sign in → raise a ticket for IT to reset your password\n3. If Gmail is slow → clear cache: Ctrl+Shift+Delete → All time → Clear data\n4. Check Spam/Junk folder if emails are missing\n\nStill having issues? Click *Create Ticket* button 🎫`,

  otp_issue:
    `**OTP / Two-Factor Authentication Not Working**\n\n1. Check phone signal — OTP needs network to arrive\n2. OTP expires in 30-60 seconds — enter it immediately after it arrives\n3. Check if your phone time/date is correct (wrong time = wrong OTP in authenticator apps)\n4. Use the "Resend OTP" button and try again\n5. If using Google Authenticator app: open app → tap 3 dots → Sync now (fixes time drift)\n\nIf your registered phone number has changed → *Create Ticket* button dabao — IT will update it 🎫`,

  software_access:
    `**Software / Application Access Required**\n\nAccess to software and applications is granted by IT — you cannot request it directly from the vendor.\n\n*Raise a ticket* and include:\n- Software/application name (e.g. Tally, AutoCAD, Adobe, VPN, etc.)\n- Your employee ID and department\n- Business reason / who asked you to use it\n- Your manager's name (approval may be required)\n\nIT will set up access within 1 working day.\n\nClick *Create Ticket* button 🎫`,
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
    return `WiFi connected but no internet. Try these steps:\n\n1. *WiFi toggle* → Taskbar WiFi → OFF → 10 sec → ON\n2. *Reopen Chrome* → Close Chrome → reopen → try gmail.com\n3. *Restart* → Restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Browser slow — check BEFORE generic slow to avoid wrong match
  if ((pn.includes('browser') || pn.includes('chrome') || pn.includes('edge')) &&
      (pn.includes('slow') || pn.includes('hang') || pn.includes('freez') || pn.includes('lagg')))
    return `Browser is slow. Try these steps:\n\n1. *Clear cache* → Ctrl+Shift+Del → "All time" → Cached images & files → Clear\n2. *Disable extensions* → Chrome → Settings → Extensions → disable all\n3. *Restart browser* → Close → reopen\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Excel slow — check BEFORE generic slow
  if (pn.includes('excel') && (pn.includes('slow') || pn.includes('hang') || pn.includes('freez')))
    return `Excel is slow/hanging. Try these steps:\n\n1. *Close other files* → Are other Excel files open? Close them\n2. *Disable add-ins* → File → Options → Add-ins → Manage: COM Add-ins → Go → uncheck all\n3. *Restart* → Close Excel → restart laptop → reopen\n\nIf not resolved → click *Create Ticket* button — IT will repair it 🎫`;

  // Teams slow
  if (pn.includes('teams') && (pn.includes('slow') || pn.includes('hang') || pn.includes('lagg')))
    return `Microsoft Teams is slow. Try these steps:\n\n1. *Quit & Reopen* → Taskbar Teams icon → right-click → Quit → reopen\n2. *Try in browser* → Open teams.microsoft.com in Chrome\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Generic laptop slow — only when NO app/browser/software context
  if ((pn.includes('slow') || pn.includes('hang') || pn.includes('freez') || pn.includes('dheema') || pn.includes('lagg')) &&
      !pn.includes('browser') && !pn.includes('chrome') && !pn.includes('edge') && !pn.includes('excel') &&
      !pn.includes('word') && !pn.includes('teams') && !pn.includes('zoom') && !pn.includes('internet') &&
      !pn.includes('wifi') && !pn.includes('website') && !pn.includes('slack') && !pn.includes('gmail') &&
      !pn.includes('outlook') && !pn.includes('app') && !pn.includes('software') && !pn.includes('pdf'))
    return `💻 *Laptop Slow/Hanging* — try these steps:\n\n1. *Task Manager* → Ctrl+Shift+Esc → CPU column → End Task whatever is using the most\n2. *Browser tabs* → Close unnecessary Chrome/Edge tabs\n3. *Restart* → Properly shut down (restart, not sleep)\n\nIf all three steps did not help → click *Create Ticket* button — IT team will check RAM or SSD 🎫`;

  if (pn.includes('wifi') || pn.includes('internet') || pn.includes('network') ||
      /\bnet\b/.test(pn) || pn.includes('net band') || pn.includes('signal nahi') || pn.includes('no internet'))
    return `WiFi/Internet issue. Try these steps:\n\n1. *Toggle* → Taskbar WiFi → OFF → 10 sec → ON → connect to "Wiom office" (password: ${WIFI_PASSWORD})\n2. *Restart* → Restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Laptop won't start / boot / turn on
  // ISSUE 5 fix: added English boot phrases ("won't turn on", "not turning on", "laptop dead")
  if (/\b(laptop|leptop|lptop|latop)\b.*(on\s*nahi|start\s*nahi|band\s*ho|nahi\s*chalta|khulta\s*nahi|nahi\s*khulta|chal\s*nahi|chalti\s*nahi|chalte\s*nahi)|boot\s*nahi|(switch|power)\s*on\s*nahi|laptop\s*nahi\s*(chal|start|on|boot)|on\s*nahi\s*ho\s*rh|(nahi\s*ho\s*rh|nahi\s*chal).*(laptop|leptop|lptop|latop)|won.?t\s*(turn\s*on|start|boot)|not\s*turning\s*on|not\s*starting|laptop\s*(is\s*)?(dead|not\s*starting)|no\s*power\s*laptop/.test(pn))
    return `Try these 3 things:\n\n1. *Check charger* — is the charger properly plugged in? Try a different socket\n2. *10 second hold* — hold the power button for 10 sec → release → wait 30 sec → try again\n3. *Remove charger and try* — remove charger → hold power button 30 sec → plug charger → turn on\n\nClick *Create Ticket* button — a HIGH PRIORITY ticket will be raised 🎫`;

  // Overheating
  if (/\b(laptop|leptop|lptop|latop)\b.*(garm|garam|heat|hot\b)|garm.*(laptop|leptop)|(overheat|over\s*heat|bahut\s*garam|bahut\s*garm|zyada\s*heat|zyada\s*garm)/.test(pn))
    return `Laptop overheating issue. Try these steps:\n\n1. *Place on a table* → Put the laptop on a table — not on a bed/sofa (blocks airflow)\n2. *Close heavy apps* → Ctrl+Shift+Esc → Task Manager → CPU column → End Task heavy apps\n3. *Restart* → Restart your laptop — stops background processes\n\nIf overheating badly or shutting off → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Screen black / blank / nothing visible
  if (/screen\s*(kali|kala|black|blank|kuch\s*nahi)|black\s*screen|kali\s*screen|monitor\s*(black|kala|kali|blank)|display\s*(black|kali|blank|nahi\s*aa)|screen\s*pe\s*kuch\s*nahi|(screen|display|monitor|laptop).*(nahi\s*dikh|dikhna\s*band)|(nahi\s*dikh|dikhna\s*band).*(screen|display|monitor|laptop)/.test(pn))
    return `Black/blank screen issue. Try these steps:\n\n1. *Brightness Keys* → Press Fn+F5 or Fn+F8 — screen may be dimmed\n2. *Force Restart* → Hold power button 10 sec → shut down → turn back on\n3. *External Monitor Test* → Connect an external monitor via HDMI — if external shows fine then laptop screen is a hardware issue\n4. *Check Charger* → Battery may be dead → plug charger → wait 10 min → turn on\n\nIf screen still does not come back → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Screen color distortion / flickering / lines
  if ((/colorful|colorfull|colarful|colarfull|colour|color\s*aa|rang\s*aa|pink\s*screen|green\s*screen|screen\s*pe\s*rang|display.*color|color.*display|screen\s*kharab/.test(pn) ||
       /distort|flicker|flickring/i.test(pn) ||
       /lines\s*(aa|on|on\s*screen|pe)|screen.*lines|horizontal\s*lines?|vertical\s*lines?/.test(pn)) &&
      /screen|display|monitor|laptop/.test(pn))
    return `Screen color/display issue. Try these steps:\n\n1. *Restart* → Restart your laptop — driver glitch usually fixes on restart\n2. *External monitor test* → Connect monitor via HDMI — if external looks fine then laptop screen is a hardware issue\n\nIf restart did not fix it → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Screen / Monitor — generic disambiguation (extra screen vs current screen broken)
  // NOTE: physical damage (crack/toot/damage) is excluded here — falls through to physical damage check below
  if (/\b(screen|monitor|display)\b/.test(pn) &&
      !/damage|crack|toot|phoot|gir\s*gaya|girna|broken|toota|tooti/.test(pn))
    return `You mentioned screen, but it is not clear if you need *an extra screen* or your *current screen is not working properly*.\n\n🖥️ *Need an extra screen?*\n→ This is outside IT scope. *Contact Admin/Facilities* — and you will need *your Reporting Manager's approval* first.\n\n⚠️ *Current screen not working?*\n→ Is the laptop on (can you see the power LED)? Or is the screen completely black?\n1. *Brightness keys* → Press Fn+F5 or Fn+F8\n2. *Force restart* → Hold power button 10 sec → shut down → turn back on\n3. *Charger check* → Battery may be dead → plug charger → wait 10 min\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Laptop won't boot / startup error / stuck on boot screen
  if (/\b(boot|startup|start\s*up)\b.*(nahi|nhi|error|stuck|atak|fail|loop)|(nahi|nhi).*(boot|start\s*up|startup)|(laptop|pc|computer).*(start\s*nahi|on\s*nahi\s*ho|boot\s*nahi)|windows.*(load\s*nahi|start\s*nahi|aata\s*nahi|nahi\s*aa\s*rha)|stuck.*logo|logo.*stuck/.test(pn))
    return `Laptop boot/startup issue. Try these steps:\n\n1. *Force shutdown* → Hold power button 10 sec → let it shut down → wait 30 sec\n2. *Turn on again* → Press power button — Windows may load correctly now\n3. *Check charger* → Battery may be dead → plug charger → wait 5 min → turn on\n4. *Happening repeatedly?* → Windows update may be running — wait 15-20 min, do not turn off\n\nIf still not booting after 3 tries → click *Create Ticket* button — IT team will come 🎫`;

  // Windows update / OS crash / restart loop
  if (/windows\s*(crash|restart|update|stuck|atak|loop|hang)|update\s*(stuck|atak|hang|nahi|ruka)|restart\s*(bar\s*bar|baar\s*baar|loop|hota\s*rha|ho\s*rha\s*bar)|os\s*(crash|hang|stuck)/.test(pn))
    return `Windows issue. Try these steps:\n\n1. *Restart* → Properly shut down via power button → turn back on\n2. *Wait* → If Windows update is running → wait, do not turn off\n\nIf restarting more than 3 times or cannot stop → click *Create Ticket* button — IT team will help you directly 🎫`;

  if ((pn.includes('sound') || pn.includes('audio') || pn.includes('speaker') || pn.includes('headphone')) && !pn.includes('zoom') && !pn.includes('teams') && !pn.includes('call'))
    return `Audio issue. Try these steps:\n\n1. *Sound settings* → Right-click speaker icon in taskbar → Sound settings\n2. *Output device* → select the correct device\n3. *Volume check* → Is it at 0% or muted?\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('blue screen') || pn.includes('bsod'))
    return `Blue Screen issue. Do this:\n\n1. *Note the error code* — what was written on the screen\n2. *Restart* — usually one restart fixes it\n3. If it has appeared more than 3 times → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (/batter[yi]?|battry|battey|batr[yi]|\bbatt\b|charging/.test(pn))
    return `Battery/Charging issue. Try these steps:\n\n1. *Check charger* → Is it firmly plugged on both ends? (laptop side + socket side)\n2. *Try a different socket*\n3. *Reset* → Shut down laptop → unplug charger → hold power button 30 sec → plug charger → turn on\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // ISSUE 4 fix: removed dead code — black screen already handled above (line ~361)

  if (pn.includes('keyboard') || pn.includes('keys') || /keybo?r?a?d/.test(pn))
    return `Keyboard issue. Try these steps:\n\n1. *Restart* → Restart your laptop\n2. *On-screen keyboard* → Start menu → type "On-Screen Keyboard" → open it → use it temporarily\n\nClick *Create Ticket* button — IT will come and fix it 🎫`;

  if (pn.includes('touchpad') || pn.includes('mouse'))
    return `Touchpad issue. Try these steps:\n\n1. *Fn key* → Press Fn + touchpad lock key (the key with the lock icon on keyboard)\n2. *Settings* → Settings → Bluetooth & devices → Touchpad → turn ON\n3. *Restart* → Restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('printer'))
    return `Printer issue. Try these steps:\n\n1. *Restart printer* → Turn printer off → wait 30 sec → turn back on\n2. *Restart laptop* → Restart your laptop → try printing again\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // MS OFFICE NOT WORKING / CRASHING — all variants including 365, xlsx, docx, pptx
  if (
    /\b(ms\s*office|microsoft\s*office|office\s*365|office365|ms365|word|excel|powerpoint|ppt|xlsx|xls|docx|doc\b|pptx|office\s*file|office\s*app|ms\s*word|ms\s*excel)\b/i.test(pn) &&
    /\b(nahi\s*khul|not\s*open|open\s*nahi|nahi\s*chal|crash|hang|ha+g|freeze|freez|error|band\s*ho|kaam\s*nahi|loading|stuck|atak|response\s*nahi|start\s*nahi|nahi\s*start)\b/i.test(pn)
  ) {
    return `⚙️ *MS Office Issue* — try these steps:\n\n1. *Force close* → Ctrl+Shift+Esc → Task Manager → find Microsoft Word/Excel → End Task → reopen\n2. *Restart* → Restart your laptop → reopen it\n\nIf still not opening → click *Create Ticket* button — IT will come and repair it 🎫`;
  }

  // Office 365 subscription/access issue
  if (/\b(office\s*365|microsoft\s*365|ms\s*365|office365)\b/i.test(pn) &&
      /\b(issue|problem|nahi|error|kaam\s*nahi|access\s*nahi|open\s*nahi|chal\s*nahi|activate|license)\b/i.test(pn)) {
    return `⚙️ *Microsoft Office 365 Issue*\n\nTry these steps:\n\n1. *Restart* → Restart your laptop\n2. *Check internet* → Office 365 requires an internet connection\n\nIf still a problem → click *Create Ticket* button — IT team will help you directly 🎫`;
  }

  if (pn.includes('slack'))
    return `Slack issue. Try these steps:\n\n1. *Quit* → Right-click Slack icon in taskbar → Quit\n2. *Reopen* → Open Slack from Start menu\n3. *Clear cache* → If still not working → Help → Troubleshooting → Clear Cache & Restart\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('teams'))
    return `Teams issue. Try these steps:\n\n1. *Quit & Reopen* → Right-click Teams icon in taskbar → Quit → reopen\n2. *Try in browser* → Open teams.microsoft.com in Chrome\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('zoom') && (pn.includes('mic') || pn.includes('audio') || pn.includes('awaaz') || pn.includes('sound') || pn.includes('sun') || pn.includes('nahi sun')))
    return `Zoom microphone/audio issue. Try these steps:\n\n1. *Privacy check* → Settings → Privacy & Security → Microphone → allow Zoom\n2. *Zoom Audio settings* → Zoom → Settings → Audio → select the correct microphone → Test it\n3. *Check in call* → Zoom → ⬆️ arrow (next to Mute button) → select correct mic\n4. *Restart* → Quit Zoom → rejoin the call\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('zoom') && (pn.includes('video') || pn.includes('camera') || pn.includes('cam') || pn.includes('black') || pn.includes('nahi dikh')))
    return `Zoom camera/video issue. Try these steps:\n\n1. *Privacy check* → Settings → Privacy & Security → Camera → allow Zoom\n2. *Zoom Video settings* → Zoom → Settings → Video → select the correct camera\n3. *Check in call* → Zoom → ⬆️ arrow (next to Video button) → select correct camera\n4. *Restart* → Quit Zoom → rejoin the call\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('zoom'))
    return `Zoom issue. Try these steps:\n\n1. *Restart* → Close Zoom → reopen it\n2. *Try in browser* → Open zoom.us/wc/join in Chrome\n3. *Settings* → Zoom Settings → select the correct device\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('calendar'))
    return `Google Calendar issue. Try these steps:\n\n1. *Check in browser* → Open calendar.google.com in Chrome\n2. *Clear cache* → Ctrl+Shift+Del → All time → Clear\n3. *Try Incognito* → Ctrl+Shift+N → calendar.google.com\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('chrome') && (pn.includes('nahi') || pn.includes('crash') || pn.includes('open')))
    return `Chrome issue. Try these steps:\n\n1. *Task Manager* → Ctrl+Shift+Esc → find Chrome → End Task\n2. *Reopen Chrome*\n3. *Restart laptop* → If still not working\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('edge') && (pn.includes('nahi') || pn.includes('crash') || pn.includes('open')))
    return `Edge browser issue. Try these steps:\n\n1. *Task Manager* → Ctrl+Shift+Esc → find Edge → End Task\n2. *Reopen Edge*\n3. *Use Chrome* → Use Chrome browser for now\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  // Phishing/suspicious email — MUST come before generic email check
  if (/phishing|suspicious\s*email|suspicious\s*link|spam\s*mail|fake\s*email|fraud\s*email/.test(pn))
    return `Phishing/suspicious email received!\n\n1. *Do NOT click any link* → ABSOLUTELY do not click any link or attachment in the email\n2. *Report in Gmail* → Email → 3 dots → Report phishing\n3. *Notify IT* → Click *Create Ticket* button — IT will investigate 🎫\n\n⚠️ If you already clicked the link → raise a ticket IMMEDIATELY!`;

  // WIOM uses Gmail (Google Workspace) — NOT Outlook
  // "email nahi chal rha", "gmail nahi khul rha", "mail nahi aa rha"
  if (pn.includes('outlook')) {
    return `ℹ️ WIOM does not use Outlook — *Gmail* is used.\n\nHaving a problem with Gmail? Open gmail.com in Chrome and describe the issue.`;
  }
  if (pn.includes('email') || pn.includes('gmail') || pn.includes('mail')) {
    return `📧 *Gmail Issue* — try these steps:\n\n1. *Incognito test* → Chrome → Ctrl+Shift+N → gmail.com → see if it opens\n2. *Clear cache* → Ctrl+Shift+Del → "All time" → Cookies + Cache → Clear\n3. *Different browser* → Open gmail.com in Edge\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;
  }

  if (pn.includes('password') || pn.includes('locked') || pn.includes('login') || /pas?w?ro?d/.test(pn)) {
    // Gmail/Google password — IT handles (no admin rights to self-reset company Google accounts)
    if (/google|gmail|email|mail/.test(pn))
      return `🔑 *Gmail/Google Account Password*\n\nCompany Gmail account password is reset by IT — employees cannot reset it themselves.\n\nClick *Create Ticket* button — IT will reset it quickly 🎫`;
    return `🔑 *Password/Login Issue*\n\nPassword reset can only be done by IT team.\n\nClick *Create Ticket* button — IT team will reset it quickly 🎫`;
  }

  if (pn.includes('bluetooth'))
    return `Bluetooth issue. Try these steps:\n\n1. *Toggle* → Settings → Bluetooth → OFF → ON\n2. *Re-pair* → Remove the device → pair again\n3. *Restart* → Restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('camera') || pn.includes('webcam') || /\bcam\b/.test(pn))
    return `Camera issue. Try these steps:\n\n1. *Privacy check* → Settings → Privacy & Security → Camera → turn ON\n2. *App settings* → Teams/Zoom → Settings → Video → select the correct camera\n3. *Restart* → Restart your laptop\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (/mic|microphone/.test(pn) && !pn.includes('microsoft'))
    return `Microphone issue. Try these steps:\n\n1. *Privacy check* → Settings → Privacy & Security → Microphone → turn ON\n2. *Input device* → Sound settings → Input → select the correct mic\n3. *Teams test* → Teams Settings → Devices → test the mic\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('usb') || pn.includes('pendrive'))
    return `USB issue. Try these steps:\n\n1. *Different port* → Plug the USB device into a different port\n2. *Restart* → Restart your laptop → plug back in\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('pdf') || pn.includes('adobe') || pn.includes('acrobat'))
    return `PDF issue. Try these steps:\n\n1. *Open in Chrome* → Drag and drop the PDF into Chrome — works without Adobe too\n2. *Right-click* → Right-click the PDF → Open With → select Adobe Acrobat\n\nIf Adobe is not installed → click *Create Ticket* button — IT will install it 🎫`;

  if (pn.includes('scanner') || pn.includes('scan'))
    return `Scanner issue. Try these steps:\n\n1. *Restart scanner* → Turn off → wait 30 sec → turn back on\n2. *Check USB cable* → Is the cable properly connected?\n3. *Restart laptop* → Try scanning again\n\nIf not detected → click *Create Ticket* button — IT will install the driver 🎫`;

  if (pn.includes('network drive') || pn.includes('shared drive') || /z:\s*drive|mapped\s*drive|shared\s*folder/.test(pn))
    return `Network Drive issue. Try these steps:\n\n1. *Restart laptop* → Usually the drive comes back after restart\n2. *File Explorer* → This PC → if not showing → click *Create Ticket* button — IT will remap it\n\nIf not resolved → click *Create Ticket* button — IT team will help you directly 🎫`;

  if (pn.includes('shared folder') || pn.includes('folder access') || pn.includes('access nahi'))
    return `Shared Folder Access issue. Do this:\n\nClick *Create Ticket* button — IT team will give you folder access. In the ticket, mention: *which folder* you need and *what it is for* 🎫`;

  if (pn.includes('hdmi') || pn.includes('projector') || pn.includes('second screen') || pn.includes('external monitor') || pn.includes('monitor connect'))
    return `External Monitor/Projector issue. Try these steps:\n\n1. *Check cable* → Is the HDMI cable properly connected on both ends?\n2. *Win+P* → Press Windows + P → select Extend or Duplicate\n3. *Monitor ON* → Is the external monitor turned on?\n\nIf not detected → click *Create Ticket* button — IT will help directly 🎫`;

  if (pn.includes('storage') || pn.includes('disk full'))
    return `Storage/disk full issue. Try these steps:\n\n1. *Recycle Bin* → Desktop → Recycle Bin → Empty Recycle Bin\n2. *Downloads folder* → File Explorer → Downloads → delete files you no longer need\n\nIf still a problem → click *Create Ticket* button — IT will do the rest of the cleanup 🎫`;

  // BUG-FIX: VPN check in getKBFallback (was only in detectIntent, returned generic before)
  if (/\bvpn\b/.test(pn))
    return `ℹ️ WIOM does not use VPN.\n\nAny other IT issue? Let me know — I can help.`;

  // BUG-FIX: liquid damage — "paani gira", "paani gir gaya" etc. (was returning generic)
  if (/paani|liquid|pani\s*gir|water\s*(gir|spill|giray)|coffee\s*gir|chai\s*gir/.test(pn))
    return `EMERGENCY! Liquid/Water spilled!\n\n1. *TURN OFF IMMEDIATELY* — Hold the power button\n2. *UNPLUG CHARGER*\n3. *TURN UPSIDE DOWN* → Let the liquid drain out\n4. *Do NOT use a hairdryer*\n5. *Notify IT* → ${ADMIN_EMAIL_KB}\n\nClick *Create Ticket* → CRITICAL emergency 🎫`;

  // BUG-FIX: physical damage — "gir gaya", "toot gaya", "damage" (was returning generic)
  if (/gir\s*gaya|toot\s*gaya|toot\s*gai|phoot\s*gaya|crack|damage|broken|screen\s*toot|crack\s*ho|physical/.test(pn) &&
      /laptop|screen|display|phone|tablet/.test(pn))
    return `Laptop has been physically damaged.\n\nThis cannot be fixed with software — click *Create Ticket* button IMMEDIATELY.\nIT will physically assess and repair/replace it.\nIn the ticket, describe the damage. 🎫`;

  if (pn.includes('virus') || pn.includes('malware') || pn.includes('antivirus'))
    return `Possible virus/malware issue. Do this:\n\n1. *Quick Scan* → Windows Security → Virus & threat protection → Quick Scan\n2. *Disconnect internet* → if suspicious activity is suspected\n\nClick *Create Ticket* button — this could be serious, IT team will help you directly 🎫`;

  if (pn.includes('kaise ho') || pn.includes('kaisa hai') || pn.includes('how are you') || pn.includes('kya haal'))
    return 'All good, thank you! Any IT issue? Let me know — I can help.';

  if (pn.includes('thanks') || pn.includes('shukriya') || pn.includes('thank you') || pn.includes('dhanyawad'))
    return 'You are welcome. Feel free to reach out if anything else comes up.';

  if (/^(hello|hi+|hey|namaste|namaskar|hlo|helo)\s*[!.]*$/i.test(pn.trim()))
    return 'Hello! I am WIOM IT Support Assistant. How can I help you today?';

  if (/\b(kise|kaun)\s*(ho|hain|hai)\b/i.test(pn) || /\b(tum|aap)\s*(kya|kise|kaun)\b/i.test(pn))
    return `I'm *WIOM IT Assistant*.\nLaptop, WiFi, software, password — I can help with any IT issue.\nTell me what the problem is.`;

  // FIX: "sajan" only for contact-intent, not when user introduces themselves
  if ((pn.includes('sajan') && /contact|email|se\s*baat|number|kaun\s*hai|it\s*wala/.test(pn)) ||
      pn.includes('it head') || pn.includes('phone number') || pn.includes('number do'))
    return `IT contact: *Sajan Kumar* | 📧 ${ADMIN_EMAIL_KB}`;

  // Conversational / non-IT responses
  if (/^(bye|goodbye|exit|quit|close|band\s*karo|niklo|alvida|baad\s*mein|chalte\s*hain|nikalta\s*hoon|nikal\s*rha)\s*[!.]*$/i.test(pn.trim()))
    return 'Alright! Let me know if you have any other IT issue. 👍';

  if (/\b(ok\b|okay|theek\s*hai|accha|achha|haan\s*theek|kal\s*bataunga|dekh\s*leta)\b/i.test(pn))
    return 'Okay. Let me know if you have any other IT issue.';

  if (/good\s*(morning|evening|night|afternoon)|subah|shaam\s*ko|kal\s*milte|good\s*day/i.test(pn))
    return 'Hello! Any IT issue? Let me know — I can help.';

  if (/\b(haha|hehe|lol|lmao|xd|😂|😄)\b/i.test(pn))
    return 'Let me know if you have any IT issue — I can help. 😊';

  if (/\b(call\s*karo|phone\s*karo|ring\s*karo|call\s*karna\s*hai)\b/i.test(pn))
    return 'This bot is text-based support. Type your problem here — I can help.';

  if (/\b(bhook|khaana|khana|chai|coffee|pani|water|pantry|canteen|lunch|dinner|breakfast)\b/i.test(pn) &&
      !/\blaptop\b|\bwifi\b|\bscreen\b/.test(pn))
    return 'This is the IT helpdesk — I only handle laptop, WiFi and software problems. Let me know if you have an IT issue!';

  if (/\b(bakwas|useless|bekar|faltu|kaam\s*nahi|farq\s*nahi|chodo|ignore)\b/i.test(pn))
    return 'Understood. Let me know if you have any IT issue — I can help.';

  if (/ticket\s*(kahan|ka\s*kya\s*hua|raise\s*kiya|status|kab\s*tak)|kab\s*tak\s*(kaam|resolve|theek|fix)/i.test(pn))
    return 'Your ticket is with the IT team. To check status, type: *my tickets*';

  if (/are\s*you\s*(ai|human|bot|robot)|kya\s*aap\s*(human|ai|bot|robot|real)\s*hain/i.test(pn))
    return `I'm *WIOM IT Assistant*.\nLaptop, WiFi, software, password — I can help with any IT issue.`;

  return `Please describe your problem in a bit more detail — which app or device, and exactly what is happening?\n\nOr click the *Create Ticket* button directly — IT team will help you directly. 🎫`;
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
    return `This looks like a ${appName.toUpperCase()} issue. Please share these details with IT:\n\n• *Error message/code* — what exactly does it say?\n• *Since when* — first time today or has it happened before?\n• *Screenshot* — if you can take one\n\nClick *Create Ticket* button — IT specialist will handle it 🎫`;
  }

  // Error codes — specific format like 0x80045, error 404, etc.
  if (/\b(error\s*[0-9a-fx]{4,}|0x[0-9a-f]+|err\s*\d+|code\s*\d+)\b/i.test(q)) {
    const errCode = q.match(/\b(error\s*[0-9a-fx]{4,}|0x[0-9a-f]+|err\s*\d+|code\s*\d+)\b/i)?.[0] || 'error';
    return `${errCode.toUpperCase()} error — this specific error code needs to be investigated by IT.\n\nPlease share:\n• *Which application* — which software is showing this?\n• *Exact error message* — a screenshot would help\n• *Since when* — after any update or change?\n\nClick *Create Ticket* button — a HIGH PRIORITY ticket will be raised 🎫`;
  }

  // Generic unknown but has technical words
  return `This issue is not in my knowledge base. IT team can help better.\n\nPlease share:\n• *Which app/device* — what exactly is the problem?\n• *Error message* — what does the screen say?\n• *Since when* — was it working before?\n\nClick *Create Ticket* button — IT team will help you directly 🎫`;
};

// Generic KB fallback string — used to detect when getKBFallback has no specific answer
const KB_GENERIC = `Please provide more details about your problem`;

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
  const readFirst = `\n\n🔍 EMPLOYEE QUESTION: "${lastUserQ}"\n\nFIRST UNDERSTAND:\n- Is the employee REQUESTING something? (need/request) → explain equipment/purchase process\n- Does something need TROUBLESHOOTING? (not working/problem) → give steps\n- Is it a HOW-TO question? (how/guide) → answer directly\n- Is it a policy/rule question? → answer from policy\nDo not answer in the wrong category. Read the question fully before answering.`;

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
    .replace(/delete\s+%appdata%[^\n]*/gi, 'Clear Teams cache (raise an IT ticket — they will clear it)')
    .replace(/%appdata%[^\s]*/gi, 'Teams cache folder')
    .replace(/\bcleanmgr\b/gi, '')
    .replace(/\bservices\.msc\b/gi, '')
    .replace(/\bDevice Manager\b[^.!?\n]*/gi, 'raise an IT ticket')
    .replace(/\bHP Support Assistant\b[^.!?\n]*/gi, '')
    .replace(/\bDell\s+(Support|SupportAssist|Diagnostics)[^.!?\n]*/gi, '')
    .replace(/\bLenovo\s+(Vantage|Support)[^.!?\n]*/gi, '')
    .replace(/Update\s+[Dd]river[^.!?\n]*/gi, 'raise an IT ticket (IT will update the driver)')
    // Remove Safe Mode / F8 / Diagnostic Tool suggestions — IT only
    .replace(/safe\s*mode\s*(mein|me|boot|open|karo|se)[^.!?\n]*/gi, 'raise an IT ticket')
    .replace(/F8\s*(key|dabao|press)[^.!?\n]*/gi, '')
    .replace(/diagnostic\s*tool[^.!?\n]*/gi, 'raise an IT ticket')
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
      ? `Hardware issue — IT team will physically help. Click *Create Ticket* button — IT will come to you 🎫`
      : `Got it. IT team will handle it. Click *Create Ticket* button — ticket will be raised 🎫`;
  }

  // Normalize: if shouldCreateTicket but no button prompt visible, add it
  if (shouldCreateTicket && !isHallucinated && !/Create\s*Ticket\s*button/i.test(reply)) {
    reply = reply.replace(/\s*$/, '') + '\n\nClick *Create Ticket* button — IT team will help you directly 🎫';
  }

  // Final safety: if reply is empty for any reason
  if (!reply || reply.trim().length < 10) {
    reply = `A technical issue occurred. Click *Create Ticket* button — IT team will help you directly. 🎫`;
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

