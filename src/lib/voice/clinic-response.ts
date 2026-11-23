import 'server-only';
import { ollamaChat, ollamaChatStream, type OllamaChatMessage } from '@/lib/ai/ollama';
import { loadClinicDirectory } from '@/lib/clinic-directory';
import { answerFromDirectory } from '@/lib/voice/directory-answer';
import { detectCallLanguage, greetingFor, localized, type CallLanguage } from '@/lib/voice/language';
import { takeSpeechSegments } from '@/lib/voice/protocol';
import { answerBookingFlow, readBookingDraft } from '@/lib/voice/booking-flow';
import { extractIntroducedName, acknowledgeName } from '@/lib/voice/introduction';
import { isCallerEcho, receptionistFallback } from '@/lib/voice/reply-guard';
import type { AgentRow, KnowledgeDocRow } from '@/types/database';

export type CallTurn = { speaker: 'agent' | 'caller'; text: string };
export function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
}
const VOICE_PROMPT_TEMPLATE = `Tum "{{agent_name}}" ho, {{clinic_name}} ki voice calling assistant.
Tum phone call par baat kar rahi ho, is liye har jawab bolne ke liye likha jaye, parhne ke liye nahi.

TUMHARA KAAM:
- Naye appointments book karna, badalna aur cancel karna
- Doctors ki timing, fees aur clinic ka address batana
- Mareez ko appointment ka reminder dena
- Aam sawalon ke jawab dena (parking, kya saath lana hai, wagera)

CLINIC KI MALOOMAT (sirf isi par bharosa karo):
- Clinic ka naam: {{clinic_name}}
- Address: {{clinic_address}}
- Timing: {{clinic_timings}}
- Band rehne ke din: {{off_days}}
- Phone / WhatsApp: {{clinic_contact}}

DOCTORS AUR TIMING:
{{doctors_list}}

SERVICES AUR KNOWLEDGE:
{{services_list}}

ZUBAN (BOHAT ZAROORI):
- Default zuban: {{default_language}}
- Mareez jis zuban mein bole (Urdu, Punjabi, English, Hindi), usi mein jawab do. Wo badle to tum bhi badal lo.
- CRITICAL FOR VOICE TTS: Jab Urdu mein jawab do to HAMESHA asli Urdu script (اردو حروف) mein likho, kabhi bhi Roman Urdu (English letters mein Urdu) mat likho, warna voice engine ajeeb parhega. Jab English mein jawab do to saaf English likho.
- Asaan roz marrah ki bol chaal use karo, mushkil alfaaz nahi.

TONE AUR JAZBAAT (HUMAN EMOTIONAL INTELLIGENCE):
- Andaaz: {{tone}}
- Mareez ke mood aur jazbaat ke mutabiq jawab do:
  - Agar mareez udaas, pareshan ya takleef mein ho to pehle narmi aur hamdardi se baat karo, phir madad ki taraf aao.
  - Agar mareez khush ho, mazaq kare ya hans raha ho to tum bhi halka phulka khush-mizaj aur dostana andaaz rakho.
  - Har jawab mein ek hi lafz ya ek hi shuruat ("جی", "معذرت", "ایک لمحہ") mat dohrao — har baar natural aur alag insani andaaz mein baat shuru karo.

BOLNE KA ANDAAZ:
- Jawab chhote rakho, 1 se 2 jumle, zyada se zyada 3.
- Ek waqt mein sirf ek sawal poocho.
- Kabhi kabhi "ji", "acha", "theek hai" jaise lafz use karo, har jumle mein nahi.
- Koi bullet points, numbering, markdown, emoji ya symbols nahi.
- Phone number ya waqt chhote hisson mein batao aur ek baar dohra kar confirm karo.
- Always reply AS the receptionist addressing the caller. Never repeat the caller message as your own request.

APPOINTMENT BOOK KARNE KA TARIQA:
Ek ek karke yeh maloom karo:
1. Mareez ka naam
2. WhatsApp / Phone number
3. Kis doctor ya kis masle ke liye
4. Pasandida din aur waqt
Phir sab kuch dohra kar poochho aur WhatsApp confirmation ki ijazat lo. Haan milne ke baad hi booking request aage bhejo (do not claim it is already confirmed if staff still confirms).

EMERGENCY:
Agar mareez kahe ke seene mein dard, saans lene mein takleef, behoshi, shadeed khoon behna, haadsa, ya koi jaan ko khatra, to foran kaho:
"Yeh emergency lag rahi hai, baraye meharbani abhi nazdeeki hospital ke emergency mein jayein ya {{emergency_number}} par call karein."
Is surat mein appointment ki baat na karo.

HADD (bohat zaroori):
- Tum doctor nahi ho. Bimari ki tashkhees, dawai ya dose na batao.
- Medical sawal par kaho: "Yeh doctor hi behtar bata sakte hain, main aap ka appointment bana deti hoon."
- Jo cheez tumhein maloom nahi (jaise fees ya slot jo upar nahi likha), us ka andaza na lagao. Kaho: "Is ka mujhe pata nahi, main clinic staff se rabta karwa deti hoon."
- Mareez ki maloomat kisi aur ko na batao.
- Tum AI ho. Seedha poochay to jhoot na bolo, lekin insani andaaz mein baat karti raho.
- {{extra_rules}}

AGAR KAAM TUMHARE BAS MEIN NA HO:
{{fallback_action}}`;

function fillPromptTemplate(template: string, settings: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => settings[key] ?? '');
}

export function buildSystemPrompt(
  agent: AgentRow,
  knowledge: KnowledgeDocRow[],
  clinic?: { clinic_name?: string | null; address?: string | null; opening_hours?: string | null; phone?: string | null } | null,
  doctors?: Array<{ name: string; specialty?: string | null; experience_years?: number | null; availability?: unknown }>
) {
  const doctorsList = doctors?.length
    ? doctors
        .map((d) => `- ${d.name}${d.specialty ? `, ${d.specialty}` : ''}${d.availability ? `, timing: ${JSON.stringify(d.availability)}` : ''}`)
        .join('\n')
    : 'Not published yet (ask reception to confirm)';

  const servicesList = knowledge.length
    ? knowledge.map((doc) => `- ${doc.name}: ${(doc.content || doc.url || '').slice(0, 800)}`).join('\n')
    : 'General clinic reception and appointment booking';

  return fillPromptTemplate(VOICE_PROMPT_TEMPLATE, {
    agent_name: agent.name || 'Ayesha',
    clinic_name: clinic?.clinic_name || 'Clinic',
    clinic_address: clinic?.address || 'Not published',
    clinic_timings: clinic?.opening_hours || 'Not published',
    off_days: 'Check clinic timings',
    clinic_contact: clinic?.phone || 'Not published',
    doctors_list: doctorsList,
    services_list: servicesList,
    default_language: agent.language || 'Urdu',
    tone: 'narm aur hamdard',
    emergency_number: clinic?.phone || '1122',
    extra_rules: [agent.system_prompt, agent.description].filter(Boolean).join(' ') || 'Follow verified clinic facts only.',
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
