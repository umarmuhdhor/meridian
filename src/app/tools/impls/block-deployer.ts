import { z } from "zod";
import { defineTool } from "../define-tool.js";

const MAX_LEN = 280;
const sanitize = (t: string): string =>
  t.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/[<>]/g, "").trim().slice(0, MAX_LEN);

export const blockDeployerTool = defineTool({
  name: "block_deployer",
  description: "Block a deployer/dev wallet. Screening hard-filters any pool whose deployer is on this list.",
  args: z.object({
    wallet: z.string().min(1),
    label: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
  }),
  result: z.object({
    blocked: z.literal(true),
    wallet: z.string(),
  }),
  execute: async (args, ctx) => {
    await ctx.repos.devBlocklist.add(args.wallet, {
      label: args.label ?? null,
      reason: sanitize(args.reason ?? "blocked via dashboard"),
      added_at: ctx.clock.now().toISOString(),
      added_by: "agent",
    });
    return { blocked: true as const, wallet: args.wallet };
  },
});
