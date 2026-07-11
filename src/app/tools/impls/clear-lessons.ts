import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const clearLessonsTool = defineTool({
  name: "clear_lessons",
  description:
    "Clear stored lessons. mode='all' removes every lesson; mode='keyword' removes only lessons whose rule contains the keyword. Performance history is never touched.",
  args: z.object({
    mode: z.enum(["all", "keyword"]).default("all"),
    keyword: z.string().optional(),
  }),
  result: z.object({
    cleared: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  }),
  execute: async ({ mode, keyword }, ctx) => {
    const loaded = await ctx.repos.lessons.load();
    if (!loaded.ok) return { cleared: 0, remaining: 0 };
    const file = loaded.value;
    const before = file.lessons.length;
    let kept = file.lessons;
    if (mode === "all") {
      kept = [];
    } else {
      const kw = (keyword ?? "").toLowerCase();
      kept = kw ? file.lessons.filter((l) => !l.rule.toLowerCase().includes(kw)) : file.lessons;
    }
    await ctx.repos.lessons.save({ lessons: kept, performance: file.performance });
    return { cleared: before - kept.length, remaining: kept.length };
  },
});
