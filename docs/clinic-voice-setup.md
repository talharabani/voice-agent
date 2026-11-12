# Clinic voice calls and WhatsApp confirmations

## Database deployment

Before deploying this update, run `supabase/005_clinic_whatsapp.sql` in the Supabase SQL Editor. Apply `schema.sql` and migrations 002?004 first if the database is new. The new table uses RLS with server-only service-role access. Do not expose the service-role key in public variables.

## Account setup

New signups open Settings to complete their clinic profile. Existing users see a dashboard prompt. Each authenticated user saves their own clinic name, address, contact phone, opening hours and IANA timezone. Phone numbers must include the country code, e.g. +923001234567. The receptionist reads the account's clinic profile and its agent's knowledge.

## Audio calls

The public `/call/[token]` page and dashboard agent call tester share an audio-only screen. There is no live transcript or text input on this screen. It provides microphone permission, mute/unmute, tap-to-interrupt, timer and hangup controls. Use Chrome or Edge over HTTPS. Browser speech recognition and speech synthesis provide audio; this is a turn-based browser voice implementation, not a full-duplex realtime audio service. Recognition currently uses English. Browser voice availability varies.

Call transcripts remain server-side for conversations, lead analysis and booking extraction. End the call using the hangup button and wait for the saved status. Closing a tab mid-call does not guarantee persistence. Ollama and the temporary tunnel must stay running for Vercel to reach the laptop. Qwen3 thinking is disabled to reduce response latency. Hosting plan execution limits still apply.

### Laptop latency

Live replies use `OLLAMA_VOICE_MODEL` (default `qwen3:0.6b`); post-call analysis still uses `OLLAMA_MODEL` (default `qwen3:1.7b`). Pull both models on the machine running Ollama. The smaller live model trades answer quality for speed; set `OLLAMA_VOICE_MODEL=qwen3:1.7b` to prefer the larger model.

The initial greeting skips model inference. Live generation requests keep the model resident for 30 minutes and limit output to 96 tokens, without applying that limit to JSON analysis. The client sends a final recognition result immediately rather than waiting for the recognition session to end. Network, database and browser speech services still contribute to call latency; CPU inference does not guarantee instant responses.

## Booking workflow

A caller's appointment request is saved after the call ends. The agent asks for a country-code phone number and explicit permission to receive a WhatsApp confirmation. The clinic reviews the call and verifies consent, selects an exact available date/time, and confirms the appointment in Appointments. The current implementation does not check a clinic calendar or auto-reserve an available slot.

Only confirmed appointments can send a confirmation. Missing setup, phone or consent is shown on the appointment; the appointment itself remains saved. Requests are not presented as confirmed bookings. Completing the visit does not send another confirmation. Slot inputs and dashboard times use the operator's browser timezone; WhatsApp formats the confirmed instant in the clinic's saved timezone.

## WhatsApp configuration

The account does not yet have an approved appointment template. Until approval and sender configuration are complete, the dashboard reports setup pending; no message is sent. This integration uses the application's configured Meta sender. It does not provision a separate WhatsApp Business sender for each clinic.

Set these server-side Vercel variables when the sender and template are ready:

- `META_ACCESS_TOKEN`
- `META_PHONE_NUMBER_ID`
- `META_GRAPH_API_VERSION` ? supported version from your Meta app, e.g. vXX.0 with the actual numeric version
- `WHATSAPP_APPOINTMENT_TEMPLATE` ? exact approved template name
- `WHATSAPP_TEMPLATE_LANGUAGE` ? approved language code (defaults to en_US)
- `META_APP_SECRET`
- `META_VERIFY_TOKEN` ? your webhook verification token

Create an approved utility template with seven positional **body** parameters in this order:

1. Patient name
2. Clinic name
3. Service
4. Confirmed appointment date/time including clinic timezone
5. Clinic address
6. Clinic contact phone
7. Opening hours

Example body:

Hello {{1}}, your appointment at {{2}} is confirmed. Service: {{3}}. Date and time: {{4}}. Address: {{5}}. Contact: {{6}}. Opening hours: {{7}}.

Configure Meta's callback URL as `https://YOUR-VERCEL-DOMAIN/api/webhooks/whatsapp`, use the configured verify token and subscribe to message status notifications. POST callbacks require the Meta HMAC signature. WhatsApp acceptance is labelled accepted, not delivered. Signed status callbacks update sent/delivered/read/failed. Concurrent sends claim a single database record; unknown network outcomes are not automatically retried. Check Meta before retrying an unknown or stuck sending result. Failed/setup-required messages can be retried from the dashboard after fixing configuration.

No real WhatsApp message is sent by the automated tests. Meta approval, account setup and recipient eligibility still need to be completed outside this repository.

## Verification

- `npm run build`
- `node --test tests/*.test.cjs`
- Manual: create an account, save clinic profile, start a call, allow microphone, speak, mute/unmute, interrupt, hang up and check Conversations/CRM/Appointments.
- Confirm a future slot and inspect setup-pending status before Meta setup. After setup, test with an authorized recipient and confirm actual delivered status via signed webhook.
