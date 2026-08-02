import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { CloseResultSchema } from "../../../domain/schemas/chain.js";
import { logCloseDecision } from "../post/log-decision.js";
import { notifyCloseHook } from "../post/notify.js";
import { consolidateCloseHook } from "../post/consolidate.js";
import { markClosedInRepoHook } from "../post/mark-closed.js";
import { enrichCloseResult } from "../../../domain/format/enrich-close.js";

const ArgsSchema = z.object({
  position_address: z.string().min(1),
  reason: z.string().min(1).describe("Human-readable reason — becomes the close_reason on the performance record."),
});

export const closePositionTool = defineTool({
  name: "close_position",
  description:
    "Close a Meteora DLMM position, withdrawing all liquidity. Locks after a successful close (oncePerSession) — retriable only on failure.",
  args: ArgsSchema,
  result: CloseResultSchema,
  oncePerSession: true,
  post: [markClosedInRepoHook, notifyCloseHook, logCloseDecision("MANAGER"), consolidateCloseHook],
  execute: async ({ position_address, reason }, ctx) => {
    // Snapshot the position before closing so we can enrich the CloseResult
    // (real chain client returns null pnl/value/fees). If the position is
    // missing from the current snapshot (already closed elsewhere), skip
    // enrichment and let the raw result flow through.
    let snapshot;
    try {
      const snap = await ctx.chain.getMyPositions();
      snapshot = snap.positions.find((p) => p.position === position_address);
    } catch {
      snapshot = undefined;
    }
    const raw = await ctx.chain.closePosition(position_address, reason);
    return enrichCloseResult(raw, snapshot);
  },
});
