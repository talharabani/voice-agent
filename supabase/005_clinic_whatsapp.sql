-- Run in Supabase SQL Editor after schema.sql and 002_appointments.sql.
create table if not exists public.clinic_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  clinic_name text not null,
  address text not null,
  phone text not null,
  opening_hours text not null,
  timezone text not null default 'Asia/Karachi',
  updated_at timestamptz not null default now()
);
alter table public.clinic_profiles enable row level security;
-- Server-only access with the service role, matching the other app tables.
alter table public.appointments add column if not exists whatsapp_consent boolean not null default false;
alter table public.appointments add column if not exists whatsapp_status text not null default 'not_sent';
alter table public.appointments add column if not exists whatsapp_message_id text;
alter table public.appointments add column if not exists whatsapp_error text;
alter table public.appointments add column if not exists whatsapp_sent_at timestamptz;
create unique index if not exists appointments_whatsapp_message_id_idx
  on public.appointments(whatsapp_message_id) where whatsapp_message_id is not null;
