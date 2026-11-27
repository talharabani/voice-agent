import 'server-only';
import { ollamaChat, ollamaChatStream, type OllamaChatMessage } from '@/lib/ai/ollama';
import { loadClinicDirectory } from '@/lib/clinic-directory';
import { answerFromDirectory } from '@/lib/voice/directory-answer';
import { detectCallLanguage, greetingFor, localized, type CallLanguage } from '@/lib/voice/language';
import { takeSpeechSegments } from '@/lib/voice/protocol';
import { answerBookingFlow, readBookingDraft } from '@/lib/voice/booking-flow';
import { extractIntroducedName, acknowledgeName } from '@/lib/voice/introduction';
import { isCallerEcho, receptionistFallback } from '@/lib/voice/reply-guard';
import { saveAppointmentMidCall } from '@/lib/voice/save-call';
import type { AgentRow, KnowledgeDocRow } from '@/types/database';

export type CallTurn = { speaker: 'agent' | 'caller'; text: string };
export function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
}
const VOICE_PROMPT_TEMPLATE = `Tum "{{agent_name}}" ho, {{clinic_name}} ki voice assistant. Phone call par baat ho rahi hai, is liye jawab bolne ke liye likho.

SPEED KE QAWAID (sab se zaroori):
- Jawab ki pehli line 2 se 4 lafz ki ho aur foran shuru ho, jaise "جی ضرور۔" "اچھا جی۔" "جی بالکل۔" "ٹھیک ہے۔" Phir baqi baat likho.
- Poora jawab 1 jumle ka rakho, zyada se zyada 2. Ek jumla 20 lafz se kam ho.
- Kabhi lambi tamheed na bandho. Mareez ki baat dohrane mein sirf 2 se 3 lafz lo.
- Ek waqt mein sirf ek sawal poocho aur jawab ke bilkul aakhir mein poocho.
- Soch ya wazahat bayan na karo. Seedha jawab do.
- Koi list, numbering, markdown, emoji ya bracket nahi.

ZUBAN:
- Default zuban: {{default_language}}.
- Mareez jis zuban mein bole (Urdu, Punjabi, English, ya mix), usi mein jawab do. Asaan roz marrah ki bol chaal rakho.
- CRITICAL FOR VOICE TTS: Urdu mein jawab HAMESHA asli Urdu script (اردو حروف) mein likho, Roman Urdu mein nahi, warna voice engine ajeeb parhega. Urdu mein aam English lafz (appointment, doctor, whitening, acne) normal hain.

CLINIC KI MALOOMAT (SIRF ISI PAR BHAROSA KARO — KUCH KHUD SE NA BANAO):
- Naam: {{clinic_name}}
- Address: {{clinic_address}}
- Timing: {{clinic_timings}}
- Band rehne ke din: {{off_days}}
- Appointment duration: {{slot_minutes}} minutes
- Phone / WhatsApp: {{clinic_contact}}
- Doctors aur fees:
{{doctors_list}}
- Services:
{{services_list}}
- Booking rules: {{booking_rules}}
- FAQs & Clinic Notes (sirf maloomat ke liye):
{{clinic_notes}}

SAKHT HADUD (STRICT CLINIC BOUNDARIES):
- Sirf wahi services aur doctors batao jo upar {{clinic_name}} ki list mein maujood hain.
- Agar mareez koi aisi service ya department maange jo is clinic mein nahi hai, to narmi se batao ke yeh service {{clinic_name}} par dastiyab nahi hai, aur jo services available hain wo batao.
- Kabhi koi doctor, service, fee, ya slot khud se ijaad na karo.
- Mareez ke masle ke mutabiq sirf usi specialty ke doctor ka naam lo jo upar list mein hai.

KAAM:
Appointment book, badalna, cancel, doctor ki timing aur fees batana, aur mareez ke masle ke mutabiq sahi department aur doctor batana.

APPOINTMENT KA TARIQA:
Sirf jo cheez abhi tak nahi mili wo ek ek karke poochho: naam, phone number, masla ya doctor, din aur waqt.
Aakhir mein ek jumle mein confirm karo aur WhatsApp confirmation ki ijazat lo. Haan ke baad hi book karo.

DOCTOR SE BAAT:
Agar mareez kahe "doctor se baat karni hai", to kaho: "جی، ڈاکٹر سے براہِ راست بات تو ممکن نہیں، لیکن میں اپائنٹمنٹ بنا دیتی ہوں۔ آپ کا نام؟"
Agar phir bhi zor de to: {{fallback_action}}

EMERGENCY:
Seene mein dard, saans ki takleef, behoshi, shadeed khoon ya haadsa ho to foran kaho:
"یہ ایمرجنسی لگ رہی ہے، ابھی قریبی ہسپتال جائیں یا {{emergency_number}} پر کال کریں۔"

HADD:
- Tum doctor nahi ho. Tashkhees, dawai ya dose na batao. Agar medical sawal pooche to kaho: "یہ ڈاکٹر ہی بہتر بتا سکتے ہیں، میں اپائنٹمنٹ بنا دیتی ہوں۔"
- Jo pata na ho us ka andaza na lagao. Kaho: "اس کا مجھے علم نہیں، کلینک اسٹاف سے رابطہ کروا دیتی ہوں۔"
- Jo baat mareez pehle bata chuka ho woh dobara mat poocho, aur apna pichla jawab lafz ba lafz dobara na bolo.
- Tum AI ho. Seedha poochay to jhoot na bolo.
- {{extra_rules}}

MISAALEIN (isi narm aur insani lehje mein baat karo):
Mareez: mujhe daant ka ya skin ka bohat masla ho raha hai
Tum: اوہ، یہ تو واقعی تکلیف دہ بات ہے۔ میں ابھی آپ کا اپائنٹمنٹ بنا دیتی ہوں، آپ کا نام بتا دیں؟

Mareez: fees kitni hai
Tum: جی، کنسلٹیشن کی تفصیل کلینک پر کنفرم ہو گی۔ کیا میں آپ کا اپائنٹمنٹ بھی بک کر دوں؟

Mareez: mujhe whitening karwani hai
Tum: اچھا جی، بالکل ہو جائے گی۔ آپ کا نام کیا ہے؟

Mareez: kal ka time mil jaye ga
Tum: جی، کل شام کا وقت دیکھ لیتے ہیں۔ آپ کو کون سا وقت بہتر رہے گا؟

Mareez: shukriya aap bohat achi hain
Tum: ارے، یہ تو میرا کام ہے جی، آپ اپنا خیال رکھیے گا!`;

