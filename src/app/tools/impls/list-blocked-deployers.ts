import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { DevBlocklistEntrySchema } from "../../../domain/schemas/dev-blocklist.js";

export const listBlockedDeployersTool = defineTool({
  name: "list_blocked_deployers",
  description: "List blocked deployer/dev wallets. Screening hard-filters pools whose deployer is on this list.",
  args: z.object({}),
  result: z.object({
    blocked: z.array(
      DevBlocklistEntrySchema.extend({ wallet: z.string() }),
    ),
  }),
  execute: async (_args, ctx) => {
    const list = await ctx.repos.devBlocklist.list();
    return { blocked: list.map(({ wallet, entry }) => ({ wallet, ...entry })) };
  },
});
