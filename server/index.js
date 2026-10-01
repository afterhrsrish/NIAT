import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createClient} from '@supabase/supabase-js';
import {processTicket,KNOWLEDGE} from './agents.js';

const app=express();
const port=process.env.PORT||4000;
const jwtSecret=process.env.JWT_SECRET;
if(process.env.NODE_ENV==='production'&&!jwtSecret)throw new Error('JWT_SECRET must be set in production');
const secret=jwtSecret||'local-only-change-this-secret';
const supabaseUrl=process.env.SUPABASE_URL;
const supabaseKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const db=supabaseUrl&&supabaseKey?createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const origins=(process.env.FRONTEND_URL||'http://localhost:5173').split(',').map(v=>v.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>!origin||origins.includes('*')||origins.includes(origin)?cb(null,true):cb(new Error('Origin is not allowed by CORS'))}));
app.use(express.json({limit:'256kb'}));

const credentials=z.object({email:z.string().email().max(180),password:z.string().min(8).max(100)});
const registerSchema=credentials.extend({name:z.string().min(2).max(70)});
const ticketSchema=z.object({subject:z.string().min(4).max(120),customerName:z.string().min(2).max(80),customerEmail:z.string().email().max(180).optional().or(z.literal('')),channel:z.enum(['Email','Chat','Web form']).default('Email'),body:z.string().min(12).max(3000)});
const statusSchema=z.object({status:z.enum(['New','Needs review','Assigned','Resolved']),team:z.string().min(2).max(60).optional()});
const publicUser=row=>({id:row.id,name:row.name,email:row.email});
function makeToken(user){return jwt.sign({sub:user.id,email:user.email,name:user.name},secret,{expiresIn:'12h'})}
function auth(req,res,next){try{const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const payload=jwt.verify(token,secret);req.user={id:payload.sub,email:payload.email,name:payload.name};next()}catch{return res.status(401).json({error:'Please sign in again.'})}}
function requireDb(req,res,next){if(!db)return res.status(503).json({error:'Database is not configured. Add the Supabase backend settings, then restart the API.'});next()}
function invalid(res,result){return res.status(400).json({error:result.error.issues[0].message})}

