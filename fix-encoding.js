const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// Remove UTF-8 BOM if present
if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

// Reverse the double-encoding: CP1252 special chars back to bytes
const cp1252map = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
  '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C,
  'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B,
  'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F
};

function fixDoubleEncoding(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const code = c.charCodeAt(0);
    if (cp1252map[c] !== undefined) {
      bytes.push(cp1252map[c]);
    } else if (code >= 0x80 && code <= 0xFF) {
      bytes.push(code);
    } else if (code < 0x80) {
      bytes.push(code);
    } else {
      // Higher unicode — keep as-is by encoding to UTF-8
      const encoded = Buffer.from(c, 'utf8');
      for (const b of encoded) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const fixed = fixDoubleEncoding(content);

// Verify some known strings
console.log('Has proper emoji test:', fixed.includes('Laptop & Display'));
console.log('Lines:', fixed.split('\n').length);

// Write back as UTF-8 without BOM
fs.writeFileSync('server.js', fixed, {encoding: 'utf8'});
console.log('Done');
