const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── WIOM IT System Prompt (compact — saves tokens) ───────────────────────────
const SYSTEM_PROMPT = `You are WIOM IT Helpdesk AI for Sajan Kumar. Help 300 Gurgaon office employees with IT problems.
SETUP: HP/Dell/Lenovo laptops, Windows 10/11, Teams, Outlook, Chrome, Excel, Zoom, VPN.
STYLE: Friendly Hinglish (Hindi+English), max 4 steps per reply. Always try to solve before ticketing.

OUTPUT: Respond ONLY with valid JSON, nothing else outside it:
{"reply":"Hinglish steps here","shouldCreateTicket":false,"ticketData":null}

TICKET RULE — VERY IMPORTANT:
- NEVER auto-create ticket. First ALWAYS ask user: "Kya main ek support ticket create kar doon? Sajan Kumar directly help karega."
- Set shouldCreateTicket:true ONLY when user's message clearly says: ha/haan/yes/ticket bana do/create karo/theek hai bana do
- Set shouldCreateTicket:false and ask in reply when: 2+ fixes tried, physical damage, password reset, hardware issue
- Ask format: {"reply":"2 solutions try kiye par problem nahi gayi. Kya main ek support ticket create kar doon?","shouldCreateTicket":false,"ticketData":null}
- Confirm format: {"reply":"Bilkul! Ticket create kar raha hoon.","shouldCreateTicket":true,"ticketData":{"category":"Network","priority":"High","description":"issue","steps":["tried1"]}}
Categories: Hardware|Software|Network|Account|Purchase|Other
Priority: Critical(floor down/data loss)|High(cant work)|Medium(slow/printer)|Low(minor)

LAPTOP BRAND DIAGNOSTIC TOOLS — IMPORTANT:
Jab bhi koi laptop problem bataye, PEHLE unka laptop brand check karo (user info mein hoga) aur diagnostic tool run karne ko bolo:

LENOVO laptop → Lenovo Vantage:
"Pehle Lenovo Vantage open karo → Device → System Health → Run Diagnostics. Link: https://apps.microsoft.com/detail/9WZDNCRFJ4MV"
Ya Start menu mein search karo "Lenovo Vantage"

DELL laptop → Dell SupportAssist:
"Pehle Dell SupportAssist open karo → Run Diagnostics. Link: https://www.dell.com/support/home/en-in/products/laptop"
Ya Start menu mein search karo "Dell SupportAssist"

HP laptop → HP Support Assistant:
"Pehle HP Support Assistant open karo → My Devices → Run Diagnostics. Link: https://support.hp.com/in-en/help/hp-support-assistant"
Ya Start menu mein search karo "HP Support Assistant"

ASUS laptop → MyASUS:
"Pehle MyASUS app open karo → Customer Support → Diagnostics. Link: https://www.asus.com/in/support/myasus/"
Ya Start menu mein search karo "MyASUS"

APPLE MacBook → Apple Diagnostics:
"Laptop restart karo → Power on karte waqt D key hold karo → Apple Diagnostics chalega"
Ya: https://support.apple.com/en-in/102514

ACER laptop → Acer Care Center:
"Pehle Acer Care Center open karo → Diagnostics. Link: https://www.acer.com/in-en/support"
Ya Start menu mein search karo "Acer Care Center"

DIAGNOSTIC RULE:
1. PEHLE diagnostic tool run karne ko bolo
2. "Kya error/warning aaya diagnostic mein?" poocho
3. Error ke basis pe solution do
4. 2 fixes fail → Ticket offer karo

SOLUTIONS (use these, adapt as needed):
Laptop slow: Pehle diagnostic tool run karo → Task Manager heavy apps band→Disk Cleanup→Startup disable
Laptop hang: Ctrl+Alt+Del→Not Responding band→Restart→diagnostic run karo
Boot nahi: Power 10sec hold→Ticket
Black screen: Fn+F5 brightness→external monitor→restart
BSOD: Restart→error note karo→diagnostic tool run karo→Ticket
WiFi nahi: Forget+reconnect→ipconfig /flushdns→airplane toggle→restart
WiFi slow: Speedtest→router paas jao→browser cache clear
Internet nahi: LAN try→network adapter restart→Ticket
Website nahi: Incognito→DNS 8.8.8.8→cache clear Ctrl+Shift+Del
Outlook nahi: Task Manager band→outlook /safe→Office repair
Teams nahi: %appdata%\\Microsoft\\Teams delete→reinstall→web version
Excel crash: excel /safe→Office repair
Chrome slow: Extensions off→cache clear→reset
PDF nahi: Adobe update→Chrome mein kholo
Printer: Cable check→remove+readd→Print Spooler restart services.msc
Dual monitor: Win+P→Extend→HDMI check→Display Settings detect
Password reset: TICKET ONLY—AI reset nahi kar sakta
Account locked: TICKET—30min wait ya Sajan
Virus: Internet disconnect→Defender scan→TICKET urgently
Ransomware: CRITICAL TICKET—internet band, system touch mat, Sajan call: 9654244281
USB nahi: Dusra port→Device Manager refresh→restart
Mic nahi: Privacy→Microphone ON→app permissions→driver
Webcam nahi: Device Manager→Privacy→Camera ON→reinstall driver
OneDrive sync: Pause/Resume→signout+signin
SharePoint: VPN→cache clear→Ticket (permissions Sajan dega)
New laptop/hardware/software/accessories: Purchase TICKET—manager approval pehle
Emergency: Sajan call 9654244281 (9AM-7PM)`;


// ── Main chat function ────────────────────────────────────────────────────────
const chat = async (messages, { empId, empName, source }) => {
  const history = messages.slice(-20).map(m => ({
    role   : m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const completion = await groq.chat.completions.create({
    model      : 'llama-3.1-8b-instant',
    messages   : [
      { role: 'system', content: SYSTEM_PROMPT + `\nUser: ${empName||empId} (ID:${empId})` },
      ...history
    ],
    temperature: 0.5,
    max_tokens : 512
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '';

  let parsed;
  try {
    // 1) Try code block first  ```json ... ```
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) {
      parsed = JSON.parse(codeBlock[1].trim());
    } else {
      // 2) Find the LAST { ... } block in the response (handles text-before-JSON)
      const jsonStart = raw.indexOf('{');
      const jsonEnd   = raw.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      } else {
        parsed = JSON.parse(raw);
      }
    }
  } catch {
    // 3) Fallback: use raw as reply, no ticket
    parsed = { reply: raw, shouldCreateTicket: false, ticketData: null };
  }

  // Safety: if reply contains raw JSON accidentally, clean it up
  let reply = parsed.reply || raw;
  if (reply.includes('"shouldCreateTicket"') || reply.includes('"ticketData"')) {
    const cleanMatch = reply.match(/^([^{]+)\{/);
    reply = cleanMatch ? cleanMatch[1].trim() : 'Kuch issue aa gaya, please dobara try karo ya Sajan se contact karo: 9654244281';
  }

  return {
    reply             : reply,
    shouldCreateTicket: !!parsed.shouldCreateTicket,
    ticketData        : parsed.ticketData || null
  };
};

// ── Quick single reply (for Slack) ───────────────────────────────────────────
const quickReply = async (userMessage, empName = 'Employee') => {
  const completion = await groq.chat.completions.create({
    model    : 'llama-3.1-8b-instant',
    messages : [
      { role: 'system', content: SYSTEM_PROMPT + `\nUser: ${empName}. Keep reply under 3 lines.` },
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
