const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
const { readJsonLines, takeSpeechSegments } = load('src/lib/voice/protocol.ts');

test('NDJSON decoder preserves Urdu split across UTF-8 byte boundaries', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ text: 'السلام علیکم' }) + '\n' + JSON.stringify({ done: true }));
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } });
  const events = []; for await (const event of readJsonLines(body)) events.push(event);
  assert.equal(events[0].text, 'السلام علیکم'); assert.equal(events[1].done, true);
});
test('sentence segmentation keeps doctor titles and decimals intact', () => {
  const result = takeSpeechSegments('Dr. Ayesha has 8 years of experience. Consultation is 2.5 hours away. ', false);
  assert.equal(result.sentences.length, 2);
  assert.equal(result.sentences[0], 'Dr. Ayesha has 8 years of experience.');
  assert.match(result.sentences[1], /2\.5/);
  assert.equal(takeSpeechSegments('The fee is 2.', false).sentences.length, 0);
  assert.equal(takeSpeechSegments('Please tell me more', true).sentences[0], 'Please tell me more');
});

function responseApi(model) {
  return load('src/lib/voice/clinic-response.ts', {
    '@/lib/clinic-directory': { async loadClinicDirectory() { return { doctors: [], clinic: null, available: true }; } },
    '@/lib/ai/ollama': model,
  });
}
test('doctor questions and scripted bookings do not call the slow model', async () => {
  const api = responseApi({ ollamaChat() { throw new Error('Inference should be bypassed'); } });
  assert.match(await api.generateAgentReply({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'How many doctors do you have?' }]), /not published/);
  assert.match(await api.generateAgentReply({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'I want an appointment' }]), /full name/);
});
test('first sentence streams before the model completes its reply', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let finished = false;
  const api = responseApi({ async *ollamaChatStream() { yield 'Welcome to reception. '; await gate; finished = true; yield 'How can I help?'; } });
  const response = await api.createVoiceStream({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'Do you offer wheelchair access?' }], 'en', new AbortController().signal);
  const events = readJsonLines(response.body);
  assert.equal((await events.next()).value.type, 'meta');
  const first = (await events.next()).value;
  assert.equal(first.type, 'sentence'); assert.equal(first.text, 'Welcome to reception.'); assert.equal(finished, false);
  release();
  const rest = []; for await (const event of events) rest.push(event);
  assert.equal(rest.at(-1).type, 'done'); assert.equal(finished, true);
});
test('streamed thinking text is never spoken', async () => {
  const api = responseApi({ async *ollamaChatStream() { for (const chunk of ['<thi', 'nk>Private reasoning.', '</think>', 'Hello. ']) yield chunk; } });
  const response = await api.createVoiceStream({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'Do you offer wheelchair access?' }], 'en', new AbortController().signal);
  const events = []; for await (const event of readJsonLines(response.body)) events.push(event);
  const spoken = events.filter(event => event.type === 'sentence').map(event => event.text).join(' ');
  assert.equal(spoken, 'Hello.'); assert.doesNotMatch(spoken, /Private|think/);
});
