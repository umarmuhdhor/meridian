import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { SwapResultSchema } from "../../../domain/schemas/chain.js";
import { notifySwapHook } from "../post/notify.js";

export const swapTokenTool = defineTool({
  name: "swap_token",
  description:
    "Swap between two Solana token mints via Jupiter. Prefer SOL <-> base mint after closes to consolidate into SOL.",
  args: z.object({
    input_mint: z.string().min(1),
    output_mint: z.string().min(1),
    amount_in: z.number().positive(),
    slippage_bps: z.number().int().min(1).max(10_000).default(100),
  }),
  result: SwapResultSchema,
  oncePerSession: true,
  post: [notifySwapHook],
  execute: async (args, ctx) => ctx.swap.swap(args),
});
