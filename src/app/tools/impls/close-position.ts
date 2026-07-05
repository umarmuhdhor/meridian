import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { CloseResultSchema } from "../../../domain/schemas/chain.js";
import { logCloseDecision } from "../post/log-decision.js";
import { notifyCloseHook } from "../post/notify.js";

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
  post: [notifyCloseHook, logCloseDecision("MANAGER")],
  execute: async ({ position_address, reason }, ctx) =>
    ctx.chain.closePosition(position_address, reason),
});