function fillPromptTemplate(template: string, settings: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => settings[key] ?? '');
}

export function buildSystemPrompt(
  agent: AgentRow,
  knowledge: KnowledgeDocRow[],
  clinic?: {
    clinic_name?: string | null;
    address?: string | null;
    opening_hours?: string | null;
    phone?: string | null;
    off_days?: string | null;
    default_slot_minutes?: number | null;
    booking_rules?: string | null;
    custom_instructions?: string | null;
    services?: Array<{ name: string; category?: string; description?: string; fee?: string; duration_minutes?: number | null }>;
  } | null,
  doctors?: Array<{
    name: string;
    specialty?: string | null;
    qualifications?: string | null;
    experience_years?: number | null;
    consultation_fee?: string | null;
    availability?: unknown;
    concern_keywords?: string[];
  }>
) {
  const doctorsList = doctors?.length
    ? doctors
        .map((d) => {
          const parts = [d.name];
          if (d.specialty) parts.push(d.specialty);
          if (d.qualifications) parts.push(`(${d.qualifications})`);
          if (d.consultation_fee) parts.push(`Fee: ${d.consultation_fee}`);
          if (d.availability) parts.push(`Timing: ${typeof d.availability === 'string' ? d.availability : JSON.stringify(d.availability)}`);
          if (d.concern_keywords?.length) parts.push(`Keywords: ${d.concern_keywords.join(', ')}`);
          return `- ${parts.join(' | ')}`;
        })
        .join('\n')
    : '- Not published yet (ask reception to confirm)';

  const servicesList = clinic?.services?.length
    ? clinic.services
        .map((s) => {
          const parts = [s.name];
          if (s.category) parts.push(`(${s.category})`);
          if (s.fee) parts.push(`Fee: ${s.fee}`);
          if (s.duration_minutes) parts.push(`${s.duration_minutes} min`);
          if (s.description) parts.push(`— ${s.description}`);
          return `- ${parts.join(' ')}`;
        })
        .join('\n')
    : doctors?.length
      ? `- ${Array.from(new Set(doctors.map((d) => d.specialty).filter(Boolean))).join(', ')}`
      : '- Only general clinic reception (no specific services listed yet)';

  const clinicNotes = knowledge.length
    ? knowledge.map((doc) => `- ${doc.name}: ${(doc.content || doc.url || '').slice(0, 800)}`).join('\n')
    : 'None.';

  return fillPromptTemplate(VOICE_PROMPT_TEMPLATE, {
    agent_name: agent.name || 'Ayesha',
    clinic_name: clinic?.clinic_name || 'Clinic',
    clinic_address: clinic?.address || 'Not published',
    clinic_timings: clinic?.opening_hours || 'Not published',
    off_days: clinic?.off_days?.trim() || 'Check clinic timings',
    slot_minutes: String(clinic?.default_slot_minutes ?? 30),
    clinic_contact: clinic?.phone || 'Not published',
    doctors_list: doctorsList,
    services_list: servicesList,
    booking_rules: clinic?.booking_rules?.trim() || 'Confirm patient name, phone, service, doctor, and preferred time before booking.',
    clinic_notes: clinicNotes,
    default_language: agent.language || 'Urdu',
    tone: 'narm aur hamdard',
    emergency_number: clinic?.phone || '1122',
    extra_rules: [clinic?.custom_instructions, agent.system_prompt, agent.description].filter(Boolean).join(' ') || 'Follow verified clinic facts only.',
    fallback_action: 'Mareez ko clinic ke number par transfer ya rabta karne ka kaho ya kaho ke staff wapas call karega.',
  });
}

