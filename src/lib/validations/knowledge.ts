import { z } from "zod";

export const createKnowledgeSchema = z
  .object({
    agent_id: z.string().uuid(),
    type: z.enum(["note", "faq", "url"]),
    name: z.string().trim().min(1).max(120),
    content: z.string().trim().max(20_000).optional(),
    url: z.string().trim().url().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "url" && !val.url) {
      ctx.addIssue({ code: "custom", message: "URL is required for a url source", path: ["url"] });
    }
    if ((val.type === "note" || val.type === "faq") && !val.content) {
      ctx.addIssue({ code: "custom", message: "Content is required", path: ["content"] });
    }
  });

export type CreateKnowledgeInput = z.infer<typeof createKnowledgeSchema>;
