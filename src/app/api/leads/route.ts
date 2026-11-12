import { NextResponse } from "next/server";

import { apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/leads — the user's captured leads, newest first.
 */
export async function GET() {
  try {
    const user = await requireApiUser();

    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("*, agents(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    return NextResponse.json({ leads: data });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
