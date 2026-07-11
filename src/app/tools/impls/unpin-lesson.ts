import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const unpinLessonTool = defineTool({
  name: "unpin_lesson",
  description: "Unpin a previously pinned lesson by id.",
  args: z.object({ id: z.string().min(1) }),
  result: z.object({ unpinned: z.boolean(), id: z.string() }),
  execute: async ({ id }, ctx) => ({ unpinned: await ctx.repos.lessons.unpinLesson(id), id }),
});
