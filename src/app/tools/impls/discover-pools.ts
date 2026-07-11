import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { CandidatePoolSchema } from "../../../domain/schemas/market.js";

export const discoverPoolsTool = defineTool({
  name: "discover_pools",
  description: "Return raw candidate pools from the discovery source, before scoring/filtering. Read-only reconnaissance.",
  args: z.object({
    limit: z.number().int().positive().max(200).default(50),
    timeframe: z.string().optional(),
    category: z.string().optional(),
  }),
  result: z.object({
    pools: z.array(CandidatePoolSchema),
  }),
  execute: async (args, ctx) => ({
    pools: await ctx.market.pools.discover({
      limit: args.limit,
      ...(args.timeframe !== undefined ? { timeframe: args.timeframe } : {}),
      ...(args.category !== undefined ? { category: args.category } : {}),
    }),
  }),
});
