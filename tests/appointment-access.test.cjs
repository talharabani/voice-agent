const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
const doctorId = '11111111-1111-4111-8111-111111111111';
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
function setup({ appointmentOwner = 'owner-a', doctorOwner = 'owner-a', active = true } = {}) {
  const appointment = { id: 'appointment-a', user_id: appointmentOwner, status: 'requested', scheduled_at: null, doctor_id: null, whatsapp_status: 'not_sent', conversation_id: 'call-a' };
  const doctor = { id: doctorId, user_id: doctorOwner, is_active: active, name: 'Dr. Verified' };
  const conversation = { id: 'call-a', user_id: appointmentOwner, transcript: [{ speaker: 'caller', text: 'My concern' }] };
  let updates = 0, notifications = 0;
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    update(values) { this.values = values; return this; }
    run() {
      const row = { appointments: appointment, doctors: doctor, conversations: conversation }[this.table];
      if (!this.filters.every(filter => filter(row))) return { data: null, error: null };
      if (this.values) { updates++; Object.assign(row, this.values); }
      return { data: { ...row }, error: null };
    }
    async single() { return this.run(); }
    async maybeSingle() { return this.run(); }
  }
  const api = load('src/app/api/appointments/[id]/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/api-helpers': { ApiError, async requireApiUser() { return { id: 'owner-a' }; }, apiErrorResponse(error) { return Response.json({ error: error.message }, { status: error.status || 500 }); } },
    '@/lib/supabase/admin': { supabaseAdmin: { from(table) { return new Query(table); } } },
    '@/lib/whatsapp': { async sendAppointmentConfirmation() { notifications++; } },
  });
  const request = changes => new Request('https://test.example/api/appointments/appointment-a', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
  return { api, appointment, request, counters: () => ({ updates, notifications }) };
}

test('another account cannot view a patient call or confirm its appointment', async () => {
  const { api, request, counters } = setup({ appointmentOwner: 'other-owner' });
  const params = { params: Promise.resolve({ id: 'appointment-a' }) };
  assert.equal((await api.GET(null, params)).status, 404);
  assert.equal((await api.PATCH(request({ status: 'confirmed' }), params)).status, 404);
  assert.equal(counters().updates, 0);
});
test('doctor assignments must belong to this clinic and be active', async () => {
  for (const options of [{ doctorOwner: 'other-owner' }, { active: false }]) {
    const { api, request, counters } = setup(options);
    const response = await api.PATCH(request({ status: 'confirmed', doctor_id: doctorId, scheduled_at: '2099-11-20T10:00:00Z' }), { params: Promise.resolve({ id: 'appointment-a' }) });
    assert.equal(response.status, 422);
    assert.equal(counters().updates, 0); assert.equal(counters().notifications, 0);
  }
});
test('confirmation requires an exact future slot and verified doctor', async () => {
  const { api, request, appointment, counters } = setup();
  const params = { params: Promise.resolve({ id: 'appointment-a' }) };
  assert.equal((await api.PATCH(request({ status: 'confirmed', scheduled_at: '2099-11-20T10:00:00Z' }), params)).status, 422);
  assert.equal((await api.PATCH(request({ status: 'confirmed', doctor_id: doctorId, scheduled_at: '2000-11-20T10:00:00Z' }), params)).status, 422);
  const response = await api.PATCH(request({ status: 'confirmed', doctor_id: doctorId, scheduled_at: '2099-11-20T10:00:00Z', doctor_name: 'Fake override' }), params);
  assert.equal(response.status, 200); assert.equal(appointment.doctor_name, 'Dr. Verified');
  assert.equal(counters().notifications, 1);
});
