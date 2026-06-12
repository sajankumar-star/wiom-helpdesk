# 💡 WIOM IT Helpdesk — Future Ideas & Plans

---

## 🤖 Idea 1: Hybrid AI System (Groq FREE + Claude Haiku PAID)

### Concept
Replace current single-AI setup with a smart 2-layer hybrid:

```
Employee Message
      ↓
[Simple/Clear query?] → Groq FREE (Llama 3.1 70B)
      ↓
[Vague/Complex/Hinglish?] → Claude Haiku (paid, minimal use)
      ↓
Monthly cost = ~₹100-200 for entire company
```

### Why This?
- Groq is already connected in the bot as fallback
- Groq handles 70% simple queries for FREE
- Claude Haiku handles 30% complex/vague for very low cost
- Employees can write anything — Hinglish, typos, mixed language

### Cost Estimate (50 employees)
| Employees | Daily Msgs | Monthly Cost |
|---|---|---|
| 50  | 250  | ~₹112  |
| 100 | 500  | ~₹224  |
| 200 | 1000 | ~₹448  |
| 500 | 2500 | ~₹1120 |

### How to Classify Simple vs Complex
- **Simple** → exact keyword match, single issue, clear language
- **Complex** → vague, multi-issue, heavy Hinglish, context-dependent, follow-up

### Implementation Steps
1. Add intent classifier (lightweight — Groq itself)
2. If confidence > 80% → Groq handles it
3. If confidence < 80% → Claude Haiku handles it
4. Keep conversation history for multi-turn chat
5. Inject employee context (laptop model, dept, floor) in every prompt

### Models
- **Groq** — Llama 3.1 70B (free tier: 14,400 req/day)
- **Claude Haiku** — claude-haiku-20240307 ($0.25 input / $1.25 output per 1M tokens)

---

## 🧠 Idea 2: Intent Classification Layer

### Concept
Before sending to main AI, extract intent first:

```json
{
  "category": "laptop",
  "subcategory": "screen_flickering",
  "urgency": "medium",
  "is_vague": false,
  "keywords": ["screen", "blink"],
  "clarification_needed": false,
  "suggested_question": null
}
```

### Benefits
- Route to correct KB article directly
- Show relevant sub-category buttons automatically
- Reduce hallucination by giving AI focused context
- Handle typos better ("lptop" → laptop, "nhi" → nahi)

---

## 💬 Idea 3: True Conversational Mode (ChatGPT-style)

### Concept
Full multi-turn conversation like ChatGPT/Claude:
- Turn 1: Employee describes problem
- Turn 2: Bot asks ONE smart question
- Turn 3: Employee answers
- Turn 4: Bot gives targeted fix (knowing what was already tried)
- Turn 5: "Nahi hua" → Bot gives NEXT step (not same one again)

### Key Improvement
Currently bot sometimes repeats same steps. With full history:
- Track what solutions were already tried
- Never suggest same step twice
- Build on previous answers

---

## 📊 Summary: Current vs Future

| Feature | Current | After Implementation |
|---|---|---|
| AI Model | Claude Sonnet only | Groq (free) + Claude Haiku |
| Monthly Cost | ~₹800-1500 | ~₹100-200 |
| Intent Detection | Basic regex | Smart classifier |
| Hinglish handling | OK | Excellent |
| Conversation memory | Basic | Full history aware |
| Repeat steps issue | Sometimes | Fixed |

---

*Saved on: 2026-05-28*
*To implement: Talk to IT/Dev team or continue with Claude Code*
