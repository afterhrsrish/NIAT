import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { processTicket, KNOWLEDGE } from './agents.js';

const app = express();
const port = process.env.PORT || 4000;
const jwtSecret = process.env.JWT_SECRET;

if (process.env.NODE_ENV === 'production' && !jwtSecret) {
  console.warn('⚠️ JWT_SECRET not set in production; falling back to temporary runtime secret.');
}
const secret = jwtSecret || 'local-demo-signaldesk-jwt-secret-key-2026';

// Supabase configuration (Backend service-role key only)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);
const db = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

// In-memory fallback database for offline demo resilience if Supabase credentials are not yet entered
const memoryUsers = new Map();
const memoryTickets = new Map();

// CORS configuration supporting local dev, Vercel deployments, and configured FRONTEND_URL
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
      return callback(null, true); // Permissive for hackathon demos to avoid cross-origin deployment blocks
    },
    credentials: true
  })
);

app.use(express.json({ limit: '256kb' }));

// Zod Validation Schemas
const credentialsSchema = z.object({
  email: z.string().email('Please enter a valid email address').max(180),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100)
});

const registerSchema = credentialsSchema.extend({
  name: z.string().min(2, 'Name must be at least 2 characters').max(70)
});

const ticketSchema = z.object({
  subject: z.string().min(4, 'Subject must be at least 4 characters').max(120),
  customerName: z.string().min(2, 'Customer name must be at least 2 characters').max(80),
  customerEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  channel: z.enum(['Email', 'Chat', 'Web form']).default('Email'),
  body: z.string().min(12, 'Ticket body must be at least 12 characters').max(3000)
});

const statusSchema = z.object({
  status: z.enum(['New', 'Needs review', 'Assigned', 'Resolved']),
  team: z.string().min(2).max(60).optional()
});

function makeToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, secret, {
    expiresIn: '24h'
  });
}

function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentication token required' });

    const payload = jwt.verify(token, secret);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

function validationError(res, parsed) {
  const firstIssue = parsed.error.issues[0];
  return res.status(400).json({ error: firstIssue?.message || 'Invalid input data' });
}

