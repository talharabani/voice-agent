const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./helpers/load-ts.cjs');

const {
  normalizeReferenceCode,
  generateFallbackReferenceCode,
  canonicalPhoneDigits,
  verifyCallerPhone,
  doctorOffersService,
} = load('src/lib/voice/appointment-ref.ts', { crypto });

const {
  findAvailableSlotsForDate,
  validateSlotRequest,
  matchClinicService,
} = load('src/lib/voice/slot-utils.ts');

const DOCTORS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Dr. Ahmed',
    specialty: 'Dentist',
    qualifications: 'BDS',
    experience_years: 8,
    description: 'Dental check-up, scaling, teeth whitening, root canal',
    photo_url: null,
    availability: 'Mon-Sat: 10:00 to 19:00',
    consultation_fee: 'Rs. 2,000',
    slot_duration_minutes: 30,
    languages: ['English', 'Urdu'],
    concern_keywords: ['teeth', 'toothache', 'whitening', 'dental'],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Dr. Sarah',
    specialty: 'Dermatologist',
    qualifications: 'MBBS, FCPS',
    experience_years: 10,
    description: 'Skin care, acne treatment, laser, hair PRP',
    photo_url: null,
    availability: 'Mon-Sat: 11:00 to 18:00',
    consultation_fee: 'Rs. 3,000',
    slot_duration_minutes: 30,
    languages: ['English', 'Urdu'],
    concern_keywords: ['skin', 'acne', 'hair', 'prp', 'laser'],
  },
];

const SERVICES = [
  {
    id: 'svc-dental',
    name: 'Dental Consultation',
    category: 'Dental',
    description: 'Dental exam and teeth whitening',
    fee: 'Rs. 2,000',
    duration_minutes: 30,
    doctor_ids: [],
  },
  {
    id: 'svc-prp',
    name: 'Hair PRP Treatment',
    category: 'Dermatology',
    description: 'Hair thinning and regrowth therapy',
    fee: 'Rs. 8,000',
    duration_minutes: 45,
    doctor_ids: ['22222222-2222-4222-8222-222222222222'],
  },
];

test('normalizeReferenceCode handles spoken and formatted reference variations', () => {
  assert.equal(normalizeReferenceCode('APT-2026-00125'), 'APT-2026-00125');
  assert.equal(normalizeReferenceCode('apt 2026 125'), 'APT-2026-00125');
  assert.equal(normalizeReferenceCode('A P T 2026 00125'), 'APT-2026-00125');
  assert.equal(normalizeReferenceCode('apt202600042'), 'APT-2026-00042');
  assert.equal(normalizeReferenceCode('12345'), null);
  assert.match(generateFallbackReferenceCode(new Date('2026-05-01T00:00:00Z')), /^APT-2026-\d{5}$/);
});

test('verifyCallerPhone requires matching registered phone and normalizes local/E.164 formats', () => {
  assert.equal(canonicalPhoneDigits('0300-1234567'), '923001234567');
  assert.equal(canonicalPhoneDigits('+92 300 1234567'), '923001234567');
  assert.equal(verifyCallerPhone('+923001234567', '0300-1234567'), true);
  assert.equal(verifyCallerPhone('+923001234567', '+923009999999'), false);
  assert.equal(verifyCallerPhone('+923001234567', ''), false);
  assert.equal(verifyCallerPhone(null, '+923001234567'), false);
});

test('doctorOffersService prevents assigning an unqualified doctor from another department', () => {
  assert.equal(doctorOffersService(DOCTORS[0], 'Dental Consultation', SERVICES).ok, true);
  assert.equal(doctorOffersService(DOCTORS[1], 'Dental Consultation', SERVICES).ok, false);
  assert.equal(doctorOffersService(DOCTORS[1], 'Hair PRP Treatment', SERVICES).ok, true);
  assert.equal(doctorOffersService(DOCTORS[0], 'Hair PRP Treatment', SERVICES).ok, false);
});

test('matchClinicService strictly rejects services not offered by the clinic', () => {
  const valid = matchClinicService('Hair PRP', SERVICES, DOCTORS);
  assert.equal(valid.ok, true);
  assert.equal(valid.label, 'Hair PRP Treatment');

  const invalid = matchClinicService('Cardiac Surgery', SERVICES, DOCTORS);
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /do not offer Cardiac Surgery/i);
});

test('findAvailableSlotsForDate returns real open slots, respects off days, and excludes current booking when rescheduling', () => {
  // Future Wednesday in 2027 (never in the past, not Sunday)
  const futureWed = '2027-06-09';
  const existing = [
    { id: 'appt-1', scheduled_at: null, requested_time: `${futureWed} 11:00` },
    { id: 'appt-2', scheduled_at: null, requested_time: `${futureWed} 11:30` },
  ];

  const slotsNormal = findAvailableSlotsForDate({
    date: futureWed,
    timezone: 'Asia/Karachi',
    clinicHours: '10:00 to 19:00',
    offDays: 'Sunday',
    doctorAvailability: '11:00 to 13:00',
    slotMinutes: 30,
    existingRows: existing,
  });
  assert.equal(slotsNormal.ok, true);
  assert.deepEqual([...slotsNormal.slots], ['12:00', '12:30']);

  // Excluding appt-1 frees 11:00 for rescheduling the same appointment
  const slotsReschedule = findAvailableSlotsForDate({
    date: futureWed,
    timezone: 'Asia/Karachi',
    clinicHours: '10:00 to 19:00',
    offDays: 'Sunday',
    doctorAvailability: '11:00 to 13:00',
    slotMinutes: 30,
    existingRows: existing,
    excludeAppointmentId: 'appt-1',
  });
  assert.equal(slotsReschedule.ok, true);
  assert.deepEqual([...slotsReschedule.slots], ['11:00', '12:00', '12:30']);

  // Sunday off day is rejected
  const futureSun = '2027-06-13';
  const sunResult = findAvailableSlotsForDate({
    date: futureSun,
    timezone: 'Asia/Karachi',
    clinicHours: '10:00 to 19:00',
    offDays: 'Sunday',
    slotMinutes: 30,
    existingRows: [],
  });
  assert.equal(sunResult.ok, false);

  // validateSlotRequest also enforces clinic offDays
  const slotSun = validateSlotRequest({
    date: futureSun,
    time: '12:00',
    timezone: 'Asia/Karachi',
    clinicHours: '10:00 to 19:00',
    offDays: 'Sunday',
    slotMinutes: 30,
  });
  assert.equal(slotSun.ok, false);
});
