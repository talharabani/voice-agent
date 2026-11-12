'use client';
import { useEffect, useState } from 'react';
import { Plus, Pencil, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DoctorCard } from '@/components/voice/doctor-card';
import type { DoctorRow } from '@/types/database';

const empty = { name: '', specialty: '', qualifications: '', experience_years: 0, description: '', photo_url: '', availability: '', languages: '', concern_keywords: '', is_active: true };
export default function DoctorsPage() {
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/doctors', { signal: controller.signal }).then(async res => {
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Could not load doctors. Please try again or contact support.');
      setDoctors(data.doctors ?? []);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  function edit(doctor?: DoctorRow) {
    setEditing(doctor?.id ?? null);
    setForm(doctor ? { ...doctor, photo_url: doctor.photo_url ?? '', languages: doctor.languages.join(', '), concern_keywords: doctor.concern_keywords.join(', ') } : empty);
    setOpen(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const payload = { ...form, photo_url: form.photo_url.trim() || null, languages: form.languages.split(',').map(s => s.trim()).filter(Boolean), concern_keywords: form.concern_keywords.split(',').map(s => s.trim()).filter(Boolean) };
      const res = await fetch(editing ? `/api/doctors/${editing}` : '/api/doctors', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Could not save doctor');
      setDoctors(rows => editing ? rows.map(row => row.id === editing ? data.doctor : row) : [...rows, data.doctor]);
      setOpen(false); setError(''); toast.success('Doctor profile saved');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save doctor'); }
    finally { setSaving(false); }
  }
  return <div>
    <PageHeader title="Your medical team" description="Clinic-provided profiles your receptionist can explain and show to patients." action={<Button onClick={() => edit()}><Plus className="size-4" />Add doctor</Button>} />
    <div className="mb-6 rounded-2xl border border-brand-border bg-brand-teal/10 p-5 text-sm leading-relaxed text-brand-muted"><Stethoscope className="mb-2 size-5 text-brand-text" />Add real clinic information only. Concern keywords connect a patient's words to your published profiles; they do not diagnose a condition or confirm that a doctor is medically suitable. Include Urdu/Punjabi terms if your patients use them.</div>
    {error && <p role="alert" className="mb-5 text-sm text-red-700">{error}</p>}
    {loading ? <p className="py-12 text-brand-muted">Loading your team...</p> : doctors.length ? <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">{doctors.map(doctor => <div key={doctor.id} className="space-y-2"><DoctorCard doctor={doctor} /><div className="flex items-center justify-between px-1 text-xs"><span className="text-brand-muted">{doctor.is_active ? 'Visible to patients' : 'Hidden from patients'}</span><Button variant="ghost" size="sm" onClick={() => edit(doctor)}><Pencil className="size-3.5" />Edit profile</Button></div></div>)}</div> : <div className="rounded-2xl border border-dashed border-brand-border p-12 text-center"><Stethoscope className="mx-auto mb-4 size-8 text-brand-teal" /><h2 className="font-display text-xl">Introduce your doctors</h2><p className="mx-auto mt-2 max-w-sm text-sm text-brand-muted">Their specialties, experience and availability will appear during patient calls.</p><Button className="mt-5" onClick={() => edit()}>Add your first doctor</Button></div>}
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}><DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto border-brand-border bg-brand-surface text-brand-text sm:max-w-2xl"><DialogTitle>{editing ? 'Edit doctor profile' : 'Add a doctor'}</DialogTitle><DialogDescription>Patients see these details. Availability is informational, not a live calendar.</DialogDescription><form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      {([['name', 'Doctor name', 'Dr. ...'], ['specialty', 'Specialty', 'Dermatology'], ['qualifications', 'Qualifications', 'MBBS, FCPS'], ['availability', 'Clinic timings', 'Mon, Wed, Fri: 4-8 pm'], ['photo_url', 'Photo URL (HTTPS)', 'https://...'], ['languages', 'Spoken languages (comma separated)', 'English, Urdu']] as const).map(([key, label, placeholder]) => <div key={key} className="space-y-2"><Label htmlFor={`doctor-${key}`}>{label}</Label><Input id={`doctor-${key}`} required={key === 'name' || key === 'specialty'} value={form[key]} maxLength={key === 'photo_url' ? 2000 : 500} placeholder={placeholder} onChange={event => setForm(p => ({ ...p, [key]: event.target.value }))} /></div>)}
      <div className="space-y-2"><Label htmlFor="doctor-experience">Years of experience</Label><Input id="doctor-experience" required type="number" min={0} max={80} value={form.experience_years} onChange={event => setForm(p => ({ ...p, experience_years: Number(event.target.value) }))} /></div>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.is_active} onChange={event => setForm(p => ({ ...p, is_active: event.target.checked }))} />Visible to patients</label>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="doctor-description">Doctor summary</Label><Textarea id="doctor-description" value={form.description} maxLength={2000} rows={4} placeholder="Clinical focus, services and professional background. Avoid unverified claims." onChange={event => setForm(p => ({ ...p, description: event.target.value }))} /></div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="doctor-keywords">Clinic-approved concern keywords (comma separated)</Label><Textarea id="doctor-keywords" value={form.concern_keywords} placeholder="skin, acne, جلد, دانے" onChange={event => setForm(p => ({ ...p, concern_keywords: event.target.value }))} /><p className="text-xs text-brand-muted">Use specific terms your clinic associates with this profile. Matching suggests a directory entry, not a diagnosis.</p></div>
      <Button disabled={saving} className="sm:col-span-2" type="submit">{saving ? 'Saving...' : 'Save doctor profile'}</Button>
    </form></DialogContent></Dialog>
  </div>;
}
