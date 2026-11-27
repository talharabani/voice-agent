import type { ClinicProfileRow, ClinicService, PublicDoctor } from '@/types/database';

const DEFAULT_SLOT_MINUTES = Math.min(180, Math.max(5, Number(process.env.CLINIC_SLOT_MINUTES || 30)));
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function getSlotMinutes(): number {
  return DEFAULT_SLOT_MINUTES;
}

export function resolveSlotDurationMinutes({
  service,
  doctor,
  clinic,
}: {
  service?: ClinicService | null;
  doctor?: PublicDoctor | null;
  clinic?: ClinicProfileRow | null;
}): number {
  const candidate =
    service?.duration_minutes ??
    doctor?.slot_duration_minutes ??
    clinic?.default_slot_minutes ??
    DEFAULT_SLOT_MINUTES;
  return Math.min(180, Math.max(5, Number(candidate) || DEFAULT_SLOT_MINUTES));
}

function normalizeTextKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchClinicService(
  inputService: string | null | undefined,
  services: ClinicService[],
  doctors: PublicDoctor[]
): { ok: true; service: ClinicService | null; label: string | null } | { ok: false; message: string } {
  const trimmed = (inputService ?? '').trim();
  if (!trimmed) {
    return { ok: true, service: null, label: null };
  }

  // If the clinic has not defined explicit services yet, allow any request that matches doctor specialties or pass through cleanly
  if (!services.length) {
    return { ok: true, service: null, label: trimmed };
  }

  const target = normalizeTextKey(trimmed);
  if (!target) {
    return { ok: true, service: null, label: null };
  }

  const exact = services.find(
    (s) => normalizeTextKey(s.name) === target || (s.category && normalizeTextKey(s.category) === target)
  );
  if (exact) return { ok: true, service: exact, label: exact.name };

  const partial = services.find((s) => {
    const nameKey = normalizeTextKey(s.name);
    const catKey = normalizeTextKey(s.category);
    const descKey = normalizeTextKey(s.description);
    return (
      (nameKey && (nameKey.includes(target) || target.includes(nameKey))) ||
      (catKey && (catKey.includes(target) || target.includes(catKey))) ||
      (descKey && descKey.includes(target))
    );
  });
  if (partial) return { ok: true, service: partial, label: partial.name };

  // Also allow matching against an active doctor's published specialty or concern keywords within this clinic
  const doctorSpecialtyMatch = doctors.find((d) => {
    const specKey = normalizeTextKey(d.specialty);
    return (
      (specKey && (specKey.includes(target) || target.includes(specKey))) ||
      d.concern_keywords.some((kw) => {
        const kwKey = normalizeTextKey(kw);
        return kwKey && (kwKey.includes(target) || target.includes(kwKey));
      })
    );
  });
  if (doctorSpecialtyMatch) {
    return { ok: true, service: null, label: trimmed };
  }

  const offered = services.map((s) => s.name).join(', ');
  return {
    ok: false,
    message: `We do not offer ${trimmed} at this clinic. Our available services are: ${offered}.`,
  };
}

function normalizeDoctorKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^dr\.?\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchClinicDoctor(
  inputDoctor: string,
  doctors: PublicDoctor[]
): { ok: true; doctor: PublicDoctor | null } | { ok: false; message: string } {
  if (!doctors.length) {
    return { ok: true, doctor: null };
  }
  const target = normalizeDoctorKey(inputDoctor);
  if (!target) {
    return {
      ok: false,
      message: `Please specify a doctor. Our available doctors are ${doctors.map((d) => d.name).join(', ')}.`,
    };
  }

  const exact = doctors.find((d) => normalizeDoctorKey(d.name) === target);
  if (exact) return { ok: true, doctor: exact };

  const partial = doctors.filter((d) => {
    const key = normalizeDoctorKey(d.name);
    return key.includes(target) || target.includes(key);
  });
  if (partial.length === 1) return { ok: true, doctor: partial[0] };

  return {
    ok: false,
    message: `I couldn't find ${inputDoctor}. Our available doctors are ${doctors.map((d) => d.name).join(', ')}.`,
  };
}

export function parseWorkingHours(text: string | null | undefined): { openMinutes: number; closeMinutes: number } {
  const match = text?.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return { openMinutes: 9 * 60, closeMinutes: 21 * 60 };

  let openH = Number(match[1]);
  const openM = Number(match[2] ?? 0);
  const openMeridiem = match[3]?.toLowerCase();

  let closeH = Number(match[4]);
  const closeM = Number(match[5] ?? 0);
  const closeMeridiem = match[6]?.toLowerCase();

  if (openMeridiem === 'pm' && openH < 12) openH += 12;
  if (openMeridiem === 'am' && openH === 12) openH = 0;

  if (closeMeridiem === 'pm' && closeH < 12) closeH += 12;
  else if (closeMeridiem === 'am' && closeH === 12) closeH = 0;
  else if (!closeMeridiem && closeH <= openH && closeH < 12) closeH += 12;

  const openMinutes = Math.min(23 * 60 + 59, Math.max(0, openH * 60 + openM));
  const closeMinutes = Math.min(24 * 60, Math.max(openMinutes + 30, closeH * 60 + closeM));
  return { openMinutes, closeMinutes };
}

function isWeekdayClosed(weekday: typeof WEEKDAYS[number], scheduleText: string | null | undefined): boolean {
  if (!scheduleText) return false;
  const lower = scheduleText.toLowerCase();
  if (weekday === 'sun' && /\b(?:mon\s*[-to]+\s*sat|sunday\s+(?:off|closed)|closed\s+(?:on\s+)?sunday)\b/i.test(lower)) {
    return true;
  }
  const explicitClosed = new RegExp(`\\b${weekday}[a-z]*\\s*(?:off|closed)\\b|\\b(?:off|closed)\\s*(?:on\\s+)?${weekday}[a-z]*\\b`, 'i');
  return explicitClosed.test(lower);
}