// Sample fictional tickets for seeding
const SAMPLE_TICKETS = [
  {
    subject: 'Charged twice for my monthly plan',
    customer_name: 'Taylor Kim',
    customer_email: 'taylor@example.com',
    body: 'I see two charges of $49.00 for the same monthly plan on my card today. Could you check whether one is a duplicate authorization? I can share the transaction date and card last 4 digits.',
    channel: 'Email',
    category: 'Billing',
    priority: 'High',
    sentiment: 'Frustrated',
    team: 'Billing',
    status: 'Needs review',
    draft_reply: 'Hi Taylor, thanks for flagging this. Please share the transaction date and the last four digits of your card only—never your full card number or CVV. Our Billing team will verify whether one charge is a duplicate authorization and rectify it.',
    knowledge_source: 'KB-101',
    risk_level: 'Medium',
    requires_human_review: true,
    confidence: 0.94,
    agent_steps: [
      { agent: 'Triage Agent', status: 'complete', title: 'Billing · High priority', detail: 'Duplicate charge concern with frustrated sentiment. Confidence: 94%.' },
      { agent: 'Knowledge Agent', status: 'complete', title: 'Matched KB-101', detail: 'Grounded next steps in “Duplicate or unexpected card charge”.' },
      { agent: 'Policy Agent', status: 'complete', title: 'Medium risk · Human review required', detail: 'Financial action requires billing review before execution.' },
      { agent: 'Response Agent', status: 'complete', title: 'Reply draft prepared', detail: 'Draft avoids requesting full payment credentials and reassures customer.' }
    ]
  },
  {
    subject: 'Locked out after password reset',
    customer_name: 'Morgan Patel',
    customer_email: 'morgan@example.com',
    body: 'I requested a password reset twice but the verification email never arrived in my inbox. I have a presentation in an hour and cannot get into my workspace. Please help me regain access immediately.',
    channel: 'Web form',
    category: 'Account access',
    priority: 'High',
    sentiment: 'Frustrated',
    team: 'Account Support',
    status: 'Needs review',
    draft_reply: 'Hi Morgan, I’m sorry the reset email hasn’t arrived. Please check your spam folder and allow up to 10 minutes. For your security, never share passwords or one-time codes here. I’ve routed this to Account Support to initiate secure verification.',
    knowledge_source: 'KB-102',
    risk_level: 'High',
    requires_human_review: true,
    confidence: 0.91,
    agent_steps: [
      { agent: 'Triage Agent', status: 'complete', title: 'Account access · High priority', detail: 'Password reset issue with an urgent customer deadline. Confidence: 91%.' },
      { agent: 'Knowledge Agent', status: 'complete', title: 'Matched KB-102', detail: 'Grounded next steps in “Reset a password and recover an account”.' },
      { agent: 'Policy Agent', status: 'complete', title: 'High risk · Human review required', detail: 'Account recovery must follow the secure identity verification flow.' },
      { agent: 'Response Agent', status: 'complete', title: 'Reply draft prepared', detail: 'Draft explicitly warns against sharing passwords or OTPs.' }
    ]
  },
  {
    subject: 'Is the service currently experiencing an outage?',
    customer_name: 'Jamie Brooks',
    customer_email: 'jamie@example.com',
    body: 'Our engineering team has been seeing repeated 500 error responses across the dashboard for the last 20 minutes. Is there an active service disruption? 15 team members are currently blocked.',
    channel: 'Chat',
    category: 'Technical issue',
    priority: 'High',
    sentiment: 'Frustrated',
    team: 'Technical Support',
    status: 'Assigned',
    draft_reply: 'Hi Jamie, thanks for letting us know. Our Technical Support team is investigating. Please monitor our public status page for real-time incident reports. We will avoid estimating recovery time until confirmed by engineers.',
    knowledge_source: 'KB-103',
    risk_level: 'Medium',
    requires_human_review: true,
    confidence: 0.89,
    agent_steps: [
      { agent: 'Triage Agent', status: 'complete', title: 'Technical issue · High priority', detail: 'Multiple users blocked by repeated 500 errors. Confidence: 89%.' },
      { agent: 'Knowledge Agent', status: 'complete', title: 'Matched KB-103', detail: 'Grounded next steps in “Service availability and outages”.' },
      { agent: 'Policy Agent', status: 'complete', title: 'Medium risk · Human review required', detail: 'Potential incident impact; verify status page before advising.' },
      { agent: 'Response Agent', status: 'complete', title: 'Reply draft prepared', detail: 'No unsupported restoration time promised.' }
    ]
  }
];

// --- ROUTES ---

// Health Check
app.get('/api/health', (_, res) => {
  res.json({
    ok: true,
    status: 'online',
    timestamp: new Date().toISOString(),
    databaseConfigured: isSupabaseConfigured,
    storageMode: isSupabaseConfigured ? 'supabase_postgresql' : 'in_memory_demo_fallback',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    aiMode: process.env.GEMINI_API_KEY ? 'gemini_multi_agent' : 'deterministic_rules_fallback',
    demoMode: process.env.DEMO_MODE !== 'false'
  });
});

// Knowledge Base
app.get('/api/knowledge', (_, res) => {
  res.json(KNOWLEDGE.map(({ id, title, tags, body }) => ({ id, title, tags, snippet: body.slice(0, 120) + '...' })));
});

