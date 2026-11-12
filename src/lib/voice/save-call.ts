import "server-only";

import { analyzeCallTranscript, extractAppointment } from "@/lib/ai/ollama";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CallTurn } from "@/lib/voice/respond";

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
  const [analysis, booking] = await Promise.all([analyzeCallTranscript(input.transcript), extractAppointment(input.transcript)]);
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
  const phone = analysis.lead.phone ?? input.callerPhone ?? null;
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
        status: "requested",
        whatsapp_consent: booking.whatsapp_consent,
      })
      .select()
      .single();

    if (apptError) { console.error("Failed to store appointment", apptError); warnings.push("Call saved, but the appointment request could not be recorded. Please contact the clinic."); }
    else appointment = apptRow;
  }

  return { conversation, lead, appointment, analysis, warnings };
}
