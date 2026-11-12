import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ClinicProfileRow, DoctorRow, PublicDoctor } from '@/types/database';

export type ClinicDirectory = { clinic: ClinicProfileRow | null; doctors: PublicDoctor[]; available: boolean };
export function publicDoctor(doctor: DoctorRow): PublicDoctor {
  const { id, name, specialty, qualifications, experience_years, description, photo_url, availability, languages, concern_keywords } = doctor;
  return { id, name, specialty, qualifications, experience_years, description, photo_url, availability, languages, concern_keywords };
}
export async function loadClinicDirectory(userId: string): Promise<ClinicDirectory> {
  const [clinic, doctors] = await Promise.all([
    supabaseAdmin.from('clinic_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('doctors').select('*').eq('user_id', userId).eq('is_active', true).order('name'),
  ]);
  if (clinic.error || doctors.error) console.error('Clinic directory could not be loaded', clinic.error?.code, doctors.error?.code);
  return { clinic: clinic.data, doctors: (doctors.data ?? []).map(publicDoctor), available: !doctors.error };
}
