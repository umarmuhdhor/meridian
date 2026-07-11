import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const unblockDeployerTool = defineTool({
  name: "unblock_deployer",
  description: "Unblock a previously blocked deployer/dev wallet.",
  args: z.object({ wallet: z.string().min(1) }),
  result: z.object({ unblocked: z.boolean(), wallet: z.string() }),
  execute: async ({ wallet }, ctx) => ({ unblocked: await ctx.repos.devBlocklist.remove(wallet), wallet }),
});
