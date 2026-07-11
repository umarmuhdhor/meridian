import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const removeSmartWalletTool = defineTool({
  name: "remove_smart_wallet",
  description: "Stop tracking a smart wallet by address.",
  args: z.object({ address: z.string().min(1) }),
  result: z.object({ removed: z.boolean(), address: z.string() }),
  execute: async ({ address }, ctx) => ({ removed: await ctx.repos.smartWallets.remove(address), address }),
});
