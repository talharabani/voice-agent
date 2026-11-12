import "server-only";

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
      "- Keep every reply short: one to three sentences. No lists, no markdown, no emojis.",
      "- Ask for one piece of information at a time.",
      "- If you don't know something, say so politely and offer to take a message.",
      "- Never invent prices, availability, or confirmed bookings. Only state what the business knowledge supports.",
      "- If the caller wants an appointment: collect their name, phone number, the service they need, and their preferred day and time — one question at a time. Then repeat the details back and say the business will confirm the exact slot shortly. Do not claim the slot is already confirmed.",
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
  if (history.length === 0 && agent.greeting) {
    return agent.greeting;
  }

  const messages = [
    { role: "system" as const, content: buildSystemPrompt(agent, knowledge) },
    ...history.map((turn) => ({
      role: turn.speaker === "caller" ? ("user" as const) : ("assistant" as const),
      content: turn.text,
    })),
  ];

  if (history.length === 0) {
    messages.push({
      role: "user" as const,
      content: "(The call just connected. Greet the caller briefly and ask how you can help.)",
    });
  }

  const reply = stripThinking(await ollamaChat(messages));
  return reply || "I'm sorry, could you say that again?";
}
