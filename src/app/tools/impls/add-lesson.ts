import { z } from "zod";
import { defineTool } from "../define-tool.js";

const MAX_LEN = 500;
const sanitize = (t: string): string =>
  t.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/[<>]/g, "").trim().slice(0, MAX_LEN);

export const addLessonTool = defineTool({
  name: "add_lesson",
  description: "Add a lesson (a PREFER/AVOID/WORKED/FAILED rule) that gets injected into future agent prompts.",
  args: z.object({
    rule: z.string().min(3),
    tags: z.array(z.string()).default([]),
    role: z.string().nullable().optional(),
    pinned: z.boolean().default(false),
  }),
  result: z.object({
    added: z.literal(true),
    id: z.string(),
  }),
  execute: async (args, ctx) => {
    const now = ctx.clock.now();
    const id = `l-${now.getTime()}`;
    await ctx.repos.lessons.addLesson({
      id,
      rule: sanitize(args.rule),
      tags: args.tags,
      role: args.role ?? null,
      pinned: args.pinned,
      sourceType: "manual",
      created_at: now.toISOString(),
    });
    return { added: true as const, id };
  },
});
