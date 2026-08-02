import type {
  ClaimResult,
  CloseResult,
  DeployResult,
  SwapResult,
} from "../../domain/schemas/chain.js";
import type { Logger } from "../../ports/logger.js";
import {
  activeBinPosition,
  binRangeToPricePct,
  explainStrategy,
} from "../../domain/format/decision-strings.js";
import type {
  LiveMessageHandle,
  Notifier,
  NotifyKind,
} from "../../ports/notifier.js";

const DEFAULT_BASE_URL = "https://api.telegram.org";
const TELEGRAM_MAX_MESSAGE = 4096;
const DEFAULT_TIMEOUT_MS = 8_000;

/** Deep link to the pool on Meteora (Telegram auto-links the bare URL). */
const meteoraPoolUrl = (pool: string): string =>
  `https://www.meteora.ag/dlmm/${pool}?referrer=portfolio`;

export type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface TelegramNotifierOptions {
  botToken: string;
  chatId: string;
  logger: Logger;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  timeoutMs?: number;
}

interface SendMessageResult {
  message_id: number;
}

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

function truncate(text: string): string {
  if (text.length <= TELEGRAM_MAX_MESSAGE) return text;
  return `${text.slice(0, TELEGRAM_MAX_MESSAGE - 30)}\n… (truncated)`;
}

function kindPrefix(kind: NotifyKind): string {
  switch (kind) {
    case "info":
      return "ℹ️";
    case "warn":
      return "⚠️";
    case "error":
      return "❌";
    case "success":
      return "✅";
  }
}

interface LiveState {
  messageId: number;
  header: string;
  lines: string[];
  finalized: boolean;
}

/**
 * Real Telegram notifier — outbound only.
 *
 * Long-poll REPL / inbound command handling is a separate app-layer concern (deferred
 * to the Telegram bridge phase). This adapter satisfies the `Notifier` port so the
 * daemon can push deploy/close/claim/swap/OOR events and drive the in-place live
 * message the JS `createLiveMessage` provides.
 *
 * Live messages: each `startLive` sends one initial message and returns a handle
 * whose `toolStart` / `toolFinish` / `note` / `finalize` calls edit that message
 * in place (`editMessageText`). Editing avoids the notification spam that a
 * per-tool-call message would produce.
 */
