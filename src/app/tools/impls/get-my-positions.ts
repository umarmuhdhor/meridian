import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { PositionsSnapshotSchema } from "../../../domain/schemas/chain.js";

export const getMyPositionsTool = defineTool({
  name: "get_my_positions",
  description:
    "Return the wallet's open positions with pnl_pct, in_range, unclaimed_fees_usd, and age. Pass force=true to bypass the 5-minute cache (used before deploy for a fresh count).",
  args: z.object({
    force: z.boolean().default(false),
  }),
  result: PositionsSnapshotSchema,
  execute: async ({ force }, ctx) => ctx.chain.getMyPositions({ force }),
});
