export const maxDuration = 180;

import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { saveCallRecord } from "@/lib/voice/save-call";
import { transcriptTurnSchema } from "@/lib/validations/voice";

/**
 * POST /api/voice/test-call — saves a finished browser test call
 * (conversation + analysis + lead + appointment) for the signed-in user.
 */

const testCallSchema = z.object({
  agent_id: z.string().uuid(),
  transcript: z.array(transcriptTurnSchema).min(1).max(200),
  duration_seconds: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();

    const rate = checkRateLimit(`test-call:${user.id}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Slow down a little." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    let input;
    try {
      input = testCallSchema.parse(await req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("id, user_id")
      .eq("id", input.agent_id)
      .eq("user_id", user.id)
      .single();

    if (agentError || !agent) {
      throw new ApiError("Agent not found", 404);
    }

    const result = await saveCallRecord({
      agentId: agent.id,
      userId: agent.user_id,
      transcript: input.transcript,
      durationSeconds: input.duration_seconds ?? null,
      status: "test",
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
