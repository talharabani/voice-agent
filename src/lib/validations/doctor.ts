import { z } from 'zod';
const terms = z.array(z.string().trim().min(1).max(80)).max(30);
export const doctorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  specialty: z.string().trim().min(2).max(160),
  qualifications: z.string().trim().max(500).default(''),
  experience_years: z.number().int().min(0).max(80).default(0),
  description: z.string().trim().max(2000).default(''),
  photo_url: z.string().url().max(2000).refine(value => value.startsWith('https://'), 'Use an HTTPS photo URL').nullable().optional(),
  availability: z.string().trim().max(500).default(''),
  languages: terms.default([]),
  concern_keywords: terms.default([]),
  is_active: z.boolean().default(true),
});
