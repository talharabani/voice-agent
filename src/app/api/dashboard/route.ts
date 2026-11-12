import { NextResponse } from "next/server";

import { apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const user = await requireApiUser();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: weekConvs, error: weekError }, { data: monthConvs, error: monthError }, { data: recentCalls, error: recentError }] =
      await Promise.all([
        supabaseAdmin
          .from("conversations")
          .select("id, sentiment, lead_score, created_at, duration_seconds")
          .eq("user_id", user.id)
          .gte("created_at", sevenDaysAgo),
        supabaseAdmin
          .from("conversations")
          .select("id, created_at, sentiment")
          .eq("user_id", user.id)
          .gte("created_at", thirtyDaysAgo),
        supabaseAdmin
          .from("conversations")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(4),
      ]);

    if (weekError) throw weekError;
    if (monthError) throw monthError;
    if (recentError) throw recentError;

    const convs = weekConvs ?? [];
    const totalCalls = convs.length;
    const leads = convs.filter((c) => (c.lead_score ?? 0) >= 60).length;
    const avgDuration = convs.length
      ? Math.round(convs.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / convs.length)
      : 0;
    const conversionRate = totalCalls ? ((leads / totalCalls) * 100).toFixed(1) : "0.0";

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const callVolume = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const label = days[d.getDay()];
      const dateStr = d.toISOString().split("T")[0];
      const count = (monthConvs ?? []).filter((c) => c.created_at.startsWith(dateStr)).length;
      return { day: label, calls: count };
    });

    const mins = Math.floor(avgDuration / 60);
    const secs = avgDuration % 60;
    const avgDurationStr = `${mins}m ${secs.toString().padStart(2, "0")}s`;

    return NextResponse.json({
      stats: {
        totalCalls,
        leads,
        avgDuration: avgDurationStr,
        conversionRate: `${conversionRate}%`,
      },
      recentCalls: (recentCalls ?? []).map((c) => ({
        id: c.id,
        callSid: c.call_sid,
        sentiment: c.sentiment ?? "neutral",
        leadScore: c.lead_score ?? 0,
        duration: c.duration_seconds
          ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s`
          : "—",
        time: formatRelativeTime(c.created_at),
        transcript: c.transcript ?? [],
      })),
      callVolume,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}
