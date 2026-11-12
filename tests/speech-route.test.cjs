const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
const token = '11111111-1111-4111-8111-111111111111';
function setup({ found = true, providerOk = true } = {}) {
  let forwards = 0, payload, userFilter;
  const api = load('src/app/api/voice/speech/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/api-helpers': { ApiError, async requireApiUser() { return { id: 'owner-a' }; }, apiErrorResponse(error) { return Response.json({ error: error.message }, { status: error.status || 500 }); } },
    '@/lib/rate-limit': { checkRateLimit() { return { allowed: true }; } },
    '@/lib/supabase/admin': { supabaseAdmin: { from() { return { select() { return this; }, eq(key, value) { if (key === 'user_id') userFilter = value; return this; }, async maybeSingle() { return { data: found ? { id: 'agent-a' } : null }; } }; } } },
  }, { fetch: async (_url, request) => { forwards++; payload = JSON.parse(request.body); return providerOk ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }) : new Response('not available', { status: 404 }); } });
  const request = changes => new Request('https://test.example/api/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, text: 'السلام علیکم', language: 'ur', style: 'warm-female', ...changes }) });
  return { api, request, state: () => ({ forwards, payload, userFilter }) };
}
test('approved speech route forwards language/style and returns real audio', async () => {
  const { api, request, state } = setup();
  const response = await api.POST(request());
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /audio\/mpeg/);
  assert.equal(state().payload.language, 'ur'); assert.equal(state().payload.style, 'warm-female');
  assert.equal(state().payload.token, undefined);
});
test('inactive/missing public call tokens cannot request speech', async () => {
  const { api, request, state } = setup({ found: false });
  assert.equal((await api.POST(request())).status, 404); assert.equal(state().forwards, 0);
});
test('private agent speech remains scoped to its authenticated account', async () => {
  const { api, request, state } = setup({ found: false });
  assert.equal((await api.POST(request({ token: undefined, agent_id: token }))).status, 404);
  assert.equal(state().userFilter, 'owner-a'); assert.equal(state().forwards, 0);
});
test('oversized speech and provider outages return explicit errors', async () => {
  const invalid = setup(); assert.equal((await invalid.api.POST(invalid.request({ text: 'x'.repeat(2001) }))).status, 422); assert.equal(invalid.state().forwards, 0);
  const outage = setup({ providerOk: false }); assert.equal((await outage.api.POST(outage.request())).status, 503);
});
