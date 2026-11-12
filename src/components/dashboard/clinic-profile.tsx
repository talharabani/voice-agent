'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';

const empty = { clinic_name: '', address: '', phone: '', opening_hours: '', timezone: 'Asia/Karachi' };
export function ClinicProfile() {
  const [clinic, setClinic] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/clinic', { signal: controller.signal }).then(async res => {
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Could not load clinic profile');
      if (data.clinic) setClinic(data.clinic);
      setReady(data.whatsappConfigured);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const res = await fetch('/api/clinic', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clinic) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Could not save clinic details');
      setClinic(data.clinic); toast.success('Clinic profile saved');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save clinic details'); }
    finally { setSaving(false); }
  }
  return <Card className="border-brand-border bg-brand-surface">
    <CardHeader><CardTitle>Your clinic</CardTitle><CardDescription>Complete this after creating your account. Your receptionist and appointment confirmations use these details.</CardDescription></CardHeader>
    <CardContent>
      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
      <form onSubmit={save} className="grid max-w-2xl gap-5 sm:grid-cols-2">
        {([
          ['clinic_name', 'Clinic name', 'Your clinic name'],
          ['phone', 'Clinic contact number', '+923001234567'],
          ['address', 'Clinic address', 'Street, area, city'],
          ['opening_hours', 'Opening hours', 'Mon–Sat, 9 am–6 pm'],
          ['timezone', 'Clinic timezone', 'Asia/Karachi'],
        ] as const).map(([key, label, placeholder]) => <div key={key} className="flex flex-col gap-2"><Label htmlFor={key}>{label}</Label><Input id={key} required maxLength={key === 'address' || key === 'opening_hours' ? 500 : 160} disabled={loading || saving} value={clinic[key]} placeholder={placeholder} onChange={e => setClinic(p => ({ ...p, [key]: e.target.value }))} /></div>)}
        <div className="flex items-end"><Button disabled={loading || saving} type="submit">{saving ? 'Saving…' : 'Save clinic details'}</Button></div>
      </form>
      <div className="mt-7 rounded-xl border border-brand-border bg-brand-bg p-4 text-sm"><p className="font-medium">WhatsApp confirmations: {ready ? 'Configured' : 'Setup pending'}</p><p className="mt-1 text-brand-muted">{ready ? 'Confirm an exact slot in Appointments to send the patient a WhatsApp confirmation, when they have agreed to receive it.' : 'An approved Meta appointment template and WhatsApp sender credentials are needed before confirmations can be sent. Clinic details can be saved now.'}</p></div>
    </CardContent>
  </Card>;
}
