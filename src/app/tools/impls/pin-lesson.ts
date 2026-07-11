import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const pinLessonTool = defineTool({
  name: "pin_lesson",
  description: "Pin a lesson by id so it is always injected into agent prompts (survives the recency cap).",
  args: z.object({ id: z.string().min(1) }),
  result: z.object({ pinned: z.boolean(), id: z.string() }),
  execute: async ({ id }, ctx) => ({ pinned: await ctx.repos.lessons.pinLesson(id), id }),
});
