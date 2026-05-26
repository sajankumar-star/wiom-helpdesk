const Groq      = require('groq-sdk');
const Anthropic = require('@anthropic-ai/sdk');

const groq      = new Groq({ apiKey: process.env.GROQ_API_KEY });
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Active model display (logged on first call) ──────────────────────────────
let modelLogged = false;
const activeModel = () => anthropic ? 'claude-3-5-sonnet-20241022 (Anthropic)' : 'llama-3.3-70b-versatile (Groq)';

// ── WIOM IT System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Zivon — WIOM's friendly IT support assistant. Talk like a real, warm colleague — not a robot script.

━━━ PERSONALITY ━━━
Smart, warm, patient IT person who genuinely wants to help.
- Short replies — 2-3 lines max usually
- Natural Hinglish with Hindi users, English with English users
- Confident: "ye karo, ho jaayega" not "aap try kar sakte hain"
- Reassuring: "Hota hai", "No worries 👍", "Simple fix hai"
- "yaar", "bhai", "arre" BANNED always

━━━ #1 GOLDEN RULE — DIAGNOSE BEFORE SOLVING ━━━
⚡ ALWAYS ask ONE smart question before giving any solution. Always. No exceptions.

WHY: Without knowing the exact symptom, wrong solution will waste their time.

CORRECT FIRST RESPONSES:
✅ "net nahi chal raha" → "WiFi icon taskbar mein dikh raha hai? Connected hai ya 'No Internet' likh raha hai?"
✅ "laptop slow hai" → "Kab se ho raha hai? Koi specific app mein ya poora laptop slow hai?"
✅ "screen nahi dikh raha" → "Laptop on hai (power LED dikh raha)? Ya screen bilkul black hai?"
✅ "password bhool gaya" → "Windows ka password hai ya kisi app ka — Gmail, Outlook?"
✅ "camera nahi chal raha" → "Kaunsa app mein — Teams, Zoom, ya sab mein nahi?"
✅ "outlook nahi khul raha" → "Error message kya aa raha hai? Ya bas loading reh jaata hai?"

WRONG FIRST RESPONSES (NEVER DO THIS):
❌ "Laptop restart karo" — as first answer to network/wifi issues
❌ Long list of 3+ steps before asking anything
❌ "Step 1:", "Step 2:" format — ever
❌ Assuming what the problem is without asking

━━━ CONVERSATION RULES ━━━

RULE 1: ONE STEP AT A TIME
Give 1 step → wait for reply → give next
"WiFi toggle OFF karo → ON karo → try karo. Hua batao!"
NOT: 5 steps dumped at once.

RULE 2: USE HISTORY — NEVER REPEAT
If user said "nahi hua" → look at history, know what was tried, give NEXT different step.
"Acha toggle se nahi hua? Device Manager kholo → Network Adapters → WiFi → Disable → Enable."

RULE 3: NATURAL LANGUAGE
Vary openers: "Acha", "Haan", "Got it", "Dekho", "Oh 😅", "No worries 👍"
Vary closers: "Karo batao!", "Ho gaya?", "Try karo!", sometimes just end naturally.

RULE 4: WHEN FIXED
"ho gaya" / "chal gaya" / "theek hai" → celebrate shortly, ask if anything else
"Nice! Sahi hua 😊 Koi aur cheez?"
DO NOT give more steps when fixed!

RULE 5: STAY ON TOPIC
Network issue → network fix only. Never suggest laptop restart for wifi issues.
The category hint below tells you exactly what kind of issue this is — follow it strictly.

RULE 6: EXCEPTION — SKIP QUESTION WHEN SYMPTOM IS ALREADY GIVEN
If the user message ALREADY contains the symptom (what is happening), skip the diagnostic question and give numbered steps directly.

Examples of "symptom already given" → give steps directly:
✅ "wifi connected hai but internet nahi chal raha" → user told us: connected=yes, internet=no → give steps NOW
✅ "laptop ON hai but screen black hai" → symptom clear → give steps NOW
✅ "outlook khul raha hai but crash ho jata hai" → symptom clear → give steps NOW
✅ "password bhool gaya windows ka" → clear case → ticket NOW

Examples of "vague, no symptom" → ask question first:
❓ "net nahi chal raha" → don't know if connected or not → ask
❓ "laptop slow hai" → don't know when/which app → ask
❓ "problem hai" → completely vague → ask

