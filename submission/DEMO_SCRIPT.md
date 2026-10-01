# 3–5 minute demo script

**0:00–0:30 — Problem**  
“Support teams repeatedly read, classify, search policy, prioritize, write replies, and route tickets by hand. That creates delays and inconsistent decisions, especially for sensitive cases. We built SignalDesk to coordinate those steps while keeping a human in control.”

**0:30–1:00 — Product**  
Open the public app and sign in using the demo option. Point out the ticket queue, priority/status labels, and the agent team. Load the fictional sample tickets if the queue is empty.

**1:00–2:00 — Agent workflow**  
Open “Charged twice for my monthly plan.” Explain that the Triage Agent identifies billing and urgency; the Knowledge Agent finds the approved duplicate-charge guidance; the Policy Agent flags that a financial issue needs human review; and the Response Agent prepares a grounded reply that asks only for safe information. Show the confidence, article, risk flag, and agent trace.

**2:00–2:40 — Human approval**  
Show that the reply is a draft, not a sent message. Assign the ticket to Billing or update its status. Explain that no refund is issued and no customer account is changed automatically.

**2:40–3:20 — Another risk case**  
Open the account recovery ticket. Point out the high-priority handoff and the warning not to share passwords or one-time codes. Explain that a human must use the secure recovery process.

**3:20–4:00 — Explain architecture**  
Briefly show the public GitHub repository: React/Vite frontend, Express API with JWT/bcrypt/Zod, Supabase PostgreSQL migration, and Gemini called only from the backend. Mention the safe fallback if the API key is absent or Gemini cannot respond.

**4:00–4:20 — Close**  
“SignalDesk reduces repetitive coordination by letting specialized agents classify, retrieve guidance, check policy, and prepare an action in one flow. People keep approval over sensitive customer outcomes.”

## Recording checklist

- Use fictional demo tickets only; hide dashboards containing secrets.
- Confirm the public app is awake and the queue is loaded before recording.
- Keep the cursor steady, zoom the browser enough for the agent trace to be readable, and record one clean take of 3–5 minutes.
- Include the deployed app and repository links in the final submission.
