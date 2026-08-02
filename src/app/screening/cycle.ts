import type { AppContext } from "../tools/context.js";
import type { LLMClient } from "../../ports/llm-client.js";
import type { SageDecider } from "../../ports/sage-decider.js";
import type { ToolRegistry } from "../tools/registry.js";
import { runAgentLoop, type AgentLoopResult } from "../agent/loop.js";
import { executeTool } from "../tools/execute.js";
import { buildSystemPrompt } from "../../domain/prompt/builder.js";
import { SCREENER_TOOLS } from "../../domain/prompt/role-tools.js";
import { sanitizeDecisionText } from "../../domain/schemas/decision.js";
import type { CandidatePool } from "../../domain/schemas/market.js";
import {
  formatInsufficientSolReason,
  formatMaxPositionsReason,
  formatNoCandidatesReason,
} from "../../domain/format/decision-strings.js";

export interface ScreeningCycleDeps {
  ctx: AppContext;
  llm: LLMClient;
  registry: ToolRegistry;
  model: string;
  /**
   * Who makes the deploy decision. "loop" (default) = local LLM ReAct loop.
   * "sage" = delegate to an external agent that reasons with memory AND executes
   * the deploy itself via the dashboard bridge; the local loop becomes the fallback.
   */
  decider?: "loop" | "sage";
  sage?: SageDecider;
  /** Memory scope for the Sage session (X-Hermes-Session-Key). */
  sageSessionKey?: string;
  /** Hard timeout for a Sage delegation before falling back. */
  sageTimeoutMs?: number;
}

export type ScreeningOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "no_deploy"; picked: number; rejection_summary: readonly string[] }
  | { kind: "invoked"; picked: number; agent: AgentLoopResult }
  | { kind: "delegated"; picked: number; deployed: boolean; text: string };

