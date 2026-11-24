import "server-only";

import { analyzeCallTranscript, extractAppointment } from "@/lib/ai/ollama";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CallTurn } from "@/lib/voice/respond";
import { readBookingDraft } from '@/lib/voice/booking-flow';
import { loadClinicDirectory } from '@/lib/clinic-directory';
import { sendAppointmentConfirmation, whatsappConfigured } from '@/lib/whatsapp';

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  // Convert Pakistani local mobile format 03XXXXXXXXX -> +923XXXXXXXXX
  if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
  if (/^923\d{9}$/.test(digits)) return `+${digits}`;
  return raw.trim() || null;
}

interface SaveCallInput {
  agentId: string;
  userId: string;
  transcript: CallTurn[];
  durationSeconds?: number | null;
  status?: string;
  callSid?: string | null;
  callerPhone?: string | null;
}

/**
 * Persists a finished call: conversation + analysis, lead when contact
 * info was captured, appointment when a booking was requested.
 * Shared by the browser call tester and the telephony webhooks.
 */
export async function saveCallRecord(input: SaveCallInput) {
  const directory = await loadClinicDirectory(input.userId);
  const draft = readBookingDraft(input.transcript, directory.doctors);
  const [analysis, extracted] = await Promise.all([
    analyzeCallTranscript(input.transcript),
    extractAppointment(input.transcript),
  ]);
  const booking = draft.cancelled
    ? { ...extracted, requested: false }
    : {
        requested: extracted.requested || draft.active,
        whatsapp_consent: extracted.whatsapp_consent || draft.consent === true,
        customer_name: extracted.customer_name ?? draft.name,
        customer_phone: normalizePhone(extracted.customer_phone ?? draft.phone),
        requested_time: extracted.requested_time ?? draft.time,
        requested_doctor: extracted.requested_doctor ?? draft.doctor,
        patient_concern: extracted.patient_concern ?? draft.concern,
        service: extracted.service || 'Clinic consultation',
      };
  const warnings: string[] = [];

  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .insert({
      agent_id: input.agentId,
      user_id: input.userId,
      call_sid: input.callSid ?? null,
      transcript: input.transcript,
      duration_seconds: input.durationSeconds ?? null,
      sentiment: analysis.sentiment,
      lead_score: analysis.lead_score,
      intent: analysis.intent,
      status: input.status ?? "completed",
    })
    .select()
    .single();

  if (conversationError || !conversation) {
    console.error("Failed to store conversation", conversationError);
    throw new Error("Failed to store conversation");
  }

  let lead = null;
  const phone = normalizePhone(analysis.lead.phone ?? booking.customer_phone ?? input.callerPhone ?? null);
  if (analysis.lead.email || phone) {
    const { data: leadRow, error: leadError } = await supabaseAdmin
      .from("leads")
      .insert({
        user_id: input.userId,
        agent_id: input.agentId,
        conversation_id: conversation.id,
        name: analysis.lead.name,
        email: analysis.lead.email,
        phone,
        lead_score: analysis.lead_score,
        status: "new",
      })
      .select()
      .single();

    if (leadError) { console.error("Failed to store lead", leadError); warnings.push("Call saved, but the lead could not be recorded."); }
    else lead = leadRow;
  }

  let appointment = null;
  if (booking.requested) {
    const { data: apptRow, error: apptError } = await supabaseAdmin
      .from("appointments")
      .insert({
        user_id: input.userId,
        agent_id: input.agentId,
        conversation_id: conversation.id,
        lead_id: lead?.id ?? null,
        customer_name: booking.customer_name ?? analysis.lead.name,
        customer_phone: booking.customer_phone ?? phone,
        customer_email: analysis.lead.email,
        service: booking.service,
        requested_time: booking.requested_time,
        requested_doctor: booking.requested_doctor,
        patient_concern: booking.patient_concern,
        call_summary: [
          `Patient: ${booking.customer_name ?? analysis.lead.name ?? 'Not captured'}`,
          `Contact: ${booking.customer_phone ?? phone ?? 'Not captured'}`,
          `Requested doctor: ${booking.requested_doctor ?? 'Clinic to assign'}`,
          `Patient-reported concern: ${booking.patient_concern ?? 'Not captured; review the call transcript'}`,
          `Service: ${booking.service ?? 'Not captured'}`,
          `Preferred time: ${booking.requested_time ?? 'Not captured'}`,
          `WhatsApp permission recorded: ${booking.whatsapp_consent ? 'Yes; verify in transcript' : 'Not recorded'}`,
          'Reception action: verify patient details, doctor and availability before confirming. This is a request, not a confirmed slot.',
        ].join('\n'),
        status: "requested",
        whatsapp_consent: booking.whatsapp_consent,
      })
      .select()
      .single();

    if (apptError) { console.error("Failed to store appointment", apptError); warnings.push("Call saved, but the appointment request could not be recorded. Please contact the clinic."); }
    else {
      appointment = apptRow;
      if (apptRow && booking.whatsapp_consent && (booking.customer_phone ?? phone) && whatsappConfigured()) {
        await sendAppointmentConfirmation(apptRow.id, input.userId).catch((err) => {
          console.error("Auto WhatsApp confirmation failed", err);
        });
      }
    }
  }

  return { conversation, lead, appointment, analysis, warnings };
}
