-- Run after schema.sql, 002_appointments.sql and 005_clinic_whatsapp.sql.
create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  specialty text not null,
  qualifications text not null default '',
  experience_years integer not null default 0 check (experience_years between 0 and 80),
  description text not null default '',
  photo_url text,
  availability text not null default '',
  languages text[] not null default '{}',
  concern_keywords text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists doctors_user_id_idx on public.doctors(user_id);
alter table public.doctors enable row level security;
-- Service-role server access only. No browser policies.
alter table public.appointments add column if not exists requested_doctor text;
alter table public.appointments add column if not exists patient_concern text;
alter table public.appointments add column if not exists call_summary text;
alter table public.appointments add column if not exists doctor_id uuid references public.doctors(id) on delete set null;
alter table public.appointments add column if not exists doctor_name text;
