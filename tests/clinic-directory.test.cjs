const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
const { answerFromDirectory, matchesTerm } = load('src/lib/voice/directory-answer.ts');
const { detectCallLanguage } = load('src/lib/voice/language.ts');
const { selectBrowserVoice } = load('src/lib/voice/presets.ts');
const doctor = { id: 'doctor-a', name: 'Dr. Ayesha Khan', specialty: 'Dermatology', experience_years: 8, description: 'Clinic-provided skin care profile', qualifications: 'MBBS', availability: 'Monday 4-8 pm', languages: ['Urdu', 'English'], concern_keywords: ['skin', 'acne', 'جلد'], photo_url: null };
const second = { ...doctor, id: 'doctor-b', name: 'Dr. Ali Ahmed', specialty: 'General practice', experience_years: 12, concern_keywords: ['general checkup'] };
const clinic = { clinic_name: 'Test clinic', address: '10 Test Street', phone: '+923001234567', opening_hours: 'Mon-Sat 9-6' };

test('doctor count and specialties are grounded in the published directory', () => {
  const answer = answerFromDirectory('How many doctors do you have and their specialties?', [doctor, second], clinic, 'en');
  assert.match(answer.reply, /2 doctors/);
  assert.deepEqual(Array.from(answer.doctorIds), ['doctor-a', 'doctor-b']);
});
test('named doctor gets their exact saved experience and profile', () => {
  const answer = answerFromDirectory('Tell me about Ayesha Khan', [doctor, second], clinic, 'en');
  assert.match(answer.reply, /Dermatology.*8 years/);
  assert.deepEqual(Array.from(answer.doctorIds), ['doctor-a']);
});
test('clinic-approved concern keywords suggest profiles without claiming suitability', () => {
  const answer = answerFromDirectory('I have acne. Which doctor is suitable?', [doctor, second], clinic, 'en');
  assert.deepEqual(Array.from(answer.doctorIds), ['doctor-a']);
  assert.match(answer.reply, /reception must confirm/);
  assert.equal(matchesTerm('a task in progress', 'skin'), false);
  assert.equal(matchesTerm('جلد پر دانے ہیں', 'جلد'), true);
});
test('unknown doctors, empty directories and directory outages do not invent names', () => {
  assert.match(answerFromDirectory('How many doctors?', [], clinic, 'en').reply, /not published/);
  assert.match(answerFromDirectory('How many doctors?', [], clinic, 'en', false).reply, /unavailable/);
  const answer = answerFromDirectory('Tell me about Dr. Imaginary', [doctor], clinic, 'en');
  assert.doesNotMatch(answer.reply, /Imaginary/);
});
test('urgent symptoms bypass routine specialty matching', () => {
  const answer = answerFromDirectory('I have chest pain, which doctor should I book?', [doctor], clinic, 'en');
  assert.equal(answer.kind, 'urgent');
  assert.match(answer.reply, /emergency/);
  assert.equal(answer.doctorIds.length, 0);
});
test('unsupported medical questions do not generate diagnoses or medicines', () => {
  const answer = answerFromDirectory('What medicine should I take for stomach pain?', [doctor], clinic, 'en');
  assert.match(answer.reply, /clinician/);
  assert.equal(answer.doctorIds.length, 0);
});
test('English, Urdu, Punjabi and Hindi transcripts select matching reply language', () => {
  assert.equal(detectCallLanguage('How many doctors do you have?'), 'en');
  assert.equal(detectCallLanguage('آپ کے کتنے ڈاکٹر ہیں؟'), 'ur');
  assert.equal(detectCallLanguage('تسی مینوں ڈاکٹر بارے دسو'), 'pa');
  assert.equal(detectCallLanguage('आपके कितने डॉक्टर हैं?'), 'hi');
  assert.equal(detectCallLanguage('Tusi mainu doctor bare dasso'), 'pa');
  assert.equal(detectCallLanguage('mujhe doctor chahiye'), 'ur');
  assert.match(answerFromDirectory('آپ کے کتنے ڈاکٹر ہیں؟', [doctor], clinic, 'ur').reply, /فہرست/);
});
test('browser voice selection respects locale and reports missing language voices', () => {
  const voices = [{ voiceURI: 'en-male', name: 'Microsoft David', lang: 'en-US' }, { voiceURI: 'ur-female', name: 'Microsoft Uzma', lang: 'ur-PK' }];
  assert.equal(selectBrowserVoice(voices, 'en', 'calm-male').voice.voiceURI, 'en-male');
  assert.equal(selectBrowserVoice(voices, 'ur', 'warm-female', 'en-male').voice.voiceURI, 'ur-female');
  assert.equal(selectBrowserVoice(voices, 'pa', 'gentle').languageAvailable, false);
  assert.equal(selectBrowserVoice(voices, 'ur', 'deep-male').styleAvailable, false);
});
test('directory responses strip owner data and only query active doctors for that clinic', async () => {
  const queries = [];
  const api = load('src/lib/clinic-directory.ts', { '@/lib/supabase/admin': { supabaseAdmin: { from(table) {
    const filters = []; queries.push({ table, filters });
    return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
      async maybeSingle() { return { data: clinic }; }, async order() { return { data: [{ ...doctor, user_id: 'owner-a', created_at: 'x', updated_at: 'x', is_active: true }] }; } };
  } } } });
  const result = await api.loadClinicDirectory('owner-a');
  assert.equal(result.doctors[0].user_id, undefined);
  assert.ok(queries.every(query => query.filters.some(([key, value]) => key === 'user_id' && value === 'owner-a')));
  assert.ok(queries.find(query => query.table === 'doctors').filters.some(([key, value]) => key === 'is_active' && value === true));
});
