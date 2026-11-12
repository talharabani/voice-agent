import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { callLimitForPlan, monthStartISO } from "@/lib/plan";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateAgentReply } from "@/lib/voice/respond";
import { transcriptTurnSchema } from "@/lib/validations/voice";

/**
 * POST /api/public/call/[token]/converse — one turn of a public
 * web call. No sign-in: the unguessable share token IS the capability.
 * Rate limited per caller IP and per token; the owner's monthly plan
 * limit applies, so a viral link can't run up unlimited model usage.
 */

const converseSchema = z.object({
  history: z.array(transcriptTurnSchema).max(80).default([]),
});

function callerIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = callerIp(req);
  const perIp = checkRateLimit(`pub-converse-ip:${ip}`, 20, 60_000);
  const perToken = checkRateLimit(`pub-converse-tok:${token}`, 60, 60_000);
  if (!perIp.allowed || !perToken.allowed) {
    const retry = Math.max(perIp.retryAfterSeconds, perToken.retryAfterSeconds);
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(retry) } }
    );
  }

  let input;
  try {
    input = converseSchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("share_token", token)
    .eq("is_active", true)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Owner's monthly plan limit guards model usage on public calls too.
  if (input.history.length === 0) {
    const [{ count }, { data: owner }] = await Promise.all([
      supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", agent.user_id)
        .gte("created_at", monthStartISO()),
      supabaseAdmin.from("users").select("plan").eq("id", agent.user_id).single(),
    ]);

    const limit = callLimitForPlan(owner?.plan ?? "free");
    if ((count ?? 0) >= limit) {
      return NextResponse.json(
        { error: "This line is not taking calls right now. Please try later." },
        { status: 403 }
      );
    }
  }

  const { data: knowledge } = await supabaseAdmin
    .from("knowledge_docs")
    .select("*")
    .eq("agent_id", agent.id);

  try {
    const reply = await generateAgentReply(agent, knowledge ?? [], input.history);
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Public call converse failed", err);
    return NextResponse.json(
      { error: "The agent is unavailable right now. Please try again shortly." },
      { status: 503 }
    );
  }
}
