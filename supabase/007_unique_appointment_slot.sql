-- Prevent concurrent or duplicate active bookings for the same doctor and time
-- within a clinic (tenant-scoped by user_id).
-- Uses doctor_id when linked, falling back to lower(requested_doctor).
DROP INDEX IF EXISTS appointments_unique_active_slot_idx;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_unique_active_slot_idx
  ON appointments (user_id, COALESCE(doctor_id::text, lower(requested_doctor)), requested_time)
  WHERE status <> 'cancelled'
    AND requested_time IS NOT NULL
    AND (doctor_id IS NOT NULL OR requested_doctor IS NOT NULL);
