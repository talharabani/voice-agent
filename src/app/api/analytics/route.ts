import { NextResponse } from "next/server";

import { apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/analytics — 30-day aggregates for the analytics page:
 * daily call volume, sentiment per agent, top intents, headline stats.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [convRes, agentRes, apptRes, leadRes] = await Promise.all([
      supabaseAdmin
        .from("conversations")
        .select("id, agent_id, sentiment, intent, duration_seconds, created_at")
        .eq("user_id", user.id)
        .gte("created_at", thirtyDaysAgo)
        .limit(5000),
      supabaseAdmin.from("agents").select("id, name").eq("user_id", user.id),
      supabaseAdmin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", thirtyDaysAgo),
      supabaseAdmin
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", thirtyDaysAgo),
    ]);

    if (convRes.error) throw convRes.error;
    if (agentRes.error) throw agentRes.error;

    const convs = convRes.data ?? [];
    const agents = agentRes.data ?? [];
    const agentName = new Map(agents.map((a) => [a.id, a.name]));

    // Daily call volume, last 30 days
    const callVolume = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      const dateStr = d.toISOString().split("T")[0];
      return {
        date: `${d.getDate()}/${d.getMonth() + 1}`,
        calls: convs.filter((c) => c.created_at.startsWith(dateStr)).length,
      };
    });

    // Sentiment per agent (top 5 agents by call count)
    const byAgent = new Map<string, { positive: number; neutral: number; negative: number; total: number }>();
    for (const c of convs) {
      const entry = byAgent.get(c.agent_id) ?? { positive: 0, neutral: 0, negative: 0, total: 0 };
      const sentiment = (c.sentiment ?? "neutral") as "positive" | "neutral" | "negative";
      entry[sentiment] += 1;
      entry.total += 1;
      byAgent.set(c.agent_id, entry);
    }
    const sentimentByAgent = [...byAgent.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([id, v]) => ({
        agent: agentName.get(id) ?? "Unknown",
        positive: v.positive,
        neutral: v.neutral,
        negative: v.negative,
      }));

    // Top intents
    const intentCounts = new Map<string, number>();
    for (const c of convs) {
      if (!c.intent) continue;
      const key = c.intent.trim().toLowerCase();
      intentCounts.set(key, (intentCounts.get(key) ?? 0) + 1);
    }
    const topIntents = [...intentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([intent, count]) => ({ intent, count }));

    // Headline stats
    const totalCalls = convs.length;
    const withDuration = convs.filter((c) => c.duration_seconds != null);
    const avgDuration = withDuration.length
      ? Math.round(
          withDuration.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / withDuration.length
        )
      : 0;
    const mins = Math.floor(avgDuration / 60);
    const secs = avgDuration % 60;

    return NextResponse.json({
      stats: {
        totalCalls,
        leads: leadRes.count ?? 0,
        appointments: apptRes.count ?? 0,
        avgDuration: `${mins}m ${secs.toString().padStart(2, "0")}s`,
      },
      callVolume,
      sentimentByAgent,
      topIntents,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
