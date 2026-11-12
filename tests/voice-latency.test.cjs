const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, process: { env: {} }, require: name => {
    if (name === 'server-only') return {};
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, ...globals });
  return exports;
}

test('initial greeting does not wait for model inference or clinic queries', async () => {
  const api = load('src/lib/voice/respond.ts', {
    '@/lib/supabase/admin': { supabaseAdmin: { from() { throw new Error('Unnecessary database call'); } } },
    '@/lib/ai/ollama': { ollamaChat() { throw new Error('Unnecessary inference'); } },
  });
  assert.equal(await api.generateAgentReply({ name: 'Reception', greeting: 'Welcome!' }, [], []), 'Welcome!');
  assert.match(await api.generateAgentReply({ name: 'Reception', greeting: null }, [], []), /Reception/);
});

test('live calls use a separate small model with bounded output and keep-alive', async () => {
  let sent;
  const api = load('src/lib/voice/respond.ts', {
    '@/lib/supabase/admin': { supabaseAdmin: { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null }; } }; } } },
    '@/lib/ai/ollama': { async ollamaChat(messages, options) { sent = { messages, options }; return 'What is your name?'; } },
  });
  await api.generateAgentReply({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'Book a visit' }]);
  assert.equal(sent.options.model, 'qwen3:0.6b');
  assert.equal(sent.options.maxTokens, 96);
  assert.equal(sent.options.keepAlive, '30m');
  assert.equal(sent.messages.at(-1).content, 'Book a visit');
});

test('voice inference options do not truncate structured post-call analysis', async () => {
  const requests = [];
  const api = load('src/lib/ai/ollama.ts', {}, {
    AbortSignal,
    fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, async json() { return { message: { content: 'OK' } }; } }; },
  });
  await api.ollamaChat([], { model: 'qwen3:0.6b', maxTokens: 96, keepAlive: '30m' });
  await api.ollamaChat([], { format: 'json' });
  assert.equal(requests[0].think, false);
  assert.equal(requests[0].options.num_predict, 96);
  assert.equal(requests[0].keep_alive, '30m');
  assert.equal(requests[1].model, 'qwen3:1.7b');
  assert.equal(requests[1].format, 'json');
  assert.equal(requests[1].options, undefined);
});