// User Registration
app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);

  const { name, email, password } = parsed.data;
  const normalized = email.toLowerCase().trim();

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    if (db) {
      const { data, error } = await db
        .from('app_users')
        .insert({ name, email: normalized, password_hash: passwordHash })
        .select('id, name, email')
        .single();

      if (error) {
        if (String(error.code) === '23505') {
          return res.status(409).json({ error: 'An account with this email already exists.' });
        }
        throw error;
      }
      const user = { id: data.id, name: data.name, email: data.email };
      return res.status(201).json({ token: makeToken(user), user });
    } else {
      // In-memory fallback
      if (memoryUsers.has(normalized)) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      const user = { id: randomUUID(), name, email: normalized };
      memoryUsers.set(normalized, { ...user, passwordHash });
      return res.status(201).json({ token: makeToken(user), user });
    }
  } catch (error) {
    console.error('Register error:', error.message);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);

  const { email, password } = parsed.data;
  const normalized = email.toLowerCase().trim();

  try {
    if (db) {
      const { data, error } = await db
        .from('app_users')
        .select('id, name, email, password_hash')
        .eq('email', normalized)
        .maybeSingle();

      if (error) throw error;
      if (!data || !(await bcrypt.compare(password, data.password_hash))) {
        return res.status(401).json({ error: 'Email or password is incorrect.' });
      }

      const user = { id: data.id, name: data.name, email: data.email };
      return res.json({ token: makeToken(user), user });
    } else {
      // In-memory fallback
      const record = memoryUsers.get(normalized);
      if (!record || !(await bcrypt.compare(password, record.passwordHash))) {
        return res.status(401).json({ error: 'Email or password is incorrect.' });
      }
      const user = { id: record.id, name: record.name, email: record.email };
      return res.json({ token: makeToken(user), user });
    }
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

// Demo Instant Sign-In
app.post('/api/auth/demo', async (req, res) => {
  const email = 'demo@signaldesk.local';
  const name = 'Alex Morgan';

  try {
    if (db) {
      let { data, error } = await db
        .from('app_users')
        .select('id, name, email')
        .eq('email', email)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const passwordHash = await bcrypt.hash(`demo-${randomUUID()}-${Date.now()}`, 10);
        const created = await db
          .from('app_users')
          .insert({ name, email, password_hash: passwordHash })
          .select('id, name, email')
          .single();

        if (created.error) throw created.error;
        data = created.data;
      }

      const user = { id: data.id, name: data.name, email: data.email };
      return res.json({ token: makeToken(user), user });
    } else {
      // In-memory fallback
      let user = memoryUsers.get(email);
      if (!user) {
        user = { id: 'demo-user-alex-morgan', name, email };
        memoryUsers.set(email, { ...user, passwordHash: 'demo' });
      }
      return res.json({ token: makeToken(user), user });
    }
  } catch (error) {
    console.error('Demo sign-in error:', error.message);
    res.status(500).json({ error: 'Demo sign-in could not start. Please check server logs.' });
  }
});

// List Tickets (Scoped to Authenticated User)
app.get('/api/tickets', auth, async (req, res) => {
  try {
    if (db) {
      const { data, error } = await db
        .from('support_tickets')
        .select('*')
        .eq('user_id', req.user.id)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return res.json(data || []);
    } else {
      // In-memory fallback
      const userTickets = Array.from(memoryTickets.values())
        .filter(t => t.user_id === req.user.id)
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      return res.json(userTickets);
    }
  } catch (error) {
    console.error('List tickets error:', error.message);
    res.status(500).json({ error: 'Could not load the ticket queue.' });
  }
});

// Seed Fictional Tickets
app.post('/api/tickets/seed', auth, async (req, res) => {
  try {
    if (db) {
      const existing = await db
        .from('support_tickets')
        .select('id')
        .eq('user_id', req.user.id)
        .limit(1);

      if (existing.error) throw existing.error;
      if (existing.data?.length) return res.json({ seeded: 0 });

      const rows = SAMPLE_TICKETS.map(row => ({ ...row, user_id: req.user.id }));
      const result = await db.from('support_tickets').insert(rows).select('*');
      if (result.error) throw result.error;
      return res.status(201).json({ seeded: result.data?.length || 0 });
    } else {
      // In-memory fallback
      const existingCount = Array.from(memoryTickets.values()).filter(t => t.user_id === req.user.id).length;
      if (existingCount > 0) return res.json({ seeded: 0 });

      SAMPLE_TICKETS.forEach(sample => {
        const id = randomUUID();
        const now = new Date().toISOString();
        memoryTickets.set(id, {
          ...sample,
          id,
          user_id: req.user.id,
          created_at: now,
          updated_at: now
        });
      });
      return res.status(201).json({ seeded: SAMPLE_TICKETS.length });
    }
  } catch (error) {
    console.error('Seed tickets error:', error.message);
    res.status(500).json({ error: 'Could not load sample tickets.' });
  }
});