export function createTelegramNotifier(opts: TelegramNotifierOptions): Notifier {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createTelegramNotifier: no fetch implementation available");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function post<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${baseUrl}/bot${opts.botToken}/${method}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw: unknown = await res.json().catch(() => null);
      const env = raw as TelegramApiEnvelope<T> | null;
      if (!res.ok || !env?.ok) {
        opts.logger.warn("telegram", `${method} failed`, {
          status: res.status,
          description: env?.description,
        });
        return null;
      }
      return env.result ?? null;
    } catch (err) {
      opts.logger.warn("telegram", `${method} threw`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendMessage(text: string): Promise<SendMessageResult | null> {
    return post<SendMessageResult>("sendMessage", {
      chat_id: opts.chatId,
      text: truncate(text),
      disable_web_page_preview: true,
    });
  }

  async function editMessage(messageId: number, text: string): Promise<void> {
    await post("editMessageText", {
      chat_id: opts.chatId,
      message_id: messageId,
      text: truncate(text),
      disable_web_page_preview: true,
    });
  }

  function renderLive(state: LiveState): string {
    return [state.header, "", ...state.lines].join("\n");
  }

  async function startLive(header: string): Promise<LiveMessageHandle> {
    const sent = await sendMessage(header);
    const state: LiveState = {
      messageId: sent?.message_id ?? 0,
      header,
      lines: [],
      finalized: false,
    };
    async function push(): Promise<void> {
      if (state.finalized || !state.messageId) return;
      await editMessage(state.messageId, renderLive(state));
    }
    return {
      async toolStart(name: string, args?: Record<string, unknown>) {
        const argSummary = args ? summarizeArgs(args) : "";
        state.lines.push(`⏳ ${name}${argSummary ? ` ${argSummary}` : ""}`);
        await push();
      },
      async toolFinish(name: string, ok: boolean, summary?: string) {
        const icon = ok ? "✅" : "❌";
        // Replace the last matching ⏳ line (in reverse) for the same tool name.
        for (let i = state.lines.length - 1; i >= 0; i -= 1) {
          const line = state.lines[i]!;
          if (line.startsWith(`⏳ ${name}`)) {
            state.lines[i] = `${icon} ${name}${summary ? ` — ${summary}` : ""}`;
            break;
          }
        }
        await push();
      },
      async note(text: string) {
        state.lines.push(`· ${text}`);
        await push();
      },
      async finalize(text?: string) {
        if (text) state.lines.push("", text);
        await push();
        state.finalized = true;
      },
      async fail(reason: string) {
        state.lines.push("", `❌ ${reason}`);
        await push();
        state.finalized = true;
      },
    };
  }

  return {
    async notify(kind, text) {
      await sendMessage(`${kindPrefix(kind)} ${text}`);
    },
    async notifyDeploy(r: DeployResult) {
      const dryTag = r.dry_run ? " [DRY]" : "";
      const label = r.pool_name ?? `${r.pool_address.slice(0, 6)}…`;
      const pricePct = binRangeToPricePct(r.bin_step, r.lower_bin, r.upper_bin);
      const rangeNote =
        pricePct != null
          ? `${r.upper_bin - r.lower_bin} bins ≈ ±${pricePct.toFixed(1)}% of price`
          : `${r.upper_bin - r.lower_bin} bins (step unknown)`;
      const posNote = activeBinPosition(r.active_bin, r.lower_bin, r.upper_bin);
      const strategyGloss = explainStrategy(r.strategy);
      const signals: string[] = [];
      if (r.fee_tvl_ratio != null) signals.push(`fee/TVL ${(r.fee_tvl_ratio * 100).toFixed(2)}%`);
      if (r.volatility != null) signals.push(`vol ${r.volatility.toFixed(2)}`);
      if (r.organic_score != null) signals.push(`organic ${r.organic_score.toFixed(2)}`);
      const signalLine = signals.length ? `signals: ${signals.join("  ")}\n` : "";
      const posShort = `${r.position_address.slice(0, 8)}…${r.position_address.slice(-4)}`;
      await sendMessage(
        `✅ Deployed${dryTag}\n` +
          `${label}\n` +
          `amount: ${r.amount_sol} SOL\n` +
          `strategy: ${strategyGloss}\n` +
          `range: bins ${r.lower_bin}..${r.upper_bin} (${rangeNote})\n` +
          `price: ${posNote} of range (active=${r.active_bin})\n` +
          signalLine +
          `pos: ${posShort}\n` +
          `${meteoraPoolUrl(r.pool_address)}\n` +
          `tx: ${r.tx ?? "(none)"}`,
      );
    },
    async notifyClose(r: CloseResult) {
      const dryTag = r.dry_run ? " [DRY]" : "";
      const pnl = r.final_pnl_pct;
      const pnlEmoji = pnl == null ? "📤" : pnl > 0 ? "🟢" : pnl < 0 ? "🔴" : "⚪";
      const pnlStr = pnl == null ? "n/a" : `${pnl >= 0 ? "+" : ""}${fmtPct(pnl)}%`;
      const peak =
        r.peak_pnl_pct != null && r.peak_pnl_pct !== pnl
          ? ` (peak ${r.peak_pnl_pct >= 0 ? "+" : ""}${fmtPct(r.peak_pnl_pct)}%)`
          : "";
      const value = r.final_value_usd != null ? fmtDollar(r.final_value_usd) : "n/a";
      const fees = fmtDollar(r.fees_earned_usd);
      const deposit = r.amount_sol_initial != null ? `${r.amount_sol_initial} SOL` : "n/a";
      const age = r.age_minutes != null ? humanDuration(r.age_minutes) : "n/a";
      const pairLine = r.pair ? `${r.pair}\n` : "";
      const posShort = `${r.position_address.slice(0, 8)}…${r.position_address.slice(-4)}`;
      await sendMessage(
        `${pnlEmoji} Closed${dryTag}\n` +
          pairLine +
          `pnl: ${pnlStr}${peak}\n` +
          `value: ${value}  fees: ${fees}\n` +
          `deposit: ${deposit}  held: ${age}\n` +
          `reason: ${r.reason}\n` +
          `pos: ${posShort}\n` +
          `${r.pool_address ? `${meteoraPoolUrl(r.pool_address)}\n` : ""}` +
          `tx: ${r.tx ?? "(none)"}`,
      );
    },
    async notifyClaim(r: ClaimResult) {
      const dryTag = r.dry_run ? " [DRY]" : "";
      await sendMessage(
        `💰 Claimed${dryTag}\n` +
          `position: ${r.position_address}\n` +
          `claimed: $${r.claimed_usd}${r.claimed_sol != null ? ` (${r.claimed_sol} SOL)` : ""}\n` +
          `tx: ${r.tx ?? "(none)"}`,
      );
    },
    async notifySwap(r: SwapResult) {
      const dryTag = r.dry_run ? " [DRY]" : "";
      await sendMessage(
        `🔁 Swap${dryTag}\n` +
          `${r.input_mint.slice(0, 6)}… → ${r.output_mint.slice(0, 6)}…\n` +
          `in: ${r.amount_in}  out: ${r.amount_out}\n` +
          `tx: ${r.tx ?? "(none)"}`,
      );
    },
    async notifyOutOfRange(position, minutes) {
      await sendMessage(`⚠️ OOR — ${position.slice(0, 8)}… for ${minutes} min`);
    },
    startLive,
  };
}

// Adaptive precision — small numbers (< $1 or < 1%) show more decimals so
// $0.0031 doesn't render as "$0.00" and 0.03% doesn't collapse to "0.00%".
function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return "0.00";
  if (abs < 0.01) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (abs < 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(2);
}
function fmtDollar(n: number): string {
  return n < 0 ? `-$${fmtUsd(-n)}` : `$${fmtUsd(n)}`;
}
function fmtPct(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return "0.00";
  if (abs < 0.01) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(2);
}

function humanDuration(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}h${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d${rh}h` : `${d}d`;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  const pairs = keys.slice(0, 3).map((k) => {
    const v = args[k];
    const s =
      typeof v === "string"
        ? v.length > 16
          ? `${v.slice(0, 13)}…`
          : v
        : typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : Array.isArray(v)
            ? `[${v.length}]`
            : "{…}";
    return `${k}=${s}`;
  });
  const suffix = keys.length > 3 ? " …" : "";
  return `(${pairs.join(", ")}${suffix})`;
}
