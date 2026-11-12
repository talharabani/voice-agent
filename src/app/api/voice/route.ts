import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { analyzeCallTranscript } from "@/lib/ai/ollama";
import { callWebhookSchema } from "@/lib/validations/voice";
import { safeEqual } from "@/lib/security";

/**
 * This route is called server-to-server by the telephony/orchestration
 * layer (e.g. an n8n workflow), not by a logged-in browser session —
 * so it authenticates via a shared API key rather than Clerk.
 */
function assertServiceAuth(req: Request) {
  const expected = process.env.N8N_API_KEY;
  const provided = req.headers.get("x-api-key");

  if (!expected) {
    console.error("N8N_API_KEY is not configured on the server");
    return false;
  }
  if (!provided) return false;
  return safeEqual(provided, expected);
}

/**
 * GET /api/voice?agent_id=...
 * Returns the live agent configuration (prompt, voice, knowledge) that
 * the calling workflow needs to actually run the conversation.
 */
export async function GET(req: Request) {
  if (!assertServiceAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId) {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }

  const { data: agent, error: agentError } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .eq("is_active", true)
    .single();

  if (agentError || !agent) {
    return NextResponse.json({ error: "Agent not found or inactive" }, { status: 404 });
  }

  const { data: knowledge } = await supabaseAdmin
    .from("knowledge_docs")
    .select("name, type, content, url")
    .eq("agent_id", agentId);

  return NextResponse.json({ agent, knowledge: knowledge ?? [] });
}

/**
 * POST /api/voice
 * Ingests a completed call: stores the transcript, runs sentiment/lead
 * analysis, and upserts a lead record when contact info was captured.
 */
export async function POST(req: Request) {
  if (!assertServiceAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input;
  try {
    const body = await req.json();
    input = callWebhookSchema.parse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const { data: agent, error: agentError } = await supabaseAdmin
    .from("agents")
    .select("id, user_id")
    .eq("id", input.agent_id)
    .single();

  if (agentError || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const analysis = await analyzeCallTranscript(input.transcript);

  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .insert({
      agent_id: agent.id,
      user_id: agent.user_id,
      transcript: input.transcript,
      duration_seconds: input.duration_seconds ?? null,
      sentiment: analysis.sentiment,
      lead_score: analysis.lead_score,
      intent: analysis.intent,
      status: input.status,
    })
    .select()
    .single();

  if (conversationError) {
    console.error("Failed to store conversation", conversationError);
    return NextResponse.json(
      { error: "Failed to store conversation" },
      { status: 500 }
    );
  }

  let lead = null;
  const hasContactInfo = analysis.lead.email || analysis.lead.phone || input.caller_phone;

  if (hasContactInfo) {
    const { data: leadRow, error: leadError } = await supabaseAdmin
      .from("leads")
      .insert({
        user_id: agent.user_id,
        agent_id: agent.id,
        conversation_id: conversation.id,
        name: analysis.lead.name,
        email: analysis.lead.email,
        phone: analysis.lead.phone ?? input.caller_phone ?? null,
        lead_score: analysis.lead_score,
        status: "new",
      })
      .select()
      .single();

    if (leadError) {
      console.error("Failed to store lead", leadError);
    } else {
      lead = leadRow;
    }
  }

  return NextResponse.json(
    { conversation, lead, analysis },
    { status: 201 }
  );
}