function nextDecisionId(now: Date): string {
  return `dec_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** DRY helper: append a `no_deploy` decision so the Decisions page is never silent. */
async function appendNoDeploy(
  ctx: AppContext,
  args: { summary: string; reason: string; metrics: Record<string, unknown>; rejected?: string[] },
): Promise<void> {
  await ctx.repos.decisions.append({
    id: nextDecisionId(ctx.clock.now()),
    ts: ctx.clock.now().toISOString(),
    type: "no_deploy",
    actor: "SCREENER",
    pool: null,
    pool_name: null,
    summary: sanitizeDecisionText(args.summary),
    reason: sanitizeDecisionText(args.reason, 500),
    risks: [],
    metrics: args.metrics,
    rejected: args.rejected ?? [],
  });
}

interface TopCandidatesResult {
  picked: Array<{ pool: CandidatePool; score: number; rank: number }>;
  scanned: number;
  passed: number;
  rejected: number;
  rejection_summary: string[];
  rejected_details: string[];
}

function formatCandidatesBlock(picked: TopCandidatesResult["picked"]): string {
  if (!picked.length) return "  (no candidates passed)";
  return picked
    .map((p, i) => {
      const feeTvl = p.pool.fee_active_tvl_ratio ?? p.pool.fee_tvl_ratio ?? 0;
      const vol = p.pool.volume_window;
      // FULL pool_address — the screener passes this verbatim to get_active_bin /
      // deploy_position. Truncating it (slice(0,8)+"...") fed the model an invalid
      // base58 string → "Invalid public key input" every cycle → never deployed.
      return `  [${i + 1}] ${p.pool.name}  pool=${p.pool.pool_address}  score=${p.score.toFixed(0)}  fee/aTVL=${(feeTvl * 100).toFixed(2)}%  vol=$${vol.toFixed(0)}  organic=${p.pool.organic_score ?? "?"}`;
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
    const shortReason = `at max positions (${positionsSnap.total_positions}/${ctx.config.risk.maxPositions})`;
    const humanReason = formatMaxPositionsReason(
      positionsSnap.total_positions,
      ctx.config.risk.maxPositions,
    );
    await ctx.repos.decisions.append({
      id: nextDecisionId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "skip",
      actor: "SCREENER",
      pool: null,
      pool_name: null,
      summary: sanitizeDecisionText(
        `Screening paused — position cap reached (${positionsSnap.total_positions}/${ctx.config.risk.maxPositions})`,
      ),
      reason: sanitizeDecisionText(humanReason, 500),
      risks: [],
      metrics: { total_positions: positionsSnap.total_positions, max: ctx.config.risk.maxPositions },
      rejected: [],
    });
    ctx.logger.info("screening", `skipped — ${shortReason}`);
    return { kind: "skipped", reason: shortReason };
  }

  const need = ctx.config.management.deployAmountSol + ctx.config.management.gasReserve;
  if (wallet.sol < need) {
    const shortReason = `insufficient SOL: ${wallet.sol.toFixed(4)} < ${need.toFixed(4)}`;
    const humanReason = formatInsufficientSolReason(
      wallet.sol,
      need,
      ctx.config.management.deployAmountSol,
      ctx.config.management.gasReserve,
    );
    await ctx.repos.decisions.append({
      id: nextDecisionId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "skip",
      actor: "SCREENER",
      pool: null,
      pool_name: null,
      summary: sanitizeDecisionText(`Screening paused — wallet SOL below deploy threshold`),
      reason: sanitizeDecisionText(humanReason, 500),
      risks: [],
      metrics: { sol: wallet.sol, need },
      rejected: [],
    });
    ctx.logger.info("screening", `skipped — ${shortReason}`);
    return { kind: "skipped", reason: shortReason };
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
  const candResult = candidates.value as TopCandidatesResult;
  const picked = candResult.picked;
  const rejSummary = candResult.rejection_summary;
  const rejDetails = candResult.rejected_details ?? [];

  if (picked.length === 0) {
    const humanReason = formatNoCandidatesReason(
      candResult.scanned,
      candResult.rejected,
      rejDetails,
    );
    await ctx.repos.decisions.append({
      id: nextDecisionId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "no_deploy",
      actor: "SCREENER",
      pool: null,
      pool_name: null,
      summary: sanitizeDecisionText(
        `No pools qualified — reviewed ${candResult.scanned}, all ${candResult.rejected} failed hard filters`,
      ),
      reason: sanitizeDecisionText(humanReason, 500),
      risks: [],
      metrics: {
        scanned: candResult.scanned,
        passed: 0,
        rejected: candResult.rejected,
      },
      rejected: rejDetails.length ? rejDetails : rejSummary,
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

  const scanned = (candidates.value as TopCandidatesResult).scanned;
  const passed = (candidates.value as TopCandidatesResult).passed;

  // Snapshot the set of open position ids BEFORE any deploy. A new id appearing after
  // is our robust "a deploy landed" signal — resilient to a concurrent management
  // close (which removes an OLD id but adds none), unlike a raw count delta.
  const beforeIds = new Set(positionsSnap.positions.map((p) => p.position));
  const detectDeploy = async (): Promise<boolean> => {
    const after = await ctx.chain.getMyPositions({ force: true });
    return after.positions.some((p) => !beforeIds.has(p.position));
  };

  // The local LLM ReAct loop — the default decider AND the fallback when Sage fails.
  const runLocalLoop = async (): Promise<ScreeningOutcome> => {
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
    // decline surfaces as text / no_tool_after_reminder), record WHY. A successful
    // deploy already logs via the tool's post-hook.
    const deployed = agent.toolCalls.some((t) => t.name === "deploy_position" && t.ok);
    if (!deployed) {
      const topPicks = picked
        .slice(0, 3)
        .map((p) => `${p.pool.name} (score ${p.score.toFixed(0)})`)
        .join(", ");
      const rationale = agent.text.trim();
      const reason = [
        `Local LLM reviewed ${picked.length} ranked candidate${picked.length === 1 ? "" : "s"} and declined to open a position.`,
        topPicks ? `Top options: ${topPicks}.` : "",
        rationale ? `Rationale: ${rationale}` : `Loop finished without a deploy call (${agent.finishReason}).`,
      ]
        .filter(Boolean)
        .join(" ");
      await appendNoDeploy(ctx, {
        summary: `Screener passed on all ${picked.length} candidate${picked.length === 1 ? "" : "s"} this cycle`,
        reason,
        metrics: { scanned, passed, candidates: picked.length, finish: agent.finishReason },
      });
      ctx.logger.info("screening", `no_deploy (screener declined) — finish=${agent.finishReason}`);
    }
    return { kind: "invoked", picked: picked.length, agent };
  };

  // Sage delegation path: Sage decides AND deploys via the bridge itself. We only get
  // prose back, so "did a deploy happen?" is answered by reconciliation, not the text.
  if (deps.decider === "sage" && deps.sage) {
    // cycle_id is the deploy idempotency key, shared with the fallback so a
    // delegate→timeout→fallback sequence can't double-deploy (bridge rejects the dup).
    const cycleId = `screen-${ctx.clock.now().toISOString().slice(0, 16)}-${Math.random().toString(36).slice(2, 8)}`;
    // Sage-tailored prompt. Sage's plugin exposes `mrd_`-prefixed tools, NOT Meridian's
    // internal SCREENER toolset — sending Meridian's full SCREENER systemPrompt makes Sage
    // flail (it calls the heavy mrd_get_candidates → CF 502 → timeout). Instead give it the
    // ranked candidates directly and one job: deploy the chosen one via mrd_deploy_position.
    const sageSystemPrompt = [
      "You are Meridian's DLMM screening decider. You are given PRE-FILTERED, RANKED pool",
      "candidates — do NOT discover, verify, or re-rank them.",
      "Pick the single best candidate to deploy into, or none.",
      "To deploy, call mrd_deploy_position EXACTLY ONCE with: pool_address (from the chosen",
      "candidate), amount_sol, strategy, bins_below (all given below), bins_above=0, and",
      "cycle_id (verbatim from the task).",
      "Do NOT call mrd_get_candidates, mrd_get_positions, mrd_get_wallet, or any other tool —",
      "everything you need is in this message.",
      "ABSOLUTELY DO NOT call mrd_update_config in this session. Config changes are",
      "human-gated and only permitted when the human user explicitly asks in a chat —",
      "which is NOT this session. This is an autonomous screening cycle, not a user request.",
      "If none qualify, reply exactly: NO DEPLOY: <reason>.",
    ].join("\n");
    const sageGoal = [
      "SCREENING CYCLE — choose one candidate and call mrd_deploy_position, or NO DEPLOY.",
      "",
      "CANDIDATES:",
      formatCandidatesBlock(picked),
      "",
      `amount_sol: ${ctx.config.management.deployAmountSol}. strategy: ${ctx.config.strategy.strategy}. bins_below: ${ctx.config.strategy.defaultBinsBelow} (floor ${ctx.config.strategy.minBinsBelow}). bins_above: 0.`,
    ].join("\n");
    try {
      const result = await deps.sage.decide({
        systemPrompt: sageSystemPrompt,
        goal: sageGoal,
        sessionKey: deps.sageSessionKey ?? "meridian-trading",
        cycleId,
        timeoutMs: deps.sageTimeoutMs ?? 90_000,
      });
      const deployed = await detectDeploy();
      if (deployed) {
        ctx.logger.info("screening", `sage delegated — deploy landed (cycle=${cycleId})`);
      } else {
        const topPicks = picked
          .slice(0, 3)
          .map((p) => `${p.pool.name} (score ${p.score.toFixed(0)})`)
          .join(", ");
        const rationale = result.text.trim();
        const reason = [
          `Sage (Hermes agent, memory-backed) reviewed ${picked.length} ranked candidate${picked.length === 1 ? "" : "s"} and declined to deploy.`,
          topPicks ? `Top options offered: ${topPicks}.` : "",
          rationale ? `Sage's rationale: ${rationale}` : "No rationale returned.",
        ]
          .filter(Boolean)
          .join(" ");
        await appendNoDeploy(ctx, {
          summary: `Sage passed on all ${picked.length} candidate${picked.length === 1 ? "" : "s"} this cycle`,
          reason,
          metrics: { scanned, passed, candidates: picked.length, decider: "sage" },
        });
        ctx.logger.info("screening", "sage delegated — no_deploy");
      }
      return { kind: "delegated", picked: picked.length, deployed, text: result.text };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      // Transport/timeout. If Sage already deployed before dying, do NOT fall back
      // (that would double-deploy). Only fall back when no new position landed.
      if (await detectDeploy()) {
        ctx.logger.warn("screening", `sage errored after a deploy landed — NOT falling back (${msg})`);
        return { kind: "delegated", picked: picked.length, deployed: true, text: "(sage errored after deploy)" };
      }
      ctx.logger.warn("screening", `sage delegation failed, falling back to local loop: ${msg}`);
      return runLocalLoop();
    }
  }

  return runLocalLoop();
}
