import { z } from 'zod';

const INTERNATIONAL_PHONE = /^\+[1-9]\d{7,14}$/;

function isSafeHttpsWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const clinicServiceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(100).default(''),
  description: z.string().trim().max(600).default(''),
  fee: z.string().trim().max(80).default(''),
  duration_minutes: z.number().int().min(5).max(180).nullable().optional().default(null),
  doctor_ids: z.array(z.string().uuid()).max(50).optional().default([]),
});

export const clinicSchema = z.object({
  clinic_name: z.string().trim().min(2).max(160),
  address: z.string().trim().min(5).max(500),
  phone: z.string().trim().regex(INTERNATIONAL_PHONE, 'Use an international number, for example +923001234567'),
  opening_hours: z.string().trim().min(3).max(500),
  timezone: z.string().trim().max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Enter a valid timezone, for example Asia/Karachi'),
  services: z.array(clinicServiceSchema).max(60).optional().default([]),
  default_slot_minutes: z.number().int().min(5).max(180).optional().default(30),
  off_days: z.string().trim().max(240).optional().default(''),
  booking_rules: z.string().trim().max(2000).optional().default(''),
  custom_instructions: z.string().trim().max(2000).optional().default(''),
  staff_notify_phone: z
    .string()
    .trim()
    .transform(v => v || null)
    .nullable()
    .optional()
    .refine(v => !v || INTERNATIONAL_PHONE.test(v), 'Use an international staff number, for example +923001234567'),
  staff_webhook_url: z
    .string()
    .trim()
    .transform(v => v || null)
    .nullable()
    .optional()
    .refine(v => !v || isSafeHttpsWebhook(v), 'Enter a valid public HTTPS webhook URL'),
});