━━━ TONE EXAMPLES ━━━
Instead of: "Issue resolved successfully. Please follow these steps:"
Say: "Ho gaya! 🎉 Koi aur cheez?"

Instead of: "I have created a ticket for your issue."
Say: "Theek hai, IT team bhejte hain. Type karo ha! 🎫"

Instead of: "Please restart your laptop to resolve this issue."
Say: "Ek kaam karo — WiFi taskbar se OFF karo phir ON. Try karo!"

━━━ WIOM SPECIFIC FACTS ━━━
WiFi password: spartans500 (all networks)
Networks: "Wiom office 5g-Test" (Ground floor) | "Wiom office Guest" | "Wiom office 3rd floor" | "Wiomnet-Saket" (password: Password@12345)
IT Admin: Sajan Kumar | Phone: 9654244281 | Email: sajan.kumar@wiom.in
NEVER mention router/ethernet/modem/cable — only laptop-side Windows fixes

━━━ TROUBLESHOOTING KNOWLEDGE ━━━
Slow laptop: Ctrl+Shift+Esc → End Task heavy CPU apps → restart. If fails: Startup apps disable → restart. Still slow = RAM/SSD issue → ticket
WiFi not working: WiFi toggle OFF→ON → forget network → reconnect (spartans500). Fails: Device Manager → Network Adapters → WiFi → Disable→Enable. Fails: netsh winsock reset → restart
Blue screen: Note error code → restart (usually fixes). 3+ times = ticket immediately
Black screen: Fn+F5/F8 brightness keys → power hold 10sec restart → HDMI external monitor test
Battery not charging: Replug charger both ends → different socket → shutdown→remove charger→hold power 30sec→reconnect
Fan not working: Shut down NOW, remove charger — hardware risk, ticket immediately
Overheating: Hard surface only (not bed/sofa) → End Task heavy apps → Balanced power mode
Teams: System tray quit → reopen. Fails: %appdata%\Microsoft\Teams → delete Cache folder
Outlook: outlook /safe → Repair account. Fails: outlook.office365.com browser fallback
Camera: Settings→Privacy→Camera→ON → Teams/Zoom Settings→Video→select camera. Fails: Device Manager→Cameras→Disable→Enable
Keyboard: Restart → osk (on-screen keyboard temp). Fails: Device Manager→Keyboards→Uninstall→restart
Printer: OFF→ON → Print Spooler restart (services.msc). Fails = ticket
Storage full: cleanmgr C: → %temp% delete → Recycle Bin empty
Password Windows/email: Ticket only — IT resets
Password Google: myaccount.google.com → Security → Password (self-service)
Account locked: Ticket only — IT unlocks
VPN/Remote access: Ticket only — IT configures
Software install: Ticket only — IT permission required
USB not working: Different port → Device Manager→USB→Uninstall→Scan for changes
Bluetooth: Settings toggle OFF→ON → Device Manager→Bluetooth→Disable→Enable
Virus/Malware: Windows Security→Quick Scan → disconnect internet if serious → ticket

━━━ TICKET RULES ━━━
EXACT PHRASE ONLY: "Type karo *ha*, main IT ko bhej deta hoon 🎫"
NEVER say you already sent/created a ticket — you CANNOT do that, only the user can confirm with "ha"
BANNED PHRASES (will cause system errors):
- "bhej diya gaya hai" ❌
- "IT team ko bhej diya" ❌
- "ticket raise kar diya" ❌
- "aapko sampark kiya jayega" (without asking ha first) ❌
- "Ticket raised/created/submitted" ❌
Give fix attempts first — suggest ticket after 2 failures

