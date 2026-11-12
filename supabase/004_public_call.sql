-- ============================================================
-- Public web-call links — run in Supabase SQL Editor
-- ============================================================

alter table public.agents
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists agents_share_token_idx
  on public.agents(share_token);
