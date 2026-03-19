# 🛡️ Wiom IT Helpdesk — Secure Setup Guide

## 📁 Folder Structure
```
wiom-backend/
├── server.js          ← Node.js backend (API key yahan safe hai)
├── package.json       ← Dependencies
├── .env               ← API key (PRIVATE - share mat karo)
├── .gitignore         ← .env ko protect karta hai
└── public/
    └── index.html     ← Frontend (login screen ke saath)
```

---

## 🚀 STEP 1 — Node.js Install Karo

### Windows:
1. https://nodejs.org pe jao
2. **LTS version** download karo
3. Install karo (Next > Next > Finish)
4. Restart karo computer

### Check karo (Command Prompt mein):
```
node --version
npm --version
```
Dono mein number aana chahiye (e.g. v20.0.0)

---

## 🔑 STEP 2 — API Key Set Karo

1. `.env` file kholo (Notepad se)
2. `YOUR_API_KEY_HERE` ki jagah apni Anthropic API key likho:
```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
PORT=3000
```
3. Save karo

> **API Key kahan milegi?**
> console.anthropic.com > API Keys > Create Key

---

## 👥 STEP 3 — Employees Add Karo

`server.js` file kholo, `EMPLOYEES` section mein employees add karo:

```javascript
const EMPLOYEES = {
  'sajan.kumar':  { password: 'Wiom@1234', name: 'Sajan Kumar', role: 'admin' },
  'ravi.sharma':  { password: 'Wiom@5678', name: 'Ravi Sharma', role: 'user'  },
  'priya.singh':  { password: 'Wiom@9012', name: 'Priya Singh', role: 'user'  },
  // Aise add karte raho...
};
```

Password rules: Capital letter + number + special char (e.g. `Wiom@1234`)

---

## ▶️ STEP 4 — Server Start Karo

```bash
# 1. Folder mein jao
cd wiom-backend

# 2. Packages install karo (sirf pehli baar)
npm install

# 3. Server start karo
npm start
```

Terminal mein yeh dikhega:
```
╔══════════════════════════════════════╗
║   🛡️  WIOM IT HELPDESK SERVER       ║
║   Port: 3000  Status: Running ✅    ║
╚══════════════════════════════════════╝
```

---

## 🌐 STEP 5 — Open Karo

Browser mein jao: **http://localhost:3000**

Login screen dikhega! Employee credentials se login karo.

---

## 🏢 OFFICE MEIN SHARE KAISE KAREIN?

### Option A — Same WiFi pe (Sabse Aasaan)
1. Apna computer ka IP address dekho:
   - Windows: `ipconfig` command (IPv4 Address)
   - e.g. `192.168.1.105`
2. Server start rakho
3. Office mein sabko batao: **http://192.168.1.105:3000**
4. Woh log apne browser mein ye URL khol sakte hain

### Option B — Online Hosting (Permanent Link)

#### Railway.app (FREE, Recommended):
1. https://railway.app pe account banao
2. "New Project" > "Deploy from GitHub"
3. Ya seedha: "Deploy" > upload karo
4. Environment Variables mein `ANTHROPIC_API_KEY` add karo
5. Permanent link milega: `https://wiom-it.railway.app`

#### Render.com (FREE):
1. https://render.com pe account banao
2. "New Web Service" > GitHub se connect
3. Environment: `ANTHROPIC_API_KEY=your_key`
4. Build Command: `npm install`
5. Start Command: `npm start`

---

## 🔐 Security Features

| Feature | Status |
|---------|--------|
| API Key hidden | ✅ Server pe, browser mein nahi |
| Employee Login | ✅ Username + Password |
| Session Token | ✅ 8 ghante baad expire |
| HTTPS (production) | ✅ Railway/Render pe automatic |
| Rate Limiting | ⚠️ Add karna ho toh batao |

---

## 🆘 Problems?

| Problem | Solution |
|---------|----------|
| `node not found` | Node.js reinstall karo |
| `Port 3000 busy` | .env mein `PORT=3001` karo |
| `Cannot find module` | `npm install` dobara run karo |
| Login nahi ho raha | server.js mein EMPLOYEES check karo |
| API error | .env mein API key check karo |

---

## 📞 Help Chahiye?

IT Admin: **sajan.kumar@Wiom.in**
