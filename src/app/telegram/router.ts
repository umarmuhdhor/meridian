import type { AppContext } from "../tools/context.js";
import type { InboundMessage } from "../../ports/telegram-inbound.js";
import type { LLMClient } from "../../ports/llm-client.js";
import type { Scheduler } from "../../ports/scheduler.js";
import type { ToolRegistry } from "../tools/registry.js";
import { runAgentLoop } from "../agent/loop.js";
import { buildSystemPrompt } from "../../domain/prompt/builder.js";
import { GENERAL_TOOLS } from "../../domain/prompt/role-tools.js";
import { runBriefingCycle } from "../briefing/cycle.js";

export interface TelegramRouterDeps {
  ctx: AppContext;
  llm: LLMClient;
  registry: ToolRegistry;
  model: string;
  /** Optional cron-control surface. When absent, `/pause` and `/resume` reply with a note. */
  scheduler?: Scheduler;
  /** Optional graceful shutdown. When absent, `/stop` replies with a note. */
  shutdown?: (reason: string) => void;
}

/**
 * Dispatch an inbound Telegram message. Read-only commands (/help /status /positions /
 * /wallet /briefing) run direct handlers. Cron-control commands (/pause /resume /stop)
 * run when deps supply a scheduler / shutdown hook. Anything else is a GENERAL agent tick.
 *
 * Commands that mutate on-chain state (/close /deploy) are staged for a subsequent phase
 * that wires them behind the existing MERIDIAN_WRITE_UNSAFE gate.
 */
export async function routeTelegramMessage(
  deps: TelegramRouterDeps,
  msg: InboundMessage,
): Promise<void> {
  const trimmed = msg.text.trim();
  const [head, ...rest] = trimmed.split(/\s+/);
  const cmd = head?.toLowerCase() ?? "";

  switch (cmd) {
    case "/help":
    case "/start":
      await deps.ctx.notifier.notify(
        "info",
        [
          "Meridian TS — available commands:",
          "  /help      — show this help",
          "  /status    — wallet balance + open positions summary",
          "  /positions — list open positions",
          "  /wallet    — wallet SOL + USD",
          "  /briefing  — send the daily briefing now",
          "  /pause     — suspend cron ticks (positions still tracked)",
          "  /resume    — resume cron ticks",
          "  /stop      — graceful daemon shutdown",
          "",
          "Any free-form message runs a GENERAL agent tick.",
        ].join("\n"),
      );
      return;

    case "/pause": {
      if (!deps.scheduler) {
        await deps.ctx.notifier.notify("info", "Cron control unavailable in this mode.");
        return;
      }
      if (deps.scheduler.isPaused()) {
        await deps.ctx.notifier.notify("info", "Already paused. /resume to continue.");
        return;
      }
      deps.scheduler.pause();
      deps.ctx.logger.info("telegram-router", "cron paused via telegram");
      await deps.ctx.notifier.notify(
        "info",
        "⏸ Cron paused. No new screening/management/health ticks. /resume to continue.",
      );
      return;
    }

    case "/resume": {
      if (!deps.scheduler) {
        await deps.ctx.notifier.notify("info", "Cron control unavailable in this mode.");
        return;
      }
      if (!deps.scheduler.isPaused()) {
        await deps.ctx.notifier.notify("info", "Cron already running.");
        return;
      }
      deps.scheduler.resume();
      deps.ctx.logger.info("telegram-router", "cron resumed via telegram");
      await deps.ctx.notifier.notify("info", "▶️ Cron resumed.");
      return;
    }

    case "/stop": {
      if (!deps.shutdown) {
        await deps.ctx.notifier.notify("info", "Shutdown hook unavailable in this mode.");
        return;
      }
      deps.ctx.logger.info("telegram-router", "shutdown requested via telegram");
      await deps.ctx.notifier.notify("info", "🛑 Shutting down. Goodbye.");
      deps.shutdown("telegram /stop");
      return;
    }

    case "/status":
    case "/wallet": {
      const [wallet, snap] = await Promise.all([
        deps.ctx.chain.getWalletBalance(),
        cmd === "/status" ? deps.ctx.chain.getMyPositions() : Promise.resolve(null),
      ]);
      const lines = [
        `Wallet: ${wallet.sol} SOL (~$${wallet.sol_usd.toFixed(2)} @ $${wallet.sol_price.toFixed(2)}/SOL)`,
      ];
      if (snap) {
        lines.push(`Open positions: ${snap.total_positions}`);
      }
      await deps.ctx.notifier.notify("info", lines.join("\n"));
      return;
    }

    case "/positions": {
      const snap = await deps.ctx.chain.getMyPositions();
      if (snap.total_positions === 0) {
        await deps.ctx.notifier.notify("info", "No open positions.");
        return;
      }
      const lines = ["Open positions:"];
      for (const p of snap.positions) {
        const pnl = p.pnl_pct == null ? "?" : `${p.pnl_pct.toFixed(2)}%`;
        lines.push(
          `  ${p.pair} pos=${p.position.slice(0, 8)}… pnl=${pnl} in_range=${p.in_range}`,
        );
      }
      await deps.ctx.notifier.notify("info", lines.join("\n"));
      return;
    }

    case "/briefing": {
      const summary = await runBriefingCycle({ ctx: deps.ctx });
      deps.ctx.logger.info("telegram-router", "briefing pushed on demand", {
        opened: summary.counts.opened_24h,
      });
      return;
    }

    default: {
      // Free-form → GENERAL agent tick.
      const goal = trimmed;
      const [wallet, snap, activeStrategy, recentDecisions] = await Promise.all([
        deps.ctx.chain.getWalletBalance(),
        deps.ctx.chain.getMyPositions(),
        deps.ctx.repos.strategies.getActive(),
        deps.ctx.repos.decisions.recent(5),
      ]);
      const systemPrompt = buildSystemPrompt({
        role: "GENERAL",
        wallet,
        positions: snap,
        config: deps.ctx.config,
        activeStrategy,
        recentDecisions,
      });
      const result = await runAgentLoop(
        { llm: deps.llm, registry: deps.registry, ctx: deps.ctx },
        {
          role: "GENERAL",
          goal,
          systemPrompt,
          model: deps.model,
          maxSteps: 8,
          toolFilter: GENERAL_TOOLS,
          requireToolOnFirstStep: false,
        },
      );
      const text = result.text ?? "(no text response)";
      await deps.ctx.notifier.notify("info", text.slice(0, 3800));
      // Unused for now, retained for future logging hooks.
      void rest;
      return;
    }
  }
}
