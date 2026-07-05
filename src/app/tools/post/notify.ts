import type { PostHook } from "../types.js";
import type { ClaimResult, CloseResult, DeployResult, SwapResult } from "../../../domain/schemas/chain.js";

export const notifyDeployHook: PostHook<unknown, DeployResult> = async (_args, result, ctx) => {
  if (result.success) await ctx.notifier.notifyDeploy(result);
};

export const notifyCloseHook: PostHook<unknown, CloseResult> = async (_args, result, ctx) => {
  if (result.success) await ctx.notifier.notifyClose(result);
};

export const notifyClaimHook: PostHook<unknown, ClaimResult> = async (_args, result, ctx) => {
  if (result.success) await ctx.notifier.notifyClaim(result);
};

export const notifySwapHook: PostHook<unknown, SwapResult> = async (_args, result, ctx) => {
  if (result.success) await ctx.notifier.notifySwap(result);
};
