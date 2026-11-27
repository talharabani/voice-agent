-- ============================================================
-- Multi-tenant clinic services, doctor fees/durations, booking rules,
-- custom AI instructions, and staff notification channels.
-- Run in Supabase SQL Editor after 006_doctor_directory.sql & 007_unique_appointment_slot.sql.
-- Safe and idempotent to re-run.
-- ============================================================

alter table public.clinic_profiles
  add column if not exists services jsonb not null default '[]'::jsonb,
  add column if not exists default_slot_minutes integer not null default 30,
  add column if not exists off_days text not null default '',
  add column if not exists booking_rules text not null default '',
  add column if not exists custom_instructions text not null default '',
  add column if not exists staff_notify_phone text,
  add column if not exists staff_webhook_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clinic_profiles_default_slot_minutes_check'
  ) then
    alter table public.clinic_profiles
      add constraint clinic_profiles_default_slot_minutes_check
      check (default_slot_minutes between 5 and 180);
  end if;
end $$;

alter table public.doctors
  add column if not exists consultation_fee text not null default '',
  add column if not exists slot_duration_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'doctors_slot_duration_minutes_check'
  ) then
    alter table public.doctors
      add constraint doctors_slot_duration_minutes_check
      check (slot_duration_minutes is null or slot_duration_minutes between 5 and 180);
  end if;
end $$;
