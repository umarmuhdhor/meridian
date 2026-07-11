import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { SmartWalletSchema } from "../../../domain/schemas/smart-wallet.js";

export const listSmartWalletsTool = defineTool({
  name: "list_smart_wallets",
  description: "List tracked KOL/whale wallets used as deployment-confidence signals.",
  args: z.object({}),
  result: z.object({
    count: z.number().int().nonnegative(),
    wallets: z.array(SmartWalletSchema),
  }),
  execute: async (_args, ctx) => {
    const wallets = await ctx.repos.smartWallets.list();
    return { count: wallets.length, wallets };
  },
});
