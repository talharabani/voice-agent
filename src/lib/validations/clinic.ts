import { z } from 'zod';

export const clinicSchema = z.object({
  clinic_name: z.string().trim().min(2).max(160),
  address: z.string().trim().min(5).max(500),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use an international number, for example +923001234567'),
  opening_hours: z.string().trim().min(3).max(500),
  timezone: z.string().trim().max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Enter a valid timezone, for example Asia/Karachi'),
});
