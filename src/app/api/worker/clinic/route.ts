import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse, ApiError } from '@/lib/api-helpers';
import { requireWorkerSecret } from '@/lib/worker-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadClinicDirectory } from '@/lib/clinic-directory';

const querySchema = z.object({
  agent_id: z.string().uuid(),
});

const LANGUAGE_LABELS: Record<string, string> = {
  ur: 'Urdu',
  en: 'English',
  pa: 'Punjabi',
  hi: 'Hindi',
};

function parseHoursRange(openingHours: string | null | undefined): { open: number; close: number } {
  const match = openingHours?.match(/(\d{1,2})(?::\d{2})?\s*(?:am|pm)?\s*[-to–]+\s*(\d{1,2})(?::\d{2})?\s*(pm)?/i);
  if (!match) return { open: 9, close: 21 };
  const open = Math.min(23, Math.max(0, Number(match[1])));
  let close = Math.min(23, Math.max(0, Number(match[2])));
  if (match[3] && close < 12) close += 12;
  if (close <= open && close < 12) close += 12;
  return { open, close: Math.max(open + 1, close) };
}

export async function GET(request: Request) {
  try {
    requireWorkerSecret(request);

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({ agent_id: searchParams.get('agent_id') });
    if (!parsed.success) {
      throw new ApiError('Valid agent_id query parameter is required.', 422);
    }

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('id', parsed.data.agent_id)
      .eq('is_active', true)
      .maybeSingle();

    if (agentError) throw agentError;
    if (!agent) throw new ApiError('Active agent not found.', 404);

    // Strictly tenant-scoped lookup: clinic profile, active doctors, and this agent's knowledge docs
    const [directory, knowledgeRes] = await Promise.all([
      loadClinicDirectory(agent.user_id),
      supabaseAdmin
        .from('knowledge_docs')
        .select('name, type, content, url, created_at')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    const clinic = directory.clinic;
    const timings = clinic?.opening_hours || '10:00 to 19:00';
    const { open, close } = parseHoursRange(timings);
    const langCode = String(agent.language || 'ur').split('-')[0].toLowerCase();
    const defaultSlotMinutes = clinic?.default_slot_minutes ?? 30;

    const doctors = directory.doctors.map((d) => ({
      id: d.id,
      name: d.name,
      speciality: d.specialty,
      qualifications: d.qualifications || '',
      experience_years: d.experience_years ?? 0,
      fee: d.consultation_fee?.trim() || 'Confirm at clinic',
      availability: d.availability || timings,
      slot_duration_minutes: d.slot_duration_minutes ?? defaultSlotMinutes,
      languages: d.languages ?? [],
      concern_keywords: d.concern_keywords ?? [],
      description: d.description || '',
    }));

    const doctorById = new Map(doctors.map((d) => [d.id, d.name]));
    const configuredServices = directory.services.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category || '',
      description: s.description || '',
      fee: s.fee || '',
      duration_minutes: s.duration_minutes ?? defaultSlotMinutes,
      doctors: (s.doctor_ids ?? [])
        .map((id) => doctorById.get(id))
        .filter((name): name is string => Boolean(name)),
    }));

    // Derive a strict summary from configured services first, else only from published doctor specialties
    const servicesSummary = configuredServices.length
      ? configuredServices
          .map((s) => {
            const parts = [s.name];
            if (s.category) parts.push(`(${s.category})`);
            if (s.fee) parts.push(`Fee: ${s.fee}`);
            if (s.duration_minutes) parts.push(`${s.duration_minutes} min`);
            if (s.description) parts.push(`— ${s.description}`);
            if (s.doctors.length) parts.push(`[Doctors: ${s.doctors.join(', ')}]`);
            return parts.join(' ');
          })
          .join('\n  - ')
      : doctors.length
        ? Array.from(new Set(doctors.map((d) => d.speciality))).join(', ')
        : 'Only clinic reception and appointment requests (no specific services published yet)';

    const MAX_NOTES_CHARS = 3500;
    let clinicNotes = '';
    for (const doc of knowledgeRes.data ?? []) {
      const text = (doc.content || doc.url || '').trim();
      if (!text) continue;
      const prefix = doc.type === 'faq' ? '[FAQ] ' : '';
      const entry = `- ${prefix}${doc.name}: ${text}`;
      if (clinicNotes.length + entry.length + 1 > MAX_NOTES_CHARS) {
        const remaining = MAX_NOTES_CHARS - clinicNotes.length - 1;
        if (remaining > 40) {
          clinicNotes += (clinicNotes ? '\n' : '') + entry.slice(0, remaining);
        }
        break;
      }
      clinicNotes += (clinicNotes ? '\n' : '') + entry;
    }

    const extraRules = [
      clinic?.custom_instructions,
      agent.system_prompt,
      agent.description,
    ]
      .filter((v): v is string => Boolean(v && v.trim()))
      .join('\n');

    return NextResponse.json({
      clinic: {
        tenant_id: agent.user_id,
        agent_id: agent.id,
        agent_name: agent.name,
        greeting: agent.greeting || '',
        clinic_name: clinic?.clinic_name || agent.name || 'Clinic',
        address: clinic?.address || 'Not published',
        phone: clinic?.phone || '',
        timings,
        open_hour: open,
        close_hour: close,
        off_days: clinic?.off_days?.trim() || 'Check clinic timings',
        default_slot_minutes: defaultSlotMinutes,
        booking_rules: clinic?.booking_rules?.trim() || '',
        default_language: LANGUAGE_LABELS[langCode] || 'Urdu',
        tone: 'warm, polite and professional',
        emergency_number: clinic?.phone || '1122',
        timezone: clinic?.timezone || agent.timezone || 'Asia/Karachi',
        doctors,
        services_list: configuredServices,
        services: configuredServices.length ? `  - ${servicesSummary}` : servicesSummary,
        clinic_notes: clinicNotes,
        fallback_action: 'say the clinic staff will call the patient back shortly',
        extra_rules: extraRules,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
