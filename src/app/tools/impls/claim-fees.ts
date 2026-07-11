import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { ClaimResultSchema } from "../../../domain/schemas/chain.js";
import { notifyClaimHook } from "../post/notify.js";

export const claimFeesTool = defineTool({
  name: "claim_fees",
  description: "Claim accrued fees from a Meteora DLMM position without closing it.",
  args: z.object({
    position_address: z.string().min(1),
  }),
  result: ClaimResultSchema,
  post: [notifyClaimHook],
  execute: async ({ position_address }, ctx) => ctx.chain.claimFees(position_address),
});
