import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { PerformanceRecordSchema } from "../../../domain/schemas/lesson.js";

export const getPerformanceHistoryTool = defineTool({
  name: "get_performance_history",
  description: "Return recent closed-position performance records (PnL, fees, hold time, close reason).",
  args: z.object({
    limit: z.number().int().positive().max(200).default(50),
  }),
  result: z.object({
    performance: z.array(PerformanceRecordSchema),
  }),
  execute: async ({ limit }, ctx) => ({
    performance: await ctx.repos.lessons.recentPerformance(limit),
  }),
});
