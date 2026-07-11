import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { WalletBalanceSchema } from "../../../domain/schemas/chain.js";

export const getWalletBalanceTool = defineTool({
  name: "get_wallet_balance",
  description: "Return the agent wallet SOL balance + USD value + current SOL price.",
  args: z.object({}),
  result: WalletBalanceSchema,
  execute: async (_args, ctx) => ctx.chain.getWalletBalance(),
});
