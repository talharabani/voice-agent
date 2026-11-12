const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
const { extractIntroducedName } = load('src/lib/voice/introduction.ts');
const { answerBookingFlow, readBookingDraft, bookingIntent } = load('src/lib/voice/booking-flow.ts');

test('natural Urdu, Roman Urdu, Hindi and English introductions extract only the name', () => {
  for (const [text, name] of [
    ['Hey, my name is Talha.', 'Talha'],
    ['mera naam Talha hai', 'Talha'],
    ['میرا نام طلحہ ہے', 'طلحہ'],
    ['हे मेरा नाम तल्हा है', 'तल्हा'],
    ['My name is Talha and I want an appointment', 'Talha'],
  ]) assert.equal(extractIntroducedName(text), name, text);
  assert.equal(extractIntroducedName('What is the doctor name?'), null);
});
test('a name introduced before booking is acknowledged and reused instead of asked again', () => {
  const history = [{ speaker: 'caller', text: 'میرا نام طلحہ ہے' }, { speaker: 'agent', text: 'جی، آپ کا نام طلحہ ہے۔ آپ کو کس سلسلے میں مدد چاہیے؟' }, { speaker: 'caller', text: 'میری اپائنٹمنٹ بک کرنی ہے' }];
  const reply = answerBookingFlow(history, [], 'ur');
  assert.equal(reply.draft.name, 'طلحہ'); assert.match(reply.reply, /واٹس ایپ/);
  assert.doesNotMatch(reply.reply, /پورا نام/);
});
test('name acknowledgements do not break the next scripted answer', () => {
  const history = [{ speaker: 'caller', text: 'I want an appointment' }];
  history.push({ speaker: 'agent', text: answerBookingFlow(history, [], 'en').reply }, { speaker: 'caller', text: 'My name is Talha' });
  const reply = answerBookingFlow(history, [], 'en');
  assert.match(reply.reply, /your name as Talha/);
  history.push({ speaker: 'agent', text: reply.reply }, { speaker: 'caller', text: '+923001234567' });
  assert.equal(readBookingDraft(history).phone, '+923001234567');
});
test('Roman Urdu booking phrases use the direct booking flow', () => {
  assert.equal(bookingIntent('meri appointment book karni hai'), true);
  assert.equal(bookingIntent('mujhe appointment chahiye'), true);
  const history = [{ speaker: 'caller', text: 'mera naam Talha hai aur meri appointment book karni hai' }];
  const reply = answerBookingFlow(history, [], 'ur');
  assert.equal(reply.draft.name, 'Talha'); assert.match(reply.reply, /Talha/); assert.match(reply.reply, /واٹس ایپ/);
});
test('doctor availability answers use saved timings without inventing free slots', () => {
  const { answerFromDirectory } = load('src/lib/voice/directory-answer.ts');
  const doctor = { id: 'doc-a', name: 'Dr. Verified', specialty: 'General practice', experience_years: 8, availability: 'Monday 4-8 pm', concern_keywords: [] };
  const reply = answerFromDirectory('کون سا ڈاکٹر دستیاب ہے؟', [doctor], null, 'ur');
  assert.equal(reply.kind, 'availability'); assert.match(reply.reply, /Monday 4-8 pm/); assert.match(reply.reply, /تصدیق/);
});
test('self-introduction acknowledgement bypasses model inference', async () => {
  const api = load('src/lib/voice/clinic-response.ts', {
    '@/lib/clinic-directory': { async loadClinicDirectory() { return { doctors: [], clinic: null, available: true }; } },
    '@/lib/ai/ollama': { ollamaChat() { throw new Error('Must not infer a simple introduction'); } },
  });
  const reply = await api.prepareVoiceReply({ name: 'Reception', user_id: 'owner' }, [], [{ speaker: 'caller', text: 'میرا نام طلحہ ہے' }], 'ur');
  assert.equal(reply.source, 'introduction'); assert.match(reply.reply, /آپ کا نام طلحہ ہے/);
});
