import "server-only";
import { readJsonLines } from '@/lib/voice/protocol';
import { z } from 'zod';

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const GROQ_MODEL_CANDIDATES = [
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
];

async function fetchGroqWithFallback(
  groqKey: string,
  preferredModel: string,
  payload: Record<string, unknown>,
  signal: AbortSignal
): Promise<Response> {
  const models = [preferredModel, ...GROQ_MODEL_CANDIDATES.filter((m) => m !== preferredModel)];
  let lastRes: Response | null = null;
  for (const model of models) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({ ...payload, model }),
      signal,
    });
    if (res.ok) return res;
    lastRes = res;
    if (res.status !== 404 && res.status !== 400) break;
  }
  throw new Error(`Groq voice model request failed (${lastRes?.status ?? 'unknown'})`);
}

export async function* ollamaChatStream(messages: OllamaChatMessage[], signal?: AbortSignal) {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const groqModel = process.env.GROQ_VOICE_MODEL || 'qwen/qwen3.8-27b';
    const timeout = AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 30000));
    const response = await fetchGroqWithFallback(
      groqKey,
      groqModel,
      {
        messages,
        stream: true,
        temperature: 0.65,
        max_tokens: 180,
      },
      signal ? AbortSignal.any([signal, timeout]) : timeout
    );
    if (!response.body) {
      throw new Error('Groq voice model response body empty');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch {
          // Ignore partial SSE JSON lines
        }
      }
    }
    return;
  }

  const model = process.env.OLLAMA_VOICE_MODEL || 'qwen3:0.6b';
  const timeout = AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS || 120000));
  const response = await fetch(`${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify({ model, messages, stream: true, keep_alive: '30m', options: { num_predict: 128 }, ...(/^qwen3(?::|$)/i.test(model) ? { think: false } : {}) }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok || !response.body) throw new Error(`Voice model request failed (${response.status})`);
  for await (const chunk of readJsonLines<{ message?: { content?: string }; error?: string }>(response.body)) {
    if (chunk.error) throw new Error('Voice generation failed');
    if (chunk.message?.content) yield chunk.message.content;
  }
}

interface OllamaChatResponse {
  message: { role: string; content: string };
}

/**
 * Calls a local Ollama instance for lightweight inference tasks
 * (sentiment classification, lead-info extraction) that don't need
 * a hosted model. Configure via OLLAMA_BASE_URL / OLLAMA_MODEL.
 */
export async function ollamaChat(
  messages: OllamaChatMessage[],
  options?: { format?: "json"; model?: string; maxTokens?: number; keepAlive?: string }
): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const model = options?.model ?? process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";
    const res = await fetchGroqWithFallback(
      groqKey,
      model,
      {
        messages,
        stream: false,
        temperature: 0.3,
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options?.format === "json" ? { response_format: { type: "json_object" } } : {}),
      },
      AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS ?? 30_000))
    );
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }

  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = options?.model ?? process.env.OLLAMA_MODEL ?? "qwen3:1.7b";

  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120_000);

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(options?.keepAlive ? { keep_alive: options.keepAlive } : {}),
      ...(options?.maxTokens ? { options: { num_predict: options.maxTokens } } : {}),
      ...(/^qwen3(?::|$)/i.test(model) ? { think: false } : {}),
      ...(options?.format ? { format: options.format } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
  }

  const data: OllamaChatResponse = await res.json();
  return data.message?.content ?? "";
}

export interface CallAnalysis {
  sentiment: "positive" | "neutral" | "negative";
  lead_score: number;
  intent: string | null;
  lead: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
}

const FALLBACK_ANALYSIS: CallAnalysis = {
  sentiment: "neutral",
  lead_score: 0,
  intent: null,
  lead: { name: null, email: null, phone: null },
};

/**
 * Analyzes a call transcript for sentiment, a 0-100 lead score, the
 * caller's likely intent, and any contact details mentioned. Falls
 * back to neutral defaults if Ollama is unreachable so the call is
 * still recorded even when the local model isn't running.
 */
export async function analyzeCallTranscript(
  transcript: { speaker: "agent" | "caller"; text: string }[]
): Promise<CallAnalysis> {
  const transcriptText = transcript
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  try {
    const content = await ollamaChat(
      [
        {
          role: "system",
          content:
            "You analyze customer call transcripts for a voice agent SaaS. " +
            "Respond with ONLY a JSON object matching this shape, no other text: " +
            '{"sentiment":"positive|neutral|negative","lead_score":0-100,"intent":"short phrase or null",' +
            '"lead":{"name":"string or null","email":"string or null","phone":"string or null"}}',
        },
        { role: "user", content: transcriptText },
      ],
      { format: "json" }
    );

    const parsed = JSON.parse(content) as Partial<CallAnalysis>;

    return {
      sentiment: parsed.sentiment ?? FALLBACK_ANALYSIS.sentiment,
      lead_score: typeof parsed.lead_score === "number" ? parsed.lead_score : 0,
      intent: parsed.intent ?? null,
      lead: {
        name: parsed.lead?.name ?? null,
        email: parsed.lead?.email ?? null,
        phone: parsed.lead?.phone ?? null,
      },
    };
  } catch (err) {
    console.error("Call analysis failed, using fallback", err);
    return FALLBACK_ANALYSIS;
  }
}


export interface AppointmentExtraction {
  requested: boolean;
  whatsapp_consent: boolean;
  customer_name: string | null;
  customer_phone: string | null;
  service: string | null;
  requested_time: string | null;
  requested_doctor: string | null;
  patient_concern: string | null;
}

const NO_APPOINTMENT: AppointmentExtraction = {
  requested: false,
  whatsapp_consent: false,
  customer_name: null,
  customer_phone: null,
  service: null,
  requested_time: null,
  requested_doctor: null,
  patient_concern: null,
};

/**
 * Checks a finished call transcript for an appointment/booking request
 * and extracts the details the caller gave. Returns requested:false on
 * any failure so call ingestion never breaks because of this step.
 */
export async function extractAppointment(
  transcript: { speaker: "agent" | "caller"; text: string }[]
): Promise<AppointmentExtraction> {
  const transcriptText = transcript
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  try {
    const content = await ollamaChat(
      [
        {
          role: "system",
          content:
            "You read customer call transcripts for a receptionist service. " +
            "Decide whether the CALLER asked to book, schedule, or reserve an appointment/visit/service. " +
            "Respond with ONLY this JSON, no other text: " +
            '{"requested":true|false,"whatsapp_consent":true|false,"customer_name":"string or null","customer_phone":"string or null",' +
            '"service":"short phrase or null","requested_time":"the time/date exactly as the caller said it, or null",' +
            '"requested_doctor":"doctor name explicitly requested by the caller, or null","patient_concern":"the caller own words about their reason for visiting, or null"}. ' +
            'Never invent a doctor, symptom, diagnosis, patient name, phone or appointment time. Preserve the caller language. ' +
            "Set whatsapp_consent:true ONLY when the CALLER explicitly agreed to receive an appointment confirmation on WhatsApp. Never infer consent from a phone number. If no booking was discussed, use requested:false and nulls.",
        },
        { role: "user", content: transcriptText },
      ],
      { format: "json" }
    );

    const optionalText = z.string().trim().max(2000).nullable().optional();
    const parsed = z.object({
      requested: z.boolean(), whatsapp_consent: z.boolean().optional(),
      customer_name: optionalText, customer_phone: optionalText, service: optionalText,
      requested_time: optionalText, requested_doctor: optionalText, patient_concern: optionalText,
    }).parse(JSON.parse(content));
    if (parsed.requested !== true) return NO_APPOINTMENT;

    return {
      requested: true,
      whatsapp_consent: parsed.whatsapp_consent === true,
      customer_name: parsed.customer_name ?? null,
      customer_phone: parsed.customer_phone ?? null,
      service: parsed.service ?? null,
      requested_time: parsed.requested_time ?? null,
      requested_doctor: parsed.requested_doctor ?? null,
      patient_concern: parsed.patient_concern ?? null,
    };
  } catch (err) {
    console.error("Appointment extraction failed, skipping", err);
    return NO_APPOINTMENT;
  }
}
