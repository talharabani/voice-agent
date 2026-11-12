const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
const { prepareWhatsAppMessage } = load('src/lib/whatsapp-message.ts');
const clinic = { clinic_name: 'Clinic One', address: '10 Clinic Street', phone: '+923001111111', opening_hours: 'Mon-Sat 9-6', timezone: 'Asia/Karachi' };
const appointment = { status: 'confirmed', customer_name: 'Talha', customer_phone: '+923001234567', whatsapp_consent: true, scheduled_at: '2099-11-20T10:00:00Z', doctor_name: 'Dr. Verified', service: 'Consultation', patient_concern: 'Private concern' };

test('manual confirmation includes doctor, clinic and exact appointment but excludes private concerns', () => {
  const draft = prepareWhatsAppMessage(appointment, clinic);
  assert.match(draft.message, /Dr\. Verified/); assert.match(draft.message, /Clinic One/);
  assert.match(draft.message, /15:00/); assert.doesNotMatch(draft.message, /Private concern/);
  const url = new URL(draft.url); assert.equal(url.hostname, 'wa.me'); assert.equal(url.pathname, '/923001234567');
  assert.equal(url.searchParams.get('text'), draft.message);
});
test('a pending request is not falsely described as a confirmed appointment', () => {
  const draft = prepareWhatsAppMessage({ ...appointment, status: 'requested', scheduled_at: null, requested_time: 'Friday afternoon' }, clinic);
  assert.match(draft.message, /still need clinic confirmation/); assert.doesNotMatch(draft.message, /is confirmed/);
});
test('manual WhatsApp drafts require permission and a valid international number', () => {
  assert.throws(() => prepareWhatsAppMessage({ ...appointment, whatsapp_consent: false }, clinic), /agreed/);
  assert.throws(() => prepareWhatsAppMessage({ ...appointment, customer_phone: '03001234567' }, clinic), /country code/);
});
test('a different account cannot prepare another patient WhatsApp draft', async () => {
  let suppliedOwner;
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const api = load('src/app/api/appointments/[id]/whatsapp-draft/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/api-helpers': { ApiError, async requireApiUser() { return { id: 'owner-a' }; }, apiErrorResponse(error) { return Response.json({ error: error.message }, { status: error.status || 500 }); } },
    '@/lib/supabase/admin': { supabaseAdmin: { from(table) { return { select() { return this; }, eq(key, value) { if (table === 'appointments' && key === 'user_id') suppliedOwner = value; return this; }, async maybeSingle() { return { data: table === 'appointments' ? null : clinic }; } }; } } },
  });
  const response = await api.GET(null, { params: Promise.resolve({ id: 'other-appointment' }) });
  assert.equal(response.status, 404); assert.equal(suppliedOwner, 'owner-a');
});
