import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { TopLpersResultSchema } from "../../../domain/schemas/study.js";

export const getTopLpersTool = defineTool({
  name: "get_top_lpers",
  description: "Return the current ranked list of top Meteora LP-ers (address, avg hold, win rate, preferred strategy).",
  args: z.object({
    limit: z.number().int().positive().max(100).default(20),
  }),
  result: TopLpersResultSchema,
  execute: async ({ limit }, ctx) => ctx.market.study.getTopLpers(limit),
});
