import { z } from "zod";

export const transcriptTurnSchema = z.object({
  speaker: z.enum(["agent", "caller"]),
  text: z.string().trim().min(1).max(2000),
});

export const callWebhookSchema = z.object({
  agent_id: z.string().uuid(),
  caller_phone: z.string().trim().max(32).optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  transcript: z.array(transcriptTurnSchema).default([]),
  status: z.string().trim().max(40).default("completed"),
});

export type CallWebhookInput = z.infer<typeof callWebhookSchema>;
