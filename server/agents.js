const MODEL=process.env.GEMINI_MODEL||'gemini-3.8-flash';
export const KNOWLEDGE=[
 {id:'KB-101',title:'Duplicate or unexpected card charge',tags:['billing','charge','charged','payment','duplicate','refund'],body:'Acknowledge the charge concern. Ask for the transaction date and last four digits only; never request a full card number or CVV. Billing specialists can verify duplicate authorizations. Pending authorizations may disappear within 3–5 business days. Escalate confirmed duplicate captures to Billing.'},
 {id:'KB-102',title:'Reset a password and recover an account',tags:['login','sign in','password','locked','account','access'],body:'Direct the customer to the official password reset flow. Never ask for or accept a password, one-time code, or recovery phrase. If the reset email does not arrive after 10 minutes, verify the account email through the secure support process and escalate to Account Security.'},
 {id:'KB-103',title:'Service availability and outages',tags:['outage','down','unavailable','error','incident','service'],body:'Check the public status page for an active incident. If an incident is active, share its public incident link and avoid promising an exact restoration time. Escalate widespread or business-critical impact to the Incident Response team.'},
 {id:'KB-104',title:'Cancel a subscription',tags:['cancel','subscription','renewal','plan'],body:'Explain the cancellation path in account settings and clarify the effective date. Do not cancel a plan or promise a refund without account-owner confirmation and eligibility review. Billing handles refund exceptions.'},
 {id:'KB-105',title:'Delivery tracking and late orders',tags:['delivery','shipping','tracking','late','order'],body:'Ask for the order reference, never payment credentials. Check carrier status and provide the latest scan. Escalate shipments without a scan for more than 48 hours to the Fulfillment team.'},
 {id:'KB-106',title:'Delete an account or personal data',tags:['delete','erase','privacy','personal data','account deletion'],body:'Treat account deletion and data-erasure requests as privacy-sensitive. Acknowledge the request, do not delete data or make a legal promise, and route it to the Privacy team for identity verification and retention review.'}
];
function fallbackTriage(ticket){
 const text=`${ticket.subject} ${ticket.body}`.toLowerCase();
 let category='General',team='Support',priority='Normal',sentiment='Neutral',intent='Information request',confidence=.72;
 if(/refund|charge|payment|invoice|billing|subscription/.test(text)){category='Billing';team='Billing';intent='Billing support';confidence=.87}
 else if(/password|login|sign in|locked|access/.test(text)){category='Account access';team='Account Support';intent='Account recovery';confidence=.86}
 else if(/outage|down|unavailable|incident|500 error/.test(text)){category='Technical issue';team='Technical Support';priority='High';intent='Service disruption';confidence=.88}
 else if(/delivery|shipping|tracking|order/.test(text)){category='Order status';team='Fulfillment';intent='Order tracking';confidence=.83}
 if(/urgent|asap|immediately|can't work|business stopped|many users|outage|down/.test(text))priority='High';
 if(/angry|furious|terrible|unacceptable|frustrat|cancel everything/.test(text))sentiment='Frustrated';
 if(/thank|great|appreciate/.test(text))sentiment='Positive';
 return {category,team,priority,sentiment,intent,confidence,summary:`${ticket.customer_name} needs help with ${intent.toLowerCase()}.`};
}
function rankKnowledge(ticket){
 const text=`${ticket.subject} ${ticket.body}`.toLowerCase();
 return KNOWLEDGE.map(article=>({article,score:article.tags.reduce((n,tag)=>n+(text.includes(tag)?(tag.includes(' ')?2:1):0),0)})).sort((a,b)=>b.score-a.score)[0];
}
function policyCheck(ticket,triage){
 const text=`${ticket.subject} ${ticket.body}`.toLowerCase();
 const flags=[];let risk='Low';
 if(/\b\d{13,19}\b|cvv|security code|one.time (password|code)|\botp\b|password is/.test(text)){flags.push('Possible credential or payment data in ticket');risk='High'}
 if(/delete my account|erase my data|data deletion/.test(text)){flags.push('Privacy request requires identity and retention review');risk='High'}
 if(/refund|chargeback|cancel.*subscription|duplicate charge/.test(text)){flags.push('Financial action requires billing review');risk=risk==='High'?'High':'Medium'}
 if(/outage|down|service unavailable|many users/.test(text)){flags.push('Potential incident impact; verify status and escalate');risk=risk==='High'?'High':'Medium'}
 const human=flags.length>0||triage.priority==='High';
 return {risk,flags,requiresHumanReview:human,policyNote:human?'Keep a human in the loop before sending or changing an account.':'Draft can be reviewed and routed by the support team.'};
}
async function geminiJson(prompt){
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('Gemini key not configured');
 const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:.2}})});
 if(!response.ok)throw new Error(`Gemini returned ${response.status}`);
 const data=await response.json();const raw=data.candidates?.[0]?.content?.parts?.[0]?.text;if(!raw)throw new Error('Gemini returned no JSON');return JSON.parse(raw);
}
function safeString(value,fallback,max=500){return typeof value==='string'?value.slice(0,max):fallback}
export async function processTicket(ticket){
 const events=[];let triage=fallbackTriage(ticket),aiMode='Demo rules';
 try{
  const modelTriage=await geminiJson(`You are the Triage Agent for a fictional customer support desk. Classify the ticket using only its content. Do not invent account facts. Return JSON with category (Billing|Account access|Technical issue|Order status|General), team (Billing|Account Support|Technical Support|Fulfillment|Support), priority (Normal|High), sentiment (Positive|Neutral|Frustrated), intent (short string), confidence (number 0 to 1), summary (one sentence). Ticket: ${JSON.stringify({subject:ticket.subject,body:ticket.body,channel:ticket.channel})}`);
  if(['Billing','Account access','Technical issue','Order status','General'].includes(modelTriage.category))triage={...triage,...modelTriage};aiMode='Gemini live';
 }catch(error){console.warn('Triage fallback:',error.message)}
 events.push({agent:'Triage Agent',status:'complete',title:`${triage.category} · ${triage.priority} priority`,detail:`${triage.summary} Sentiment: ${triage.sentiment.toLowerCase()}. Confidence: ${Math.round(Number(triage.confidence||.7)*100)}%.`});
 const ranked=rankKnowledge(ticket);const article=ranked.score>0?ranked.article:null;
 events.push({agent:'Knowledge Agent',status:'complete',title:article?`Matched ${article.id}`:'No exact article match',detail:article?`Grounding response in “${article.title}”.`:'Use a clarification-first response; do not invent policy.'});
 const policy=policyCheck(ticket,triage);
 events.push({agent:'Policy Agent',status:'complete',title:`${policy.risk} risk · ${policy.requiresHumanReview?'Human review required':'Standard review'}`,detail:policy.flags.length?policy.flags.join('; '):policy.policyNote});
 let draft;
 try{
  const generated=await geminiJson(`You are the Response Agent. Draft a concise, kind customer support reply grounded ONLY in the ticket and knowledge article. Do not claim that you checked an account, issued a refund, changed a password, deleted data, or sent anything. Do not request passwords, OTPs, full card numbers, or CVVs. If the article says human review is required, acknowledge the request and explain it is being routed without promising an outcome. Return JSON: {"draftReply":"...","nextAction":"one short internal action"}.\nTicket: ${JSON.stringify({subject:ticket.subject,customer:ticket.customer_name,body:ticket.body})}\nTriage: ${JSON.stringify(triage)}\nPolicy: ${JSON.stringify(policy)}\nKnowledge article: ${article?JSON.stringify({title:article.title,body:article.body}):'No matching article. Ask one clarifying question and offer to route to a specialist.'}`);
  draft=safeString(generated.draftReply,'Thanks for reaching out. We’re reviewing your request and will follow up shortly.',900);if(aiMode==='Gemini live')aiMode='Gemini + policy tools';
 }catch(error){console.warn('Response fallback:',error.message);draft=article?`Hi ${ticket.customer_name}, thanks for contacting us. ${article.body.split('. ')[0]}. I’ve prepared this for our ${triage.team} team to review. We’ll follow up with the next step shortly.`:`Hi ${ticket.customer_name}, thanks for reaching out. Could you share a little more detail so our ${triage.team} team can help? Please don’t include passwords or payment details.`;}
 events.push({agent:'Response Agent',status:'complete',title:'Reply draft prepared',detail:'Grounded in the matched help article and checked against support policy.'});
 return {triage,policy,article,events,draft,aiMode,nextAction:policy.requiresHumanReview?'Review the draft and route to a specialist before responding.':safeString((await Promise.resolve('Send the approved reply and monitor for a response.')), 'Review and send the reply.')};
}
