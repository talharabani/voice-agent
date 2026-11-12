import { NextResponse } from "next/server";

import { loadClinicDirectory } from "@/lib/clinic-directory";
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
    .select("name, business_type, is_active, user_id, language, voice")
    .eq("share_token", token)
    .single();

  if (!agent || !agent.is_active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const directory = await loadClinicDirectory(agent.user_id);
  const clinic = directory.clinic;
  return NextResponse.json({
    agent: { name: agent.name, business_type: agent.business_type, language: agent.language, voice: agent.voice },
    clinic: clinic ? { clinic_name: clinic.clinic_name, address: clinic.address, phone: clinic.phone, opening_hours: clinic.opening_hours } : null,
    doctors: directory.doctors,
    directoryAvailable: directory.available,
  });
}
