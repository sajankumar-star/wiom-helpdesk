const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// Remove all non-ASCII characters (emojis) from button text and category labels
// But only inside the CATEGORIES array and button text fields

// Strategy: replace emoji in text/label strings only
// Match patterns like: text:'💻 Laptop Slow' → text:'Laptop Slow'
// and label: '🔵 💻 Laptop & Display' → label: 'Laptop & Display'

// Remove emoji characters (anything outside ASCII 0-127)
function stripEmoji(str) {
  // Remove emoji and other non-ASCII chars, then clean up extra spaces
  return str.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, ' ').trim();
}

// Process the CATEGORIES section - strip emoji from label and text fields
// We'll do targeted replacements for each label and button text

const replacements = [
  // Category labels
  ["'🔵 💻 Laptop & Display'", "'Laptop & Display'"],
  ["'🟢 🌐 Network & Internet'", "'Network & Internet'"],
  ["'🟡 💿 Software, Apps & Account'", "'Software, Apps & Account'"],
  ["'🔴 🔄 Replacement / Upgrade'", "'Replacement / Upgrade'"],

  // Laptop buttons
  ["'💻 Laptop Slow'", "'Laptop Slow'"],
  ["'💻 Won\\'t Turn On'", "'Won\\'t Turn On'"],
  ["'💙 Blue Screen'", "'Blue Screen'"],
  ["'🌡️ Overheating'", "'Overheating'"],
  ["'🔋 Battery Issue'", "'Battery Issue'"],
  ["'🖥️ Screen Black'", "'Screen Black'"],
  ["'⌨️ Keyboard Issue'", "'Keyboard Issue'"],
  ["'🖱️ Touchpad Issue'", "'Touchpad Issue'"],
  ["'❄️ Freezing / Hanging'", "'Freezing / Hanging'"],
  ["'⚡ Sudden Shutdown'", "'Sudden Shutdown'"],
  ["'🔊 No Sound'", "'No Sound'"],
  ["'🎤 Mic Not Working'", "'Mic Not Working'"],
  ["'📷 Camera Issue'", "'Camera Issue'"],
  ["'🎧 Headphone Issue'", "'Headphone Issue'"],
  ["'🖥️ External Monitor'", "'External Monitor'"],
  ["'📺 Screen Flickering'", "'Screen Flickering'"],
  ["'🔵 Bluetooth Issue'", "'Bluetooth Issue'"],
  ["'🔌 USB Not Working'", "'USB Not Working'"],
  ["'😴 Sleep / Wake Issue'", "'Sleep / Wake Issue'"],
  ["'💨 Fan Noise'", "'Fan Noise'"],
  ["'💧 Liquid Damage'", "'Liquid Damage'"],
  ["'🔁 Stuck Restarting'", "'Stuck Restarting'"],
  ["'🚫 Boot Error'", "'Boot Error'"],
  ["'🔡 Caps Lock Stuck'", "'Caps Lock Stuck'"],
  ["'🐌 Slow After Update'", "'Slow After Update'"],

  // Network buttons
  ["'📶 WiFi Not Working'", "'WiFi Not Working'"],
  ["'🐢 Internet Very Slow'", "'Internet Very Slow'"],
  ["'🔑 WiFi Password'", "'WiFi Password'"],
  ["'🚫 Website Not Opening'", "'Website Not Opening'"],
  ["'📶 WiFi Disconnecting'", "'WiFi Disconnecting'"],

  // Software buttons
  ["'📹 Teams Issue'", "'Teams Issue'"],
  ["'🖥️ Zoom Issue'", "'Zoom Issue'"],
  ["'📧 Outlook Issue'", "'Outlook Issue'"],
  ["'🌐 Browser Issue'", "'Browser Issue'"],
  ["'📄 Word / Excel Issue'", "'Word / Excel Issue'"],
  ["'☁️ OneDrive Sync Issue'", "'OneDrive Sync Issue'"],
  ["'🔄 Windows Update Issue'", "'Windows Update Issue'"],
  ["'📄 PDF Not Opening'", "'PDF Not Opening'"],
  ["'💥 App Crashing'", "'App Crashing'"],
  ["'📋 Copy Paste Issue'", "'Copy Paste Issue'"],
  ["'🔑 Password Reset'", "'Password Reset'"],
  ["'📧 Email Password'", "'Email Password'"],
  ["'💾 Storage Full'", "'Storage Full'"],
  ["'🦠 Virus Suspected'", "'Virus Suspected'"],
  ["'🔒 Account Locked'", "'Account Locked'"],
  ["'📱 2FA / OTP Issue'", "'2FA / OTP Issue'"],
  ["'🛡️ Antivirus Alert'", "'Antivirus Alert'"],
  ["'☁️ OneDrive Full'", "'OneDrive Full'"],
  ["'🕐 Wrong Date / Time'", "'Wrong Date / Time'"],

  // Replacement buttons
  ["'🔄 Laptop Replacement'", "'Laptop Replacement'"],
  ["'🖱️ Mouse Replacement'", "'Mouse Replacement'"],
  ["'⌨️ Keyboard Replacement'", "'Keyboard Replacement'"],
  ["'🖥️ New Monitor Request'", "'New Monitor Request'"],
];

for (const [from, to] of replacements) {
  content = content.split(from).join(to);
}

fs.writeFileSync('server.js', content, 'utf8');
console.log('Done. Checking for remaining emoji in labels...');

// Verify
const idx = content.indexOf("'Laptop & Display'");
console.log('Label clean:', idx > -1 ? 'YES' : 'NO');
