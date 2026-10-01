import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './style.css';

const API = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const PRESETS = [
  {
    label: '💳 Duplicate Charge ($39)',
    subject: 'Charged twice for monthly plan',
    customerName: 'Jordan Lee',
    customerEmail: 'jordan@example.com',
    channel: 'Email',
    body: 'I noticed two identical charges of $39.00 on my credit card statement today for my monthly subscription. Could you please check if one of these was an accidental duplicate authorization?'
  },
  {
    label: '🔐 Password Reset Loop',
    subject: 'Password reset link expired repeatedly',
    customerName: 'Casey Smith',
    customerEmail: 'casey@example.com',
    channel: 'Web form',
    body: 'I have requested a password reset link three times in the last 15 minutes, but the email link says expired immediately upon opening. I have an urgent client review today and cannot access my account.'
  },
  {
    label: '⚠️ 504 Gateway Outage',
    subject: 'Critical: 504 Gateway Timeouts across team',
    customerName: 'Devon Vance',
    customerEmail: 'devon@example.com',
    channel: 'Chat',
    body: 'Our entire team of 20 people is receiving continuous 504 Gateway Timeout errors when loading our project workspace. Is there a service disruption currently affecting production?'
  }
];

function App() {
  const [token, setToken] = useState(localStorage.getItem('signal-token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('signal-user') || 'null'));
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('All tickets');
  const [search, setSearch] = useState('');
  const [authMode, setAuthMode] = useState('demo'); // 'demo' | 'login' | 'register'
  const [auth, setAuth] = useState({ name: '', email: '', password: '' });
  const [form, setForm] = useState({
    subject: '',
    customerName: '',
    customerEmail: '',
    channel: 'Email',
    body: ''
  });
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [copied, setCopied] = useState(false);

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  async function api(path, options = {}) {
    const res = await fetch(`${API}/api${path}`, {
      ...options,
      headers: { ...headers, ...options.headers }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadTickets() {
    try {
      const list = await api('/tickets');
      setTickets(list);
      if (selected) {
        const updated = list.find(t => t.id === selected.id);
        setSelected(updated || list[0] || null);
      } else if (list.length > 0) {
        setSelected(list[0]);
      }
    } catch (e) {
      setToast(e.message);
    }
  }

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then(r => r.json())
      .then(d => {
        setAiConfigured(Boolean(d.aiConfigured));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (token) loadTickets();
  }, [token]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function saveSession(data) {
    localStorage.setItem('signal-token', data.token);
    localStorage.setItem('signal-user', JSON.stringify(data.user));
    setUser(data.user);
    setToken(data.token);
  }

  async function demoLogin() {
    setBusy(true);
    try {
      const data = await api('/auth/demo', { method: 'POST', body: '{}' });
      saveSession(data);
      const seeded = await api('/tickets/seed', { method: 'POST', body: '{}' });
      if (seeded.seeded > 0) {
        setToast('Fictional sample tickets loaded into workspace.');
      }
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function authSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const path = authMode === 'login' ? '/auth/login' : '/auth/register';
      const body = authMode === 'login' ? { email: auth.email, password: auth.password } : auth;
      const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
      saveSession(data);
      setToast(authMode === 'login' ? 'Signed in successfully.' : 'Account created.');
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem('signal-token');
    localStorage.removeItem('signal-user');
    setToken('');
    setUser(null);
    setTickets([]);
    setSelected(null);
    setToast('Signed out.');
  }

  async function createTicket(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const row = await api('/tickets', { method: 'POST', body: JSON.stringify(form) });
      setTickets(old => [row, ...old]);
      setSelected(row);
      setShowNew(false);
      setForm({ subject: '', customerName: '', customerEmail: '', channel: 'Email', body: '' });
      setToast(
        row.agent_mode?.includes('Gemini')
          ? 'Agents analyzed ticket with Gemini Live.'
          : 'Agent workflow executed in safe demo mode.'
      );
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeTicket(values) {
    if (!selected) return;
    try {
      const row = await api(`/tickets/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(values)
      });
      const enriched = { ...selected, ...row };
      setSelected(enriched);
      setTickets(rows => rows.map(t => (t.id === row.id ? { ...t, ...row } : t)));
      setToast(
        values.status === 'Assigned'
          ? `Ticket approved and routed to ${values.team || selected.team || 'team'}.`
          : `Ticket status set to ${values.status}.`
      );
    } catch (e) {
      setToast(e.message);
    }
  }

  async function removeTicket() {
    if (!selected) return;
    try {
      await api(`/tickets/${selected.id}`, { method: 'DELETE' });
      const list = tickets.filter(t => t.id !== selected.id);
      setTickets(list);
      setSelected(list[0] || null);
      setToast('Ticket removed from workspace.');
    } catch (e) {
      setToast(e.message);
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(selected?.draft_reply || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      setToast('Suggested reply draft copied to clipboard.');
    } catch {
      setToast('Clipboard access unavailable.');
    }
  }

  async function seedFromQueue() {
    try {
      const data = await api('/tickets/seed', { method: 'POST', body: '{}' });
      if (data.seeded > 0) {
        await loadTickets();
        setToast('Fictional sample tickets added to queue.');
      } else {
        setToast('Sample tickets already present.');
      }
    } catch (e) {
      setToast(e.message);
    }
  }

  const visible = useMemo(() => {
    let list = tickets;
    if (filter === 'Needs review') list = list.filter(t => t.status === 'Needs review');
    if (filter === 'Assigned') list = list.filter(t => t.status === 'Assigned');
    if (filter === 'Resolved') list = list.filter(t => t.status === 'Resolved');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        t => t.subject?.toLowerCase().includes(q) || t.customer_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [tickets, filter, search]);

  const needsReview = tickets.filter(t => t.status === 'Needs review').length;
  const highPriority = tickets.filter(t => t.priority === 'High').length;

  // --- SIGN IN VIEW ---
  if (!token) {
    return (
      <div className="login-layout">
        <div className="login-left">
          <div className="logo">
            <span className="logo-symbol">S</span>
            <span>
              signal<span className="logo-light">desk</span>
            </span>
          </div>

          <div className="login-main">
            <div className="eyebrow">AGENTIC AI & INTELLIGENT SYSTEMS</div>
            <h1>
              Every ticket.<br />
              <span>One transparent agent pipeline.</span>
            </h1>
            <p className="login-sub">
              SignalDesk coordinates four specialized AI agents to triage incoming customer support,
              ground answers in approved policy, flag sensitive risks, and draft empathetic replies—while
              keeping humans firmly in control.
            </p>

            <div className="login-benefits">
              <div>
                <span>✦</span>
                <b>1. Triage Agent</b>
                <small>Classifies intent, sentiment, category & urgency</small>
              </div>
              <div>
                <span>⌕</span>
                <b>2. Knowledge Agent</b>
                <small>Grounds responses in verified help articles</small>
              </div>
              <div>
                <span>◈</span>
                <b>3. Policy Agent</b>
                <small>Flags credentials, payments & privacy escalations</small>
              </div>
              <div>
                <span>✎</span>
                <b>4. Response Agent</b>
                <small>Drafts safe customer reply & internal next action</small>
              </div>
            </div>

            {/* Auth Switcher */}
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${authMode === 'demo' ? 'active' : ''}`}
                onClick={() => setAuthMode('demo')}
              >
                Instant Demo
              </button>
              <button
                type="button"
                className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => setAuthMode('login')}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`auth-tab ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => setAuthMode('register')}
              >
                Create Account
              </button>
            </div>

            {authMode === 'demo' && (
              <div className="demo-login-box">
                <button
                  type="button"
                  className="primary large glowing"
                  onClick={demoLogin}
                  disabled={busy}
                >
                  {busy ? 'Preparing workspace…' : 'Explore Demo Workspace (Alex Morgan)'}
                  <span>→</span>
                </button>
                <p className="demo-note">
                  <i /> Instant 1-click access · Preloaded fictional tickets · Safe demo environment
                </p>
              </div>
            )}

            {authMode === 'login' && (
              <form className="quick-register" onSubmit={authSubmit}>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    placeholder="support@company.com"
                    value={auth.email}
                    onChange={e => setAuth({ ...auth, email: e.target.value })}
                  />
                </label>
                <label>
                  Password
                  <input
                    required
                    type="password"
                    placeholder="••••••••"
                    value={auth.password}
                    onChange={e => setAuth({ ...auth, password: e.target.value })}
                  />
                </label>
                <button type="submit" className="primary large" disabled={busy}>
                  {busy ? 'Verifying…' : 'Sign in to SignalDesk'}
                </button>
              </form>
            )}

            {authMode === 'register' && (
              <form className="quick-register" onSubmit={authSubmit}>
                <label>
                  Your Name
                  <input
                    required
                    placeholder="Support Specialist"
                    value={auth.name}
                    onChange={e => setAuth({ ...auth, name: e.target.value })}
                  />
                </label>
                <label>
                  Work Email
                  <input
                    required
                    type="email"
                    placeholder="specialist@company.com"
                    value={auth.email}
                    onChange={e => setAuth({ ...auth, email: e.target.value })}
                  />
                </label>
                <label>
                  Password (8+ chars)
                  <input
                    required
                    type="password"
                    minLength="8"
                    placeholder="Minimum 8 characters"
                    value={auth.password}
                    onChange={e => setAuth({ ...auth, password: e.target.value })}
                  />
                </label>
                <button type="submit" className="primary large" disabled={busy}>
                  {busy ? 'Registering…' : 'Create Support Account'}
                </button>
              </form>
            )}
          </div>

          <div className="login-footer">
            Built for college hackathon · Google Gemini & Supabase PostgreSQL · Responsible AI in Support
          </div>
        </div>

        <div className="login-right">
          <div className="floating-label label-top">
            <span className="tiny-dot violet-dot" />
            1. TRIAGE AGENT
          </div>
          <div className="floating-label label-right">
            <span className="tiny-dot blue-dot" />
            2. KNOWLEDGE AGENT
          </div>
          <div className="floating-label label-left">
            <span className="tiny-dot amber-dot" />
            3. POLICY AGENT
          </div>
          <div className="floating-label label-bottom">
            <span className="tiny-dot green-dot" />
            4. RESPONSE AGENT
          </div>

          <div className="flow-visual">
            <div className="flow-orbit orbit-1" />
            <div className="flow-orbit orbit-2" />
            <div className="flow-core">S</div>
            <div className="flow-node node-top" title="Triage Agent">✦</div>
            <div className="flow-node node-right" title="Knowledge Agent">⌕</div>
            <div className="flow-node node-bottom" title="Response Agent">✎</div>
            <div className="flow-node node-left" title="Policy Agent">◈</div>
          </div>

          <div className="right-copy">
            <h2>
              Autonomous reasoning.<br />
              Guaranteed human oversight.
            </h2>
            <p>
              Agents collaborate on classification, context retrieval, and risk assessment. Critical
              account actions and message sending always require support worker approval.
            </p>
          </div>

          <div className="mini-flow">
            <span>INCOMING</span>
            <b>→</b>
            <span>TRIAGE</span>
            <b>→</b>
            <span>KNOWLEDGE</span>
            <b>→</b>
            <span>POLICY</span>
            <b>→</b>
            <span>HUMAN APPROVAL</span>
          </div>
        </div>

        {toast && <div className="toast">✦ &nbsp;{toast}</div>}
      </div>
    );
  }

  // --- WORKSPACE VIEW ---
  return (
    <div className="shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-symbol">S</span>
          <span>
            signal<span className="logo-light">desk</span>
          </span>
        </div>

        <div className="workspace">
          <div className="workspace-avatar">N</div>
          <div>
            <b>NIAT Support Desk</b>
            <small>Support Triage Workspace</small>
          </div>
          <span className="workspace-chevron">⌄</span>
        </div>

        <div className="side-section-title">NAVIGATION</div>
        <button
          className={`side-nav ${filter === 'All tickets' ? 'active' : ''}`}
          onClick={() => setFilter('All tickets')}
        >
          <span>▦</span>
          Inbox
          <i>{tickets.length}</i>
        </button>
        <button
          className={`side-nav ${filter === 'Needs review' ? 'active' : ''}`}
          onClick={() => setFilter('Needs review')}
        >
          <span>◷</span>
          Needs review
          <i className="review-count">{needsReview}</i>
        </button>
        <button
          className={`side-nav ${filter === 'Assigned' ? 'active' : ''}`}
          onClick={() => setFilter('Assigned')}
        >
          <span>✓</span>
          Assigned / Routed
          <i>{tickets.filter(t => t.status === 'Assigned').length}</i>
        </button>

        <div className="side-bottom">
          <div className="agent-online">
            <span className="online-icon">✦</span>
            <div>
              <b>Agent Team Ready</b>
              <small>{aiConfigured ? 'Gemini Live' : 'Deterministic Rules'} · 4 stages</small>
            </div>
            <i />
          </div>

          <button className="account" onClick={logout} title="Click to log out">
            <span className="user-avatar">
              {(user?.name || 'A')
                .split(' ')
                .map(x => x[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span>
              <b>{user?.name || 'Alex Morgan'}</b>
              <small>{user?.email || 'demo@signaldesk.local'}</small>
            </span>
            <span className="logout-tag">Log out</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace Content */}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <b>Inbox</b>
            <span className="filter-crumb">({filter})</span>
          </div>
          <div className="top-right">
            <span className="date-label">
              {new Intl.DateTimeFormat('en', {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
              }).format(new Date())}
            </span>
            <span className="status-pill">
              <i className="live-dot" />
              {aiConfigured ? 'GEMINI CONNECTED' : 'DEMO MODE'}
            </span>
            <span className="top-avatar">
              {(user?.name || 'A')
                .split(' ')
                .map(x => x[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
          </div>
        </header>

        <div className="content">
          {/* Header */}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                SUPPORT OPERATIONS <span className="live-pill"><i />MULTI-AGENT TRIAGE</span>
              </div>
              <h1>
                Support Inbox <span>✦</span>
              </h1>
              <p>Specialized agents parse incoming tickets, query knowledge, evaluate policy risk, and draft responses.</p>
            </div>
            <div className="heading-actions">
              <button className="ghost-btn" onClick={seedFromQueue}>
                ↻ Load Sample Tickets
              </button>
              <button className="primary new-btn" onClick={() => setShowNew(true)}>
                ＋ <span>New Ticket</span>
              </button>
            </div>
          </div>

          {/* KPI Stats */}
          <div className="stats">
            <div className="stat-card">
              <div className="stat-label">
                Open Tickets
                <span className="stat-icon purple">▦</span>
              </div>
              <div className="stat-value">
                {tickets.filter(t => t.status !== 'Resolved').length}
                <small>active</small>
              </div>
              <div className="stat-foot">In triage queue across channels</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">
                Needs Human Review
                <span className="stat-icon amber">◷</span>
              </div>
              <div className="stat-value">
                {needsReview}
                <small>flagged</small>
              </div>
              <div className="stat-foot">Flagged by Policy Agent for approval</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">
                High Priority
                <span className="stat-icon coral">↗</span>
              </div>
              <div className="stat-value">
                {highPriority}
                <small>urgent</small>
              </div>
              <div className="stat-foot">Classified by Triage Agent</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">
                Cooperating Agents
                <span className="stat-icon green">✦</span>
              </div>
              <div className="stat-value">
                4<small>agents</small>
              </div>
              <div className="stat-foot">Triage · Knowledge · Policy · Response</div>
            </div>
          </div>

          {/* Work Grid */}
          <div className="work-grid">
            {/* Queue Panel */}
            <section className="panel queue-panel">
              <div className="panel-head">
                <div>
                  <h2>Ticket Queue</h2>
                  <p>Select a ticket to inspect the multi-agent decision trace</p>
                </div>
                <div className="queue-controls">
                  <input
                    type="search"
                    placeholder="Search subject or customer…"
                    className="queue-search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  <select
                    className="filter-select"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  >
                    <option>All tickets</option>
                    <option>Needs review</option>
                    <option>Assigned</option>
                    <option>Resolved</option>
                  </select>
                </div>
              </div>

              <div className="queue-columns">
                <span>TICKET & CUSTOMER</span>
                <span>CATEGORY</span>
                <span>PRIORITY</span>
                <span>STATUS</span>
                <span>AGE</span>
              </div>

              <div className="ticket-rows">
                {visible.map(t => (
                  <button
                    key={t.id}
                    className={`ticket-row ${selected?.id === t.id ? 'selected' : ''}`}
                    onClick={() => setSelected(t)}
                  >
                    <div className="ticket-main">
                      <span
                        className={`channel-icon ${
                          t.category === 'Billing'
                            ? 'billing'
                            : t.category === 'Technical issue'
                            ? 'technical'
                            : t.category === 'Account access'
                            ? 'account-icon'
                            : 'general'
                        }`}
                      >
                        {t.category === 'Billing'
                          ? '＄'
                          : t.category === 'Technical issue'
                          ? '⌘'
                          : t.category === 'Account access'
                          ? '◉'
                          : '✉'}
                      </span>
                      <span className="ticket-text">
                        <b>{t.subject}</b>
                        <small>
                          {t.customer_name} <i>·</i> {t.channel || 'Email'}
                        </small>
                      </span>
                    </div>

                    <div>
                      <span className="category-pill">{t.category || 'General'}</span>
                    </div>

                    <div>
                      <span className={`priority ${t.priority === 'High' ? 'high' : ''}`}>
                        <i />
                        {t.priority}
                      </span>
                    </div>

                    <div>
                      <span
                        className={`status-chip ${
                          t.status === 'Needs review'
                            ? 'needs-review'
                            : t.status === 'Assigned'
                            ? 'assigned'
                            : t.status === 'Resolved'
                            ? 'resolved'
                            : ''
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>

                    <div className="age">{age(t.updated_at || t.created_at)}</div>
                  </button>
                ))}

                {!visible.length && (
                  <div className="empty-state">
                    <span>✦</span>
                    <b>{tickets.length ? 'No tickets match filter' : 'Queue is empty'}</b>
                    <p>
                      {tickets.length
                        ? 'Try clearing the search query or selecting another status filter.'
                        : 'Load fictional sample tickets or submit a new ticket to test agent orchestration.'}
                    </p>
                    <button className="primary" onClick={seedFromQueue}>
                      ＋ Load Sample Tickets
                    </button>
                  </div>
                )}
              </div>

              <div className="queue-foot">
                <span>
                  <i /> Automated triage active · Scoped to user workspace
                </span>
                <span className="queue-count">{visible.length} ticket(s) shown</span>
              </div>
            </section>

            {/* Agent Team Overview Panel */}
            <section className="panel team-panel">
              <div className="panel-head">
                <div>
                  <h2>Agent Pipeline</h2>
                  <p>4 cooperating specialized stages</p>
                </div>
                <span className="online-pill">
                  <i />
                  ACTIVE
                </span>
              </div>

              <div className="team-list">
                {[
                  [
                    'T',
                    '1. Triage Agent',
                    'Classifies intent, sentiment, priority & confidence',
                    'violet'
                  ],
                  [
                    '⌕',
                    '2. Knowledge Agent',
                    'Retrieves grounded guidance from approved knowledge base',
                    'blue'
                  ],
                  [
                    '◈',
                    '3. Policy Agent',
                    'Screens credentials, payment risk & requires human review',
                    'amber'
                  ],
                  [
                    '✎',
                    '4. Response Agent',
                    'Drafts customer reply & proposes internal next action',
                    'green'
                  ]
                ].map(([icon, name, desc, color], i) => (
                  <div className="team-row" key={name}>
                    <span className={`team-icon ${color}`}>{icon}</span>
                    <span className="team-copy">
                      <b>{name}</b>
                      <small>{desc}</small>
                    </span>
                    <span className="ready">Ready</span>
                    {i < 3 && <i className="connector" />}
                  </div>
                ))}
              </div>

              <div className="team-foot">
                <span className="pulse" />
                <span>Deterministic safety guarantees keep humans in the loop</span>
              </div>
            </section>
          </div>

          {/* Detail Panel: Selected Ticket & Agent Run Trace */}
          {selected && (
            <section className="panel detail-panel">
              <div className="detail-top">
                <div className="detail-about">
                  <div className="detail-meta">
                    <span className={`priority ${selected.priority === 'High' ? 'high' : ''}`}>
                      <i />
                      {selected.priority} priority
                    </span>
                    <span>·</span>
                    <span>{selected.channel || 'Email'}</span>
                    <span>·</span>
                    <span>{age(selected.created_at)}</span>
                    {selected.confidence && (
                      <>
                        <span>·</span>
                        <span className="confidence-tag">
                          Confidence: {Math.round(selected.confidence * 100)}%
                        </span>
                      </>
                    )}
                  </div>
                  <h2>{selected.subject}</h2>
                  <p className="ticket-body">“{selected.body}”</p>
                  <div className="customer-line">
                    <span className="customer-avatar">
                      {(selected.customer_name || 'C')
                        .split(' ')
                        .map(x => x[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <span>
                      <b>{selected.customer_name}</b>
                      <small>{selected.customer_email || 'No email provided'}</small>
                    </span>
                  </div>
                </div>

                <div className="detail-controls">
                  <label className="control-label">
                    Status:
                    <select
                      aria-label="Ticket status"
                      value={selected.status}
                      onChange={e => changeTicket({ status: e.target.value })}
                    >
                      <option>New</option>
                      <option>Needs review</option>
                      <option>Assigned</option>
                      <option>Resolved</option>
                    </select>
                  </label>
                  <button className="ghost-btn danger" onClick={removeTicket} title="Delete ticket">
                    Remove
                  </button>
                </div>
              </div>

              <div className="detail-grid">
                {/* Agent Trace */}
                <div className="agent-run">
                  <div className="section-title">
                    <span>✦</span>
                    <b>Agent Execution Trace</b>
                    <span className={`ai-mode ${aiConfigured ? 'ai-live' : ''}`}>
                      {selected.agent_mode || (aiConfigured ? 'GEMINI LIVE' : 'DEMO RULES')}
                    </span>
                  </div>

                  <div className="run-list">
                    {(selected.agent_steps || []).map((step, i) => (
                      <div className="run-step" key={step.agent || i}>
                        <span className="run-check">✓</span>
                        {i < (selected.agent_steps?.length || 0) - 1 && <i className="run-line" />}
                        <div className="run-content">
                          <div className="step-header">
                            <b>{step.agent}</b>
                            <small>{step.title}</small>
                          </div>
                          <p>{step.detail}</p>
                        </div>
                        <span className="done-label">Complete</span>
                      </div>
                    ))}
                  </div>

                  <div className="analysis-tags">
                    <span>Category: {selected.category}</span>
                    <span>Sentiment: {selected.sentiment || 'Neutral'}</span>
                    <span>Routed Team: {selected.team || 'Support'}</span>
                    {selected.requires_human_review && (
                      <span className="tag-warning">Human Approval Required</span>
                    )}
                  </div>
                </div>

                {/* Suggested Reply & Grounded Policy Check */}
                <div className="reply-card">
                  <div className="reply-head">
                    <div>
                      <span>✎</span>
                      <b>Response Agent Draft</b>
                    </div>
                    <button className="copy-btn" onClick={copyDraft}>
                      {copied ? 'Copied ✓' : '📋 Copy Reply Draft'}
                    </button>
                  </div>

                  <div className="reply-body">
                    {selected.draft_reply || 'No draft generated.'}
                  </div>

                  {selected.knowledge_source && (
                    <div className="source-row">
                      <span>GROUNDED IN KNOWLEDGE:</span>
                      <b>{selected.knowledge_source}</b>
                      {selected.knowledge_article?.title && (
                        <small>({selected.knowledge_article.title})</small>
                      )}
                    </div>
                  )}

                  <div
                    className={`risk-callout ${
                      selected.risk_level === 'High'
                        ? 'risk-high'
                        : selected.risk_level === 'Medium'
                        ? 'risk-medium'
                        : 'risk-low'
                    }`}
                  >
                    <span>◈</span>
                    <div>
                      <b>
                        {selected.risk_level || 'Low'} Risk Level ·{' '}
                        {selected.requires_human_review
                          ? 'Review Required Before Sending'
                          : 'Standard Verification'}
                      </b>
                      <small>
                        {selected.requires_human_review
                          ? 'Policy check flagged sensitive financial, credential, or privacy boundaries. Support worker verification is mandatory.'
                          : 'Standard policy clearance; reply can be reviewed and transmitted.'}
                      </small>
                    </div>
                  </div>

                  {selected.next_action && (
                    <div className="next-action-row">
                      <span>RECOMMENDED ACTION:</span>
                      <p>{selected.next_action}</p>
                    </div>
                  )}

                  <button
                    type="button"
                    className="primary route-btn"
                    onClick={() =>
                      changeTicket({
                        status: 'Assigned',
                        team: selected.team || 'Support'
                      })
                    }
                  >
                    {selected.status === 'Assigned'
                      ? `✓ Approved & Routed to ${selected.team || 'Support'}`
                      : `Approve Draft & Assign to ${selected.team || 'Support'}`}
                    <span>→</span>
                  </button>

                  <div className="no-send-note">
                    🛡️ Fictional Hackathon Prototype · No real customer emails are dispatched · Human in the loop guaranteed
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="page-foot">
            <span>✦</span> SignalDesk: Agentic AI & Intelligent Systems · Google Gemini & Supabase PostgreSQL
          </div>
        </div>
      </main>

      {/* New Ticket Modal */}
      {showNew && (
        <div className="modal-layer" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-top">
              <div>
                <div className="eyebrow">NEW SUPPORT REQUEST</div>
                <h2>Bring In A Support Ticket</h2>
                <p>The 4-stage agent pipeline will classify, ground, evaluate risk, and draft a response.</p>
              </div>
              <button className="modal-close" onClick={() => setShowNew(false)}>
                ×
              </button>
            </div>

            {/* Quick Preset Selector */}
            <div className="preset-selector">
              <span className="preset-label">Quick Demo Presets:</span>
              <div className="preset-buttons">
                {PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    className="preset-chip"
                    onClick={() =>
                      setForm({
                        subject: preset.subject,
                        customerName: preset.customerName,
                        customerEmail: preset.customerEmail,
                        channel: preset.channel,
                        body: preset.body
                      })
                    }
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={createTicket}>
              <label>
                Ticket Subject
                <input
                  required
                  minLength="4"
                  maxLength="120"
                  placeholder="e.g. Charged twice for monthly plan"
                  value={form.subject}
                  onChange={e => setForm({ ...form, subject: e.target.value })}
                />
              </label>

              <div className="two-col">
                <label>
                  Customer Name
                  <input
                    required
                    minLength="2"
                    placeholder="Customer Name"
                    value={form.customerName}
                    onChange={e => setForm({ ...form, customerName: e.target.value })}
                  />
                </label>
                <label>
                  Channel
                  <select
                    value={form.channel}
                    onChange={e => setForm({ ...form, channel: e.target.value })}
                  >
                    <option>Email</option>
                    <option>Chat</option>
                    <option>Web form</option>
                  </select>
                </label>
              </div>

              <label>
                Customer Email <span className="optional">optional</span>
                <input
                  type="email"
                  placeholder="customer@example.com"
                  value={form.customerEmail}
                  onChange={e => setForm({ ...form, customerEmail: e.target.value })}
                />
              </label>

              <label>
                Ticket Message
                <textarea
                  required
                  minLength="12"
                  maxLength="3000"
                  rows="5"
                  placeholder="Enter ticket body message. For hackathon safety, use synthetic/fictional text only."
                  value={form.body}
                  onChange={e => setForm({ ...form, body: e.target.value })}
                />
                <small>Synthetic demonstration ticket only. Do not input actual PII or sensitive keys.</small>
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setShowNew(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? 'Agents Orchestrating…' : 'Run 4-Agent Pipeline'}
                  <span>→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className="toast">✦ &nbsp;{toast}</div>}
    </div>
  );
}

function age(date) {
  if (!date) return 'Just now';
  const m = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
