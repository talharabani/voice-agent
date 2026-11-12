-- ============================================================
-- Appointments — run in Supabase SQL Editor (New query -> Run)
-- ============================================================

create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  agent_id        uuid not null references public.agents(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  customer_name   text,
  customer_phone  text,
  customer_email  text,
  service         text,
  requested_time  text,         -- what the caller actually said ("tomorrow at 5 pm")
  scheduled_at    timestamptz,  -- confirmed slot, set by the business
  status          text not null default 'requested'
                  check (status in ('requested','confirmed','completed','cancelled')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists appointments_user_id_idx  on public.appointments(user_id);
create index if not exists appointments_agent_id_idx on public.appointments(agent_id);
create index if not exists appointments_status_idx   on public.appointments(status);

-- Same lockdown as the rest: RLS on, no policies, server-only access.
alter table public.appointments enable row level security;
