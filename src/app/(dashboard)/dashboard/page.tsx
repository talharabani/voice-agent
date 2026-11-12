import {
  PhoneCall,
  TrendingUp,
  Users,
  Clock,
  ArrowUpRight,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Waveform } from "@/components/voice/waveform";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUserId } from "@/lib/auth";

const SENTIMENT_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  positive: "default",
  neutral: "secondary",
  negative: "destructive",
};

async function getDashboardData() {
  const userId = await getCurrentUserId();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: weekConvs }, { data: recentCalls }] = await Promise.all([
    supabaseAdmin
      .from("conversations")
      .select("id, sentiment, lead_score, duration_seconds")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo),
    supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(4),
  ]);

  const convs = weekConvs ?? [];
  const totalCalls = convs.length;
  const leads = convs.filter((c) => (c.lead_score ?? 0) >= 60).length;
  const avgDurationSecs = convs.length
    ? Math.round(convs.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / convs.length)
    : 0;
  const mins = Math.floor(avgDurationSecs / 60);
  const secs = avgDurationSecs % 60;
  const conversionRate = totalCalls ? ((leads / totalCalls) * 100).toFixed(1) : "0.0";

  return {
    stats: [
      { label: "Calls this week", value: String(totalCalls), delta: "+0%", icon: PhoneCall },
      { label: "Leads captured", value: String(leads), delta: "+0%", icon: Users },
      {
        label: "Avg. call duration",
        value: `${mins}m ${secs.toString().padStart(2, "0")}s`,
        delta: "—",
        icon: Clock,
      },
      { label: "Conversion rate", value: `${conversionRate}%`, delta: "—", icon: TrendingUp },
    ],
    recentCalls: (recentCalls ?? []).map((c) => {
      const diff = Date.now() - new Date(c.created_at).getTime();
      const m = Math.floor(diff / 60000);
      const timeAgo = m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} hr ago`;
      return {
        id: c.id,
        callSid: c.call_sid ?? "—",
        sentiment: (c.sentiment ?? "neutral") as string,
        leadScore: c.lead_score ?? 0,
        duration: c.duration_seconds
          ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s`
          : "—",
        time: timeAgo,
      };
    }),
  };
}

export default async function DashboardOverviewPage() {
  const { stats, recentCalls } = await getDashboardData();

  return (
    <div>
      <PageHeader
        title="Overview"
        description="What your agents have been up to."
        action={
          <div className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-3 py-1.5">
            <Waveform className="scale-75" />
            <span className="text-xs font-medium text-brand-muted">
              {recentCalls.length} recent calls
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const isUp = stat.delta.startsWith("+");
          return (
            <Card key={stat.label} className="border-brand-border bg-brand-surface gap-3 py-5">
              <CardContent className="px-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-brand-muted">{stat.label}</span>
                  <Icon className="size-4 text-brand-muted" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-semibold text-brand-text">
                    {stat.value}
                  </span>
                  <span
                    className={
                      isUp
                        ? "text-xs font-medium text-brand-teal"
                        : "text-xs font-medium text-brand-muted"
                    }
                  >
                    {stat.delta}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-brand-border bg-brand-surface lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-brand-text">Recent calls</CardTitle>
            <CardDescription>
              Latest conversations from your n8n phone handler.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentCalls.length === 0 ? (
              <p className="text-sm text-brand-muted py-4 text-center">
                No calls yet. Test your workflow with curl to see data here.
              </p>
            ) : (
              <div className="flex flex-col">
                {recentCalls.map((call, i) => (
                  <div key={call.id}>
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-brand-text">
                          Call {call.callSid}
                        </p>
                        <p className="font-data text-xs text-brand-muted">
                          Lead score: {call.leadScore} · {call.duration}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={SENTIMENT_VARIANT[call.sentiment] ?? "secondary"}>
                          {call.sentiment}
                        </Badge>
                        <span className="text-xs text-brand-muted">{call.time}</span>
                      </div>
                    </div>
                    {i < recentCalls.length - 1 && (
                      <Separator className="bg-brand-border" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-brand-border bg-brand-surface">
          <CardHeader>
            <CardTitle className="text-brand-text">Pipeline status</CardTitle>
            <CardDescription>Your n8n automation backend.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-brand-muted">n8n workflow</span>
                <span className="flex items-center gap-1 font-medium text-brand-teal">
                  Active <ArrowUpRight className="size-3.5" />
                </span>
              </div>
              <Separator className="bg-brand-border" />
              <div className="flex items-center justify-between">
                <span className="text-brand-muted">Ollama (qwen3:1.7b)</span>
                <span className="text-xs text-brand-muted">local</span>
              </div>
              <Separator className="bg-brand-border" />
              <div className="flex items-center justify-between">
                <span className="text-brand-muted">Google Calendar</span>
                <span className="flex items-center gap-1 font-medium text-brand-teal">
                  Connected
                </span>
              </div>
              <Separator className="bg-brand-border" />
              <div className="flex items-center justify-between">
                <span className="text-brand-muted">Supabase</span>
                <span className="flex items-center gap-1 font-medium text-brand-teal">
                  Connected
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
