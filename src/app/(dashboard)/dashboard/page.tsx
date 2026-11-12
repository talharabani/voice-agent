import Link from "next/link";
import { whatsappConfigured } from "@/lib/whatsapp";
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
  const [{ data: appointments, error: appointmentsError }, { data: clinic, error: clinicError }, { count: leadCount }, { count: pendingCount }, { count: confirmedCount }, { count: deliveredCount }] = await Promise.all([
    supabaseAdmin.from('appointments').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5),
    supabaseAdmin.from('clinic_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sevenDaysAgo),
    supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'requested'),
    supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'confirmed'),
    supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('whatsapp_status', ['delivered', 'read']),
  ]);
  const leads = leadCount ?? 0;
  const avgDurationSecs = convs.length
    ? Math.round(convs.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / convs.length)
    : 0;
  const mins = Math.floor(avgDurationSecs / 60);
  const secs = avgDurationSecs % 60;
  const conversionRate = totalCalls ? ((leads / totalCalls) * 100).toFixed(1) : "0.0";

  return {
    appointments: appointments ?? [], clinic, setupError: Boolean(appointmentsError || clinicError),
    pendingCount: pendingCount ?? 0, confirmedCount: confirmedCount ?? 0, deliveredCount: deliveredCount ?? 0,
    stats: [
      { label: "Calls this week", value: String(totalCalls), delta: "this week", icon: PhoneCall },
      { label: "Leads captured", value: String(leads), delta: "this week", icon: Users },
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
  const { stats, recentCalls, appointments, clinic, setupError, pendingCount, confirmedCount, deliveredCount } = await getDashboardData();

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

      {(!clinic || setupError) && <Link href="/settings" className="mb-6 block rounded-xl border border-brand-border bg-brand-teal/15 p-5 text-sm"><strong>{setupError ? 'Clinic and appointment setup needs attention.' : 'Welcome - complete your clinic profile.'}</strong><span className="mt-1 block text-brand-muted">{setupError ? 'Apply the clinic/WhatsApp database migration, then add your clinic details in Settings.' : 'Add your clinic name, address, phone and opening hours so your receptionist and confirmations have the right information.'}</span></Link>}
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
              Your latest browser and phone conversations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentCalls.length === 0 ? (
              <p className="text-sm text-brand-muted py-4 text-center">
                No calls yet. Open an agent and start a voice call to see activity here.
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
          <CardHeader><CardTitle>Clinic activity</CardTitle><CardDescription>Bookings and patient confirmations.</CardDescription></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {[["Awaiting confirmation", pendingCount], ["Confirmed appointments", confirmedCount], ["WhatsApp delivered / read", deliveredCount]].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><span className="text-brand-muted">{label}</span><strong>{value}</strong></div>)}
            <Separator />
            <div className="flex justify-between gap-4"><span className="text-brand-muted">WhatsApp setup</span><span>{whatsappConfigured() ? 'Configured' : 'Pending template'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-brand-muted">Clinic profile</span><span>{clinic ? 'Complete' : 'Required'}</span></div>
            <Link href="/appointments" className="inline-flex items-center gap-2 font-medium underline underline-offset-4">Manage appointments <ArrowUpRight className="size-4" /></Link>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6 border-brand-border bg-brand-surface">
        <CardHeader><CardTitle>Latest appointment requests</CardTitle><CardDescription>Patient details captured during calls, ready for clinic review.</CardDescription></CardHeader>
        <CardContent>{appointments.length ? <div className="divide-y divide-brand-border">{appointments.map(appointment => <Link key={appointment.id} href="/appointments" className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{appointment.customer_name || 'Unknown caller'}</p><p className="mt-1 text-sm text-brand-muted">{appointment.service || 'Clinic visit'} / {appointment.customer_phone || 'No phone captured'}</p><p className="mt-1 text-xs text-brand-muted">{appointment.requested_time || 'Time to be confirmed'}</p></div><div className="text-right"><Badge variant="secondary">{appointment.status}</Badge><p className="mt-2 text-xs text-brand-muted">WhatsApp: {appointment.whatsapp_status?.replaceAll('_', ' ') || 'not sent'}</p></div></Link>)}</div> : <p className="py-4 text-sm text-brand-muted">No booking requests yet.</p>}</CardContent>
      </Card>
    </div>
  );
}
