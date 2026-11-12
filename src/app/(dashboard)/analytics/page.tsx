"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";

import { PageHeader } from "@/components/dashboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { toast } from "sonner";

/* Chart palette — validated for CVD safety on the cream surface.
   Sentiment is a diverging trio: green pole / neutral gray / red pole. */
const INK = "#161613";
const GRID = "#E4DECB";
const AXIS = "#70705F";
const POSITIVE = "#4F7D42";
const NEUTRAL = "#87836F";
const NEGATIVE = "#C05B4D";

const tooltipStyle = {
  backgroundColor: "#FDFBF4",
  border: "1px solid #DAD3BF",
  borderRadius: 4,
  color: INK,
  fontSize: 12,
};

interface Analytics {
  stats: {
    totalCalls: number;
    leads: number;
    appointments: number;
    avgDuration: string;
  };
  callVolume: { date: string; calls: number }[];
  sentimentByAgent: { agent: string; positive: number; neutral: number; negative: number }[];
  topIntents: { intent: string; count: number }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analytics")
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (ok) setData(d);
        else toast.error(d.error ?? "Could not load analytics");
      })
      .catch(() => !cancelled && toast.error("Could not load analytics"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = data?.stats;
  const tiles = [
    { label: "Calls // 30 days", value: stats?.totalCalls ?? 0 },
    { label: "Leads captured", value: stats?.leads ?? 0 },
    { label: "Appointments", value: stats?.appointments ?? 0 },
    { label: "Avg call length", value: stats?.avgDuration ?? "0m 00s" },
  ];

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Call volume, sentiment, and trends across your agents — last 30 days."
      />

      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* stat tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {tiles.map((tile) => (
              <Card key={tile.label} className="border-brand-border bg-brand-surface">
                <CardContent className="pt-6">
                  <p className="font-data text-[10px] uppercase tracking-[0.16em] text-brand-muted">
                    {tile.label}
                  </p>
                  <p className="mt-2 font-display text-3xl font-bold text-brand-text">
                    {tile.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="border-brand-border bg-brand-surface">
              <CardHeader>
                <CardTitle className="text-brand-text">Call volume</CardTitle>
                <CardDescription>Calls handled per day, last 30 days.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data?.callVolume ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="date" stroke={AXIS} fontSize={11} interval={4} />
                      <YAxis stroke={AXIS} fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line
                        type="monotone"
                        dataKey="calls"
                        stroke={INK}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: INK }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-brand-border bg-brand-surface">
              <CardHeader>
                <CardTitle className="text-brand-text">Sentiment by agent</CardTitle>
                <CardDescription>Calls by sentiment, per agent, last 30 days.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  {data && data.sentimentByAgent.length === 0 ? (
                    <p className="flex h-full items-center justify-center text-sm text-brand-muted">
                      No calls yet — run a test call to see data here.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data?.sentimentByAgent ?? []}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                        <XAxis dataKey="agent" stroke={AXIS} fontSize={11} />
                        <YAxis stroke={AXIS} fontSize={11} allowDecimals={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 12, color: INK }} />
                        <Bar dataKey="positive" name="Positive" stackId="a" fill={POSITIVE} stroke="#F8F4E9" strokeWidth={1} />
                        <Bar dataKey="neutral" name="Neutral" stackId="a" fill={NEUTRAL} stroke="#F8F4E9" strokeWidth={1} />
                        <Bar dataKey="negative" name="Negative" stackId="a" fill={NEGATIVE} stroke="#F8F4E9" strokeWidth={1} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* top intents */}
          <Card className="border-brand-border bg-brand-surface">
            <CardHeader>
              <CardTitle className="text-brand-text">Top caller intents</CardTitle>
              <CardDescription>What people call about most.</CardDescription>
            </CardHeader>
            <CardContent>
              {data && data.topIntents.length === 0 ? (
                <p className="text-sm text-brand-muted">No intents detected yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {(data?.topIntents ?? []).map((item, i) => {
                    const max = data?.topIntents[0]?.count ?? 1;
                    return (
                      <div key={item.intent} className="flex items-center gap-3">
                        <span className="w-6 font-data text-xs text-brand-muted">0{i + 1}</span>
                        <span className="w-48 truncate text-sm capitalize text-brand-text">
                          {item.intent}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-sm bg-brand-border/50">
                          <div
                            className="h-full rounded-sm bg-[#A6BDA0]"
                            style={{ width: `${(item.count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right font-data text-xs text-brand-text">
                          {item.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
