export const maxDuration = 180;

import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { callLimitForPlan, monthStartISO } from "@/lib/plan";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateAgentReply } from "@/lib/voice/respond";
import { transcriptTurnSchema } from "@/lib/validations/voice";

/**
 * POST /api/voice/converse
 *
 * Runs one turn of a live (browser-based) voice conversation directly
 * against the local Ollama model — used by the in-dashboard call tester.
 * Body: { agent_id, history: [{ speaker: "caller" | "agent", text }] }
 */

const converseSchema = z.object({
  agent_id: z.string().uuid(),
  history: z.array(transcriptTurnSchema).max(80).default([]),
});

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();

    // Rate limit: 30 conversation turns per minute per user.
    const rate = checkRateLimit(`converse:${user.id}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Slow down a little." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    let input;
    try {
      input = converseSchema.parse(await req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("id", input.agent_id)
      .eq("user_id", user.id)
      .single();

    if (agentError || !agent) {
      throw new ApiError("Agent not found", 404);
    }

    // New call starting? Enforce the plan's monthly call limit.
    if (input.history.length === 0) {
      const { count } = await supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", monthStartISO());

      const limit = callLimitForPlan(user.plan);
      if ((count ?? 0) >= limit) {
        return NextResponse.json(
          { error: `Monthly call limit reached (${limit} calls on the ${user.plan} plan).` },
          { status: 403 }
        );
      }
    }

    const { data: knowledge } = await supabaseAdmin
      .from("knowledge_docs")
      .select("*")
      .eq("agent_id", agent.id);

    let reply: string;
    try {
      reply = await generateAgentReply(agent, knowledge ?? [], input.history);
    } catch (err) {
      console.error("Ollama unreachable during converse", err);
      return NextResponse.json(
        {
          error:
            "The AI model is not reachable. Make sure Ollama is running (`ollama serve`) and the model is pulled.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ reply });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
