export const maxDuration = 180;

import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { saveCallRecord } from "@/lib/voice/save-call";
import { transcriptTurnSchema } from "@/lib/validations/voice";

/**
 * POST /api/public/call/[token]/end — saves a finished public web call
 * into the owner's dashboard (conversation, lead, appointment).
 */

const endSchema = z.object({
  transcript: z.array(transcriptTurnSchema).min(1).max(200),
  duration_seconds: z.number().int().nonnegative().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rate = checkRateLimit(`pub-end:${ip}`, 6, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  let input;
  try {
    input = endSchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, user_id")
    .eq("share_token", token)
    .eq("is_active", true)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await saveCallRecord({
      agentId: agent.id,
      userId: agent.user_id,
      transcript: input.transcript,
      durationSeconds: input.duration_seconds ?? null,
      status: "web",
    });
    return NextResponse.json({ ok: true, warnings: result.warnings });
  } catch (err) {
    console.error("Failed to save public web call", err);
    return NextResponse.json({ error: "Could not save the call. Please contact the clinic." }, { status: 500 });
  }

}
