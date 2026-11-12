import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/public/call/[token] — minimal public info for the web-call
 * page. Exposes ONLY the agent's display name and business type;
 * prompts, knowledge, and owner data stay server-side.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("name, business_type, is_active")
    .eq("share_token", token)
    .single();

  if (!agent || !agent.is_active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    agent: { name: agent.name, business_type: agent.business_type },
  });
}
