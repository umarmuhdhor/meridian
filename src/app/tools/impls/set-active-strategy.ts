import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const setActiveStrategyTool = defineTool({
  name: "set_active_strategy",
  description: "Set which saved LP strategy is active (used in the SCREENER prompt).",
  args: z.object({ id: z.string().min(1) }),
  result: z.object({ active: z.boolean(), id: z.string() }),
  execute: async ({ id }, ctx) => ({ active: await ctx.repos.strategies.setActive(id), id }),
});
