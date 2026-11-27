-- ============================================================
-- Appointment Reference IDs (APT-YYYY-NNNNN), expanded lifecycle
-- statuses, and append-only modification_history audit log.
-- Run in Supabase SQL Editor after 008_multitenant_clinic_config.sql.
-- Safe and idempotent to re-run.
-- ============================================================

create sequence if not exists public.appointments_ref_seq start with 100 increment by 1;

alter table public.appointments
  add column if not exists reference_code text,
  add column if not exists modification_history jsonb not null default '[]'::jsonb;

create or replace function public.assign_appointment_reference_code()
returns trigger
language plpgsql
as $$
declare
  yr text;
  seq_num bigint;
begin
  if new.reference_code is null or btrim(new.reference_code) = '' then
    yr := to_char(coalesce(new.created_at, now()) at time zone 'UTC', 'YYYY');
    seq_num := nextval('public.appointments_ref_seq');
    new.reference_code := 'APT-' || yr || '-' || lpad(seq_num::text, 5, '0');
  else
    new.reference_code := upper(btrim(new.reference_code));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_assign_ref_code on public.appointments;
create trigger trg_appointments_assign_ref_code
  before insert on public.appointments
  for each row
  execute function public.assign_appointment_reference_code();

-- Backfill any pre-existing appointments that do not yet have a reference code
update public.appointments
set reference_code =
  'APT-' || to_char(coalesce(created_at, now()) at time zone 'UTC', 'YYYY') || '-' ||
  lpad(nextval('public.appointments_ref_seq')::text, 5, '0')
where reference_code is null or btrim(reference_code) = '';

create unique index if not exists appointments_reference_code_idx
  on public.appointments(reference_code)
  where reference_code is not null;

-- Expand status check constraint to support full appointment lifecycle
-- (keeps 'requested' backward-compatible alongside pending/confirmed/rescheduled/completed/cancelled)
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.appointments drop constraint if exists %I', c.conname);
  end loop;

  alter table public.appointments
    add constraint appointments_status_check
    check (status in ('requested', 'pending', 'confirmed', 'rescheduled', 'completed', 'cancelled'));
end $$;
