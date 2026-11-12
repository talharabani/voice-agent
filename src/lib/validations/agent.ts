import { z } from "zod";

export const agentVoiceEnum = z.enum(["nova", "echo", "alloy", "shimmer", "warm-female", "clear-female", "calm-male", "deep-male", "youthful", "gentle"]);

export const createAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional(),
  system_prompt: z.string().trim().max(8000).optional(),
  voice: agentVoiceEnum.default("nova"),
  language: z.string().trim().min(2).max(10).default("en"),
  greeting: z.string().trim().max(500).optional(),
  business_type: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(60).default("UTC"),
});

export const updateAgentSchema = createAgentSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