export async function prepareVoiceReply(agent: AgentRow, knowledge: KnowledgeDocRow[], history: CallTurn[], hint: CallLanguage = 'en') {
  const latest = [...history].reverse().find(turn => turn.speaker === 'caller')?.text ?? '';
  const language = detectCallLanguage(latest, hint);
  if (!history.length) return { language, doctorIds: [] as string[], reply: agent.greeting && detectCallLanguage(agent.greeting, language) === language ? agent.greeting : greetingFor(agent.name, language), source: 'greeting', messages: [] as OllamaChatMessage[] };
  const introductoryName = extractIntroducedName(latest);
  const activeBooking = readBookingDraft(history).active;
  if (introductoryName && !activeBooking) return { language, doctorIds: [] as string[], source: 'introduction', messages: [] as OllamaChatMessage[], reply: acknowledgeName(introductoryName, language) + ' ' + localized(language, 'How can I help you today?', 'آپ کو کس سلسلے میں مدد چاہیے؟', 'تہاڈے لئی کی مدد کراں؟', 'आपको किस बारे में मदद चाहिए?') };
  if (!activeBooking && /^(?:hello|hi|hey|salaam|salam|ass?alam[ -]?o?[ -]?alaikum|السلام\s*علیکم|اسلام\s*علیکم|سلام|ہیلو|नमस्ते)[\s.!،؟۔]*$/iu.test(latest.trim())) return { language, doctorIds: [] as string[], source: 'greeting', reply: greetingFor(agent.name, language), messages: [] as OllamaChatMessage[] };
  const directory = await loadClinicDirectory(agent.user_id);
  const direct = answerFromDirectory(latest, directory.doctors, directory.clinic, language, directory.available);
  if (direct?.kind === 'urgent') return { ...direct, language, source: direct.kind, messages: [] as OllamaChatMessage[] };
  const doctorFacts = directory.doctors.map(doctor => ({ name: doctor.name, specialty: doctor.specialty, experience_years: doctor.experience_years, availability: doctor.availability }));
  const clinicFacts = directory.clinic ? { name: directory.clinic.clinic_name, address: directory.clinic.address, phone: directory.clinic.phone, hours: directory.clinic.opening_hours, timezone: directory.clinic.timezone } : null;
  const messages: OllamaChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(agent, knowledge, directory.clinic, directory.doctors) + `\nCurrent caller language: ${language}.\nVerified clinic: ${JSON.stringify(clinicFacts)}\nPublished doctors: ${JSON.stringify(doctorFacts)}` },
    ...history.map(turn => ({ role: turn.speaker === 'caller' ? 'user' as const : 'assistant' as const, content: turn.text })),
  ];
  return { language, doctorIds: direct?.doctorIds ?? ([] as string[]), reply: null, source: 'model', messages };
}

