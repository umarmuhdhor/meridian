import type { AppContext } from "../tools/context.js";
import type { LLMClient } from "../../ports/llm-client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { runAgentLoop, type AgentLoopResult } from "../agent/loop.js";
import { buildSystemPrompt } from "../../domain/prompt/builder.js";
import { MANAGER_TOOLS } from "../../domain/prompt/role-tools.js";

export interface HealthCycleDeps {
  ctx: AppContext;
  llm: LLMClient;
  registry: ToolRegistry;
  model: string;
}

export type HealthOutcome =
  | { kind: "invoked"; agent: AgentLoopResult }
  | { kind: "no_positions" };

/**
 * Hourly health check — a MANAGER agent tick that summarizes wallet + positions and
 * flags anomalies (e.g. missing PnL data, stuck OOR, unusual balances) without any
 * mutating action. If no positions are open, the LLM is skipped entirely.
 */
export async function runHealthCycle(deps: HealthCycleDeps): Promise<HealthOutcome> {
  const { ctx, llm, registry, model } = deps;
  const snap = await ctx.chain.getMyPositions();
  if (snap.total_positions === 0) {
    ctx.logger.info("health", "no positions — skipping LLM tick");
    return { kind: "no_positions" };
  }

  const [wallet, activeStrategy, recentDecisions] = await Promise.all([
    ctx.chain.getWalletBalance(),
    ctx.repos.strategies.getActive(),
    ctx.repos.decisions.recent(5),
  ]);
  const systemPrompt = buildSystemPrompt({
    role: "MANAGER",
    wallet,
    positions: snap,
    config: ctx.config,
    activeStrategy,
    recentDecisions,
  });

  const goal = [
    "HEALTH CHECK — summarize the state of the wallet + all open positions in ≤5 lines.",
    "",
    "Do NOT close, claim, swap, or deploy. Only report.",
    "",
    "Include:",
    "  - Wallet SOL + USD.",
    "  - Position count + any OOR / suspect-pnl positions.",
    "  - One suggested next action, or 'no action' if healthy.",
  ].join("\n");

  const agent = await runAgentLoop(
    { llm, registry, ctx },
    {
      role: "MANAGER",
      goal,
      systemPrompt,
      model,
      maxSteps: 4,
      toolFilter: MANAGER_TOOLS,
      requireToolOnFirstStep: false,
    },
  );
  ctx.logger.info("health", `check complete — steps=${agent.steps} finish=${agent.finishReason}`);
  return { kind: "invoked", agent };
}
