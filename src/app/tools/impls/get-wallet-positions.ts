import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const getWalletPositionsTool = defineTool({
  name: "get_wallet_positions",
  description:
    "List the wallet's open DLMM positions in a compact shape (address, pair, PnL, bin range). Mirrors get_my_positions but flattened for display.",
  args: z.object({
    wallet_address: z.string().optional(),
  }),
  result: z.object({
    total_positions: z.number().int().nonnegative(),
    positions: z.array(
      z.object({
        position: z.string(),
        pool_name: z.string().nullable(),
        pair: z.string(),
        pnl_pct: z.number().nullable(),
        lower_bin: z.number().int(),
        upper_bin: z.number().int(),
      }),
    ),
  }),
  execute: async ({ wallet_address }, ctx) => {
    const snap = await ctx.chain.getMyPositions(
      wallet_address ? { wallet_address } : undefined,
    );
    return {
      total_positions: snap.total_positions,
      positions: snap.positions.map((p) => ({
        position: p.position,
        pool_name: p.pair, // TS positions carry `pair`; expose it under both keys for the UI
        pair: p.pair,
        pnl_pct: p.pnl_pct,
        lower_bin: p.lower_bin,
        upper_bin: p.upper_bin,
      })),
    };
  },
});
