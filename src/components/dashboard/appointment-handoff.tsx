'use client';
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { AppointmentRow } from '@/types/database';

export function AppointmentHandoff({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ appointment: AppointmentRow; transcript: { speaker: string; text: string }[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    fetch(`/api/appointments/${id}`, { signal: controller.signal }).then(async res => {
      const response = await res.json(); if (!res.ok) throw new Error(response.error ?? 'Could not load call record');
      setData(response);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, open]);
  return <><Button variant="outline" onClick={() => setOpen(true)}><FileText className="size-4" />Reception handoff</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto border-brand-border bg-brand-surface text-brand-text sm:max-w-2xl"><DialogTitle>Patient call & reception handoff</DialogTitle><DialogDescription>Review the caller's actual words before confirming extracted details.</DialogDescription>
    {loading && <p className="text-sm text-brand-muted">Loading call record...</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data?.appointment.doctor_name && <p className="rounded-lg bg-brand-teal/15 p-3 text-sm">Assigned doctor: {data.appointment.doctor_name}</p>}
    {data && <><pre className="whitespace-pre-wrap rounded-xl border border-brand-border bg-brand-bg p-4 font-body text-sm leading-relaxed">{data.appointment.call_summary || `Patient: ${data.appointment.customer_name || 'Not captured'}\nDoctor: ${data.appointment.requested_doctor || 'Clinic to assign'}\nConcern: ${data.appointment.patient_concern || 'Review transcript'}\nPreferred time: ${data.appointment.requested_time || 'Not captured'}`}</pre><p className="text-xs text-brand-muted">Current booking: {data.appointment.status}. Confirmed slot: {data.appointment.scheduled_at ? new Date(data.appointment.scheduled_at).toLocaleString() : 'Not assigned'}. WhatsApp: {data.appointment.whatsapp_status?.replaceAll('_', ' ')}.</p><details><summary className="cursor-pointer text-sm font-medium">Read the original call transcript</summary><div className="mt-4 space-y-3">{data.transcript.length ? data.transcript.map((turn, index) => <div key={index} className="rounded-xl border border-brand-border p-3"><p className="mb-1 font-data text-[10px] uppercase tracking-widest text-brand-muted">{turn.speaker === 'caller' ? 'Patient' : 'Receptionist'}</p><p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed">{turn.text}</p></div>) : <p className="text-sm text-brand-muted">No linked call transcript is available.</p>}</div></details></>}
  </DialogContent></Dialog></>;
}
