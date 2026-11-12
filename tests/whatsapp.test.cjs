const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync('src/lib/whatsapp.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(overrides = {}, options = {}) {
  const row = {
    id: 'appt-1', user_id: 'owner-1', status: 'confirmed', whatsapp_status: 'not_sent',
    whatsapp_consent: true, customer_phone: '+923001234567', customer_name: 'Ayesha',
    scheduled_at: '2026-11-20T05:00:00.000Z', service: 'Consultation', ...overrides,
  };
  const clinic = { clinic_name: 'Test clinic', address: '10 Test Street', phone: '+923001111111', opening_hours: 'Mon–Sat 9–6', timezone: 'Asia/Karachi' };
  const requests = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.values = null; }
    select() { return this; }
    eq(key, value) { this.filters.push(item => item[key] === value); return this; }
    in(key, values) { this.filters.push(item => values.includes(item[key])); return this; }
    update(values) { this.values = values; return this; }
    run() {
      const item = this.table === 'clinic_profiles' ? { ...clinic, user_id: 'owner-1' } : row;
      if (options.noClinic && this.table === 'clinic_profiles') return { data: null, error: null };
      if (!this.filters.every(filter => filter(item))) return { data: null, error: null };
      if (this.values) Object.assign(item, this.values);
      return { data: { ...item }, error: null };
    }
    single() { return Promise.resolve(this.run()); }
    maybeSingle() { return Promise.resolve(this.run()); }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  const env = { META_ACCESS_TOKEN: 'test-token', META_PHONE_NUMBER_ID: '12345', WHATSAPP_APPOINTMENT_TEMPLATE: 'appointment_confirmation', META_GRAPH_API_VERSION: 'v99.0', META_APP_SECRET: 'test-secret', META_VERIFY_TOKEN: 'test-verify', ...options.env };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: name => {
      if (name === 'server-only') return {};
      if (name === '@/lib/supabase/admin') return { supabaseAdmin: { from: table => new Query(table) } };
      throw new Error(`Unexpected dependency ${name}`);
    },
    process: { env }, Intl, Date, AbortSignal, Error,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      if (options.timeout) throw new Error('timeout');
      return { ok: !options.rejected, status: options.rejected ? 400 : 200, json: async () => options.rejected ? { error: { code: 132000 } } : { messages: [{ id: 'wamid.test' }] } };
    },
  });
  return { api: exports, row, requests };
}

test('confirmed booking sends clinic details and timezone in approved template', async () => {
  const { api, row, requests } = setup();
  await api.sendAppointmentConfirmation('appt-1', 'owner-1');
  assert.equal(row.whatsapp_status, 'accepted');
  assert.equal(row.whatsapp_message_id, 'wamid.test');
  assert.equal(requests.length, 1);
  const payload = requests[0].body;
  assert.equal(payload.to, '923001234567');
  assert.equal(payload.type, 'template');
  const values = payload.template.components[0].parameters.map(p => p.text);
  assert.equal(values.length, 7);
  assert.equal(values[1], 'Test clinic');
  assert.match(values[3], /10:00.*Asia\/Karachi/);
  assert.equal(values[4], '10 Test Street');
});

test('a booking request does not send an unconfirmed slot', async () => {
  const { api, requests } = setup({ status: 'requested' });
  await api.sendAppointmentConfirmation('appt-1', 'owner-1');
  assert.equal(requests.length, 0);
});

test('explicit consent, valid international phone and exact slot are required', async () => {
  for (const changes of [{ whatsapp_consent: false }, { customer_phone: '03001234567' }, { scheduled_at: null }]) {
    const { api, row, requests } = setup(changes);
    await api.sendAppointmentConfirmation('appt-1', 'owner-1');
    assert.equal(requests.length, 0);
    assert.equal(row.whatsapp_status, 'setup_required');
    assert.ok(row.whatsapp_error);
  }
});

test('missing approved template or clinic details reports setup pending', async () => {
  for (const options of [{ env: { WHATSAPP_APPOINTMENT_TEMPLATE: '' } }, { noClinic: true }]) {
    const { api, row, requests } = setup({}, options);
    await api.sendAppointmentConfirmation('appt-1', 'owner-1');
    assert.equal(requests.length, 0);
    assert.equal(row.whatsapp_status, 'setup_required');
  }
});

test('another account cannot send the appointment confirmation', async () => {
  const { api, requests } = setup();
  await assert.rejects(api.sendAppointmentConfirmation('appt-1', 'other-owner'));
  assert.equal(requests.length, 0);
});

test('concurrent confirmation requests claim only one send', async () => {
  const { api, requests } = setup();
  await Promise.all([api.sendAppointmentConfirmation('appt-1', 'owner-1'), api.sendAppointmentConfirmation('appt-1', 'owner-1')]);
  assert.equal(requests.length, 1);
});

test('provider rejection is failed, rather than delivered', async () => {
  const { api, row } = setup({}, { rejected: true });
  await api.sendAppointmentConfirmation('appt-1', 'owner-1');
  assert.equal(row.whatsapp_status, 'failed');
  assert.match(row.whatsapp_error, /132000/);
});

test('confirmation includes the assigned doctor and omits private patient concerns', async () => {
  const { api, requests } = setup({ doctor_name: 'Dr. Ayesha', patient_concern: 'Private patient concern' });
  await api.sendAppointmentConfirmation('appt-1', 'owner-1');
  assert.match(requests[0].body.template.components[0].parameters[2].text, /Dr\. Ayesha/);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /Private patient concern/);
});

test('unknown send outcome is not automatically retried', async () => {
  const { api, row, requests } = setup({}, { timeout: true });
  await api.sendAppointmentConfirmation('appt-1', 'owner-1');
  await api.sendAppointmentConfirmation('appt-1', 'owner-1');
  assert.equal(row.whatsapp_status, 'unknown');
  assert.equal(requests.length, 1);
});

test('accepted or delivered messages are never sent again', async () => {
  for (const status of ['sending', 'accepted', 'sent', 'delivered', 'read']) {
    const { api, requests } = setup({ whatsapp_status: status });
    await api.sendAppointmentConfirmation('appt-1', 'owner-1');
    assert.equal(requests.length, 0);
  }
});
