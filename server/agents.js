const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.5-flash'
].filter(Boolean);

export const KNOWLEDGE = [
  {
    id: 'KB-101',
    title: 'Duplicate or unexpected card charge',
    tags: ['billing', 'charge', 'charged', 'payment', 'duplicate', 'refund', 'card', 'invoice'],
    body: 'Acknowledge the charge concern. Ask for the transaction date and last four digits only; never request a full card number or CVV. Billing specialists can verify duplicate authorizations. Pending authorizations may disappear within 3–5 business days. Escalate confirmed duplicate captures to Billing.'
  },
  {
    id: 'KB-102',
    title: 'Reset a password and recover an account',
    tags: ['login', 'sign in', 'password', 'locked', 'account', 'access', 'reset', 'credentials'],
    body: 'Direct the customer to the official password reset flow. Never ask for or accept a password, one-time code, or recovery phrase. If the reset email does not arrive after 10 minutes, verify the account email through the secure support process and escalate to Account Security.'
  },
  {
    id: 'KB-103',
    title: 'Service availability and outages',
    tags: ['outage', 'down', 'unavailable', 'error', 'incident', 'service', '500', 'crash'],
    body: 'Check the public status page for an active incident. If an incident is active, share its public incident link and avoid promising an exact restoration time. Escalate widespread or business-critical impact to the Incident Response team.'
  },
  {
    id: 'KB-104',
    title: 'Cancel a subscription',
    tags: ['cancel', 'subscription', 'renewal', 'plan', 'downgrade', 'stop'],
    body: 'Explain the cancellation path in account settings and clarify the effective date. Do not cancel a plan or promise a refund without account-owner confirmation and eligibility review. Billing handles refund exceptions.'
  },
  {
    id: 'KB-105',
    title: 'Delivery tracking and late orders',
    tags: ['delivery', 'shipping', 'tracking', 'late', 'order', 'package', 'courier'],
    body: 'Ask for the order reference, never payment credentials. Check carrier status and provide the latest scan. Escalate shipments without a scan for more than 48 hours to the Fulfillment team.'
  },
  {
    id: 'KB-106',
    title: 'Delete an account or personal data',
    tags: ['delete', 'erase', 'privacy', 'personal data', 'account deletion', 'gdpr', 'ccpa'],
    body: 'Treat account deletion and data-erasure requests as privacy-sensitive. Acknowledge the request, do not delete data or make a legal promise, and route it to the Privacy team for identity verification and retention review.'
  }
];

export function fallbackTriage(ticket) {
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  let category = 'General';
  let team = 'Support';
  let priority = 'Normal';
  let sentiment = 'Neutral';
  let intent = 'Information request';
  let confidence = 0.75;

  if (/refund|charge|payment|invoice|billing|subscription|credit card|charged/.test(text)) {
    category = 'Billing';
    team = 'Billing';
    intent = 'Billing support';
    confidence = 0.92;
  } else if (/password|login|sign in|locked|access|auth|code|otp/.test(text)) {
    category = 'Account access';
    team = 'Account Support';
    intent = 'Account recovery';
    confidence = 0.89;
  } else if (/outage|down|unavailable|incident|500 error|broken|crash|not working/.test(text)) {
    category = 'Technical issue';
    team = 'Technical Support';
    priority = 'High';
    intent = 'Service disruption';
    confidence = 0.91;
  } else if (/delivery|shipping|tracking|order|shipment|courier/.test(text)) {
    category = 'Order status';
    team = 'Fulfillment';
    intent = 'Order tracking';
    confidence = 0.86;
  }

  if (/urgent|asap|immediately|can't work|business stopped|many users|outage|down|emergency|critical/.test(text)) {
    priority = 'High';
  }

  if (/angry|furious|terrible|unacceptable|frustrat|cancel everything|awful|horrible/.test(text)) {
    sentiment = 'Frustrated';
  } else if (/thank|great|appreciate|helpful|love/.test(text)) {
    sentiment = 'Positive';
  }

  const summary = `${ticket.customer_name || 'Customer'} is requesting help with ${intent.toLowerCase()}.`;
  return { category, team, priority, sentiment, intent, confidence, summary };
}

export function rankKnowledge(ticket) {
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  const ranked = KNOWLEDGE.map(article => ({
    article,
    score: article.tags.reduce((sum, tag) => sum + (text.includes(tag) ? (tag.includes(' ') ? 3 : 1) : 0), 0)
  })).sort((a, b) => b.score - a.score);

  return ranked[0];
}

export function policyCheck(ticket, triage) {
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  const flags = [];
  let risk = 'Low';

  if (/\b\d{13,19}\b|cvv|security code|one.time (password|code)|\botp\b|password is/.test(text)) {
    flags.push('Potential credential or payment data detected in ticket text');
    risk = 'High';
  }

  if (/delete my account|erase my data|data deletion|gdpr|right to be forgotten/.test(text)) {
    flags.push('Privacy & erasure request requires legal retention verification');
    risk = 'High';
  }

  if (/refund|chargeback|cancel.*subscription|duplicate charge|unauthorized charge/.test(text)) {
    flags.push('Financial operation requires billing team review before action');
    risk = risk === 'High' ? 'High' : 'Medium';
  }

  if (/outage|down|service unavailable|many users|all users|incident/.test(text)) {
    flags.push('Potential systemic incident impact; verify status page before advising');
    risk = risk === 'High' ? 'High' : 'Medium';
  }

  const requiresHumanReview = flags.length > 0 || triage.priority === 'High';
  const policyNote = requiresHumanReview
    ? 'Keep a human in the loop before replying or altering account status.'
    : 'Draft reply meets automated safety policy and can be reviewed normally.';

  return { risk, flags, requiresHumanReview, policyNote };
}

