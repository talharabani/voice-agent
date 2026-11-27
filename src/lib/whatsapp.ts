import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

export function whatsappSetup() {
  const required = ['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID'];
  const missing = required.filter(name => !process.env[name]?.trim());
  return { configured: missing.length === 0, missing };
}
export function whatsappConfigured() { return whatsappSetup().configured; }

function normalizeWhatsappPhone(raw: string | null | undefined): string {
  const digits = raw?.replace(/[\s()-]/g, '') ?? '';
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
  if (/^923\d{9}$/.test(digits)) return `+${digits}`;
  return digits;
}

// Sends a WhatsApp confirmation for confirmed or patient-consented requested appointments.
export async function sendAppointmentConfirmation(id: string, userId: string) {
  const { data: appointment, error } = await supabaseAdmin.from('appointments').select('*').eq('id', id).eq('user_id', userId).single();
  if (error || !appointment) throw new Error('Could not load appointment for notification');
  if (appointment.status !== 'confirmed' && !(appointment.status === 'requested' && appointment.whatsapp_consent)) return;
  if (['sending', 'accepted', 'sent', 'delivered', 'read', 'unknown'].includes(appointment.whatsapp_status)) return;

  const { data: clinic } = await supabaseAdmin.from('clinic_profiles').select('*').eq('user_id', userId).maybeSingle();
  const phone = normalizeWhatsappPhone(appointment.customer_phone);
  const templateName = process.env.WHATSAPP_APPOINTMENT_TEMPLATE?.trim();
  let reason = '';
  if (!whatsappConfigured()) reason = 'WhatsApp sender (META_ACCESS_TOKEN / META_PHONE_NUMBER_ID) is not configured.';
  else if (!clinic) reason = 'Complete your clinic profile in Settings.';
  else if (!appointment.whatsapp_consent) reason = 'The patient has not agreed to receive a WhatsApp confirmation.';
  else if (!/^\+[1-9]\d{7,14}$/.test(phone)) reason = 'A valid international patient number is required, for example +923001234567.';
  if (reason) {
    const { error: updateError } = await supabaseAdmin.from('appointments').update({ whatsapp_status: 'setup_required', whatsapp_error: reason }).eq('id', id).eq('user_id', userId);
    if (updateError) throw new Error('Could not save WhatsApp setup status');
    return;
  }
  if (!clinic) return;
  const { data: claimed, error: claimError } = await supabaseAdmin.from('appointments')
    .update({ whatsapp_status: 'sending', whatsapp_error: null })
    .eq('id', id).eq('user_id', userId)
    .in('whatsapp_status', ['not_sent', 'failed', 'setup_required']).select('id').maybeSingle();
  if (claimError) throw new Error('Could not claim appointment notification');
  if (!claimed) return;

  const time = appointment.scheduled_at
    ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: clinic.timezone }).format(new Date(appointment.scheduled_at)) + ` (${clinic.timezone})`
    : (appointment.requested_time || 'To be confirmed by clinic');
  const service = (appointment.service || 'Clinic visit') + (appointment.requested_doctor || appointment.doctor_name ? ` with ${appointment.requested_doctor || appointment.doctor_name}` : '');
  const values = [appointment.customer_name || 'Patient', clinic.clinic_name, service, time, clinic.address, clinic.phone, clinic.opening_hours];
  let status = 'unknown';
  let messageId: string | null = null;
  let failure: string | null = null;
  try {
    const version = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
    const sender = process.env.META_PHONE_NUMBER_ID!.trim();
    if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(sender)) throw new Error('Invalid WhatsApp sender or Graph API version');
    const bodyPayload = templateName
      ? {
          messaging_product: 'whatsapp',
          to: phone.slice(1),
          type: 'template',
          template: {
            name: templateName,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
            components: [{ type: 'body', parameters: values.map(value => ({ type: 'text', text: value.replace(/\s+/g, ' ').trim() })) }],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: phone.slice(1),
          type: 'text',
          text: {
            body: `Assalam-o-Alaikum ${appointment.customer_name || ''}, your appointment request at ${clinic.clinic_name} (${service}) for ${time} has been received. Address: ${clinic.address}. Contact: ${clinic.phone}`.replace(/\s+/g, ' ').trim(),
          },
        };
    const response = await fetch(`https://graph.facebook.com/${version}/${sender}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) {
      status = 'failed';
      failure = `WhatsApp rejected the message (code ${result.error?.code ?? response.status}). Check the sender, template and recipient in Meta.`;
    } else if (typeof result.messages?.[0]?.id === 'string') {
      status = 'accepted'; messageId = result.messages[0].id;
    } else failure = 'WhatsApp response was incomplete. Check Meta before retrying.';
  } catch {
    // A timeout may happen after Meta accepts a send. Do not automatically retry.
    failure = 'Send outcome is unknown. Check Meta before sending another confirmation.';
  }
  const { error: saveError } = await supabaseAdmin.from('appointments').update({
    whatsapp_status: status, whatsapp_message_id: messageId, whatsapp_error: failure,
    whatsapp_sent_at: messageId ? new Date().toISOString() : null,
  }).eq('id', id).eq('user_id', userId).eq('whatsapp_status', 'sending');
  if (saveError) throw new Error('Could not save WhatsApp send result; check Meta before retrying');
}

/**
 * Notify a clinic's designated staff member after a booking is persisted.
 * Supports WhatsApp text alert (via existing Meta Cloud API credentials)
 * and/or a clinic-configured HTTPS webhook. Never throws so a notification
 * failure cannot roll back a saved appointment.
 */
export async function notifyClinicStaff({
  clinic,
  appointment,
}: {
  clinic: {
    clinic_name: string;
    phone?: string | null;
    timezone?: string | null;
    staff_notify_phone?: string | null;
    staff_webhook_url?: string | null;
  } | null;
  appointment: {
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    service: string | null;
    doctor_name: string | null;
    requested_time: string | null;
    patient_concern: string | null;
  };
}): Promise<{ whatsappSent: boolean; webhookSent: boolean }> {
  let whatsappSent = false;
  let webhookSent = false;
  if (!clinic) return { whatsappSent, webhookSent };

  const staffPhone = normalizeWhatsappPhone(clinic.staff_notify_phone);
  if (staffPhone && /^\+[1-9]\d{7,14}$/.test(staffPhone) && whatsappConfigured()) {
    try {
      const version = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
      const sender = process.env.META_PHONE_NUMBER_ID!.trim();
      if (/^v\d+\.\d+$/.test(version) && /^\d+$/.test(sender)) {
        const text = [
          `New booking at ${clinic.clinic_name}`,
          `Patient: ${appointment.customer_name || 'Unknown'} (${appointment.customer_phone || 'No phone'})`,
          `Service: ${appointment.service || 'Consultation'}`,
          `Doctor: ${appointment.doctor_name || 'To be assigned'}`,
          `Slot: ${appointment.requested_time || 'To be confirmed'}`,
          appointment.patient_concern ? `Concern: ${appointment.patient_concern}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        const res = await fetch(`https://graph.facebook.com/${version}/${sender}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: staffPhone.slice(1),
            type: 'text',
            text: { body: text },
          }),
          signal: AbortSignal.timeout(10000),
        });
        whatsappSent = res.ok;
      }
    } catch (err) {
      console.warn('Staff WhatsApp notification failed:', err instanceof Error ? err.message : 'Unknown');
    }
  }

  const webhookUrl = clinic.staff_webhook_url?.trim();
  if (webhookUrl && /^https:\/\/.+/i.test(webhookUrl)) {
    try {
      const parsed = new URL(webhookUrl);
      const host = parsed.hostname.toLowerCase();
      const isPrivate =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);
      if (!isPrivate) {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'appointment.booked',
            clinic_name: clinic.clinic_name,
            timezone: clinic.timezone || 'Asia/Karachi',
            appointment,
            sent_at: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(8000),
        });
        webhookSent = res.ok;
      }
    } catch (err) {
      console.warn('Staff webhook notification failed:', err instanceof Error ? err.message : 'Unknown');
    }
  }

  return { whatsappSent, webhookSent };
}
