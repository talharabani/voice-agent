"use client";

import { useEffect, useState } from "react";
import { ClinicProfile } from "@/components/dashboard/clinic-profile";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Usage = { plan: string; used: number; limit: number; remaining: number };
export default function SettingsPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/usage', { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Could not load usage');
      setUsage(data);
    }).catch(error => { if (!controller.signal.aborted) setUsageError(error.message); });
    return () => controller.abort();
  }, []);
  return <div>
    <PageHeader title="Settings" description="Your clinic profile, patient confirmations and account usage." />
    <Tabs defaultValue="profile">
      <TabsList><TabsTrigger value="profile">Clinic profile</TabsTrigger><TabsTrigger value="usage">Plan & usage</TabsTrigger></TabsList>
      <TabsContent value="profile" className="mt-6"><ClinicProfile /></TabsContent>
      <TabsContent value="usage" className="mt-6"><Card className="border-brand-border bg-brand-surface"><CardHeader><CardTitle>Account usage</CardTitle><CardDescription>Calls recorded in the current calendar month.</CardDescription></CardHeader><CardContent>
        {usageError ? <p role="alert" className="text-sm text-red-700">{usageError}</p> : usage ? <div className="max-w-lg space-y-4"><p className="font-display text-xl capitalize">{usage.plan} plan</p><p className="text-sm text-brand-muted">{usage.used} of {usage.limit} calls used / {usage.remaining} remaining</p><Progress value={Math.min(100, usage.used / Math.max(usage.limit, 1) * 100)} /><p className="text-xs text-brand-muted">Call details, leads and appointments are available in their dashboard sections.</p></div> : <p className="text-sm text-brand-muted">Loading usage...</p>}
      </CardContent></Card></TabsContent>
    </Tabs>
  </div>;
}
