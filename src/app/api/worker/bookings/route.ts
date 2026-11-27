import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse, ApiError } from '@/lib/api-helpers';
import { requireWorkerSecret } from '@/lib/worker-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadClinicDirectory } from '@/lib/clinic-directory';
import { notifyClinicStaff, sendAppointmentConfirmation, whatsappConfigured } from '@/lib/whatsapp';
import {
  checkSlotOverlap,
  matchClinicDoctor,
  matchClinicService,
  resolveSlotDurationMinutes,
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
    service: z.string().max(160).optional().default(''),
  }),
  z.object({
    action: z.literal('book_appointment'),
    agent_id: z.string().uuid(),
    name: z.string().min(1).max(160),
    phone: z.string().min(4).max(40),
    doctor: z.string().min(1).max(160),
    date: z.string().min(1).max(40),
    time: z.string().min(1).max(40),
    service: z.string().max(160).optional().default(''),
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

    // Strictly scope every operation to an active agent and its owning clinic tenant (agent.user_id)
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, user_id, timezone, is_active')
      .eq('id', input.agent_id)
      .eq('is_active', true)
      .maybeSingle();

    if (agentError) throw agentError;
    if (!agent) throw new ApiError('Active agent not found.', 404);

    if (input.action === 'check_availability' || input.action === 'book_appointment') {
      const directory = await loadClinicDirectory(agent.user_id);

      // 1. Validate service against this clinic's configured services (strict tenant boundary)
      const serviceMatch = matchClinicService(input.service, directory.services, directory.doctors);
      if (!serviceMatch.ok) {
        return NextResponse.json({ ok: false, available: false, message: serviceMatch.message });
      }

      // 2. Validate doctor strictly against this clinic's active doctors
      const doctorMatch = matchClinicDoctor(input.doctor, directory.doctors);
      if (!doctorMatch.ok) {
        return NextResponse.json({ ok: false, available: false, message: doctorMatch.message });
      }

      const canonicalDoctor = doctorMatch.doctor;
      const doctorName = canonicalDoctor?.name ?? input.doctor.trim();
      const resolvedService =
        serviceMatch.label ||
        (canonicalDoctor?.specialty ? `${canonicalDoctor.specialty} consultation` : 'Clinic consultation');
      const timezone = directory.clinic?.timezone || agent.timezone || 'Asia/Karachi';
      const slotMinutes = resolveSlotDurationMinutes({
        service: serviceMatch.service,
        doctor: canonicalDoctor,
        clinic: directory.clinic,
      });

      // 3. Validate slot against clinic hours, off_days, doctor availability, and duration
      const slot = validateSlotRequest({
        date: input.date,
        time: input.time,
        timezone,
        clinicHours: directory.clinic?.opening_hours,
        offDays: directory.clinic?.off_days,
        doctorAvailability: canonicalDoctor?.availability,
        slotMinutes,
      });

      if (!slot.ok) {
        return NextResponse.json({ ok: false, available: false, message: slot.message });
      }

      // 4. Check tenant-scoped appointment conflicts for this doctor
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
          slot_minutes: slot.slotMinutes,
          doctor: doctorName,
          service: resolvedService,
          message: hasOverlap
            ? 'That slot is already taken. Offer another time.'
            : `Available (${slot.slotMinutes}-minute slot with ${doctorName}).`,
        });
      }

      if (hasOverlap) {
        return NextResponse.json({
          ok: false,
          message: 'Failed: slot already taken.',
        });
      }

      // 5. Persist appointment strictly under agent.user_id
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
          patient_concern: input.reason || resolvedService,
          service: resolvedService,
          status: 'requested',
          whatsapp_consent: true,
          call_summary: [
            `Service: ${resolvedService}`,
            `Requested doctor: ${doctorName}`,
            `Duration: ${slot.slotMinutes} minutes`,
            `Concern: ${input.reason || resolvedService}`,
            `Preferred time: ${slot.normalizedTime}`,
            'Booked via LiveKit voice worker',
          ].join('\n'),
        })
        .select('id, customer_name, customer_phone, service, doctor_name, requested_time, patient_concern')
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

      // 6. Notify designated clinic staff ONLY after database creation succeeded
      const staffNotify = await notifyClinicStaff({
        clinic: directory.clinic,
        appointment: appt,
      });

      return NextResponse.json({
        ok: true,
        appointment_id: appt.id,
        service: resolvedService,
        doctor: doctorName,
        requested_time: slot.normalizedTime,
        staff_notified: staffNotify.whatsappSent || staffNotify.webhookSent,
        message: 'Success: appointment booked.',
      });
    }

    // send_whatsapp_confirmation (strictly scoped to agent.user_id & agent.id)
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
      .eq('user_id', agent.user_id)
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
