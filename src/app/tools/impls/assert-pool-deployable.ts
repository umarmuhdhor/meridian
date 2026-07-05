import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { poolCooldownGate } from "../safety/pool-cooldown.js";

const ArgsSchema = z.object({
  pool_address: z.string().min(1).describe("Meteora DLMM pool address."),
  base_mint: z.string().nullable().optional().describe("Base token mint for base-mint cooldown check."),
});

const ResultSchema = z.object({
  pool_address: z.string(),
  deployable: z.literal(true),
  checked_at: z.string(),
});

/**
 * Cheap pre-deploy check. Safety chain does the real work — pool cooldown + base mint
 * cooldown gates. If either fires, executor returns a `safety_blocked` error before this
 * ever runs. Success path just echoes back a timestamp.
 */
export const assertPoolDeployableTool = defineTool({
  name: "assert_pool_deployable",
  description:
    "Check that a pool is not on cooldown (pool-level or base-mint-level). Returns success only when both gates pass. Call BEFORE any deploy attempt.",
  args: ArgsSchema,
  result: ResultSchema,
  safety: [poolCooldownGate],
  execute: async ({ pool_address }, ctx) => ({
    pool_address,
    deployable: true as const,
    checked_at: ctx.clock.now().toISOString(),
  }),
});
