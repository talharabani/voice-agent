'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Bell, Sparkles, BriefcaseMedical } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import type { ClinicService } from '@/types/database';

interface ClinicFormState {
  clinic_name: string;
  address: string;
  phone: string;
  opening_hours: string;
  timezone: string;
  off_days: string;
  default_slot_minutes: number;
  booking_rules: string;
  custom_instructions: string;
  staff_notify_phone: string;
  staff_webhook_url: string;
  services: ClinicService[];
}

const emptyClinic: ClinicFormState = {
  clinic_name: '',
  address: '',
  phone: '',
  opening_hours: '',
  timezone: 'Asia/Karachi',
  off_days: '',
  default_slot_minutes: 30,
  booking_rules: '',
  custom_instructions: '',
  staff_notify_phone: '',
  staff_webhook_url: '',
  services: [],
};

const emptyService = {
  name: '',
  category: '',
  fee: '',
  duration_minutes: '',
  description: '',
};

export function ClinicProfile() {
  const [clinic, setClinic] = useState<ClinicFormState>(emptyClinic);
  const [newService, setNewService] = useState(emptyService);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/clinic', { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not load clinic profile');
        if (data.clinic) {
          setClinic({
            clinic_name: data.clinic.clinic_name ?? '',
            address: data.clinic.address ?? '',
            phone: data.clinic.phone ?? '',
            opening_hours: data.clinic.opening_hours ?? '',
            timezone: data.clinic.timezone ?? 'Asia/Karachi',
            off_days: data.clinic.off_days ?? '',
            default_slot_minutes: Number(data.clinic.default_slot_minutes) || 30,
            booking_rules: data.clinic.booking_rules ?? '',
            custom_instructions: data.clinic.custom_instructions ?? '',
            staff_notify_phone: data.clinic.staff_notify_phone ?? '',
            staff_webhook_url: data.clinic.staff_webhook_url ?? '',
            services: Array.isArray(data.clinic.services) ? data.clinic.services : [],
          });
        }
        setReady(Boolean(data.whatsappConfigured));
        setMissing(data.whatsappSetup?.missing ?? []);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function addService() {
    const trimmedName = newService.name.trim();
    if (trimmedName.length < 2) {
      toast.error('Enter a service name (at least 2 characters).');
      return;
    }
    const durNum = newService.duration_minutes.trim()
      ? Number(newService.duration_minutes)
      : null;
    if (durNum !== null && (!Number.isInteger(durNum) || durNum < 5 || durNum > 180)) {
      toast.error('Service duration must be between 5 and 180 minutes.');
      return;
    }
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `svc-${Date.now()}`;
    const item: ClinicService = {
      id,
      name: trimmedName,
      category: newService.category.trim(),
      fee: newService.fee.trim(),
      duration_minutes: durNum,
      description: newService.description.trim(),
      doctor_ids: [],
    };
    setClinic((prev) => ({ ...prev, services: [...prev.services, item] }));
    setNewService(emptyService);
  }

  function removeService(id: string) {
    setClinic((prev) => ({
      ...prev,
      services: prev.services.filter((s) => s.id !== id),
    }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setWarning('');
    try {
      const payload = {
        ...clinic,
        default_slot_minutes: Math.min(180, Math.max(5, Number(clinic.default_slot_minutes) || 30)),
        staff_notify_phone: clinic.staff_notify_phone.trim() || null,
        staff_webhook_url: clinic.staff_webhook_url.trim() || null,
      };
      const res = await fetch('/api/clinic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save clinic details');
      if (data.warning) {
        setWarning(data.warning);
        toast.warning('Saved basic details — migration needed for extended fields');
      } else {
        toast.success('Clinic configuration saved — AI agent updated immediately');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save clinic details');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card className="border-brand-border bg-brand-surface">
        <CardHeader>
          <CardTitle>Clinic profile &amp; schedule</CardTitle>
          <CardDescription>
            Your AI voice receptionist strictly uses this clinic&apos;s details, hours, off days, and appointment duration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
          {warning && (
            <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              {warning}
            </p>
          )}
          <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
            {([
              ['clinic_name', 'Clinic name', 'ABC Dental & Aesthetics Clinic'],
              ['phone', 'Clinic contact number', '+923001234567'],
              ['address', 'Clinic address', 'Street, area, city'],
              ['opening_hours', 'Business hours', 'Mon–Sat, 10 am–7 pm'],
              ['off_days', 'Closed / off days', 'Sunday'],
              ['timezone', 'Clinic timezone', 'Asia/Karachi'],
            ] as const).map(([key, label, placeholder]) => (
              <div key={key} className="flex flex-col gap-2">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  required={key !== 'off_days'}
                  maxLength={key === 'address' || key === 'opening_hours' ? 500 : 160}
                  disabled={loading || saving}
                  value={clinic[key]}
                  placeholder={placeholder}
                  onChange={(e) => setClinic((p) => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex flex-col gap-2">
              <Label htmlFor="default_slot_minutes">Default appointment duration (minutes)</Label>
              <Input
                id="default_slot_minutes"
                type="number"
                min={5}
                max={180}
                step={5}
                disabled={loading || saving}
                value={clinic.default_slot_minutes}
                onChange={(e) =>
                  setClinic((p) => ({ ...p, default_slot_minutes: Number(e.target.value) || 30 }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-brand-border bg-brand-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BriefcaseMedical className="size-4 text-brand-teal" />
            Services &amp; departments
          </CardTitle>
          <CardDescription>
            Define the exact services this clinic offers (e.g., Dental, Aesthetics, Dermatology, Hair PRP, Neurosurgery). The AI agent will only discuss and book services configured here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {clinic.services.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {clinic.services.map((svc) => (
                <div
                  key={svc.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-brand-border bg-brand-bg/70 p-3.5"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-sm text-brand-text">
                      {svc.name}
                      {svc.category && (
                        <span className="ml-2 rounded-full bg-brand-teal/15 px-2 py-0.5 text-[10px] font-normal text-brand-text">
                          {svc.category}
                        </span>
                      )}
                    </p>
                    <p className="font-data text-[11px] text-brand-muted">
                      {svc.fee ? `Fee: ${svc.fee}` : 'Fee confirmed at clinic'} ·{' '}
                      {svc.duration_minutes ? `${svc.duration_minutes} min` : `${clinic.default_slot_minutes} min default`}
                    </p>
                    {svc.description && (
                      <p className="text-xs text-brand-muted">{svc.description}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-brand-muted hover:text-destructive"
                    onClick={() => removeService(svc.id)}
                    aria-label={`Remove ${svc.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-brand-border p-4 text-xs text-brand-muted">
              No services configured yet. Add each treatment or department your clinic offers below, then press Save clinic configuration.
            </p>
          )}

          <div className="grid max-w-3xl gap-3 rounded-xl border border-brand-border bg-brand-surface-raised p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-name">Service name</Label>
              <Input
                id="svc-name"
                placeholder="Hair PRP Treatment"
                value={newService.name}
                onChange={(e) => setNewService((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-category">Department / specialization</Label>
              <Input
                id="svc-category"
                placeholder="Dermatology / Aesthetics"
                value={newService.category}
                onChange={(e) => setNewService((p) => ({ ...p, category: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-fee">Fee (optional)</Label>
              <Input
                id="svc-fee"
                placeholder="Rs. 8,000"
                value={newService.fee}
                onChange={(e) => setNewService((p) => ({ ...p, fee: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-duration">Duration in minutes (optional)</Label>
              <Input
                id="svc-duration"
                type="number"
                min={5}
                max={180}
                placeholder={String(clinic.default_slot_minutes)}
                value={newService.duration_minutes}
                onChange={(e) => setNewService((p) => ({ ...p, duration_minutes: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="svc-desc">Short description (optional)</Label>
              <Input
                id="svc-desc"
                placeholder="Platelet-rich plasma therapy for hair thinning and regrowth."
                value={newService.description}
                onChange={(e) => setNewService((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="button" variant="outline" size="sm" onClick={addService}>
                <Plus className="size-3.5" />
                Add service
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-brand-border bg-brand-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand-teal" />
            Booking rules &amp; AI receptionist instructions
          </CardTitle>
          <CardDescription>
            Policies and clinic-specific instructions applied automatically to this clinic&apos;s AI agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-3xl gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="booking_rules">Booking &amp; cancellation policies</Label>
            <Textarea
              id="booking_rules"
              rows={3}
              maxLength={2000}
              disabled={loading || saving}
              value={clinic.booking_rules}
              placeholder="e.g., Arrive 10 minutes early. Free rescheduling up to 4 hours before the appointment. No walk-ins for surgical procedures."
              onChange={(e) => setClinic((p) => ({ ...p, booking_rules: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="custom_instructions">Custom clinic instructions for the AI</Label>
            <Textarea
              id="custom_instructions"
              rows={3}
              maxLength={2000}
              disabled={loading || saving}
              value={clinic.custom_instructions}
              placeholder="e.g., Mention free parking behind the plaza when callers ask for directions. Always ask whether the visit is a first consultation or follow-up."
              onChange={(e) => setClinic((p) => ({ ...p, custom_instructions: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-brand-border bg-brand-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-4 text-brand-teal" />
            Staff booking notifications &amp; WhatsApp
          </CardTitle>
          <CardDescription>
            Notify your clinic&apos;s front-desk staff automatically whenever the AI books an appointment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="staff_notify_phone">Staff WhatsApp alert number (optional)</Label>
              <Input
                id="staff_notify_phone"
                disabled={loading || saving}
                value={clinic.staff_notify_phone}
                placeholder="+923001234567"
                onChange={(e) => setClinic((p) => ({ ...p, staff_notify_phone: e.target.value }))}
              />
              <p className="text-[11px] text-brand-muted">
                Receives a WhatsApp alert for every new AI booking when Meta WhatsApp is configured.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="staff_webhook_url">Staff notification webhook URL (optional)</Label>
              <Input
                id="staff_webhook_url"
                type="url"
                disabled={loading || saving}
                value={clinic.staff_webhook_url}
                placeholder="https://hooks.example.com/clinic-bookings"
                onChange={(e) => setClinic((p) => ({ ...p, staff_webhook_url: e.target.value }))}
              />
              <p className="text-[11px] text-brand-muted">
                Receives a JSON POST payload (Slack, n8n, Zapier, or clinic CRM) after each booking is saved.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-brand-border bg-brand-bg p-4 text-sm">
            <p className="font-medium">WhatsApp confirmations: {ready ? 'Configured' : 'Setup pending'}</p>
            <p className="mt-1 text-brand-muted">
              {ready
                ? 'Confirmed and patient-consented bookings can automatically send WhatsApp confirmations to patients and alerts to staff.'
                : 'An approved Meta appointment template and WhatsApp sender credentials are needed for automated WhatsApp sending. Clinic settings and webhooks can be saved now.'}
            </p>
            {!ready && missing.length > 0 && (
              <details className="mt-3 text-xs text-brand-muted">
                <summary className="cursor-pointer">Administrator setup checklist</summary>
                <ul className="mt-2 list-inside list-disc space-y-1">
                  {missing.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div>
            <Button disabled={loading || saving} type="submit">
              {saving ? 'Saving…' : 'Save clinic configuration'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
