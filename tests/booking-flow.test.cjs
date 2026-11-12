const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');
const { answerBookingFlow, readBookingDraft, normalizeSpokenPhone } = load('src/lib/voice/booking-flow.ts');

function buildBooking(answers, language = 'en') {
  const history = [{ speaker: 'caller', text: language === 'en' ? 'I want to book an appointment' : 'مجھے اپائنٹمنٹ چاہیے' }];
  for (const answer of answers) {
    const step = answerBookingFlow(history, [], language);
    history.push({ speaker: 'agent', text: step.reply }, { speaker: 'caller', text: answer });
  }
  return history;
}

test('scripted booking records patient, phone, concern, doctor, time and explicit consent', () => {
  const history = buildBooking(['Ayesha Khan', '+923001234567', 'I have a skin rash', 'Any doctor', 'Tomorrow at 5 pm', 'Yes']);
  const draft = readBookingDraft(history);
  assert.equal(draft.name, 'Ayesha Khan');
  assert.equal(draft.phone, '+923001234567');
  assert.equal(draft.concern, 'I have a skin rash');
  assert.equal(draft.doctor, null);
  assert.equal(draft.doctorAnswered, true);
  assert.equal(draft.time, 'Tomorrow at 5 pm');
  assert.equal(draft.consent, true);
  const result = answerBookingFlow(history, [], 'en');
  assert.match(result.reply, /End the call to submit/);
  assert.doesNotMatch(result.reply, /is confirmed|message sent/);
});
test('Urdu scripted replies preserve patient concerns in the caller language', () => {
  const history = buildBooking(['عائشہ', '+۹۲۳۰۰۱۲۳۴۵۶۷', 'جلد پر دانے ہیں', 'کوئی بھی ڈاکٹر', 'کل پانچ بجے', 'جی ہاں'], 'ur');
  const draft = readBookingDraft(history);
  assert.equal(draft.phone, '+923001234567');
  assert.equal(draft.concern, 'جلد پر دانے ہیں');
  assert.equal(draft.consent, true);
  assert.match(answerBookingFlow(history, [], 'ur').reply, /درخواست/);
});
test('invalid national phone numbers are not guessed or silently accepted', () => {
  assert.equal(normalizeSpokenPhone('03001234567'), null);
  assert.equal(normalizeSpokenPhone('plus nine two three zero zero one two three four five six seven'), '+923001234567');
  assert.equal(normalizeSpokenPhone('Call my friend on 0300'), null);
  assert.equal(normalizeSpokenPhone('پلس ۹۲۳۰۰۱۲۳۴۵۶۷'), '+923001234567');
  const history = buildBooking(['Ayesha', '03001234567']);
  assert.match(answerBookingFlow(history, [], 'en').reply, /country code/);
});

test('a doctor requested at the start of the call is retained in the booking draft', () => {
  const doctors = [{ name: 'Dr. Ayesha Khan' }];
  const history = [{ speaker: 'caller', text: 'I want to book an appointment with Dr. Ayesha Khan' }];
  assert.equal(readBookingDraft(history, doctors).doctor, 'Dr. Ayesha Khan');
  assert.equal(readBookingDraft(history, doctors).doctorAnswered, true);
});
test('declined or ambiguous WhatsApp permission is not recorded as consent', () => {
  for (const answer of ['No', 'Yes but do not send', 'نہیں']) {
    const draft = readBookingDraft(buildBooking(['Ayesha', '+923001234567', 'checkup', 'any', 'Friday at 4', answer]));
    assert.equal(draft.consent, false);
  }
  const history = buildBooking(['Ayesha', '+923001234567', 'checkup', 'any', 'Friday at 4', 'Maybe']);
  assert.equal(readBookingDraft(history).consent, null);
  assert.match(answerBookingFlow(history, [], 'en').reply, /May the clinic send/);
});
test('phone corrections replace the number without corrupting other booking fields', () => {
  const history = buildBooking(['Ayesha', '+923001234567', 'checkup']);
  history.push({ speaker: 'agent', text: answerBookingFlow(history, [], 'en').reply }, { speaker: 'caller', text: 'Change my phone number' });
  history.push({ speaker: 'agent', text: answerBookingFlow(history, [], 'en').reply }, { speaker: 'caller', text: '+923009876543' });
  assert.equal(readBookingDraft(history).phone, '+923009876543');
  assert.equal(readBookingDraft(history).concern, 'checkup');
});
test('cancelled new requests are not persisted as active bookings', () => {
  const history = buildBooking(['Ayesha', '+923001234567']);
  history.push({ speaker: 'caller', text: 'Cancel my appointment request' });
  const draft = readBookingDraft(history);
  assert.equal(draft.active, false); assert.equal(draft.cancelled, true);
  assert.match(answerBookingFlow(history, [], 'en').reply, /will not be submitted/);
});

test('changing an already-consented WhatsApp number requires fresh permission', () => {
  const history = buildBooking(['Ayesha', '+923001234567', 'checkup', 'any', 'Friday', 'Yes']);
  history.push({ speaker: 'caller', text: 'Change my phone number' });
  history.push({ speaker: 'agent', text: answerBookingFlow(history, [], 'en').reply }, { speaker: 'caller', text: '+923009876543' });
  assert.equal(readBookingDraft(history).consent, null);
  assert.match(answerBookingFlow(history, [], 'en').reply, /May the clinic send/);
});
