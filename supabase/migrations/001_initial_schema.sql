create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  subject text not null,
  customer_name text not null,
  customer_email text,
  body text not null,
  channel text not null default 'Email',
  category text not null default 'Untriaged',
  priority text not null default 'Normal',
  sentiment text not null default 'Neutral',
  team text not null default 'Support',
  status text not null default 'New',
  draft_reply text,
  knowledge_source text,
  risk_level text not null default 'Low',
  requires_human_review boolean not null default true,
  confidence numeric(4,3),
  agent_steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_updated_idx on public.support_tickets(user_id, updated_at desc);
create index if not exists support_tickets_user_status_idx on public.support_tickets(user_id, status);

alter table public.app_users enable row level security;
alter table public.support_tickets enable row level security;
