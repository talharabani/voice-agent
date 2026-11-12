import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

export function whatsappConfigured() {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID && process.env.WHATSAPP_APPOINTMENT_TEMPLATE && process.env.META_GRAPH_API_VERSION && process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN);
}

// Only confirmed appointments are eligible. A database claim prevents duplicate
// sends when confirmation requests race or the user clicks twice.
export async function sendAppointmentConfirmation(id: string, userId: string) {
  const { data: appointment, error } = await supabaseAdmin.from('appointments').select('*').eq('id', id).eq('user_id', userId).single();
  if (error || !appointment) throw new Error('Could not load appointment for notification');
  if (appointment.status !== 'confirmed') return;
  if (['sending', 'accepted', 'sent', 'delivered', 'read', 'unknown'].includes(appointment.whatsapp_status)) return;

  const { data: clinic } = await supabaseAdmin.from('clinic_profiles').select('*').eq('user_id', userId).maybeSingle();
  const phone = appointment.customer_phone?.replace(/[\s()-]/g, '') ?? '';
  let reason = '';
  if (!whatsappConfigured()) reason = 'WhatsApp sender and approved appointment template are not configured.';
  else if (!clinic) reason = 'Complete your clinic profile in Settings.';
  else if (!appointment.whatsapp_consent) reason = 'The patient has not agreed to receive a WhatsApp confirmation.';
  else if (!/^\+[1-9]\d{7,14}$/.test(phone)) reason = 'A valid international patient number is required, for example +923001234567.';
  else if (!appointment.scheduled_at) reason = 'Confirm an exact appointment date and time first.';
  if (reason) {
    const { error: updateError } = await supabaseAdmin.from('appointments').update({ whatsapp_status: 'setup_required', whatsapp_error: reason }).eq('id', id).eq('user_id', userId);
    if (updateError) throw new Error('Could not save WhatsApp setup status');
    return;
  }
  if (!clinic || !appointment.scheduled_at) return;
  const { data: claimed, error: claimError } = await supabaseAdmin.from('appointments')
    .update({ whatsapp_status: 'sending', whatsapp_error: null })
    .eq('id', id).eq('user_id', userId).eq('status', 'confirmed')
    .in('whatsapp_status', ['not_sent', 'failed', 'setup_required']).select('id').maybeSingle();
  if (claimError) throw new Error('Could not claim appointment notification');
  if (!claimed) return;

  const time = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: clinic.timezone }).format(new Date(appointment.scheduled_at)) + ` (${clinic.timezone})`;
  const values = [appointment.customer_name || 'Patient', clinic.clinic_name, appointment.service || 'Clinic visit', time, clinic.address, clinic.phone, clinic.opening_hours];
  let status = 'unknown';
  let messageId: string | null = null;
  let failure: string | null = null;
  try {
    const version = process.env.META_GRAPH_API_VERSION!;
    const sender = process.env.META_PHONE_NUMBER_ID!;
    if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(sender)) throw new Error('Invalid WhatsApp sender or Graph API version');
    const response = await fetch(`https://graph.facebook.com/${version}/${sender}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: phone.slice(1), type: 'template',
        template: {
          name: process.env.WHATSAPP_APPOINTMENT_TEMPLATE,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
          components: [{ type: 'body', parameters: values.map(value => ({ type: 'text', text: value.replace(/\s+/g, ' ').trim() })) }],
        },
      }),
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
