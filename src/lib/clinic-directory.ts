import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ClinicProfileRow, ClinicService, DoctorRow, PublicDoctor } from '@/types/database';

export type ClinicDirectory = {
  clinic: ClinicProfileRow | null;
  doctors: PublicDoctor[];
  services: ClinicService[];
  available: boolean;
};

export function parseClinicServices(raw: unknown): ClinicService[] {
  if (!Array.isArray(raw)) return [];
  const out: ClinicService[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) continue;
    const duration =
      typeof obj.duration_minutes === 'number' &&
      Number.isInteger(obj.duration_minutes) &&
      obj.duration_minutes >= 5 &&
      obj.duration_minutes <= 180
        ? obj.duration_minutes
        : null;
    out.push({
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      category: typeof obj.category === 'string' ? obj.category.trim() : '',
      description: typeof obj.description === 'string' ? obj.description.trim() : '',
      fee: typeof obj.fee === 'string' ? obj.fee.trim() : '',
      duration_minutes: duration,
      doctor_ids: Array.isArray(obj.doctor_ids)
        ? obj.doctor_ids.filter((id): id is string => typeof id === 'string')
        : [],
    });
  }
  return out;
}

export function publicDoctor(doctor: DoctorRow): PublicDoctor {
  const {
    id,
    name,
    specialty,
    qualifications,
    experience_years,
    description,
    photo_url,
    availability,
    consultation_fee,
    slot_duration_minutes,
    languages,
    concern_keywords,
  } = doctor;
  return {
    id,
    name,
    specialty,
    qualifications,
    experience_years,
    description,
    photo_url,
    availability,
    consultation_fee: consultation_fee ?? '',
    slot_duration_minutes: slot_duration_minutes ?? null,
    languages,
    concern_keywords,
  };
}

export async function loadClinicDirectory(userId: string): Promise<ClinicDirectory> {
  const [clinicRes, doctorsRes] = await Promise.all([
    supabaseAdmin.from('clinic_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('doctors').select('*').eq('user_id', userId).eq('is_active', true).order('name'),
  ]);
  if (clinicRes.error || doctorsRes.error) {
    console.error('Clinic directory could not be loaded', clinicRes.error?.code, doctorsRes.error?.code);
  }
  const clinic = clinicRes.data
    ? { ...clinicRes.data, services: parseClinicServices(clinicRes.data.services) }
    : null;
  return {
    clinic,
    doctors: (doctorsRes.data ?? []).map(publicDoctor),
    services: clinic?.services ?? [],
    available: !doctorsRes.error,
  };
}
