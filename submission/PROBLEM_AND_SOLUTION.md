# Hackathon submission: SignalDesk

## Problem statement

Small customer support teams receive requests across email, chat, and web forms. Repeated manual reading, categorization, policy lookup, priority decisions, and handoffs slow responses and make outcomes inconsistent. Sensitive payment, account-security, privacy, and incident requests also need careful human review. SignalDesk addresses this fragmented triage work by coordinating specialized AI-assisted steps while keeping risky decisions with a person.

## Solution description

SignalDesk is an agentic support-triage workspace built with React/Vite, an Express API, Supabase PostgreSQL, and Google Gemini. A support worker submits a ticket. The backend orchestrates four cooperating stages:

1. **Triage Agent** uses Gemini to identify category, team, urgency, customer sentiment, intent, confidence, and a short summary.
2. **Knowledge Agent** searches the approved local support knowledge base and provides a matching article to ground the next step.
3. **Policy Agent** checks for sensitive credentials, payment details, privacy requests, financial actions, and incident impact. It records flags and requires human review when risk or urgency warrants it.
4. **Response Agent** drafts a concise reply using the ticket and matched article. The system stores the classification, draft, risk assessment, and agent trace in Supabase.

The support worker can inspect the reasoning trace, copy the draft, route the ticket to a team, or mark it resolved. The system does not send customer messages or perform account, payment, or deletion actions. If Gemini is unavailable or not configured, deterministic local triage and safe template drafting keep the demo functional, with the mode disclosed in the interface.

## Key features

- A single ticket queue with category, priority, status, and team ownership
- Multi-stage agent trace to show planning, knowledge collaboration, policy checks, and execution
- Grounded reply drafts with visible risk flags and explicit human review
- JWT login, bcrypt password hashing, Zod request validation, and per-user ticket access
- Supabase PostgreSQL persistence and fictional sample tickets
- Backend-only Gemini credentials and a fallback demo mode

## Responsible-use boundary

This is a hackathon prototype using synthetic examples. Drafts must be reviewed by a support worker. It does not connect to a live CRM or send messages. Do not enter real customer or payment data.