export async function generateAgentReply(agent: AgentRow, knowledge: KnowledgeDocRow[], history: CallTurn[]): Promise<string> {
  const prepared = await prepareVoiceReply(agent, knowledge, history);
  if (prepared.reply) return prepared.reply;
  const reply = stripThinking(await ollamaChat(prepared.messages, { model: process.env.OLLAMA_VOICE_MODEL || 'qwen3:0.6b', maxTokens: 128, keepAlive: '30m' }));
  return !reply || isCallerEcho(reply, history.at(-1)?.text ?? '') ? receptionistFallback(prepared.language) : reply;
}

export async function createVoiceStream(agent: AgentRow, knowledge: KnowledgeDocRow[], history: CallTurn[], hint: CallLanguage, signal: AbortSignal) {
  const prepared = await prepareVoiceReply(agent, knowledge, history, hint);
  const encoder = new TextEncoder();
  const stop = new AbortController();
  const combined = AbortSignal.any([signal, stop.signal]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => { if (!combined.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
      try {
        send({ type: 'meta', language: prepared.language, doctorIds: prepared.doctorIds, source: prepared.source, bookingDraft: 'bookingDraft' in prepared ? prepared.bookingDraft : null });
        if (prepared.reply) {
          for (const text of takeSpeechSegments(prepared.reply, true).sentences) send({ type: 'sentence', text });
          send({ type: 'done', reply: prepared.reply });
        } else {
          let raw = '', spokenLength = 0;
          const modelStop = new AbortController();
          const modelSignal = AbortSignal.any([combined, modelStop.signal]);
          const iterator = ollamaChatStream(prepared.messages, modelSignal)[Symbol.asyncIterator]();
          let timer: ReturnType<typeof setTimeout> | undefined;
          let emitted = false;
          const spoken: string[] = [];
          const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Voice reply deadline')), 15000); });
          const caller = [...history].reverse().find(turn => turn.speaker === 'caller')?.text ?? '';
          const emit = (text: string) => {
            if (isCallerEcho(text, caller)) throw new Error('Caller echo rejected');
            send({ type: 'sentence', text }); emitted = true; spoken.push(text);
          };
          try {
          while (true) {
            const next = await Promise.race([iterator.next(), deadline]);
            if (next.done) break;
            const chunk = next.value;
            raw += chunk;
            const clean = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trimStart();
            const pending = clean.slice(spokenLength);
            if (/<(?:think)?[^>]*$/.test(pending)) continue;
            const segmented = takeSpeechSegments(pending);
            for (const text of segmented.sentences) emit(text);
            spokenLength = clean.length - segmented.rest.length;
          }
          const reply = stripThinking(raw);
          if (!reply) throw new Error('The model returned an empty answer');
          for (const text of takeSpeechSegments(reply.slice(spokenLength), true).sentences) emit(text);
          send({ type: 'done', reply });
          if (history.length >= 4 && /whatsapp|واٹس ایپ|بھیج|تصدیق|confirm/iu.test(caller + ' ' + reply)) {
            void saveAppointmentMidCall(agent.id, agent.user_id, [...history, { speaker: 'agent', text: reply }]).catch(() => {});
          }
          } catch (error) {
            if (combined.aborted) throw error;
            console.error('Voice stream model fallback:', error instanceof Error ? error.message : 'Unknown error');
            // Finish once, cancelling inference so a late response cannot play afterwards.
            const reply = emitted ? spoken.join(' ') : receptionistFallback(prepared.language);
            if (!emitted) send({ type: 'sentence', text: reply });
            send({ type: 'done', reply });
          } finally { if (timer) clearTimeout(timer); modelStop.abort(); }
        }
      } catch (error) {
        if (!combined.aborted) {
          console.error('Voice stream failed', error instanceof Error ? error.message : 'Unknown error');
          send({ type: 'error', error: localized(prepared.language, 'The agent could not finish. Please try again.', 'ایجنٹ جواب مکمل نہیں کر سکا۔ دوبارہ کوشش کریں۔', 'ایجنٹ جواب پورا نہیں کر سکیا۔ دوبارہ کوشش کرو۔', 'एजेंट जवाब पूरा नहीं कर सका। फिर कोशिश करें।') });
        }
      } finally { if (!stop.signal.aborted) controller.close(); }
    },
    cancel() { stop.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff' } });
}
