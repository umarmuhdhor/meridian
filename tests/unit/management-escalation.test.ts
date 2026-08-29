import { describe, it, expect } from "vitest";
import { runManagementCycle } from "../../src/app/management/cycle.js";
import { createRegistry } from "../../src/app/tools/registry.js";
import { createDryRunChainClient } from "../../src/adapters/chain/dry-run.js";
import { closePositionTool } from "../../src/app/tools/impls/close-position.js";
import { claimFeesTool } from "../../src/app/tools/impls/claim-fees.js";
import { getMyPositionsTool } from "../../src/app/tools/impls/get-my-positions.js";
import { createFakeSageExitAdvisor } from "../../src/adapters/llm/fake-sage-exit-advisor.js";
import { fixedClock } from "../../src/ports/clock.js";
import type { AppConfig } from "../../src/domain/schemas/config.js";
import type { OnChainPosition } from "../../src/domain/schemas/chain.js";
import { makeCtx } from "./tool-context.js";
import { mgmt, screening } from "./fixtures.js";

const CLOCK = fixedClock("2026-07-05T12:00:00.000Z");
const REGISTRY = createRegistry([closePositionTool, claimFeesTool, getMyPositionsTool]);

/** Smart-exit config with realistic thresholds, exit engine armed. */
function smartConfig(over: Partial<typeof mgmt> = {}): AppConfig {
  return {
    risk: { maxPositions: 3 },
    management: {
      ...mgmt,
      smartExitEnabled: true,
      sageExitEnabled: true,
      stopLossPct: -15,
      exitHardFloorPct: -25,
      healthyFeeVelocityMin: 12,
      minClaimAmount: 1000, // keep CLAIM from firing so we isolate the exit path
      ...over,
    },
    strategy: { strategy: "spot", binsBelow: 69 },
    schedule: { managementIntervalMin: 10, screeningIntervalMin: 30, healthCheckIntervalMin: 60 },
    screening,
  } as unknown as AppConfig;
}

/** In-range, deep paper loss, weak fees → classifies AMBIGUOUS → escalates. */
function ambiguousPosition(): OnChainPosition {
  return {
    position: "posAMB",
    pool: "poolAMB",
    pair: "AMB/SOL",
    base_mint: "MINT_AMB",
    lower_bin: 0,
    upper_bin: 10,
    active_bin: 5,
    in_range: true,
    unclaimed_fees_usd: 0,
    pnl_pct: -18,
    pnl_pct_suspicious: false,
    total_value_usd: 30,
    // Above low-yield floor (minFeePerTvl24h=7) so rule 4 doesn't pre-empt, but
    // below healthyFeeVelocityMin (12) so it isn't HEALTHY → genuinely AMBIGUOUS.
    fee_per_tvl_24h: 9,
    age_minutes: 300,
  };
}

describe("runManagementCycle — smart-exit escalation", () => {
  it("AMBIGUOUS + Sage says CLOSE → position planned for close", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { walletSol: 5, positions: [ambiguousPosition()] },
    });
    const ctx = makeCtx({ chain, config: smartConfig() });
    const sageExit = createFakeSageExitAdvisor({ verdict: { action: "CLOSE", reason: "support broken, cut it" } });
    const outcome = await runManagementCycle({ ctx, registry: REGISTRY, sageExit });
    expect(outcome.kind).toBe("executed");
    if (outcome.kind === "executed") {
      const closePlan = outcome.plans.find((p) => p.action === "CLOSE");
      expect(closePlan).toBeDefined();
      expect(closePlan?.reason).toContain("Sage");
    }
    expect(sageExit.calls.length).toBe(1);
  });

  it("AMBIGUOUS + Sage says HOLD → position stays", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { walletSol: 5, positions: [ambiguousPosition()] },
    });
    const ctx = makeCtx({ chain, config: smartConfig() });
    const sageExit = createFakeSageExitAdvisor({ verdict: { action: "HOLD", reason: "in-range, fees recovering" } });
    const outcome = await runManagementCycle({ ctx, registry: REGISTRY, sageExit });
    expect(outcome.kind).toBe("all_stay");
  });

  it("AMBIGUOUS + Sage unreachable → conditional fallback HOLDs an in-range position", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { walletSol: 5, positions: [ambiguousPosition()] },
    });
    const ctx = makeCtx({ chain, config: smartConfig() });
    const sageExit = createFakeSageExitAdvisor({ throwError: true });
    const outcome = await runManagementCycle({ ctx, registry: REGISTRY, sageExit });
    expect(outcome.kind).toBe("all_stay");
  });

  it("sageExitEnabled=false → in-range ambiguous position falls back to HOLD without calling Sage", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { walletSol: 5, positions: [ambiguousPosition()] },
    });
    const ctx = makeCtx({ chain, config: smartConfig({ sageExitEnabled: false }) });
    const sageExit = createFakeSageExitAdvisor({ verdict: { action: "CLOSE", reason: "should not be called" } });
    const outcome = await runManagementCycle({ ctx, registry: REGISTRY, sageExit });
    expect(outcome.kind).toBe("all_stay");
    expect(sageExit.calls.length).toBe(0);
  });
});
