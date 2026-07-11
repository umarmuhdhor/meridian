import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { CandidatePoolSchema } from "../../../domain/schemas/market.js";

export const getPoolDetailTool = defineTool({
  name: "get_pool_detail",
  description: "Fetch the full candidate-pool detail for a single pool address (TVL, fees, organic score, bin step, etc.).",
  args: z.object({
    pool_address: z.string().min(1),
  }),
  result: z.object({
    found: z.boolean(),
    pool: CandidatePoolSchema.nullable(),
  }),
  execute: async ({ pool_address }, ctx) => {
    const pool = await ctx.market.pools.getPoolDetail(pool_address);
    return { found: pool !== null, pool };
  },
});
