import { saveCallRecord } from "@/lib/voice/save-call";
import {
  validateTwilioSignature,
  getCallState,
  deleteCallState,
} from "@/lib/voice/twilio";

/**
 * POST /api/telephony/twilio/status — Twilio status callback.
 * Configure this as the number's "Call status changes" webhook.
 * On call completion, persists the transcript + analysis + lead +
 * appointment through the shared pipeline.
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
  const status = params.CallStatus;

  if (callSid && ["completed", "busy", "failed", "no-answer", "canceled"].includes(status)) {
    const state = getCallState(callSid);
    if (state && state.history.length > 0) {
      try {
        await saveCallRecord({
          agentId: state.agent.id,
          userId: state.agent.user_id,
          transcript: state.history,
          durationSeconds: params.CallDuration ? parseInt(params.CallDuration, 10) : null,
          status: "completed",
          callSid,
          callerPhone: state.callerPhone,
        });
      } catch (err) {
        console.error("Failed to save Twilio call record", err);
      }
    }
    deleteCallState(callSid);
  }

  return new Response("", { status: 204 });
}
