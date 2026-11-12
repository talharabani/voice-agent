import { NextResponse } from "next/server";

import { apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { callLimitForPlan, monthStartISO } from "@/lib/plan";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/usage — calls used this month vs the user's plan limit.
 */
export async function GET() {
  try {
    const user = await requireApiUser();

    const { count, error } = await supabaseAdmin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", monthStartISO());

    if (error) throw error;

    const used = count ?? 0;
    const limit = callLimitForPlan(user.plan);

    return NextResponse.json({
      plan: user.plan,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
