import type { AppointmentRow, ClinicProfileRow } from '@/types/database';

export function prepareWhatsAppMessage(appointment: AppointmentRow, clinic: ClinicProfileRow) {
  const phone = appointment.customer_phone?.replace(/[\s()-]/g, '') ?? '';
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Add a valid patient number with its country code first.');
  if (!appointment.whatsapp_consent) throw new Error('Verify the patient agreed to receive WhatsApp appointment details first.');
  if (!['requested', 'confirmed'].includes(appointment.status)) throw new Error('WhatsApp drafts are available for requested or confirmed appointments.');
  const confirmed = appointment.status === 'confirmed';
  if (confirmed && !appointment.scheduled_at) throw new Error('Choose the confirmed appointment date and time first.');
  const time = confirmed ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: clinic.timezone }).format(new Date(appointment.scheduled_at!)) + ` (${clinic.timezone})` : appointment.requested_time || 'To be agreed';
  const message = [
    `Hello ${appointment.customer_name || 'there'},`,
    confirmed ? `Your appointment at ${clinic.clinic_name} is confirmed.` : `${clinic.clinic_name} has received your appointment request. The doctor and slot still need clinic confirmation.`,
    `Doctor: ${appointment.doctor_name || appointment.requested_doctor || 'Reception will confirm'}`,
    `Service: ${appointment.service || 'Clinic visit'}`,
    `${confirmed ? 'Appointment' : 'Preferred'} date/time: ${time}`,
    `Clinic address: ${clinic.address}`,
    `Clinic contact: ${clinic.phone}`,
    `Opening hours: ${clinic.opening_hours}`,
  ].join('\n');
  return { message, url: `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}` };
}
