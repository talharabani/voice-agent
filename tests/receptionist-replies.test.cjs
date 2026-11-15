const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
const { bookingIntent, readBookingDraft } = load('src/lib/voice/booking-flow.ts');
const { readJsonLines } = load('src/lib/voice/protocol.ts');

test('checkup requests enter booking in Urdu, Roman Urdu, Hindi and English', () => {
  for (const text of ['مجھے چیک اپ کروانا ہے', 'mujhe checkup karwana hai', 'मुझे चेकअप करवाना है', 'I need a check-up']) {
    assert.equal(bookingIntent(text), true, text);
    assert.equal(readBookingDraft([{ speaker: 'caller', text }]).concern, text);
  }
  for (const text of ['What is a checkup?', 'I do not need a checkup', 'مجھے چیک اپ نہیں کروانا']) assert.equal(bookingIntent(text), false, text);
});

test('checkup bypasses inference and asks for patient details instead of repeating the caller', async () => {
  const api = load('src/lib/voice/clinic-response.ts', {
    '@/lib/clinic-directory': { async loadClinicDirectory() { return { doctors: [], clinic: null, available: true }; } },
    '@/lib/ai/ollama': { ollamaChat() { throw Error('must not infer'); } },
  });
  const result = await api.prepareVoiceReply({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'مجھے چیک اپ کروانا ہے' }], 'ur');
  assert.equal(result.source, 'booking');
  assert.match(result.reply, /پورا نام/);
});

test('a model echo never reaches speech or the saved agent reply', async () => {
  const caller = 'Do you offer wheelchair access?';
  const api = load('src/lib/voice/clinic-response.ts', {
    '@/lib/clinic-directory': { async loadClinicDirectory() { return { doctors: [], clinic: null, available: true }; } },
    '@/lib/ai/ollama': { async *ollamaChatStream() { yield caller + ' '; } },
  });
  const response = await api.createVoiceStream({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: caller }], 'en', new AbortController().signal);
  const events = []; for await (const event of readJsonLines(response.body)) events.push(event);
  assert.equal(events.filter(event => event.type === 'done').length, 1);
  assert.equal(events.some(event => event.text === caller || event.reply === caller), false);
  assert.match(events.at(-1).reply, /appointments and clinic information/);
});

test('stalled inference finishes once within the reply budget and cancels late output', async () => {
  let cancelled = false;
  const api = load('src/lib/voice/clinic-response.ts', {
    '@/lib/clinic-directory': { async loadClinicDirectory() { return { doctors: [], clinic: null, available: true }; } },
    '@/lib/ai/ollama': { async *ollamaChatStream(_messages, signal) {
      await new Promise(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
      yield 'Late response must never be spoken.';
    } },
  });
  const started = Date.now();
  const response = await api.createVoiceStream({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'Do you offer wheelchair access?' }], 'en', new AbortController().signal);
  const events = []; for await (const event of readJsonLines(response.body)) events.push(event);
  assert.ok(Date.now() - started < 7500);
  assert.equal(cancelled, true);
  assert.equal(events.filter(event => event.type === 'done').length, 1);
  assert.doesNotMatch(JSON.stringify(events), /Late response/);
});
