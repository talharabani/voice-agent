import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse, ApiError } from '@/lib/api-helpers';
import { requireWorkerSecret } from '@/lib/worker-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadClinicDirectory } from '@/lib/clinic-directory';
import { sendAppointmentConfirmation, whatsappConfigured } from '@/lib/whatsapp';
import {
  checkSlotOverlap,
  getSlotMinutes,
  matchClinicDoctor,
  validateSlotRequest,
} from '@/lib/voice/slot-utils';

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
  if (/^923\d{9}$/.test(digits)) return `+${digits}`;
  return raw.trim();
}

const bookingActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('check_availability'),
    agent_id: z.string().uuid(),
    doctor: z.string().min(1).max(160),
    date: z.string().min(1).max(40),
    time: z.string().min(1).max(40),
  }),
  z.object({
    action: z.literal('book_appointment'),
    agent_id: z.string().uuid(),
    name: z.string().min(1).max(160),
    phone: z.string().min(4).max(40),
    doctor: z.string().min(1).max(160),
    date: z.string().min(1).max(40),
    time: z.string().min(1).max(40),
    reason: z.string().max(500).optional().default(''),
  }),
  z.object({
    action: z.literal('send_whatsapp_confirmation'),
    agent_id: z.string().uuid(),
    phone: z.string().min(4).max(40),
    message: z.string().min(1).max(1000),
  }),
]);

export async function POST(request: Request) {
  try {
    requireWorkerSecret(request);

    const parsed = bookingActionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0]?.message ?? 'Invalid booking payload', 422);
    }
    const input = parsed.data;

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, user_id, timezone')
      .eq('id', input.agent_id)
      .maybeSingle();

    if (agentError) throw agentError;
    if (!agent) throw new ApiError('Agent not found.', 404);

    if (input.action === 'check_availability' || input.action === 'book_appointment') {
      const directory = await loadClinicDirectory(agent.user_id);
      const doctorMatch = matchClinicDoctor(input.doctor, directory.doctors);
      if (!doctorMatch.ok) {
        return NextResponse.json({ ok: false, available: false, message: doctorMatch.message });
      }

      const canonicalDoctor = doctorMatch.doctor;
      const doctorName = canonicalDoctor?.name ?? input.doctor.trim();
      const timezone = directory.clinic?.timezone || agent.timezone || 'Asia/Karachi';
      const slotMinutes = getSlotMinutes();

      const slot = validateSlotRequest({
        date: input.date,
        time: input.time,
        timezone,
        clinicHours: directory.clinic?.opening_hours,
        doctorAvailability: canonicalDoctor?.availability,
        slotMinutes,
      });

      if (!slot.ok) {
        return NextResponse.json({ ok: false, available: false, message: slot.message });
      }

      const query = supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, requested_time')
        .eq('user_id', agent.user_id)
        .neq('status', 'cancelled');

      const { data: existingRows, error: conflictError } = canonicalDoctor
        ? await query.or(`doctor_id.eq.${canonicalDoctor.id},requested_doctor.ilike.${doctorName}`)
        : await query.ilike('requested_doctor', doctorName);

      if (conflictError) throw conflictError;

      const hasOverlap = checkSlotOverlap(
        existingRows ?? [],
        slot.slotStartMs,
        slot.slotMinutes,
        timezone
      );

      if (input.action === 'check_availability') {
        return NextResponse.json({
          ok: true,
          available: !hasOverlap,
          message: hasOverlap ? 'That slot is already taken. Offer another time.' : 'Available.',
        });
      }

      if (hasOverlap) {
        return NextResponse.json({
          ok: false,
          message: 'Failed: slot already taken.',
        });
      }

      const normPhone = normalizePhone(input.phone);
      const { data: appt, error: insertError } = await supabaseAdmin
        .from('appointments')
        .insert({
          user_id: agent.user_id,
          agent_id: agent.id,
          doctor_id: canonicalDoctor?.id ?? null,
          doctor_name: doctorName,
          customer_name: input.name,
          customer_phone: normPhone,
          requested_doctor: doctorName,
          requested_time: slot.normalizedTime,
          scheduled_at: slot.scheduledAtIso,
          patient_concern: input.reason || 'Consultation',
          service: 'Clinic consultation',
          status: 'requested',
          whatsapp_consent: true,
          call_summary: [
            `Requested doctor: ${doctorName}`,
            `Concern: ${input.reason || 'Consultation'}`,
            `Preferred time: ${slot.normalizedTime}`,
            'Booked via LiveKit voice worker',
          ].join('\n'),
        })
        .select('id')
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          return NextResponse.json({
            ok: false,
            message: 'Failed: slot already taken.',
          });
        }
        throw insertError;
      }
      if (!appt) throw new Error('Failed to save appointment');

      return NextResponse.json({
        ok: true,
        appointment_id: appt.id,
        message: 'Success: appointment booked.',
      });
    }

    // send_whatsapp_confirmation
    const normPhone = normalizePhone(input.phone);
    if (!whatsappConfigured()) {
      return NextResponse.json({
        ok: false,
        message: 'Failed: WhatsApp is not connected. Tell the caller staff will confirm.',
      });
    }

    const { data: recentAppt } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('agent_id', agent.id)
      .eq('customer_phone', normPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!recentAppt) {
      return NextResponse.json({
        ok: false,
        message: 'Failed: no matching appointment found to confirm.',
      });
    }

    await sendAppointmentConfirmation(recentAppt.id, agent.user_id);
    return NextResponse.json({
      ok: true,
      message: 'Success: confirmation sent.',
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