app.get('/api/health',(_,res)=>res.json({ok:true,databaseConfigured:Boolean(db),aiConfigured:Boolean(process.env.GEMINI_API_KEY)}));
app.get('/api/knowledge',(_,res)=>res.json(KNOWLEDGE.map(({id,title,tags})=>({id,title,tags}))));
app.post('/api/auth/register',requireDb,async(req,res)=>{
 const parsed=registerSchema.safeParse(req.body);if(!parsed.success)return invalid(res,parsed);
 const {name,email,password}=parsed.data;const normalized=email.toLowerCase();
 try{const passwordHash=await bcrypt.hash(password,12);const {data,error}=await db.from('app_users').insert({name,email:normalized,password_hash:passwordHash}).select('id,name,email').single();if(error)throw error;const user=publicUser(data);res.status(201).json({token:makeToken(user),user})}
 catch(error){if(String(error.code)==='23505')return res.status(409).json({error:'An account with this email already exists.'});console.error('Register error',error.message);res.status(500).json({error:'Could not create account. Check the Supabase tables and try again.'})}
});
app.post('/api/auth/login',requireDb,async(req,res)=>{
 const parsed=credentials.safeParse(req.body);if(!parsed.success)return invalid(res,parsed);
 try{const {data,error}=await db.from('app_users').select('id,name,email,password_hash').eq('email',parsed.data.email.toLowerCase()).maybeSingle();if(error)throw error;if(!data||!await bcrypt.compare(parsed.data.password,data.password_hash))return res.status(401).json({error:'Email or password is incorrect.'});const user=publicUser(data);res.json({token:makeToken(user),user})}
 catch(error){console.error('Login error',error.message);res.status(500).json({error:'Could not sign in. Check the Supabase tables and try again.'})}
});
app.post('/api/auth/demo',requireDb,async(req,res)=>{
 if(process.env.DEMO_MODE!=='true')return res.status(404).json({error:'Demo sign-in is disabled.'});
 const email='demo@signaldesk.local';
 try{let {data,error}=await db.from('app_users').select('id,name,email').eq('email',email).maybeSingle();if(error)throw error;if(!data){const passwordHash=await bcrypt.hash(`demo-${randomUUID()}-${Date.now()}`,12);const created=await db.from('app_users').insert({name:'Alex Morgan',email,password_hash:passwordHash}).select('id,name,email').single();if(created.error)throw created.error;data=created.data}const user=publicUser(data);res.json({token:makeToken(user),user})}
 catch(error){console.error('Demo sign-in error',error.message);res.status(500).json({error:'Demo sign-in could not start. Check the database setup.'})}
});
app.get('/api/tickets',auth,requireDb,async(req,res)=>{
 try{const {data,error}=await db.from('support_tickets').select('*').eq('user_id',req.user.id).order('updated_at',{ascending:false}).limit(100);if(error)throw error;res.json(data||[])}catch(error){console.error('List tickets',error.message);res.status(500).json({error:'Could not load the ticket queue.'})}
});
app.post('/api/tickets/seed',auth,requireDb,async(req,res)=>{
 try{
  const existing=await db.from('support_tickets').select('id').eq('user_id',req.user.id).limit(1);if(existing.error)throw existing.error;if(existing.data?.length)return res.json({seeded:0});
  const samples=[
   {subject:'Charged twice for my monthly plan',customer_name:'Taylor Kim',customer_email:'taylor@example.com',body:'I see two charges for the same monthly plan on my card today. Could you check whether one is a duplicate? I can share the transaction date, but I will not send full card details here.',channel:'Email',category:'Billing',priority:'High',sentiment:'Frustrated',team:'Billing',status:'Needs review',draft_reply:'Hi Taylor, thanks for flagging this. Please share the transaction date and the last four digits only—never your full card number or CVV. Our Billing team will verify whether one charge is a duplicate authorization.',knowledge_source:'KB-101',risk_level:'Medium',requires_human_review:true,confidence:.94,agent_steps:[{agent:'Triage Agent',status:'complete',title:'Billing · High priority',detail:'Duplicate charge concern with frustrated sentiment. Confidence: 94%.'},{agent:'Knowledge Agent',status:'complete',title:'Matched KB-101',detail:'Grounded next steps in “Duplicate or unexpected card charge”.'},{agent:'Policy Agent',status:'complete',title:'Medium risk · Human review required',detail:'Financial action requires billing review.'},{agent:'Response Agent',status:'complete',title:'Reply draft prepared',detail:'Draft avoids requesting full payment credentials.'}]},
   {subject:'Locked out after password reset',customer_name:'Morgan Patel',customer_email:'morgan@example.com',body:'I requested a password reset twice but the email never arrived. I have a presentation in an hour and cannot get into my account. Please help me regain access.',channel:'Web form',category:'Account access',priority:'High',sentiment:'Frustrated',team:'Account Support',status:'Needs review',draft_reply:'Hi Morgan, I’m sorry the reset email hasn’t arrived. Please check your spam folder and wait 10 minutes. Never share your password or one-time code here. I’ve routed this to Account Support for the secure recovery process.',knowledge_source:'KB-102',risk_level:'High',requires_human_review:true,confidence:.91,agent_steps:[{agent:'Triage Agent',status:'complete',title:'Account access · High priority',detail:'Password reset issue with an urgent deadline. Confidence: 91%.'},{agent:'Knowledge Agent',status:'complete',title:'Matched KB-102',detail:'Grounded next steps in “Reset a password and recover an account”.'},{agent:'Policy Agent',status:'complete',title:'High risk · Human review required',detail:'Account recovery must use the secure support process.'},{agent:'Response Agent',status:'complete',title:'Reply draft prepared',detail:'Draft explicitly warns against sharing passwords or one-time codes.'}]},
   {subject:'Is the service currently unavailable?',customer_name:'Jamie Brooks',customer_email:'jamie@example.com',body:'Our team has been seeing repeated errors for the last 20 minutes. Is there an outage? We have 12 people blocked from finishing their work.',channel:'Chat',category:'Technical issue',priority:'High',sentiment:'Frustrated',team:'Technical Support',status:'Assigned',draft_reply:'Hi Jamie, thanks for letting us know. We’re checking this with Technical Support. Please see our public status page for confirmed incident updates; we won’t guess at a restoration time. I’ve flagged the impact for review.',knowledge_source:'KB-103',risk_level:'Medium',requires_human_review:true,confidence:.89,agent_steps:[{agent:'Triage Agent',status:'complete',title:'Technical issue · High priority',detail:'Multiple users blocked by repeated errors. Confidence: 89%.'},{agent:'Knowledge Agent',status:'complete',title:'Matched KB-103',detail:'Grounded next steps in “Service availability and outages”.'},{agent:'Policy Agent',status:'complete',title:'Medium risk · Human review required',detail:'Potential incident impact; verify status and escalate.'},{agent:'Response Agent',status:'complete',title:'Reply draft prepared',detail:'No unsupported restoration promise included.'}]}
  ];
  const rows=samples.map(({...row})=>({...row,user_id:req.user.id}));const result=await db.from('support_tickets').insert(rows).select('*');if(result.error)throw result.error;res.status(201).json({seeded:result.data?.length||0});
 }catch(error){console.error('Seed tickets',error.message);res.status(500).json({error:'Could not load sample tickets. Check the Supabase migration.'})}
});
app.post('/api/tickets',auth,requireDb,async(req,res)=>{
 const parsed=ticketSchema.safeParse(req.body);if(!parsed.success)return invalid(res,parsed);
 try{const input=parsed.data;const created=await db.from('support_tickets').insert({user_id:req.user.id,subject:input.subject,customer_name:input.customerName,customer_email:input.customerEmail||null,body:input.body,channel:input.channel,status:'New'}).select('*').single();if(created.error)throw created.error;
  const result=await processTicket(created.data);const update=await db.from('support_tickets').update({category:result.triage.category,priority:result.triage.priority,sentiment:result.triage.sentiment,team:result.triage.team,status:result.policy.requiresHumanReview?'Needs review':'Assigned',draft_reply:result.draft,knowledge_source:result.article?.id||null,risk_level:result.policy.risk,requires_human_review:result.policy.requiresHumanReview,confidence:Number(result.triage.confidence)||null,agent_steps:result.events,updated_at:new Date().toISOString()}).eq('id',created.data.id).eq('user_id',req.user.id).select('*').single();if(update.error)throw update.error;
  res.status(201).json({...update.data,agent_mode:result.aiMode,next_action:result.nextAction,policy_flags:result.policy.flags,knowledge_article:result.article?{id:result.article.id,title:result.article.title,body:result.article.body}:null});
 }catch(error){console.error('Create/triage ticket',error.message);res.status(500).json({error:'The ticket could not be triaged. Check API and database settings.'})}
});
app.patch('/api/tickets/:id',auth,requireDb,async(req,res)=>{
 const parsed=statusSchema.safeParse(req.body);if(!parsed.success)return invalid(res,parsed);
 try{const fields={status:parsed.data.status,updated_at:new Date().toISOString()};if(parsed.data.team)fields.team=parsed.data.team;const {data,error}=await db.from('support_tickets').update(fields).eq('id',req.params.id).eq('user_id',req.user.id).select('*').maybeSingle();if(error)throw error;if(!data)return res.status(404).json({error:'Ticket not found.'});res.json(data)}catch(error){console.error('Update ticket',error.message);res.status(500).json({error:'Could not update the ticket.'})}
});
app.delete('/api/tickets/:id',auth,requireDb,async(req,res)=>{
 try{const {error,count}=await db.from('support_tickets').delete({count:'exact'}).eq('id',req.params.id).eq('user_id',req.user.id);if(error)throw error;if(!count)return res.status(404).json({error:'Ticket not found.'});res.json({ok:true})}catch(error){console.error('Delete ticket',error.message);res.status(500).json({error:'Could not remove the ticket.'})}
});
app.use((error,req,res,next)=>{console.error(error.message);res.status(500).json({error:'Unexpected server error.'})});
app.listen(port,'0.0.0.0',()=>console.log(`SignalDesk API listening on ${port}`));
