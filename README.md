# SignalDesk — Agentic Support Triage

SignalDesk helps a small support team turn incoming customer messages into a reviewed, routed support case. The Triage Agent classifies the request, the Knowledge Agent finds a relevant help article, the Policy Agent checks for sensitive or high-impact cases, and the Response Agent prepares a grounded reply draft. A support person reviews and assigns the ticket; this demo never sends a customer message or changes a customer account.

## What is included

- React, Vite, and React Router frontend (`client/`)
- Express API with JWT authentication, bcrypt password hashing, and Zod request validation (`server/`)
- Supabase PostgreSQL schema and row-level security (`supabase/migrations/`)
- Gemini API integration called only from the backend; deterministic fallback keeps the demo usable if no key is configured
- Fictional sample tickets and a three-to-four minute demo script (`submission/`)
- Render backend blueprint (`render.yaml`) and Vercel single-page-app rewrite (`vercel.json`)

## Run locally

Requirements: Node.js 20 or later, npm, a Supabase project, and optionally a Google Gemini API key.

1. In Supabase, open **SQL Editor**, paste and run `supabase/migrations/001_initial_schema.sql`.
2. In `server/`, copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `JWT_SECRET`. Set `GEMINI_API_KEY` to enable live Gemini reasoning. Never put the Supabase service-role key or Gemini key in the client or commit either secret.
3. Install and run the API:

   ```sh
   cd server
   npm install
   npm run dev
   ```

4. In another terminal, copy `client/.env.example` to `client/.env`, then install and run the frontend:

   ```sh
   cd client
   npm install
   npm run dev
   ```

5. Open the Vite URL shown in the terminal. Create an account or use **Explore demo**. Load fictional examples from the queue to demonstrate the workflow.

Without Gemini, rule-based triage and safe template replies are used. The UI shows the active mode.

## Deploy

### Supabase

Run the SQL migration above in the Supabase project. In **Project Settings → API**, copy the Project URL and the `service_role` secret for the backend only. Treat it like a password.

### Render API

Create a Render **Web Service** from this repository, or use the included `render.yaml` blueprint. Set the service root directory to `server`, build command `npm install`, and start command `npm start`. Add these environment variables in Render:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | A long random secret (Render can generate one) |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase `service_role` secret |
| `GEMINI_API_KEY` | Gemini API key (optional; server fallback is available) |
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `FRONTEND_URL` | Vercel site origin, added after frontend deploy |
| `DEMO_MODE` | `true` for the hackathon demo |

Wait for the service to deploy. Its health endpoint is `/api/health`.

### Vercel frontend

Import this GitHub repository in Vercel and set **Root Directory** to `client`. Vercel detects Vite; build command is `npm run build`, output directory is `dist`. Add `VITE_API_BASE_URL` with the Render service URL (no trailing slash), then deploy. Copy the resulting Vercel site origin into Render's `FRONTEND_URL` and redeploy the API.

Render free services may sleep when idle, so the first request after inactivity can take longer. Keep `DEMO_MODE=true` for the public demo; do not put real customer data into the demo.

## Agent workflow

1. **Plan/triage:** Gemini proposes category, urgency, sentiment, intent, confidence, and summary from the submitted ticket.
2. **Collaborate/ground:** a local knowledge agent ranks six support articles; its match is provided as the only policy source for reply drafting.
3. **Reason/check:** a deterministic policy agent flags payment, credential, privacy, financial, or incident risks and requires human review for flagged or high-priority cases.
4. **Execute:** the response agent drafts a reply and internal next action. The API saves the result and agent trace to Supabase. A human may then assign or resolve the internal ticket.

The model does not send messages, issue refunds, reset passwords, or perform account actions. Human approval remains explicit.

## API overview

- `GET /api/health` — API and configuration status
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/demo`
- `GET /api/knowledge`
- `GET /api/tickets`, `POST /api/tickets`, `POST /api/tickets/seed`
- `PATCH /api/tickets/:id`, `DELETE /api/tickets/:id`

Authenticated routes use `Authorization: Bearer <JWT>`. The API validates inputs with Zod and scopes every ticket query to the signed-in user.

## Submission material

- [Problem statement and solution description](submission/PROBLEM_AND_SOLUTION.md)
- [Demo video script](submission/DEMO_SCRIPT.md)

## Team of four: suggested split

1. Frontend: run the app, refine and rehearse the visible workflow.
2. Backend/AI: explain agent stages, Gemini integration, policy checks, and fallback.
3. Data/deployment: run the Supabase SQL, configure Render and Vercel with the README.
4. Product/demo: own the problem statement, script, recording, and final submission links.

All teammates should understand the end-to-end flow and rehearse the same demo account before presenting.
