import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { LessonSchema } from "../../../domain/schemas/lesson.js";

export const listLessonsTool = defineTool({
  name: "list_lessons",
  description: "List stored lessons, optionally filtered by role / pinned / tag.",
  args: z.object({
    role: z.string().nullable().optional(),
    pinned: z.boolean().nullable().optional(),
    tag: z.string().nullable().optional(),
    limit: z.number().int().positive().max(200).optional(),
  }),
  result: z.object({
    lessons: z.array(LessonSchema),
  }),
  execute: async (args, ctx) => ({
    lessons: await ctx.repos.lessons.listLessons({
      role: args.role ?? null,
      pinned: args.pinned ?? null,
      tag: args.tag ?? null,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),
  }),
});
