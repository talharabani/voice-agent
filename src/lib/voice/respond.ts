import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ollamaChat } from "@/lib/ai/ollama";
import type { AgentRow, KnowledgeDocRow } from "@/types/database";

export type CallTurn = { speaker: "agent" | "caller"; text: string };

/** qwen3-style models may emit <think>…</think> blocks — never speak those. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export function buildSystemPrompt(agent: AgentRow, knowledge: KnowledgeDocRow[]): string {
  const sections: string[] = [];

  sections.push(
    `You are ${agent.name}, an AI phone receptionist` +
      (agent.business_type ? ` for a ${agent.business_type} business.` : ".")
  );

  if (agent.system_prompt) sections.push(agent.system_prompt);
  if (agent.description) sections.push(`About this agent: ${agent.description}`);

  if (knowledge.length > 0) {
    const docs = knowledge
      .map((d) => `- ${d.name}: ${(d.content ?? d.url ?? "").slice(0, 1200)}`)
      .join("\n");
    sections.push(`Business knowledge you can rely on when answering:\n${docs}`);
  }

  sections.push(
    [
      "Rules for this live phone call:",
      "- Reply in plain spoken English only.",
      "- Reply in one short sentence, usually under 25 words. Use two sentences only when repeating booking details. No lists, markdown or emojis.",
      "- Ask for one piece of information at a time.",
      "- If you don't know something, say so politely and offer to take a message.",
      "- Never invent prices, availability, or confirmed bookings. Only state what the business knowledge supports.",
      "- If the caller wants an appointment: collect their name, phone number, the service they need, and their preferred day and time — one question at a time. Ask for the phone number with its country code and explicitly ask whether they agree to receive an appointment confirmation on WhatsApp. Record their answer accurately. Then repeat the details back and say the business will confirm the exact slot shortly. Do not claim the slot is already confirmed.",
      "- Do not output <think> tags or any reasoning — output only what you would say out loud.",
    ].join("\n")
  );

  return sections.join("\n\n");
}

/**
 * One conversational turn: given the agent, its knowledge, and the call
 * history, produce the next thing the agent says. Shared by the browser
 * call tester and the telephony webhooks.
 */
export async function generateAgentReply(
  agent: AgentRow,
  knowledge: KnowledgeDocRow[],
  history: CallTurn[]
): Promise<string> {
  if (history.length === 0) {
    return agent.greeting || `Hello, this is ${agent.name}. How can I help you today?`;
  }

  const { data: clinic } = await supabaseAdmin.from("clinic_profiles").select("*").eq("user_id", agent.user_id).maybeSingle();
  const clinicContext = clinic ? `\nVerified clinic information:\nName: ${clinic.clinic_name}\nAddress: ${clinic.address}\nContact: ${clinic.phone}\nHours: ${clinic.opening_hours}\nTimezone: ${clinic.timezone}` : "\nClinic details have not been provided. Do not invent them.";

  const messages = [
    { role: "system" as const, content: buildSystemPrompt(agent, knowledge) + clinicContext },
    ...history.map((turn) => ({
      role: turn.speaker === "caller" ? ("user" as const) : ("assistant" as const),
      content: turn.text,
    })),
  ];

  const reply = stripThinking(await ollamaChat(messages, {
    model: process.env.OLLAMA_VOICE_MODEL || "qwen3:0.6b",
    maxTokens: 96,
    keepAlive: "30m",
  }));
  return reply || "I'm sorry, could you say that again?";
}
