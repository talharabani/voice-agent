import { randomInt } from 'crypto';
import { safeEqual } from '@/lib/security';
import type { ClinicService, PublicDoctor } from '@/types/database';

/**
 * Normalize spoken or typed appointment reference numbers to canonical APT-YYYY-NNNNN format.
 * Handles variations like "apt 2026 125", "A P T 2026 00125", "APT-2026-00125", etc.
 */
export function normalizeReferenceCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  // Match "A P T 2026 00125" or "APT 2026 125"
  const fullMatch = /^(?:A\s*P\s*T)\s*(\d{4})\s*(\d{1,6})$/.exec(cleaned);
  if (fullMatch) {
    const year = fullMatch[1];
    const num = fullMatch[2].padStart(5, '0');
    return `APT-${year}-${num}`;
  }

  // Match compact "APT202600125"
  const compactMatch = /^APT(\d{4})(\d{1,6})$/.exec(cleaned.replace(/\s+/g, ''));
  if (compactMatch) {
    return `APT-${compactMatch[1]}-${compactMatch[2].padStart(5, '0')}`;
  }

  return null;
}

/**
 * Generate a human-friendly, verbally clear fallback reference code (APT-YYYY-NNNNN)
 * when the database trigger has not populated one yet.
 */
export function generateFallbackReferenceCode(now = new Date()): string {
  const year = now.getUTCFullYear();
  const num = randomInt(10000, 99999);
  return `APT-${year}-${String(num).padStart(5, '0')}`;
}

/**
 * Canonicalize a phone number into comparable digit form (Pakistan & international E.164).
 */
export function canonicalPhoneDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Normalize Pakistani local 03XXXXXXXXX -> 923XXXXXXXXX
  if (/^03\d{9}$/.test(digits)) {
    return `92${digits.slice(1)}`;
  }
  // Strip leading international 00 prefix (e.g. 0092... -> 92...)
  if (digits.startsWith('00') && digits.length > 10) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Verify caller identity before revealing or modifying an appointment.
 * Reference number alone is never sufficient; caller's registered phone must match.
 */
export function verifyCallerPhone(
  storedPhone: string | null | undefined,
  providedPhone: string | null | undefined
): boolean {
  const stored = canonicalPhoneDigits(storedPhone);
  const provided = canonicalPhoneDigits(providedPhone);
  if (!stored || !provided || stored.length < 7 || provided.length < 7) {
    return false;
  }
  if (safeEqual(stored, provided)) {
    return true;
  }
  // Allow last-10-digit match when one side includes country code and the other omits it
  if (stored.length >= 10 && provided.length >= 10) {
    return safeEqual(stored.slice(-10), provided.slice(-10));
  }
  return false;
}

function normalizeTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !['the', 'and', 'for', 'clinic', 'consultation', 'visit', 'checkup', 'treatment'].includes(w));
}

/**
 * Verify whether a clinic doctor offers the requested service or specialization.
 * Prevents assigning a doctor from an unrelated department (e.g., Dentist for Neurosurgery).
 */
export function doctorOffersService(
  doctor: PublicDoctor,
  serviceName: string | null | undefined,
  clinicServices: ClinicService[]
): { ok: true } | { ok: false; message: string } {
  const trimmed = (serviceName ?? '').trim();
  if (!trimmed || /^clinic (?:consultation|visit)$/i.test(trimmed)) {
    return { ok: true };
  }

  const lowerService = trimmed.toLowerCase();
  const matchedConfig = clinicServices.find(
    (s) =>
      s.name.toLowerCase() === lowerService ||
      s.name.toLowerCase().includes(lowerService) ||
      lowerService.includes(s.name.toLowerCase())
  );

  // If the service explicitly restricts eligible doctor_ids, enforce it strictly
  if (matchedConfig?.doctor_ids && matchedConfig.doctor_ids.length > 0) {
    if (matchedConfig.doctor_ids.includes(doctor.id)) {
      return { ok: true };
    }
    return {
      ok: false,
      message: `${doctor.name} (${doctor.specialty}) does not handle ${matchedConfig.name} at this clinic.`,
    };
  }

  // Build doctor's capability corpus strictly from their published clinic profile
  const docCorpus = [
    doctor.specialty,
    doctor.description,
    ...doctor.concern_keywords,
  ]
    .join(' ')
    .toLowerCase();

  const serviceTerms = normalizeTerms(
    [trimmed, matchedConfig?.category ?? '', matchedConfig?.description ?? ''].join(' ')
  );

  // Check stem/substring overlap (e.g. "dental"/"dentist", "skin"/"dermatol", "hair"/"prp", "neuro")
  const hasMatch = serviceTerms.some((term) => {
    const stem = term.length >= 5 ? term.slice(0, 5) : term;
    return docCorpus.includes(term) || docCorpus.includes(stem);
  });

  if (hasMatch || !serviceTerms.length) {
    return { ok: true };
  }

  // Allow common clinical synonym stems (dental<->dentist, skin<->dermatolog, teeth/tooth<->dent)
  const synonyms: Array<[RegExp, RegExp]> = [
    [/\b(dental|teeth|tooth|whiten|braces|root\s*canal|scaling)\b/i, /\b(dent|ortho|oral)\w*/i],
    [/\b(skin|acne|eczema|rash|pigment|laser|facial|aesthetic|prp|hair)\b/i, /\b(dermat|skin|aesthet|cosmet|hair)\w*/i],
    [/\b(brain|spine|nerve|neuro|headache|migraine)\b/i, /\b(neuro|spine)\w*/i],
    [/\b(heart|cardio|chest|bp|blood\s*pressure)\b/i, /\b(cardio|heart)\w*/i],
    [/\b(child|kid|baby|pediat|paediat)\b/i, /\b(pediat|paediat|child)\w*/i],
    [/\b(eye|vision|cataract|ophthalm)\b/i, /\b(ophthalm|eye|optom)\w*/i],
    [/\b(bone|joint|knee|fracture|orthop)\b/i, /\b(orthop|bone|joint)\w*/i],
  ];

  for (const [svcRe, docRe] of synonyms) {
    if (svcRe.test(trimmed) && docRe.test(docCorpus)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    message: `${doctor.name} is a ${doctor.specialty} specialist and does not offer ${trimmed} at this clinic.`,
  };
}
