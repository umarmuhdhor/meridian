import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { ActiveBinSchema } from "../../../domain/schemas/chain.js";

export const getActiveBinTool = defineTool({
  name: "get_active_bin",
  description: "Return the current active bin id + price for a Meteora DLMM pool.",
  args: z.object({
    pool_address: z.string().min(1).describe("Meteora DLMM pool address."),
  }),
  result: ActiveBinSchema,
  execute: async ({ pool_address }, ctx) => ctx.chain.getActiveBin(pool_address),
});