/**
 * Convert a wall-clock YYYY-MM-DD HH:MM in an IANA timezone to a UTC Date.
 */
export function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date | null {
  const dMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tMatch = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dMatch || !tMatch) return null;

  const year = Number(dMatch[1]);
  const month = Number(dMatch[2]);
  const day = Number(dMatch[3]);
  const hour = Number(tMatch[1]);
  const minute = Number(tMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (utcGuess.getUTCFullYear() !== year || utcGuess.getUTCMonth() !== month - 1 || utcGuess.getUTCDate() !== day) {
    return null;
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(utcGuess);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const tzAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    const offsetMs = tzAsUtc - utcGuess.getTime();
    return new Date(utcGuess.getTime() - offsetMs);
  } catch {
    return utcGuess;
  }
}

export type SlotValidationResult =
  | { ok: true; normalizedTime: string; scheduledAtIso: string; slotStartMs: number; slotMinutes: number }
  | { ok: false; message: string };

export function validateSlotRequest({
  date,
  time,
  timezone,
  clinicHours,
  offDays,
  doctorAvailability,
  slotMinutes = DEFAULT_SLOT_MINUTES,
}: {
  date: string;
  time: string;
  timezone: string;
  clinicHours?: string | null;
  offDays?: string | null;
  doctorAvailability?: string | null;
  slotMinutes?: number;
}): SlotValidationResult {
  const scheduledUtc = zonedDateTimeToUtc(date.trim(), time.trim(), timezone);
  if (!scheduledUtc) {
    return {
      ok: false,
      message: 'Please provide a valid date in YYYY-MM-DD format and time in 24-hour HH:MM format.',
    };
  }

  if (scheduledUtc.getTime() <= Date.now()) {
    return {
      ok: false,
      message: 'That date and time is in the past. Please choose an upcoming time.',
    };
  }

  const weekdayIndex = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();
  const weekday = WEEKDAYS[weekdayIndex];
  const offDayMatch = Boolean(offDays && new RegExp(`\\b${weekday}[a-z]*\\b`, 'i').test(offDays));
  if (offDayMatch || isWeekdayClosed(weekday, clinicHours) || isWeekdayClosed(weekday, doctorAvailability)) {
    return {
      ok: false,
      message: 'The clinic or doctor is closed on that day. Please pick another day.',
    };
  }

  const [hh, mm] = time.trim().split(':').map(Number);
  const totalMinutes = hh * 60 + mm;
  const { openMinutes, closeMinutes } = parseWorkingHours(doctorAvailability || clinicHours);
  if (totalMinutes < openMinutes || totalMinutes + slotMinutes > closeMinutes) {
    const openStr = `${String(Math.floor(openMinutes / 60)).padStart(2, '0')}:${String(openMinutes % 60).padStart(2, '0')}`;
    const closeStr = `${String(Math.floor(closeMinutes / 60)).padStart(2, '0')}:${String(closeMinutes % 60).padStart(2, '0')}`;
    return {
      ok: false,
      message: `That time is outside working hours (${openStr} to ${closeStr}). Please choose a time within working hours.`,
    };
  }

  if (totalMinutes % slotMinutes !== 0) {
    const rounded = Math.round(totalMinutes / slotMinutes) * slotMinutes;
    const clamped = Math.min(closeMinutes - slotMinutes, Math.max(openMinutes, rounded));
    const suggested = `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
    return {
      ok: false,
      message: `Appointments are booked in ${slotMinutes}-minute slots. Would ${suggested} work for you?`,
    };
  }

  return {
    ok: true,
    normalizedTime: `${date.trim()} ${time.trim()}`,
    scheduledAtIso: scheduledUtc.toISOString(),
    slotStartMs: scheduledUtc.getTime(),
    slotMinutes,
  };
}

export function checkSlotOverlap(
  existingRows: Array<{ scheduled_at: string | null; requested_time: string | null }>,
  targetStartMs: number,
  slotMinutes: number,
  timezone: string
): boolean {
  const windowMs = slotMinutes * 60_000;
  for (const row of existingRows) {
    let existingMs: number | null = null;
    if (row.scheduled_at) {
      const parsed = Date.parse(row.scheduled_at);
      if (!Number.isNaN(parsed)) existingMs = parsed;
    } else if (row.requested_time) {
      const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(row.requested_time.trim());
      if (m) {
        const dt = zonedDateTimeToUtc(m[1], m[2], timezone);
        if (dt) existingMs = dt.getTime();
      }
    }
    if (existingMs !== null && Math.abs(existingMs - targetStartMs) < windowMs) {
      return true;
    }
  }
  return false;
}

export function normalizeFreeTextRequestedTime(rawTime: string | null, timezone: string): string | null {
  if (!rawTime) return null;
  const trimmed = rawTime.trim();
  const isoMatch = /^(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[1]} ${isoMatch[2].padStart(2, '0')}:${isoMatch[3]}`;
  }

  const timeMatch = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(trimmed);
  if (!timeMatch) return trimmed;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? 0);
  const meridiem = timeMatch[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  else if (meridiem === 'am' && hour === 12) hour = 0;
  else if (!meridiem && hour >= 1 && hour <= 7 && /evening|shaam|شام/i.test(trimmed)) hour += 12;
  if (hour > 23 || minute > 59) return trimmed;

  const baseDate = new Date();
  if (/tomorrow|kal|کل/i.test(trimmed)) {
    baseDate.setUTCDate(baseDate.getUTCDate() + 1);
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(baseDate);
    return `${parts} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  } catch {
    return trimmed;
  }
}
