import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { StrategyEntrySchema } from "../../../domain/schemas/strategy.js";

export const getActiveStrategyTool = defineTool({
  name: "get_active_strategy",
  description: "Return the currently active LP strategy from the strategy library.",
  args: z.object({}),
  result: z.object({
    active: StrategyEntrySchema.nullable(),
  }),
  execute: async (_args, ctx) => ({
    active: await ctx.repos.strategies.getActive(),
  }),
});
