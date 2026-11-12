import "server-only";

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  options?: { format?: "json"; model?: string }
): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = options?.model ?? process.env.OLLAMA_MODEL ?? "qwen3:1.7b";

  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120_000);

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
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
}

const NO_APPOINTMENT: AppointmentExtraction = {
  requested: false,
  whatsapp_consent: false,
  customer_name: null,
  customer_phone: null,
  service: null,
  requested_time: null,
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
            '"service":"short phrase or null","requested_time":"the time/date exactly as the caller said it, or null"}. ' +
            "Set whatsapp_consent:true ONLY when the CALLER explicitly agreed to receive an appointment confirmation on WhatsApp. Never infer consent from a phone number. If no booking was discussed, use requested:false and nulls.",
        },
        { role: "user", content: transcriptText },
      ],
      { format: "json" }
    );

    const parsed = JSON.parse(content) as Partial<AppointmentExtraction>;
    if (parsed.requested !== true) return NO_APPOINTMENT;

    return {
      requested: true,
      whatsapp_consent: parsed.whatsapp_consent === true,
      customer_name: parsed.customer_name ?? null,
      customer_phone: parsed.customer_phone ?? null,
      service: parsed.service ?? null,
      requested_time: parsed.requested_time ?? null,
    };
  } catch (err) {
    console.error("Appointment extraction failed, skipping", err);
    return NO_APPOINTMENT;
  }
}
