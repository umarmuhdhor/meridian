import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { StrategyEntrySchema } from "../../../domain/schemas/strategy.js";

export const listStrategiesTool = defineTool({
  name: "list_strategies",
  description: "List all saved LP strategies and which one is active.",
  args: z.object({}),
  result: z.object({
    active: z.string().nullable(),
    strategies: z.array(StrategyEntrySchema),
  }),
  execute: async (_args, ctx) => {
    const [strategies, active] = await Promise.all([
      ctx.repos.strategies.list(),
      ctx.repos.strategies.getActive(),
    ]);
    return { active: active?.id ?? null, strategies };
  },
});
