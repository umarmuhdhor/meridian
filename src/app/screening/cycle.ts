import type { AppContext } from "../tools/context.js";
import type { LLMClient } from "../../ports/llm-client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { runAgentLoop, type AgentLoopResult } from "../agent/loop.js";
import { executeTool } from "../tools/execute.js";
import { buildSystemPrompt } from "../../domain/prompt/builder.js";
import { SCREENER_TOOLS } from "../../domain/prompt/role-tools.js";
import { sanitizeDecisionText } from "../../domain/schemas/decision.js";
import type { CandidatePool } from "../../domain/schemas/market.js";

export interface ScreeningCycleDeps {
  ctx: AppContext;
  llm: LLMClient;
  registry: ToolRegistry;
  model: string;
}

export type ScreeningOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "no_deploy"; picked: number; rejection_summary: readonly string[] }
  | { kind: "invoked"; picked: number; agent: AgentLoopResult };

function nextDecisionId(now: Date): string {
  return `dec_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface TopCandidatesResult {
  picked: Array<{ pool: CandidatePool; score: number; rank: number }>;
  scanned: number;
  passed: number;
  rejected: number;
  rejection_summary: string[];
}

function formatCandidatesBlock(picked: TopCandidatesResult["picked"]): string {
  if (!picked.length) return "  (no candidates passed)";
  return picked
    .map((p, i) => {
      const feeTvl = p.pool.fee_active_tvl_ratio ?? p.pool.fee_tvl_ratio ?? 0;
      const vol = p.pool.volume_window;
      return `  [${i + 1}] ${p.pool.name}  pool=${p.pool.pool_address.slice(0, 8)}...  score=${p.score.toFixed(0)}  fee/aTVL=${(feeTvl * 100).toFixed(2)}%  vol=$${vol.toFixed(0)}  organic=${p.pool.organic_score ?? "?"}`;
    })
    .join("\n");
}

/**
 * One screening cycle. Order:
 *   1. Preflight — enough SOL? at maxPositions? log skip if so.
 *   2. Run `get_top_candidates`.
 *   3. If 0 pass → append `no_deploy` decision + return `no_deploy`.
 *   4. If ≥1 pass → build system prompt + goal (with candidates block) + invoke agent loop.
 */
export async function runScreeningCycle(deps: ScreeningCycleDeps): Promise<ScreeningOutcome> {
  const { ctx, llm, registry, model } = deps;

  // Preflight
  const [wallet, positionsSnap, activeStrategy, recentDecisions] = await Promise.all([
    ctx.chain.getWalletBalance(),
    ctx.chain.getMyPositions({ force: true }),
    ctx.repos.strategies.getActive(),
    ctx.repos.decisions.recent(5),
  ]);

  if (positionsSnap.total_positions >= ctx.config.risk.maxPositions) {
    const reason = `at max positions (${positionsSnap.total_positions}/${ctx.config.risk.maxPositions})`;
    await ctx.repos.decisions.append({
      id: nextDecisionId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "skip",
      actor: "SCREENER",
      pool: null,
      pool_name: null,
      summary: sanitizeDecisionText(`Screening skipped: ${reason}`),
      reason: sanitizeDecisionText(reason, 500),
      risks: [],
      metrics: { total_positions: positionsSnap.total_positions, max: ctx.config.risk.maxPositions },
      rejected: [],
    });
    ctx.logger.info("screening", `skipped — ${reason}`);
    return { kind: "skipped", reason };
  }

  const need = ctx.config.management.deployAmountSol + ctx.config.management.gasReserve;
  if (wallet.sol < need) {
    const reason = `insufficient SOL: ${wallet.sol.toFixed(4)} < ${need.toFixed(4)}`;
    await ctx.repos.decisions.append({
      id: nextDecisionId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "skip",
      actor: "SCREENER",
      pool: null,
      pool_name: null,
      summary: sanitizeDecisionText(`Screening skipped: ${reason}`),
      reason: sanitizeDecisionText(reason, 500),
      risks: [],
      metrics: { sol: wallet.sol, need },
      rejected: [],
    });
    ctx.logger.info("screening", `skipped — ${reason}`);
    return { kind: "skipped", reason };
  }

  // Run pipeline
  const candidates = await executeTool(registry, {
    name: "get_top_candidates",
    args: { limit: 5, discover_limit: 50 },
  }, ctx);

  if (!candidates.ok) {
    const message = `get_top_candidates failed: ${candidates.error.kind}`;
    ctx.logger.error("screening", message);
    return { kind: "skipped", reason: message };
  }
  const picked = (candidates.value as TopCandidatesResult).picked;
  const rejSummary = (candidates.value as TopCandidatesResult).rejection_summary;

  if (picked.length === 0) {
    await ctx.repos.decisions.append({
      id: nextDecisionId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "no_deploy",
      actor: "SCREENER",
      pool: null,
      pool_name: null,
      summary: sanitizeDecisionText("Screening produced 0 eligible candidates"),
      reason: sanitizeDecisionText(rejSummary.slice(0, 3).join(", "), 500),
      risks: [],
      metrics: {
        scanned: (candidates.value as TopCandidatesResult).scanned,
        passed: 0,
        rejected: (candidates.value as TopCandidatesResult).rejected,
      },
      rejected: rejSummary,
    });
    ctx.logger.info("screening", `no_deploy — ${rejSummary.slice(0, 3).join(", ")}`);
    return { kind: "no_deploy", picked: 0, rejection_summary: rejSummary };
  }

  // Invoke agent loop
  const systemPrompt = buildSystemPrompt({
    role: "SCREENER",
    wallet,
    positions: positionsSnap,
    config: ctx.config,
    activeStrategy,
    recentDecisions,
  });

  const goal = [
    "SCREENING CYCLE — pick one of the following candidates and call deploy_position, or explain why none qualify.",
    "",
    "CANDIDATES:",
    formatCandidatesBlock(picked),
    "",
    `Deploy amount: ${ctx.config.management.deployAmountSol} SOL. Strategy: ${ctx.config.strategy.strategy}.`,
    `bins_below floor: ${ctx.config.strategy.minBinsBelow}. Default: ${ctx.config.strategy.defaultBinsBelow}.`,
  ].join("\n");

  const agent = await runAgentLoop(
    { llm, registry, ctx },
    {
      role: "SCREENER",
      goal,
      systemPrompt,
      model,
      maxSteps: 8,
      toolFilter: SCREENER_TOOLS,
      requireToolOnFirstStep: true,
    },
  );

  ctx.logger.info(
    "screening",
    `invoked agent — steps=${agent.steps} locks=${agent.locks.join(",")} finish=${agent.finishReason}`,
  );

  // Visibility: if the screener ran but did NOT deploy (it has no "skip" tool, so a
  // decline surfaces as text / no_tool_after_reminder), record WHY so the Decisions
  // page isn't silent. A successful deploy already logs via the tool's post-hook.
  const deployed = agent.toolCalls.some((t) => t.name === "deploy_position" && t.ok);
  if (!deployed) {
    const scanned = (candidates.value as TopCandidatesResult).scanned;
    const passed = (candidates.value as TopCandidatesResult).passed;
    const reasonText = agent.text.trim() || `screener finished without deploying (${agent.finishReason})`;
    await ctx.repos.decisions.append({
      id: nextDecisionId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "no_deploy",
      actor: "SCREENER",
      pool: null,
      pool_name: null,
      summary: sanitizeDecisionText(`Screener reviewed ${picked.length} candidate(s), chose not to deploy`),
      reason: sanitizeDecisionText(reasonText, 500),
      risks: [],
      metrics: { scanned, passed, candidates: picked.length, finish: agent.finishReason },
      rejected: [],
    });
    ctx.logger.info("screening", `no_deploy (screener declined) — finish=${agent.finishReason}`);
  }

  return { kind: "invoked", picked: picked.length, agent };
}
