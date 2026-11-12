const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync('src/app/api/webhooks/whatsapp/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(secret = 'test-secret', initial = 'accepted') {
  const row = { whatsapp_message_id: 'wamid.test', whatsapp_status: initial };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, process: { env: { META_APP_SECRET: secret } }, Response, console,
    require(name) {
      if (name === 'next/server') return { NextResponse: Response };
      if (name === 'crypto') return require('node:crypto');
      if (name === 'zod') return require('zod');
      if (name === '@/lib/security') return { safeEqual: (a, b) => a === b };
      if (name === '@/lib/supabase/admin') return { supabaseAdmin: { from() {
        let values, id;
        return {
          update(input) { values = input; return this; },
          eq(_key, value) { id = value; return this; },
          async in(_key, states) {
            if (row.whatsapp_message_id === id && states.includes(row.whatsapp_status)) Object.assign(row, values);
            return { error: null };
          },
        };
      } } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  function request(status, signed = true) {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.test', status }] } }] }] });
    const signature = signed ? 'sha256=' + createHmac('sha256', 'test-secret').update(body).digest('hex') : 'invalid';
    return new Request('https://test.example/api/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': signature } });
  }
  return { api: exports, row, request };
}

test('unsigned delivery callbacks cannot change appointment status', async () => {
  const { api, row, request } = setup();
  assert.equal((await api.POST(request('delivered', false))).status, 401);
  assert.equal(row.whatsapp_status, 'accepted');
});

test('missing Meta secret fails closed', async () => {
  const { api, row, request } = setup('');
  assert.equal((await api.POST(request('delivered'))).status, 503);
  assert.equal(row.whatsapp_status, 'accepted');
});

test('verified delivery callbacks update the matching appointment', async () => {
  const { api, row, request } = setup();
  assert.equal((await api.POST(request('delivered'))).status, 200);
  assert.equal(row.whatsapp_status, 'delivered');
});

test('late sent/failed callbacks do not downgrade a read confirmation', async () => {
  const { api, row, request } = setup('test-secret', 'read');
  await api.POST(request('sent'));
  await api.POST(request('failed'));
  assert.equal(row.whatsapp_status, 'read');
});
