import 'server-only';
import { ollamaChat, ollamaChatStream, type OllamaChatMessage } from '@/lib/ai/ollama';
import { loadClinicDirectory } from '@/lib/clinic-directory';
import { answerFromDirectory } from '@/lib/voice/directory-answer';
import { detectCallLanguage, greetingFor, localized, type CallLanguage } from '@/lib/voice/language';
import { takeSpeechSegments } from '@/lib/voice/protocol';
import { answerBookingFlow } from '@/lib/voice/booking-flow';
import type { AgentRow, KnowledgeDocRow } from '@/types/database';

export type CallTurn = { speaker: 'agent' | 'caller'; text: string };
export function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
}
export function buildSystemPrompt(agent: AgentRow, knowledge: KnowledgeDocRow[]) {
  return [
    `You are ${agent.name}, the clinic receptionist. You provide administrative help, never diagnosis or medical treatment advice.`,
    agent.system_prompt || '', agent.description || '',
    'Reply in the SAME language as the caller: English, Urdu, Punjabi or Hindi. Do not translate proper names or clinic facts. For Urdu use Urdu script, for Punjabi match the caller script. Never force English.',
    'Speak briefly: one short sentence and one question at a time. No markdown or thinking text.',
    'Use ONLY verified clinic and doctor facts below. Never invent a doctor, qualification, experience, fee, available slot or diagnosis. If information is absent, say reception needs to confirm.',
    'For a booking collect patient name, WhatsApp number with country code, concern in their own words, preferred doctor/service, and preferred date/time. Ask each missing item one at a time. Then explicitly ask permission for WhatsApp confirmation. Do not infer consent. Repeat details and explain the clinic will confirm the slot; do not claim a booking or message is already confirmed.',
    'If asked for a diagnosis, treatment, or a guarantee of doctor suitability, explain a clinician must assess it. Urgent symptoms should be directed to local emergency care, not routine booking.',
    ...knowledge.map(doc => `Clinic knowledge: ${doc.name}: ${(doc.content || doc.url || '').slice(0, 1000)}`),
  ].filter(Boolean).join('\n');
}

export async function prepareVoiceReply(agent: AgentRow, knowledge: KnowledgeDocRow[], history: CallTurn[], hint: CallLanguage = 'en') {
  const latest = [...history].reverse().find(turn => turn.speaker === 'caller')?.text ?? '';
  const language = detectCallLanguage(latest, hint);
  if (!history.length) return { language, doctorIds: [] as string[], reply: agent.greeting || greetingFor(agent.name, language), source: 'greeting', messages: [] as OllamaChatMessage[] };
  const directory = await loadClinicDirectory(agent.user_id);
  const direct = answerFromDirectory(latest, directory.doctors, directory.clinic, language, directory.available);
  const booking = direct?.kind === 'urgent' ? null : answerBookingFlow(history, directory.doctors, language);
  if (booking) return { language, doctorIds: direct?.doctorIds ?? [], reply: booking.reply, source: 'booking', messages: [] as OllamaChatMessage[], bookingDraft: booking.draft };
  if (direct) return { ...direct, language, source: direct.kind, messages: [] as OllamaChatMessage[] };
  const doctorFacts = directory.doctors.map(doctor => ({ name: doctor.name, specialty: doctor.specialty, experience_years: doctor.experience_years, availability: doctor.availability }));
  const clinicFacts = directory.clinic ? { name: directory.clinic.clinic_name, address: directory.clinic.address, phone: directory.clinic.phone, hours: directory.clinic.opening_hours, timezone: directory.clinic.timezone } : null;
  const messages: OllamaChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(agent, knowledge) + `\nCurrent caller language: ${language}.\nVerified clinic: ${JSON.stringify(clinicFacts)}\nPublished doctors: ${JSON.stringify(doctorFacts)}` },
    ...history.map(turn => ({ role: turn.speaker === 'caller' ? 'user' as const : 'assistant' as const, content: turn.text })),
  ];
  return { language, doctorIds: [] as string[], reply: null, source: 'model', messages };
}

export async function generateAgentReply(agent: AgentRow, knowledge: KnowledgeDocRow[], history: CallTurn[]): Promise<string> {
  const prepared = await prepareVoiceReply(agent, knowledge, history);
  if (prepared.reply) return prepared.reply;
  const reply = stripThinking(await ollamaChat(prepared.messages, { model: process.env.OLLAMA_VOICE_MODEL || 'qwen3:0.6b', maxTokens: 128, keepAlive: '30m' }));
  return reply || 'Please repeat that for reception.';
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
          send({ type: 'sentence', text: prepared.reply });
          send({ type: 'done', reply: prepared.reply });
        } else {
          let raw = '', spokenLength = 0;
          for await (const chunk of ollamaChatStream(prepared.messages, combined)) {
            raw += chunk;
            const clean = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trimStart();
            const pending = clean.slice(spokenLength);
            if (/<(?:think)?[^>]*$/.test(pending)) continue;
            const segmented = takeSpeechSegments(pending);
            for (const text of segmented.sentences) send({ type: 'sentence', text });
            spokenLength = clean.length - segmented.rest.length;
          }
          const reply = stripThinking(raw);
          if (!reply) throw new Error('The model returned an empty answer');
          for (const text of takeSpeechSegments(reply.slice(spokenLength), true).sentences) send({ type: 'sentence', text });
          send({ type: 'done', reply });
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
