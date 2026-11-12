import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateAgentReply } from "@/lib/voice/respond";
import {
  validateTwilioSignature,
  escapeXml,
  twilioVoiceFor,
  twimlResponse,
  getCallState,
  setCallState,
  type CallState,
} from "@/lib/voice/twilio";

/**
 * POST /api/telephony/twilio — Twilio Voice webhook.
 *
 * Point your Twilio number's "A call comes in" webhook here (POST).
 * The agent is resolved from the dialed number via the phone_numbers
 * table, or from an ?agent_id=... query param for quick testing.
 *
 * Each turn: Twilio converts caller speech to text (<Gather input="speech">),
 * we run the agent brain, and reply with <Say> inside the next <Gather>.
 */

function publicUrl(req: Request): string {
  const base = process.env.TWILIO_WEBHOOK_BASE;
  const u = new URL(req.url);
  if (!base) return req.url;
  return base.replace(/\/$/, "") + u.pathname + u.search;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params[k] = v;
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(signature, publicUrl(req), params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const callSid = params.CallSid;
  if (!callSid) {
    return new Response("Missing CallSid", { status: 400 });
  }

  let state = getCallState(callSid);

  // First webhook for this call: resolve the agent and build state.
  if (!state) {
    const url = new URL(req.url);
    let agentId = url.searchParams.get("agent_id");

    if (!agentId && params.To) {
      const { data: numberRow } = await supabaseAdmin
        .from("phone_numbers")
        .select("agent_id")
        .eq("phone_number", params.To)
        .single();
      agentId = numberRow?.agent_id ?? null;
    }

    if (!agentId) {
      return twimlResponse(
        `<Say>This number is not connected to an agent yet. Goodbye.</Say><Hangup/>`
      );
    }

    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .eq("is_active", true)
      .single();

    if (!agent) {
      return twimlResponse(
        `<Say>This agent is not available right now. Goodbye.</Say><Hangup/>`
      );
    }

    const { data: knowledge } = await supabaseAdmin
      .from("knowledge_docs")
      .select("*")
      .eq("agent_id", agent.id);

    state = {
      agent,
      knowledge: knowledge ?? [],
      history: [],
      startedAt: Date.now(),
      callerPhone: params.From ?? null,
    } satisfies CallState;
    setCallState(callSid, state);
  }

  // Caller said something? Append it.
  const speech = params.SpeechResult?.trim();
  if (speech) {
    state.history.push({ speaker: "caller", text: speech });
  }

  // Agent's turn.
  let reply: string;
  try {
    reply = await generateAgentReply(state.agent, state.knowledge, state.history);
  } catch (err) {
    console.error("Agent reply failed during Twilio call", err);
    reply = "I'm sorry, I'm having trouble right now. Please call back in a moment.";
  }
  state.history.push({ speaker: "agent", text: reply });
  setCallState(callSid, state);

  const voice = twilioVoiceFor(state.agent.voice);
  const action = escapeXml(publicUrl(req));

  return twimlResponse(
    `<Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US">` +
      `<Say voice="${voice}">${escapeXml(reply)}</Say>` +
      `</Gather>` +
      `<Say voice="${voice}">Are you still there? Goodbye.</Say><Hangup/>`
  );
}
