-- ============================================================
-- Phone numbers — run in Supabase SQL Editor (New query -> Run)
-- ============================================================

create table if not exists public.phone_numbers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  agent_id     uuid references public.agents(id) on delete set null,
  phone_number text not null unique,     -- E.164, e.g. +14155550123
  provider     text not null default 'twilio',
  created_at   timestamptz not null default now()
);

create index if not exists phone_numbers_user_id_idx on public.phone_numbers(user_id);
create index if not exists phone_numbers_number_idx  on public.phone_numbers(phone_number);

alter table public.phone_numbers enable row level security;
