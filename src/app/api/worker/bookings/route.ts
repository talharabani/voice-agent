import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse, ApiError } from '@/lib/api-helpers';
import { requireWorkerSecret } from '@/lib/worker-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadClinicDirectory } from '@/lib/clinic-directory';
import { notifyClinicStaff, sendAppointmentConfirmation, whatsappConfigured } from '@/lib/whatsapp';
import {
  checkSlotOverlap,
  findAvailableSlotsForDate,
  matchClinicDoctor,
  matchClinicService,
  resolveSlotDurationMinutes,
  validateSlotRequest,
} from '@/lib/voice/slot-utils';
import {
  doctorOffersService,
  generateFallbackReferenceCode,
  normalizeReferenceCode,
  verifyCallerPhone,
} from '@/lib/voice/appointment-ref';
import type { AppointmentModification } from '@/types/database';

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
  if (/^923\d{9}$/.test(digits)) return `+${digits}`;
  return raw.trim();
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  const msg = String((error as { message?: string }).message ?? '');
  return code === '42703' || code === 'PGRST204' || /column .* does not exist|schema cache/i.test(msg);
}

function extractDateAndTime(requestedTime: string | null, scheduledAt: string | null, timezone: string): { date: string; time: string } | null {
  if (requestedTime) {
    const m = /^(\d{4}-\d{2}-\d{2})[\sT]+(\d{1,2}):(\d{2})/.exec(requestedTime.trim());
    if (m) {
      return { date: m[1], time: `${m[2].padStart(2, '0')}:${m[3]}` };
    }
  }
  if (scheduledAt) {
    const d = new Date(scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).formatToParts(d);
        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
        return {
          date: `${get('year')}-${get('month')}-${get('day')}`,
          time: `${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`,
        };
      } catch {
        return {
          date: d.toISOString().slice(0, 10),
          time: d.toISOString().slice(11, 16),
        };
      }
    }
  }
  return null;
}

const bookingActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('check_availability'),
    agent_id: z.string().uuid(),
    doctor: z.string().min(1).max(160),
    date: z.string().min(1).max(40),
    time: z.string().min(1).max(40),
    service: z.string().max(160).optional().default(''),
    exclude_reference_code: z.string().max(40).optional().default(''),
  }),
  z.object({
    action: z.literal('get_available_slots'),
    agent_id: z.string().uuid(),
    doctor: z.string().min(1).max(160),
    date: z.string().min(1).max(40),
    service: z.string().max(160).optional().default(''),
    exclude_reference_code: z.string().max(40).optional().default(''),
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
    action: z.literal('lookup_appointment'),
    agent_id: z.string().uuid(),
    reference_code: z.string().min(3).max(40),
    phone: z.string().min(4).max(40),
  }),
  z.object({
    action: z.literal('modify_appointment'),
    agent_id: z.string().uuid(),
    reference_code: z.string().min(3).max(40),
    phone: z.string().min(4).max(40),
    new_date: z.string().max(40).optional().default(''),
    new_time: z.string().max(40).optional().default(''),
    new_doctor: z.string().max(160).optional().default(''),
    new_service: z.string().max(160).optional().default(''),
    cancel: z.boolean().optional().default(false),
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

    // -----------------------------------------------------------------------
    // LOOKUP EXISTING APPOINTMENT (strictly tenant-scoped + caller phone verified)
    // -----------------------------------------------------------------------
    if (input.action === 'lookup_appointment') {
      const normalizedRef = normalizeReferenceCode(input.reference_code);
      if (!normalizedRef) {
        return NextResponse.json({
          ok: false,
          verified: false,
          message:
            'That reference number format looks incomplete. Please share the full reference number, like APT-2026-00125.',
        });
      }

      const { data: existing, error: lookupError } = await supabaseAdmin
        .from('appointments')
        .select('*')
        .eq('user_id', agent.user_id)
        .eq('reference_code', normalizedRef)
        .maybeSingle();

      if (lookupError) {
        if (isMissingColumnError(lookupError)) {
          return NextResponse.json({
            ok: false,
            verified: false,
            message: 'Appointment reference lookup requires running the latest database migration.',
          });
        }
        throw lookupError;
      }

      // Never reveal whether a reference exists when phone verification fails (prevents guessing/enumeration)
      if (!existing || !verifyCallerPhone(existing.customer_phone, input.phone)) {
        return NextResponse.json({
          ok: false,
          verified: false,
          message:
            'I could not verify an appointment with that reference number and phone number at this clinic. Please double-check both and try again.',
        });
      }

      return NextResponse.json({
        ok: true,
        verified: true,
        appointment: {
          id: existing.id,
          reference_code: existing.reference_code ?? normalizedRef,
          status: existing.status,
          customer_name: existing.customer_name,
          service: existing.service,
          doctor_name: existing.doctor_name || existing.requested_doctor,
          requested_time: existing.requested_time,
          scheduled_at: existing.scheduled_at,
          patient_concern: existing.patient_concern,
          modification_count: Array.isArray(existing.modification_history)
            ? existing.modification_history.length
            : 0,
        },
        message: `Verified appointment ${existing.reference_code ?? normalizedRef}: ${existing.service || 'Clinic consultation'} with ${existing.doctor_name || existing.requested_doctor || 'clinic doctor'} at ${existing.requested_time || 'unscheduled time'} (status: ${existing.status}).`,
      });
    }

    // -----------------------------------------------------------------------
    // GET AVAILABLE SLOTS ON A DATE (real availability, never fabricated)
    // -----------------------------------------------------------------------
    if (input.action === 'get_available_slots') {
      const directory = await loadClinicDirectory(agent.user_id);

      const serviceMatch = matchClinicService(input.service, directory.services, directory.doctors);
      if (!serviceMatch.ok) {
        return NextResponse.json({ ok: false, slots: [], message: serviceMatch.message });
      }

      const doctorMatch = matchClinicDoctor(input.doctor, directory.doctors);
      if (!doctorMatch.ok) {
        return NextResponse.json({ ok: false, slots: [], message: doctorMatch.message });
      }

      const canonicalDoctor = doctorMatch.doctor;
      const resolvedService = serviceMatch.label || input.service.trim();
      if (canonicalDoctor && resolvedService) {
        const compat = doctorOffersService(canonicalDoctor, resolvedService, directory.services);
        if (!compat.ok) {
          return NextResponse.json({ ok: false, slots: [], message: compat.message });
        }
      }

      const doctorName = canonicalDoctor?.name ?? input.doctor.trim();
      const timezone = directory.clinic?.timezone || agent.timezone || 'Asia/Karachi';
      const slotMinutes = resolveSlotDurationMinutes({
        service: serviceMatch.service,
        doctor: canonicalDoctor,
        clinic: directory.clinic,
      });

      let excludeId: string | undefined;
      const excludeRef = normalizeReferenceCode(input.exclude_reference_code);
      if (excludeRef) {
        const { data: own } = await supabaseAdmin
          .from('appointments')
          .select('id')
          .eq('user_id', agent.user_id)
          .eq('reference_code', excludeRef)
          .maybeSingle();
        excludeId = own?.id;
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

      const available = findAvailableSlotsForDate({
        date: input.date,
        timezone,
        clinicHours: directory.clinic?.opening_hours,
        offDays: directory.clinic?.off_days,
        doctorAvailability: canonicalDoctor?.availability,
        slotMinutes,
        existingRows: existingRows ?? [],
        excludeAppointmentId: excludeId,
      });

      if (!available.ok) {
        return NextResponse.json({ ok: false, slots: [], message: available.message });
      }

      if (!available.slots.length) {
        return NextResponse.json({
          ok: true,
          slots: [],
          doctor: doctorName,
          message: `No open slots remain with ${doctorName} on ${input.date}. Please suggest another date.`,
        });
      }

      return NextResponse.json({
        ok: true,
        slots: available.slots,
        slot_minutes: slotMinutes,
        doctor: doctorName,
        message: `Available ${slotMinutes}-minute slots with ${doctorName} on ${input.date}: ${available.slots.slice(0, 6).join(', ')}.`,
      });
    }

    // -----------------------------------------------------------------------
    // MODIFY / RESCHEDULE / CHANGE DOCTOR / CANCEL EXISTING APPOINTMENT
    // Updates the SAME record, keeps reference_code unchanged, appends audit history.
    // -----------------------------------------------------------------------
    if (input.action === 'modify_appointment') {
      const normalizedRef = normalizeReferenceCode(input.reference_code);
      if (!normalizedRef) {
        return NextResponse.json({
          ok: false,
          message: 'Please provide a valid appointment reference number like APT-2026-00125.',
        });
      }

      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('appointments')
        .select('*')
        .eq('user_id', agent.user_id)
        .eq('reference_code', normalizedRef)
        .maybeSingle();

      if (fetchError) {
        if (isMissingColumnError(fetchError)) {
          return NextResponse.json({
            ok: false,
            message: 'Appointment modification requires running the latest database migration.',
          });
        }
        throw fetchError;
      }

      if (!existing || !verifyCallerPhone(existing.customer_phone, input.phone)) {
        return NextResponse.json({
          ok: false,
          message:
            'I could not verify that appointment reference number and registered phone number. No changes were made.',
        });
      }

      if (existing.status === 'cancelled') {
        return NextResponse.json({
          ok: false,
          message: `Appointment ${normalizedRef} is already cancelled and cannot be modified. Would you like to book a new appointment instead?`,
        });
      }

      if (existing.status === 'completed') {
        return NextResponse.json({
          ok: false,
          message: `Appointment ${normalizedRef} is already marked completed and cannot be modified.`,
        });
      }

      const directory = await loadClinicDirectory(agent.user_id);
      const timezone = directory.clinic?.timezone || agent.timezone || 'Asia/Karachi';
      const prevHistory: AppointmentModification[] = Array.isArray(existing.modification_history)
        ? existing.modification_history
        : [];
      const previousSnapshot = {
        doctor_name: existing.doctor_name || existing.requested_doctor,
        doctor_id: existing.doctor_id,
        service: existing.service,
        requested_time: existing.requested_time,
        scheduled_at: existing.scheduled_at,
        status: existing.status,
      };

      // Cancellation path (preserves reference_code & original details in history)
      if (input.cancel) {
        const historyEntry: AppointmentModification = {
          changed_at: new Date().toISOString(),
          actor: 'voice_agent',
          action: 'cancelled',
          previous: previousSnapshot,
          updated: { ...previousSnapshot, status: 'cancelled' },
          note: input.reason || 'Cancelled by verified caller via voice agent',
        };

        const { data: cancelledRow, error: cancelErr } = await supabaseAdmin
          .from('appointments')
          .update({
            status: 'cancelled',
            modification_history: [...prevHistory, historyEntry],
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .eq('user_id', agent.user_id)
          .select('id, reference_code, status')
          .single();

        if (cancelErr) throw cancelErr;

        return NextResponse.json({
          ok: true,
          appointment_id: cancelledRow.id,
          reference_code: cancelledRow.reference_code ?? normalizedRef,
          status: 'cancelled',
          message: `Success: appointment ${cancelledRow.reference_code ?? normalizedRef} has been cancelled.`,
        });
      }

      // Modification path: validate ALL requested changes BEFORE executing a single atomic update
      const targetServiceInput = input.new_service.trim() || existing.service || '';
      const serviceMatch = matchClinicService(targetServiceInput, directory.services, directory.doctors);
      if (!serviceMatch.ok) {
        return NextResponse.json({ ok: false, message: serviceMatch.message });
      }
      const resolvedService = serviceMatch.label || targetServiceInput || 'Clinic consultation';

      const targetDoctorInput =
        input.new_doctor.trim() || existing.doctor_name || existing.requested_doctor || '';
      const doctorMatch = matchClinicDoctor(targetDoctorInput, directory.doctors);
      if (!doctorMatch.ok) {
        return NextResponse.json({ ok: false, message: doctorMatch.message });
      }
      const canonicalDoctor = doctorMatch.doctor;
      const doctorName = canonicalDoctor?.name ?? targetDoctorInput;

      // Strictly verify the chosen doctor offers the required service/specialization
      if (canonicalDoctor) {
        const compat = doctorOffersService(canonicalDoctor, resolvedService, directory.services);
        if (!compat.ok) {
          return NextResponse.json({ ok: false, message: compat.message });
        }
      }

      const currentDateTime = extractDateAndTime(existing.requested_time, existing.scheduled_at, timezone);
      const effectiveDate = input.new_date.trim() || currentDateTime?.date || '';
      const effectiveTime = input.new_time.trim() || currentDateTime?.time || '';

      if (!effectiveDate || !effectiveTime) {
        return NextResponse.json({
          ok: false,
          message: 'Please provide both the new date (YYYY-MM-DD) and time (HH:MM).',
        });
      }

      const slotMinutes = resolveSlotDurationMinutes({
        service: serviceMatch.service,
        doctor: canonicalDoctor,
        clinic: directory.clinic,
      });

      const slot = validateSlotRequest({
        date: effectiveDate,
        time: effectiveTime,
        timezone,
        clinicHours: directory.clinic?.opening_hours,
        offDays: directory.clinic?.off_days,
        doctorAvailability: canonicalDoctor?.availability,
        slotMinutes,
      });

      if (!slot.ok) {
        return NextResponse.json({ ok: false, message: slot.message });
      }

      // Check conflict against all OTHER active appointments for the target doctor in this clinic
      const conflictQuery = supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, requested_time')
        .eq('user_id', agent.user_id)
        .neq('status', 'cancelled')
        .neq('id', existing.id);

      const { data: existingRows, error: conflictError } = canonicalDoctor
        ? await conflictQuery.or(`doctor_id.eq.${canonicalDoctor.id},requested_doctor.ilike.${doctorName}`)
        : await conflictQuery.ilike('requested_doctor', doctorName);

      if (conflictError) throw conflictError;

      const hasOverlap = checkSlotOverlap(
        existingRows ?? [],
        slot.slotStartMs,
        slot.slotMinutes,
        timezone,
        existing.id
      );

      if (hasOverlap) {
        return NextResponse.json({
          ok: false,
          message: `That slot (${slot.normalizedTime}) is already taken for ${doctorName}. Please choose another time.`,
        });
      }

      const doctorChanged =
        (canonicalDoctor?.id && canonicalDoctor.id !== existing.doctor_id) ||
        doctorName.toLowerCase() !== (existing.doctor_name || existing.requested_doctor || '').toLowerCase();
      const timeChanged = slot.normalizedTime !== (existing.requested_time ?? '');
      const serviceChanged = resolvedService.toLowerCase() !== (existing.service ?? '').toLowerCase();

      if (!doctorChanged && !timeChanged && !serviceChanged) {
        return NextResponse.json({
          ok: true,
          appointment_id: existing.id,
          reference_code: existing.reference_code ?? normalizedRef,
          status: existing.status,
          doctor: doctorName,
          service: resolvedService,
          requested_time: slot.normalizedTime,
          message: `Appointment ${existing.reference_code ?? normalizedRef} is already set to ${resolvedService} with ${doctorName} at ${slot.normalizedTime}.`,
        });
      }

      const actionKind: AppointmentModification['action'] =
        Number(doctorChanged) + Number(timeChanged) + Number(serviceChanged) > 1
          ? 'modified'
          : doctorChanged
            ? 'doctor_changed'
            : serviceChanged
              ? 'service_changed'
              : 'rescheduled';

      const newStatus = 'rescheduled' as const;
      const historyEntry: AppointmentModification = {
        changed_at: new Date().toISOString(),
        actor: 'voice_agent',
        action: actionKind,
        previous: previousSnapshot,
        updated: {
          doctor_name: doctorName,
          doctor_id: canonicalDoctor?.id ?? existing.doctor_id,
          service: resolvedService,
          requested_time: slot.normalizedTime,
          scheduled_at: slot.scheduledAtIso,
          status: newStatus,
        },
        note: input.reason || 'Modified by verified caller via voice agent',
      };

      const updatePayload = {
        doctor_id: canonicalDoctor?.id ?? existing.doctor_id,
        doctor_name: doctorName,
        requested_doctor: doctorName,
        service: resolvedService,
        requested_time: slot.normalizedTime,
        scheduled_at: slot.scheduledAtIso,
        status: newStatus,
        modification_history: [...prevHistory, historyEntry],
        updated_at: new Date().toISOString(),
      };

      const { data: updatedRow, error: updateErr } = await supabaseAdmin
        .from('appointments')
        .update(updatePayload)
        .eq('id', existing.id)
        .eq('user_id', agent.user_id)
        .select('id, reference_code, customer_name, customer_phone, service, doctor_name, requested_time, patient_concern, status')
        .single();

      if (updateErr) {
        if (updateErr.code === '23505') {
          return NextResponse.json({
            ok: false,
            message: `That slot (${slot.normalizedTime}) was just booked for ${doctorName}. Please offer another time.`,
          });
        }
        throw updateErr;
      }

      // Notify clinic staff of the verified schedule update
      await notifyClinicStaff({
        clinic: directory.clinic,
        appointment: updatedRow,
      });

      return NextResponse.json({
        ok: true,
        appointment_id: updatedRow.id,
        reference_code: updatedRow.reference_code ?? normalizedRef,
        status: updatedRow.status,
        doctor: doctorName,
        service: resolvedService,
        requested_time: slot.normalizedTime,
        message: `Success: appointment ${updatedRow.reference_code ?? normalizedRef} updated to ${resolvedService} with ${doctorName} on ${slot.normalizedTime} (status: ${updatedRow.status}).`,
      });
    }

    // -----------------------------------------------------------------------
    // CHECK AVAILABILITY & BOOK NEW APPOINTMENT
    // -----------------------------------------------------------------------
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

      if (canonicalDoctor && serviceMatch.label) {
        const compat = doctorOffersService(canonicalDoctor, resolvedService, directory.services);
        if (!compat.ok) {
          return NextResponse.json({ ok: false, available: false, message: compat.message });
        }
      }

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

      let excludeId: string | undefined;
      if (input.action === 'check_availability' && input.exclude_reference_code) {
        const excludeRef = normalizeReferenceCode(input.exclude_reference_code);
        if (excludeRef) {
          const { data: own } = await supabaseAdmin
            .from('appointments')
            .select('id')
            .eq('user_id', agent.user_id)
            .eq('reference_code', excludeRef)
            .maybeSingle();
          excludeId = own?.id;
        }
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
        timezone,
        excludeId
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

      // 5. Persist appointment strictly under agent.user_id (DB trigger assigns unique APT-YYYY-NNNNN)
      const normPhone = normalizePhone(input.phone);
      const baseInsert = {
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
        status: 'confirmed' as const,
        whatsapp_consent: false,
        call_summary: [
          `Service: ${resolvedService}`,
          `Requested doctor: ${doctorName}`,
          `Duration: ${slot.slotMinutes} minutes`,
          `Concern: ${input.reason || resolvedService}`,
          `Scheduled time: ${slot.normalizedTime}`,
          'Booked via LiveKit voice worker',
        ].join('\n'),
      };

      const { data: appt, error: insertError } = await supabaseAdmin
        .from('appointments')
        .insert(baseInsert)
        .select('id, reference_code, customer_name, customer_phone, service, doctor_name, requested_time, patient_concern, status')
        .single();

      let savedAppt: {
        id: string;
        reference_code?: string | null;
        customer_name: string | null;
        customer_phone: string | null;
        service: string | null;
        doctor_name: string | null;
        requested_time: string | null;
        patient_concern: string | null;
        status: string;
      } | null = appt;

      if (insertError) {
        if (insertError.code === '23505') {
          return NextResponse.json({
            ok: false,
            message: 'Failed: slot already taken.',
          });
        }
        if (isMissingColumnError(insertError)) {
          const fallback = await supabaseAdmin
            .from('appointments')
            .insert(baseInsert)
            .select('id, customer_name, customer_phone, service, doctor_name, requested_time, patient_concern, status')
            .single();
          if (fallback.error) throw fallback.error;
          savedAppt = fallback.data;
        } else {
          throw insertError;
        }
      }

      if (!savedAppt) throw new Error('Failed to save appointment');
      const referenceCode = savedAppt.reference_code || generateFallbackReferenceCode();

      // 6. Notify designated clinic staff ONLY after database creation succeeded
      const staffNotify = await notifyClinicStaff({
        clinic: directory.clinic,
        appointment: savedAppt,
      });

      return NextResponse.json({
        ok: true,
        appointment_id: savedAppt.id,
        reference_code: referenceCode,
        status: savedAppt.status,
        service: resolvedService,
        doctor: doctorName,
        requested_time: slot.normalizedTime,
        staff_notified: staffNotify.whatsappSent || staffNotify.webhookSent,
        message: `Success: appointment booked. Appointment reference number is ${referenceCode}. Tell the caller their reference number clearly so they can use it if they need to reschedule or change their appointment later.`,
      });
    }

    // Existing send_whatsapp_confirmation action (preserved untouched for backward compatibility)
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