// Create & Triage Ticket (Runs 4 Cooperating Agents)
app.post('/api/tickets', auth, async (req, res) => {
  const parsed = ticketSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);

  const input = parsed.data;
  const now = new Date().toISOString();

  try {
    let rawTicket;

    if (db) {
      const created = await db
        .from('support_tickets')
        .insert({
          user_id: req.user.id,
          subject: input.subject,
          customer_name: input.customerName,
          customer_email: input.customerEmail || null,
          body: input.body,
          channel: input.channel,
          status: 'New'
        })
        .select('*')
        .single();

      if (created.error) throw created.error;
      rawTicket = created.data;
    } else {
      const id = randomUUID();
      rawTicket = {
        id,
        user_id: req.user.id,
        subject: input.subject,
        customer_name: input.customerName,
        customer_email: input.customerEmail || null,
        body: input.body,
        channel: input.channel,
        status: 'New',
        created_at: now,
        updated_at: now
      };
      memoryTickets.set(id, rawTicket);
    }

    // Execute Multi-Agent Orchestration
    const agentResult = await processTicket(rawTicket);

    const updateFields = {
      category: agentResult.triage.category,
      priority: agentResult.triage.priority,
      sentiment: agentResult.triage.sentiment,
      team: agentResult.triage.team,
      status: agentResult.policy.requiresHumanReview ? 'Needs review' : 'Assigned',
      draft_reply: agentResult.draft,
      knowledge_source: agentResult.article?.id || null,
      risk_level: agentResult.policy.risk,
      requires_human_review: agentResult.policy.requiresHumanReview,
      confidence: Number(agentResult.triage.confidence) || null,
      agent_steps: agentResult.events,
      updated_at: new Date().toISOString()
    };

    if (db) {
      const updated = await db
        .from('support_tickets')
        .update(updateFields)
        .eq('id', rawTicket.id)
        .eq('user_id', req.user.id)
        .select('*')
        .single();

      if (updated.error) throw updated.error;
      return res.status(201).json({
        ...updated.data,
        agent_mode: agentResult.aiMode,
        next_action: agentResult.nextAction,
        policy_flags: agentResult.policy.flags,
        knowledge_article: agentResult.article
          ? { id: agentResult.article.id, title: agentResult.article.title, body: agentResult.article.body }
          : null
      });
    } else {
      const finalTicket = { ...rawTicket, ...updateFields };
      memoryTickets.set(rawTicket.id, finalTicket);
      return res.status(201).json({
        ...finalTicket,
        agent_mode: agentResult.aiMode,
        next_action: agentResult.nextAction,
        policy_flags: agentResult.policy.flags,
        knowledge_article: agentResult.article
          ? { id: agentResult.article.id, title: agentResult.article.title, body: agentResult.article.body }
          : null
      });
    }
  } catch (error) {
    console.error('Create ticket error:', error.message);
    res.status(500).json({ error: 'The ticket could not be triaged by the agent team.' });
  }
});

// Update Ticket Status / Assignment
app.patch('/api/tickets/:id', auth, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);

  const fields = {
    status: parsed.data.status,
    updated_at: new Date().toISOString()
  };
  if (parsed.data.team) fields.team = parsed.data.team;

  try {
    if (db) {
      const { data, error } = await db
        .from('support_tickets')
        .update(fields)
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Ticket not found.' });
      return res.json(data);
    } else {
      const ticket = memoryTickets.get(req.params.id);
      if (!ticket || ticket.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Ticket not found.' });
      }
      const updated = { ...ticket, ...fields };
      memoryTickets.set(req.params.id, updated);
      return res.json(updated);
    }
  } catch (error) {
    console.error('Update ticket error:', error.message);
    res.status(500).json({ error: 'Could not update the ticket.' });
  }
});

// Delete Ticket
app.delete('/api/tickets/:id', auth, async (req, res) => {
  try {
    if (db) {
      const { error, count } = await db
        .from('support_tickets')
        .delete({ count: 'exact' })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);

      if (error) throw error;
      if (!count) return res.status(404).json({ error: 'Ticket not found.' });
      return res.json({ ok: true });
    } else {
      const ticket = memoryTickets.get(req.params.id);
      if (!ticket || ticket.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Ticket not found.' });
      }
      memoryTickets.delete(req.params.id);
      return res.json({ ok: true });
    }
  } catch (error) {
    console.error('Delete ticket error:', error.message);
    res.status(500).json({ error: 'Could not remove the ticket.' });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message);
  res.status(500).json({ error: 'Unexpected server error occurred.' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 SignalDesk API listening on port ${port}`);
  console.log(`📦 Database: ${isSupabaseConfigured ? 'Supabase PostgreSQL' : 'In-Memory Fallback'}`);
  console.log(`🤖 AI Engine: ${process.env.GEMINI_API_KEY ? 'Google Gemini Live' : 'Deterministic Rules Fallback'}`);
});
