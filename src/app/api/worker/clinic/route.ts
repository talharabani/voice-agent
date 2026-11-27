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
  const match = openingHours?.match(/(\d{1,2})(?::\d{2})?\s*(?:am|pm)?\s*[-to]+\s*(\d{1,2})(?::\d{2})?\s*(pm)?/i);
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

    const [directory, knowledgeRes] = await Promise.all([
      loadClinicDirectory(agent.user_id),
      supabaseAdmin
        .from('knowledge_docs')
        .select('name, content, url, created_at')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const clinic = directory.clinic;
    const timings = clinic?.opening_hours || '10:00 to 19:00';
    const { open, close } = parseHoursRange(timings);
    const langCode = String(agent.language || 'ur').split('-')[0].toLowerCase();

    const doctors = directory.doctors.map((d) => ({
      name: d.name,
      speciality: d.specialty,
      fee: 'Confirm at clinic',
      availability: d.availability || timings,
    }));

    const MAX_NOTES_CHARS = 3000;
    let clinicNotes = '';
    for (const doc of knowledgeRes.data ?? []) {
      const text = (doc.content || doc.url || '').trim();
      if (!text) continue;
      const entry = `- ${doc.name}: ${text}`;
      if (clinicNotes.length + entry.length + 1 > MAX_NOTES_CHARS) {
        const remaining = MAX_NOTES_CHARS - clinicNotes.length - 1;
        if (remaining > 40) {
          clinicNotes += (clinicNotes ? '\n' : '') + entry.slice(0, remaining);
        }
        break;
      }
      clinicNotes += (clinicNotes ? '\n' : '') + entry;
    }

    return NextResponse.json({
      clinic: {
        agent_id: agent.id,
        agent_name: agent.name,
        clinic_name: clinic?.clinic_name || agent.name || 'Clinic',
        address: clinic?.address || 'Not published',
        timings,
        open_hour: open,
        close_hour: close,
        off_days: 'Check clinic timings',
        default_language: LANGUAGE_LABELS[langCode] || 'Urdu',
        tone: 'warm, polite and professional',
        emergency_number: clinic?.phone || '1122',
        timezone: clinic?.timezone || agent.timezone || 'Asia/Karachi',
        doctors: doctors.length
          ? doctors
          : [{ name: 'Clinic Doctor', speciality: 'General Consultation', fee: 'Confirm at clinic' }],
        services: 'General consultation and appointment booking',
        clinic_notes: clinicNotes,
        fallback_action: 'say the clinic staff will call the patient back shortly',
        extra_rules: [agent.system_prompt, agent.description].filter(Boolean).join(' '),
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
