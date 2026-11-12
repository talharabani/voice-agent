-- ============================================================
-- VOXA AI (Voicewave) — Database schema
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- users ----------
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  clerk_id    text not null unique,
  email       text not null,
  name        text,
  plan        text not null default 'free',
  created_at  timestamptz not null default now()
);

-- ---------- agents ----------
create table if not exists public.agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  name          text not null,
  description   text,
  system_prompt text,
  voice         text not null default 'default',
  language      text not null default 'en',
  greeting      text,
  is_active     boolean not null default true,
  business_type text,
  timezone      text not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists agents_user_id_idx on public.agents(user_id);

-- ---------- conversations ----------
create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  call_sid         text,
  agent_id         uuid not null references public.agents(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  transcript       jsonb not null default '[]'::jsonb,
  duration_seconds integer,
  sentiment        text check (sentiment in ('positive','neutral','negative')),
  lead_score       integer not null default 0,
  intent           text,
  status           text not null default 'completed',
  created_at       timestamptz not null default now()
);
create index if not exists conversations_user_id_idx on public.conversations(user_id);
create index if not exists conversations_agent_id_idx on public.conversations(agent_id);
create index if not exists conversations_created_at_idx on public.conversations(created_at desc);

-- ---------- leads ----------
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  agent_id        uuid not null references public.agents(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  name            text,
  email           text,
  phone           text,
  tags            text[] not null default '{}',
  status          text not null default 'new',
  notes           text,
  lead_score      integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists leads_user_id_idx on public.leads(user_id);
create index if not exists leads_agent_id_idx on public.leads(agent_id);

-- ---------- knowledge_docs ----------
create table if not exists public.knowledge_docs (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  type       text not null check (type in ('pdf','docx','txt','url','faq','note')),
  name       text not null,
  content    text,
  url        text,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_docs_agent_id_idx on public.knowledge_docs(agent_id);

-- ============================================================
-- SECURITY: Row Level Security ON, with NO policies.
-- The app talks to the DB only from the server using the
-- service_role key (which bypasses RLS). The public anon key
-- therefore can read/write NOTHING. 
-- ============================================================
alter table public.users          enable row level security;
alter table public.agents         enable row level security;
alter table public.conversations  enable row level security;
alter table public.leads          enable row level security;
alter table public.knowledge_docs enable row level security;