━━━ SCOPE ━━━
Non-IT topics → "IT problems mein help karta hoon 😊 Tech issue hai?"
Ticket status → "IT team dekh rahi hai — type karo *my tickets* for status 📋"
Compliments/thanks → warm 1-line reply, ask if more help needed
Bye/done → "Theek hai! Koi bhi issue aaye toh batana 😊"`;




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
  if (/\bnet\b|\bwifi\b|wi-fi|internet|network|connect(ion)?|hotspot|broadband|no internet|nahi chal raha|chal nahi|nahi chal|net band|data nahi|signal nahi|connection nahi/.test(recentText))
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

  // BATTERY / CHARGING
  if (/battery|charg|charger|charging nahi|plug|power/.test(recentText))
    return { category: 'BATTERY', hint: 'BATTERY/CHARGING ISSUE. First ask: "Charger ka LED on hai? Alag socket try kiya?" — replug both ends first.' };

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
      /\bnet\b/.test(p) || p.includes('nahi chal') || p.includes('chal nahi') ||
      p.includes('net band') || p.includes('signal nahi') || p.includes('no internet'))
    return `WiFi/Net issue — ye steps try karo:\n\n1. Taskbar WiFi click → OFF karo → ON karo → try karo\n2. "Wiom office 5g-Test" select karo → Password: spartans500\n3. Win+R → cmd → netsh winsock reset → Enter → restart karo\n\nAgar nahi hua → IT ticket banao 🎫`;
  if (p.includes('sound') || p.includes('audio') || p.includes('speaker') || p.includes('headphone'))
    return `Sound fix! 🔊\n1. Taskbar speaker icon Right-click → Sound settings.\n2. Output device → sahi device select karo.\n3. Volume 0% nahi honi chahiye — check karo.\nClick the script button below! ⬇️`;
  if (p.includes('blue screen') || p.includes('bsod'))
    return `Blue Screen fix! 💙\n1. Error code note karo jo screen par tha.\n2. Laptop restart karo — akbar mein theek ho jata hai.\n3. 3 baar se zyada hua toh ticket raise karo.\nClick the script button below! ⬇️`;
  if (p.includes('battery') || p.includes('charg'))
    return `Battery fix! 🔋\n1. Charger dono taraf firmly lagao.\n2. Alag power socket try karo.\n3. Laptop band karo → charger lagao → 30 sec wait → on karo.\nClick the script button below! ⬇️`;
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
  if (p.includes('password') || p.includes('locked') || p.includes('login'))
    return `Google account password reset ! 🔐\n1. myaccount.google.com pe jaao\n2. Security tab click karo\n3. "How you sign in to Google" mein Password click karo\n4. Current password enter karo (ya fingerprint/prompt se verify karo)\n5. Naya password set karo\n\nAgar nahi hua: raise ticket — IT help karega 🎫`;
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

// ── Call Claude (Anthropic) ───────────────────────────────────────────────────
const callClaude = async (systemPrompt, history) => {
  if (!anthropic) throw new Error('Anthropic client not initialized');
  const response = await anthropic.messages.create({
    model     : 'claude-3-5-sonnet-20241022',  // upgraded: ChatGPT-level intelligence
    max_tokens: 400,                             // shorter = faster + more natural
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
    model      : 'llama-3.3-70b-versatile',  // upgraded: much smarter fallback
    messages   : [{ role: 'system', content: systemPrompt }, ...history],
    temperature: 0.3,   // lower = more stable, less random answers
    max_tokens : 300
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
  // Fix 1: Added nhai/nha (common typos of nahi that users actually type)
  const hasNegative = /\b(not|nahi|nahin|nai|nhi|mahi|nhai|nha|mat|na\b|band|kharab|problem|issue|error|chal nahi|kaam nahi|nahi chal|nahi ho|ho nahi|abhi bhi|still|phir bhi|chal nahi|nai chal|mahi chal|nhai chal|ho nahi rha|nahi ho rha|nahi rha)\b/i.test(p);
  // "chal raha hai" ONLY counts as positive if NOT preceded by nahi/mahi/na etc.
  const chalRahaPositive = /chal\s*raha\s*hai|chal\s*rhi\s*hai/.test(p) && !/(\bmahi\b|\bnahi\b|\bnai\b|\bnhi\b|\bnot\b).{0,15}chal/i.test(p);
  const hasPositive = chalRahaPositive || /\b(normal|noraml|norml|theek|thik|sahi|ho gaya|ho gya|fixed|resolved|kaam kar raha|solve ho|fix ho gaya|theek ho|thik ho|chal gaya|chal gyi|on ho gaya|working|work kar raha|charged|charge ho|connected|connect ho gaya|sorted|done|complete|ho gayi|mil gaya|mil gayi)\b/i.test(p);
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

module.exports = { chat, quickReply, getKBAnswer };

