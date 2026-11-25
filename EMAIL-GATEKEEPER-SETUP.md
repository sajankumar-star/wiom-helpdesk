# Email IT Gatekeeper — Setup Guide

`sajan.kumar@wiom.in` par aane waali mail ko AI padh kar decide karta hai:
- **IT problem** → auto-reply "My HR Buddy par jao: [link]" + mail inbox se hat jaye
- **IT nahi** → mail aapke inbox me rahe (jaise abhi)
- **External (@wiom.in nahi)** ya **boss/exclude list** → kuch na ho

> Pehle **TEST mode** me chalega — Gmail me kuch nahi badlega, sirf log banega.
> Accuracy sahi lage, tabhi **LIVE** karein.

---

## Naye files
| File | Kaam |
|---|---|
| `services/classifyIssue.js` | AI (Groq) + keyword se "IT / non-IT" decide karta hai (Slack + Gmail dono) |
| `services/emailGatekeeper.js` | Inbox watch + routing (test/live) |
| `slack/bot.js` | Isme shadow-classify **log** add hua (bot ka behavior same) |
| `.env.example` | Gatekeeper settings |

---

## STEP 1 — Packages install
```
npm install
```
(`imapflow` aur `mailparser` package.json me add ho chuke hain — Railway deploy par apne aap install honge.)

## STEP 2 — Gmail me IMAP ON karo
Gmail → ⚙️ Settings → **Forwarding and POP/IMAP** → **Enable IMAP** → Save.
(Bhejne/padhne dono ke liye wahi **App Password** chalega jo `SMTP_PASS` me hai.)

## STEP 3 — `.env` me settings
`.env` me ye lines daalo (values `.env.example` me ready hain):
```
GATEKEEPER_ENABLED=true
GATEKEEPER_MODE=test          # abhi test hi rakho
OFFICE_DOMAIN=wiom.in
MY_HR_BUDDY_LINK=https://wiomworkspace.slack.com/archives/D0B6ZR3GUTU
GATEKEEPER_EXCLUDE=marut.singh@wiom.in,satyam.darmora@wiom.in,nishit.aggarwal@wiom.in,divi.ramola@wiom.in,mukul.yadav@wiom.in
```
(Baaki — poll time, confidence, IMAP host — default theek hain.)

## STEP 4 — TEST mode me chalao
```
npm run gatekeeper
```
Har 2 minute me inbox check karega aur **sirf log** karega, jaise:
```
📧 [Gatekeeper] WOULD-REDIRECT → IT (Wi-Fi/Internet, conf 0.88, via ai) | ramesh@wiom.in | "wifi nahi chal raha"  [TEST: kuch nahi badla]
📧 [Gatekeeper] KEEP  → NON-IT (Non-IT, conf 0.80, via ai) | hr@wiom.in | "leave policy"  [inbox me rahega]
📧 [Gatekeeper] SKIP (excluded/boss): marut.singh@wiom.in | "..."
```
Log file bhi banti hai: **`logs/gatekeeper.log`**

### Slack bhi test ho raha hai
Bot chalao (`npm run bot`). Jab koi bot ko message kare, console me aise log aayega:
```
🔎 [Gatekeeper/Slack dm] IT (Software, conf 0.82, via ai) — "outlook open nahi ho raha"
```
(Bot ka jawab nahi badlega — sirf log.)

## STEP 5 — Accuracy check karo
Kuch din / kuch mails ke log dekho. Agar AI sahi decide kar raha hai (IT ko IT, HR ko non-IT), to aage badho.
- Galat lag raha hai? `GATEKEEPER_MIN_CONFIDENCE` badhao/ghatao, ya mujhe bolo keyword list tune kar dun.

## STEP 6 — LIVE karo (jab bharosa ho)
`.env` me sirf ek line badlo:
```
GATEKEEPER_MODE=live
```
Dobara `npm run gatekeeper`. Ab IT mails par:
- Sender ko **auto-reply** jayega (My HR Buddy link ke saath)
- Mail **`IT-Redirected`** label me chali jayegi (aapke inbox se gayab)
- Non-IT mail inbox me rahegi

---

## Band karna
`.env` me `GATEKEEPER_ENABLED=false` → gatekeeper kuch nahi karega.

## Zaroori baatein
- Ye **sirf aapke apne inbox** (`sajan.kumar@wiom.in`) par chalta hai.
- Boss/exclude aur external mails ko haath nahi lagata.
- "My HR Buddy" Slack bot ko **change nahi kiya** — wo jaisa hai waisa hai.
- LIVE me mail **delete nahi** hoti — sirf label me move hoti hai (kabhi bhi waapas mil jayegi).
