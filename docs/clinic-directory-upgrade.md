# Clinic directory and multilingual voice upgrade

## Required migration

Run `supabase/006_doctor_directory.sql` in Supabase SQL Editor after the base schema, `002_appointments.sql` and `005_clinic_whatsapp.sql`. It creates the doctor directory and adds requested doctor, patient concern, reception handoff and assigned doctor fields to appointments. All doctor/profile access is scoped to the authenticated account or the public call link's agent owner. RLS remains enabled with server-only service-role access.

## Clinic setup

1. Save the clinic name, address, phone, timezone and hours in Settings.
2. Open Doctors and add real names, specialties, qualifications, experience, summaries, HTTPS photos, timings and spoken languages.
3. Add clinic-approved concern keywords in the languages your patients use. These surface relevant profiles, not a diagnosis or a guarantee of suitability.
4. Hide a doctor to remove the profile from public calls. No sample doctor records are inserted into the database.

## Calls and languages

Choose the agent's default microphone language when creating it. The public call screen also shows a visible Listening language selector and remembers the caller's choice. An explicit agent/caller preference takes priority over the browser locale. Urdu callers should begin in Urdu recognition mode; reply-language detection cannot repair words that were already misrecognized by an English speech recognizer.

Natural self-introductions such as “میرا نام طلحہ ہے”, “mera naam Talha hai”, “मेरा नाम तल्हा है”, and “my name is Talha” are acknowledged directly and remembered before booking begins. Name acknowledgements can precede the next booking question without breaking the flow. Roman Urdu booking phrases and doctor-availability questions use direct saved-data/scripted responses.

The cream/sage clinic reception page shows clinic contact details, a microphone-reactive orb, call controls and doctor profile cards. It has no chat input or live transcript. Doctor questions highlight the relevant profiles; mobile callers can jump to the highlighted profile. Six voice-tone presets and optional native voice selection are available. Presets use available system voices, pitch and rate. Youthful is a style, not an actual child voice; a requested male/female voice depends on what is installed.

Recognized English, Urdu, Punjabi (Shahmukhi) and Hindi text select the reply language. The first listening language comes from the device or agent configuration. Browser recognition listens in **one language at a time** and cannot reliably detect every first utterance automatically. Device/input fallback settings allow recovery from misheard speech. Missing Urdu/Punjabi audio voices are reported. These are browser constraints: [recognition language](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/lang), [voice language](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/lang).

## Response speed and factual answers

The initial greeting, doctor counts, saved doctor profiles, clinic address/hours and guided booking script bypass model inference. Generic replies stream sentence by sentence from Ollama. Live replies use `OLLAMA_VOICE_MODEL` (default `qwen3:0.6b`), keep the model loaded for 30 minutes, disable Qwen3 thinking and limit output to 128 tokens. Post-call analysis still uses `OLLAMA_MODEL`; its structured JSON output is not subject to the voice token limit.

Grounded doctor answers use saved clinic facts. Unknown medical concerns are referred to reception for clinician assessment. A limited urgent-symptom guard directs callers to emergency care based on [NHS symptom guidance](https://www.nhs.uk/symptoms/chest-pain/); this is not a clinical triage system. No response accuracy percentage or instant end-to-end latency is guaranteed. Device speech services, database, network, CPU speed and model loading still affect latency.

## Appointment handoff

The localized script collects one field at a time: name, international WhatsApp number, concern in the patient's words, preferred doctor, preferred date/time and explicit permission for a WhatsApp confirmation. A visit-request card shows the captured details. Users can ask to change name/phone/doctor/time. Cancelling the new request prevents its appointment record from being created; it does not cancel an existing clinic appointment.

After hangup, scripted fields are saved directly. Unstructured calls can use model extraction. In Appointments, Reception handoff shows the structured call summary and original transcript. Staff must verify captured details, select an active doctor belonging to their clinic and choose an exact future slot. Requested time is not a reservation. No calendar integration or automatic availability check is implemented.

Only clinic-confirmed appointments are eligible for a WhatsApp confirmation. The assigned doctor's name is included in the service text parameter of the existing seven-parameter template. Private patient concern text is not included in WhatsApp messages. Accepted, sent, delivered and read are separate statuses.

## WhatsApp activation

The account still needs an approved Meta appointment template and sender credentials. Until then, messages are not sent and the dashboard reports setup pending. See [existing WhatsApp setup](clinic-voice-setup.md#whatsapp-configuration). The application uses one configured platform sender; it does not provision separate WhatsApp senders for each clinic.

### Manual WhatsApp sending, available without Meta approval

Appointments has a **WhatsApp message** action. It prepares the patient name, doctor, clinic address/contact/hours and appointment time for review, then opens an [official WhatsApp click-to-chat link](https://faq.whatsapp.com/5913398998672934). Staff must press Send in WhatsApp. Draft creation does not update delivery status or automatically send anything. Pending requests are explicitly labelled unconfirmed; a confirmed message requires a scheduled slot. A valid international number and recorded WhatsApp consent are required. Patient concern text is excluded. Only the appointment owner can prepare the draft.

Settings shows which environment variable names are missing for automatic sending; no token values are exposed. The automatic Meta sender remains the existing confirmation pipeline and requires an approved template plus credentials before it can deliver messages.

## Validation

Run `node --test tests/*.test.cjs` and `npm run build`. Browser checks should cover desktop/mobile layout, six tone buttons, native voice availability, microphone permission/mute, interrupted streaming, multilingual recognition and doctor profile navigation. Automated tests do not place calls or send real WhatsApp messages.
