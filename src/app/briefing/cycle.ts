import type { AppContext } from "../tools/context.js";
import { generateBriefing, type BriefingSummary } from "./generate.js";

export interface BriefingCycleDeps {
  ctx: AppContext;
  lookbackHours?: number;
}

/**
 * Assemble the daily briefing from live repo data and push it to the notifier.
 *
 * Non-fatal by design — any repo failure logs and returns the (partial) summary
 * so the cron never crashes the daemon. Notifier failures are swallowed by the
 * notifier itself (real Telegram adapter is fire-and-forget).
 */
export async function runBriefingCycle(deps: BriefingCycleDeps): Promise<BriefingSummary> {
  const { ctx } = deps;
  const [positions, lessonsFile] = await Promise.all([
    ctx.repos.positions.all().catch((err) => {
      ctx.logger.warn("briefing", "positions.all failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    ctx.repos.lessons.load().then((r) => (r.ok ? r.value : { lessons: [], performance: [] })),
  ]);

  const summary = generateBriefing({
    positions,
    performance: lessonsFile.performance,
    lessons: lessonsFile.lessons,
    now: ctx.clock.now(),
    ...(deps.lookbackHours !== undefined ? { lookbackHours: deps.lookbackHours } : {}),
  });

  await ctx.notifier.notify("info", summary.plain);
  ctx.logger.info("briefing", "sent daily briefing", {
    opened: summary.counts.opened_24h,
    closed: summary.counts.closed_24h,
    open_now: summary.counts.open_positions,
  });
  return summary;
}
