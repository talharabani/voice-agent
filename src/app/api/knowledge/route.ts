import { NextResponse } from "next/server";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createKnowledgeSchema } from "@/lib/validations/knowledge";

/**
 * GET /api/knowledge — all knowledge sources across the user's agents.
 */
export async function GET() {
  try {
    const user = await requireApiUser();

    const { data, error } = await supabaseAdmin
      .from("knowledge_docs")
      .select("*, agents!inner(id, name, user_id)")
      .eq("agents.user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ docs: data });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * POST /api/knowledge — add a note / FAQ / URL source to one of the
 * user's own agents.
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser();

    const rate = checkRateLimit(`knowledge:${user.id}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Slow down a little." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    let input;
    try {
      input = createKnowledgeSchema.parse(await req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // Ownership check — never attach knowledge to someone else's agent.
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("id", input.agent_id)
      .eq("user_id", user.id)
      .single();

    if (agentError || !agent) {
      throw new ApiError("Agent not found", 404);
    }

    const { data, error } = await supabaseAdmin
      .from("knowledge_docs")
      .insert({
        agent_id: input.agent_id,
        type: input.type,
        name: input.name,
        content: input.content ?? null,
        url: input.url ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ doc: data }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
