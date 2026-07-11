import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { CandidatePoolSchema } from "../../../domain/schemas/market.js";

export const searchPoolsTool = defineTool({
  name: "search_pools",
  description: "Free-text search over Meteora DLMM pools by name or address. Returns raw candidate rows.",
  args: z.object({
    query: z.string().min(1).describe("Substring to match against pool name or address."),
    limit: z.number().int().positive().max(50).default(10),
  }),
  result: z.object({
    count: z.number().int().nonnegative(),
    pools: z.array(CandidatePoolSchema),
  }),
  execute: async ({ query, limit }, ctx) => {
    const pools = await ctx.market.pools.search(query, limit);
    return { count: pools.length, pools };
  },
});
