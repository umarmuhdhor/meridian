import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { StudyResultSchema } from "../../../domain/schemas/study.js";

export const studyTopLpersTool = defineTool({
  name: "study_top_lpers",
  description:
    "Study the top Meteora LP-ers and return their aggregated patterns (avg hold, win rate, preferred strategies) plus a summary.",
  args: z.object({}),
  result: StudyResultSchema,
  execute: async (_args, ctx) => ctx.market.study.studyTopLpers(),
});
