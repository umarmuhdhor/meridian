import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { TokenHoldersSummarySchema } from "../../../domain/schemas/market.js";

export const getTokenHoldersTool = defineTool({
  name: "get_token_holders",
  description: "Return top holders summary + top10_pct + bot_pct for a mint. Filters pool-tagged holders.",
  args: z.object({
    mint: z.string().min(1),
    limit: z.number().int().positive().max(100).default(20),
  }),
  result: TokenHoldersSummarySchema,
  execute: async ({ mint, limit }, ctx) => ctx.market.tokenInfo.getHolders(mint, limit),
});
