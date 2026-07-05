import { AppConfigSchema, type AppConfig } from "./schemas/config.js";
import { FlatUserConfigSchema, type FlatUserConfig } from "./schemas/config-flat.js";
import { err, ok, type Result } from "../shared/result.js";
import { z } from "zod";

export type ConfigLoadError =
  | { kind: "flat_invalid"; issues: z.ZodIssue[] }
  | { kind: "nested_invalid"; issues: z.ZodIssue[] };

/**
 * Pure — map the flat user-config.json shape to the nested AppConfig the domain reads.
 * The JS runtime today builds the same nested `config` object at load time in config.js;
 * this port makes the transform explicit and validates both sides via Zod.
 */
export function flatToNested(flat: FlatUserConfig): AppConfig {
  return {
    risk: {
      maxPositions: flat.maxPositions,
      maxDeployAmount: flat.maxDeployAmount,
    },
    management: {
      stopLossPct: flat.stopLossPct,
      takeProfitPct: flat.takeProfitPct,
      outOfRangeBinsToClose: flat.outOfRangeBinsToClose,
      outOfRangeWaitMinutes: flat.outOfRangeWaitMinutes,
      oorCooldownTriggerCount: flat.oorCooldownTriggerCount,
      oorCooldownHours: flat.oorCooldownHours,
      minFeePerTvl24h: flat.minFeePerTvl24h,
      minAgeBeforeYieldCheck: flat.minAgeBeforeYieldCheck,
      minClaimAmount: flat.minClaimAmount,
      trailingTakeProfit: flat.trailingTakeProfit,
      trailingTriggerPct: flat.trailingTriggerPct,
      trailingDropPct: flat.trailingDropPct,
      deployAmountSol: flat.deployAmountSol,
      gasReserve: flat.gasReserve,
      positionSizePct: flat.positionSizePct,
      minSolToOpen: flat.minSolToOpen,
      pnlSanityMaxDiffPct: flat.pnlSanityMaxDiffPct,
      solMode: flat.solMode,
      repeatDeployCooldownEnabled: flat.repeatDeployCooldownEnabled,
      repeatDeployCooldownTriggerCount: flat.repeatDeployCooldownTriggerCount,
      repeatDeployCooldownHours: flat.repeatDeployCooldownHours,
      repeatDeployCooldownScope: flat.repeatDeployCooldownScope,
      repeatDeployCooldownMinFeeEarnedPct: flat.repeatDeployCooldownMinFeeEarnedPct,
    },
    strategy: {
      strategy: flat.strategy,
      minBinsBelow: flat.minBinsBelow,
      maxBinsBelow: flat.maxBinsBelow,
      defaultBinsBelow: flat.defaultBinsBelow,
    },
    schedule: {
      managementIntervalMin: flat.managementIntervalMin,
      screeningIntervalMin: flat.screeningIntervalMin,
      healthCheckIntervalMin: flat.healthCheckIntervalMin,
    },
  };
}

/**
 * Full pipeline: raw JSON → validated flat → nested AppConfig → validated again.
 * Both validation stages surface Zod issues.
 */
export function parseAppConfig(raw: unknown): Result<AppConfig, ConfigLoadError> {
  const flat = FlatUserConfigSchema.safeParse(raw);
  if (!flat.success) return err({ kind: "flat_invalid", issues: flat.error.issues });
  const nested = AppConfigSchema.safeParse(flatToNested(flat.data));
  if (!nested.success) return err({ kind: "nested_invalid", issues: nested.error.issues });
  return ok(nested.data);
}

/**
 * Rebuild the flat file from a nested AppConfig — used by the migration script + `update_config` writeback.
 * Note: this drops keys we haven't ported yet (e.g. llm, screening); callers merge with the original flat.
 */
export function nestedToFlat(nested: AppConfig): Partial<FlatUserConfig> {
  return {
    ...nested.risk,
    ...nested.management,
    ...nested.strategy,
    ...nested.schedule,
  };
}
