import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const addSmartWalletTool = defineTool({
  name: "add_smart_wallet",
  description:
    "Track a KOL/alpha wallet. type='lp' checks its DLMM positions (deploy-confidence signal); type='holder' only checks token holdings.",
  args: z.object({
    name: z.string().min(1),
    address: z.string().min(1),
    category: z.string().optional(),
    type: z.enum(["lp", "holder"]).default("lp"),
  }),
  result: z.object({
    added: z.literal(true),
    address: z.string(),
  }),
  execute: async (args, ctx) => {
    await ctx.repos.smartWallets.add({
      name: args.name,
      address: args.address,
      ...(args.category !== undefined ? { category: args.category } : {}),
      type: args.type,
      addedAt: ctx.clock.now().toISOString(),
    });
    return { added: true as const, address: args.address };
  },
});