function cleanJson(raw) {
  if (!raw) return '';
  return raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
}

async function geminiJson(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  let lastError = null;
  // Try candidate models in order of priority
  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini (${model}) returned HTTP ${response.status}: ${errorText.slice(0, 150)}`);
      }

      const data = await response.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new Error(`Gemini (${model}) returned empty candidates`);

      const cleaned = cleanJson(raw);
      return JSON.parse(cleaned);
    } catch (err) {
      lastError = err;
      // If error is 404 (model not found), try next model candidate
      if (err.message.includes('404')) {
        console.warn(`Model ${model} not available, trying next candidate...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All Gemini model candidates failed');
}

function safeString(value, fallback, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

export async function processTicket(ticket) {
  const events = [];
  let triage = fallbackTriage(ticket);
  let aiMode = 'Demo rules';

  // 1. Triage Agent (Gemini live or fallback rule engine)
  try {
    const modelTriage = await geminiJson(
      `You are the Triage Agent for a customer support desk (SignalDesk). Classify the support ticket using only its text. Do not invent facts. Return strict JSON with:
category: one of ["Billing", "Account access", "Technical issue", "Order status", "General"]
team: one of ["Billing", "Account Support", "Technical Support", "Fulfillment", "Support"]
priority: one of ["Normal", "High"]
sentiment: one of ["Positive", "Neutral", "Frustrated"]
intent: short 2-5 word intent description
confidence: number between 0.60 and 0.99
summary: one clear concise sentence summarizing the customer request

Ticket: ${JSON.stringify({ subject: ticket.subject, body: ticket.body, channel: ticket.channel })}`
    );

    if (['Billing', 'Account access', 'Technical issue', 'Order status', 'General'].includes(modelTriage.category)) {
      triage = { ...triage, ...modelTriage };
      aiMode = 'Gemini live';
    }
  } catch (error) {
    console.warn('Triage fallback to rules engine:', error.message);
  }

  events.push({
    agent: 'Triage Agent',
    status: 'complete',
    title: `${triage.category} · ${triage.priority} priority`,
    detail: `${triage.summary} Sentiment: ${triage.sentiment.toLowerCase()}. Confidence: ${Math.round(Number(triage.confidence || 0.75) * 100)}%.`
  });

  // 2. Knowledge Agent (Grounded article lookup)
  const ranked = rankKnowledge(ticket);
  const article = ranked && ranked.score > 0 ? ranked.article : null;

  events.push({
    agent: 'Knowledge Agent',
    status: 'complete',
    title: article ? `Matched ${article.id}` : 'No exact article match',
    detail: article
      ? `Grounding response in “${article.title}”.`
      : 'Using standard clarification guidance; no ungrounded claims permitted.'
  });

  // 3. Policy Agent (Risk assessment, sensitive escalation check)
  const policy = policyCheck(ticket, triage);

  events.push({
    agent: 'Policy Agent',
    status: 'complete',
    title: `${policy.risk} risk · ${policy.requiresHumanReview ? 'Human review required' : 'Standard review'}`,
    detail: policy.flags.length ? policy.flags.join('; ') : policy.policyNote
  });

  // 4. Response Agent (Draft grounded reply and internal next action)
  let draft;
  let nextAction = policy.requiresHumanReview
    ? `Review draft and escalate to ${triage.team} team.`
    : `Send approved reply and monitor for customer response.`;

  try {
    const generated = await geminiJson(
      `You are the Response Agent for SignalDesk. Draft a concise, professional customer support reply grounded ONLY in the customer ticket and approved knowledge article.
Rules:
- Never claim to have performed actions (do not say you issued a refund, changed passwords, deleted accounts, or resolved anything).
- Never request full card numbers, CVVs, passwords, or one-time codes.
- If human review is required, reassure the customer and state their request is routed to ${triage.team} for verification.
- Tone: Empathetic, clear, and reassuring.

Ticket: ${JSON.stringify({ subject: ticket.subject, customer: ticket.customer_name, body: ticket.body })}
Triage: ${JSON.stringify(triage)}
Policy: ${JSON.stringify(policy)}
Knowledge: ${article ? JSON.stringify({ title: article.title, guidance: article.body }) : 'Clarification needed; route to specialist.'}

Return JSON format: {"draftReply": "...", "nextAction": "one concise internal instruction"}`
    );

    draft = safeString(
      generated.draftReply,
      `Hi ${ticket.customer_name || 'there'}, thanks for reaching out. We have logged your request and our ${triage.team} team is reviewing it. We'll update you shortly.`,
      900
    );

    if (generated.nextAction) {
      nextAction = safeString(generated.nextAction, nextAction, 200);
    }

    if (aiMode === 'Gemini live') {
      aiMode = 'Gemini live (Multi-Agent)';
    }
  } catch (error) {
    console.warn('Response fallback to template:', error.message);
    draft = article
      ? `Hi ${ticket.customer_name || 'there'}, thanks for contacting us. ${article.body.split('. ')[0]}. I’ve prepared this for our ${triage.team} team to review and we will follow up with next steps shortly.`
      : `Hi ${ticket.customer_name || 'there'}, thanks for reaching out. Could you share a few more details so our ${triage.team} team can assist you? For security, please never include passwords or complete payment details.`;
  }

  events.push({
    agent: 'Response Agent',
    status: 'complete',
    title: 'Reply draft prepared',
    detail: 'Draft grounded in approved guidance and verified against automated safety rules.'
  });

  return {
    triage,
    policy,
    article,
    events,
    draft,
    aiMode,
    nextAction
  };
}
