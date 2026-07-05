import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { SmartWalletMatchSchema } from "../../../domain/schemas/market.js";

export const checkSmartWalletsOnPoolTool = defineTool({
  name: "check_smart_wallets_on_pool",
  description:
    "Return tracked smart wallets currently in this pool (LP positions or base-mint holders). Use to gauge deployment confidence.",
  args: z.object({
    pool_address: z.string().min(1),
    base_mint: z.string().nullable().optional(),
  }),
  result: z.object({
    count: z.number().int().nonnegative(),
    matches: z.array(SmartWalletMatchSchema),
  }),
  execute: async ({ pool_address, base_mint }, ctx) => {
    const matches = await ctx.market.smartWalletChecker.checkPool(pool_address, base_mint ?? null);
    return { count: matches.length, matches };
  },
});
