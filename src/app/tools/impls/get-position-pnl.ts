import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { OnChainPositionSchema } from "../../../domain/schemas/chain.js";

export const getPositionPnlTool = defineTool({
  name: "get_position_pnl",
  description:
    "Return the live PnL + range snapshot for a single open position by its address (from the current on-chain positions snapshot).",
  args: z.object({
    position_address: z.string().min(1),
  }),
  result: z.object({
    found: z.boolean(),
    position: OnChainPositionSchema.nullable(),
  }),
  execute: async ({ position_address }, ctx) => {
    const snap = await ctx.chain.getMyPositions();
    const position = snap.positions.find((p) => p.position === position_address) ?? null;
    return { found: position !== null, position };
  },
});
