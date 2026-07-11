import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const removeFromBlacklistTool = defineTool({
  name: "remove_from_blacklist",
  description: "Remove a token mint from the blacklist so screening can consider it again.",
  args: z.object({ mint: z.string().min(1) }),
  result: z.object({ removed: z.boolean(), mint: z.string() }),
  execute: async ({ mint }, ctx) => ({ removed: await ctx.repos.tokenBlacklist.remove(mint), mint }),
});
