"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, MessageCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { AppointmentHandoff } from '@/components/dashboard/appointment-handoff';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { AppointmentRow, DoctorRow } from "@/types/database";

type Appointment = AppointmentRow & { agents: { name: string } | null };
const messageLabels: Record<string, string> = { not_sent: 'Not sent', setup_required: 'Action needed', sending: 'Sending', accepted: 'Accepted by WhatsApp', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', unknown: 'Check Meta' };
export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [slot, setSlot] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [consent, setConsent] = useState(false);
  const [filter, setFilter] = useState('all');
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/appointments'); const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load appointments');
      setAppointments(data.appointments ?? []); setError('');
      const doctorRes = await fetch('/api/doctors'); const doctorData = await doctorRes.json();
      if (doctorRes.ok) setDoctors(doctorData.doctors ?? []); else setError('Doctor directory is temporarily unavailable. Please try again or contact support before confirming appointments.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load appointments'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [load]);
  async function update(id: string, changes: object) {
    setBusy(id);
    try {
      const res = await fetch(`/api/appointments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Could not update appointment');
      setAppointments(rows => rows.map(row => row.id === id ? data.appointment : row));
      if (data.notificationError) toast.warning(data.notificationError);
      else if (data.appointment.whatsapp_error && data.appointment.status === 'confirmed') toast.warning(data.appointment.whatsapp_error);
      else toast.success('Appointment updated');
      setSelected(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not update appointment'); }
    finally { setBusy(null); }
  }
  function openConfirm(appointment: Appointment) {
    const date = appointment.scheduled_at ? new Date(appointment.scheduled_at) : null;
    const localSlot = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    setDoctorId(appointment.doctor_id || doctors.find(doctor => doctor.is_active && doctor.name.toLowerCase() === appointment.requested_doctor?.toLowerCase())?.id || '');
    setSelected(appointment); setSlot(localSlot); setPhone(appointment.customer_phone ?? ''); setService(appointment.service ?? ''); setConsent(appointment.whatsapp_consent);
  }
  return <div>
    <PageHeader title="Appointments" description="Review call requests, confirm a slot and track the patient's WhatsApp confirmation." action={<Button variant="outline" onClick={load}><RefreshCw className="size-4" />Refresh</Button>} />
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      {[['requested', 'Awaiting confirmation'], ['confirmed', 'Confirmed appointments'], ['delivered', 'WhatsApp delivered / read']].map(([key, label]) => <div key={key} className="rounded-xl border border-brand-border bg-brand-surface p-5"><p className="text-sm text-brand-muted">{label}</p><p className="mt-2 font-display text-3xl">{appointments.filter(a => key === 'delivered' ? ['delivered', 'read'].includes(a.whatsapp_status) : a.status === key).length}</p></div>)}
    </div>
    <div className="mb-5 flex flex-wrap gap-2">{['all', 'requested', 'confirmed', 'completed', 'cancelled'].map(value => <Button key={value} variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)} className="capitalize">{value}</Button>)}</div>
    {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
    {loading ? <p className="py-10 text-brand-muted">Loading appointments...</p> : <div className="grid gap-4">
      {appointments.filter(a => filter === 'all' || a.status === filter).map(appointment => <article key={appointment.id} className="rounded-2xl border border-brand-border bg-brand-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 font-data text-[10px] uppercase tracking-widest text-brand-muted">{appointment.agents?.name ?? 'Voice receptionist'}</p><h2 className="font-display text-xl">{appointment.customer_name || 'Unknown caller'}</h2><p className="mt-1 text-sm text-brand-muted">{appointment.customer_phone || 'Phone number not captured'}</p></div><Badge variant={appointment.status === 'cancelled' ? 'destructive' : appointment.status === 'confirmed' ? 'default' : 'secondary'}>{appointment.status}</Badge></div>
        <div className="mt-4 grid gap-3 rounded-xl border border-brand-border bg-brand-bg p-4 text-sm sm:grid-cols-2"><div><p className="text-xs text-brand-muted">{appointment.doctor_name ? 'Assigned doctor' : 'Requested doctor'}</p><p className="mt-1">{appointment.doctor_name || appointment.requested_doctor || 'Clinic to assign'}</p></div><div><p className="text-xs text-brand-muted">Patient-reported concern</p><p dir="auto" className="mt-1">{appointment.patient_concern || 'Review call record'}</p></div></div>
        <div className="my-5 grid gap-4 text-sm sm:grid-cols-3"><div><p className="text-brand-muted">Service</p><p className="mt-1">{appointment.service || 'Not specified'}</p></div><div><p className="text-brand-muted">Requested time</p><p className="mt-1">{appointment.requested_time || 'Not specified'}</p></div><div><p className="text-brand-muted">Confirmed slot (your local time)</p><p className="mt-1">{appointment.scheduled_at ? new Date(appointment.scheduled_at).toLocaleString() : 'Awaiting clinic review'}</p></div></div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-brand-border pt-4"><div className="text-sm"><p className="flex items-center gap-2"><MessageCircle className="size-4 text-brand-teal" />{messageLabels[appointment.whatsapp_status] || 'Not sent'}</p>{appointment.whatsapp_error && <p className="mt-1 max-w-xl text-xs text-brand-muted">{appointment.whatsapp_error}</p>}</div><div className="flex flex-wrap gap-2">
          <AppointmentHandoff id={appointment.id} />
          {appointment.status === 'requested' && <Button disabled={!!busy} onClick={() => openConfirm(appointment)}><CalendarCheck className="size-4" />Confirm appointment</Button>}
          {appointment.status === 'confirmed' && <>{['not_sent', 'failed', 'setup_required'].includes(appointment.whatsapp_status) && <Button disabled={!!busy} variant="outline" onClick={() => openConfirm(appointment)}>Review confirmation</Button>}<Button variant="outline" disabled={!!busy} onClick={() => update(appointment.id, { status: 'completed' })}>Mark completed</Button>{['not_sent', 'failed', 'setup_required'].includes(appointment.whatsapp_status) && <Button disabled={!!busy} variant="outline" onClick={() => update(appointment.id, { notify: true })}>Send WhatsApp</Button>}</>}
          {['requested', 'confirmed'].includes(appointment.status) && <Button variant="ghost" disabled={!!busy} onClick={() => update(appointment.id, { status: 'cancelled' })}>Cancel booking</Button>}
        </div></div>
      </article>)}
      {!appointments.some(a => filter === 'all' || a.status === filter) && <div className="rounded-xl border border-dashed border-brand-border p-12 text-center text-sm text-brand-muted">No appointments here yet. Booking requests appear after a caller ends their call.</div>}
    </div>}
    {selected && <Dialog open onOpenChange={open => { if (!open && !busy) setSelected(null); }}><DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-y-auto rounded-2xl border-brand-border bg-brand-surface text-brand-text"><DialogTitle className="font-display text-xl">Confirm appointment</DialogTitle><DialogDescription>Review the patient details and choose an available slot.</DialogDescription>
      <form onSubmit={event => { event.preventDefault(); if (slot) void update(selected.id, { status: 'confirmed', doctor_id: doctorId, scheduled_at: new Date(slot).toISOString(), customer_phone: phone, service: service || null, whatsapp_consent: consent }); }} className="flex flex-col gap-4">
        <p className="text-sm text-brand-muted">Confirm the clinic's availability before saving. The patient will receive the clinic details with this exact slot when WhatsApp is configured.</p>
        <div className="grid gap-2"><Label htmlFor="assigned-doctor">Confirming doctor</Label><select id="assigned-doctor" required value={doctorId} onChange={event => setDoctorId(event.target.value)} className="h-10 rounded-md border border-brand-border bg-brand-bg px-3 text-sm"><option value="">Choose an active clinic doctor</option>{doctors.filter(doctor => doctor.is_active).map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name} / {doctor.specialty}</option>)}</select>{!doctors.some(doctor => doctor.is_active) && <p className="text-xs text-red-700">Add an active doctor in the Doctors section first.</p>}</div>
        <div className="grid gap-2"><Label htmlFor="slot">Appointment date and time</Label><Input autoFocus id="slot" type="datetime-local" value={slot} required onChange={e => setSlot(e.target.value)} /><p className="text-xs text-brand-muted">Enter your browser's local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}). The message uses the clinic's saved timezone.</p></div>
        <div className="grid gap-2"><Label htmlFor="patient-phone">Patient's WhatsApp number</Label><Input id="patient-phone" type="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+923001234567" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="service">Service</Label><Input id="service" value={service} maxLength={200} onChange={e => setService(e.target.value)} /></div>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />The patient explicitly agreed to receive appointment details on WhatsApp. Verify this in the call record.</label>
        <Button type="submit" disabled={!!busy}>{busy ? 'Saving...' : 'Confirm appointment'}</Button>
      </form>
    </DialogContent></Dialog>}
  </div>;
}
