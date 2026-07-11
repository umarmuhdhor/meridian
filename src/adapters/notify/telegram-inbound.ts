import { z } from "zod";
import type { Logger } from "../../ports/logger.js";
import type { InboundMessage, TelegramInbound } from "../../ports/telegram-inbound.js";

const DEFAULT_LONG_POLL_SECONDS = 30;
const DEFAULT_BACKOFF_MS = 3_000;

export type FetchImpl = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

const UpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: z
      .object({
        message_id: z.number().int(),
        date: z.number().int().optional(),
        chat: z.object({
          id: z.union([z.number(), z.string()]),
          type: z.string().optional(),
        }),
        from: z
          .object({
            id: z.union([z.number(), z.string()]).optional(),
            username: z.string().optional(),
          })
          .optional(),
        text: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const UpdatesResponseSchema = z.object({
  ok: z.boolean(),
  result: z.array(UpdateSchema).optional(),
});

export interface TelegramInboundOptions {
  logger: Logger;
  botToken: string;
  /** Authorized chatId — messages from other chats are ignored. */
  chatId: string;
  /** For group/supergroup chats, authorized user ids. Empty set → group access denied. */
  allowedUserIds?: string[];
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  /** Long-poll timeout in seconds passed to getUpdates. Default 30. */
  longPollSeconds?: number;
  /** Backoff after a failed poll. Default 3000ms. */
  backoffMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Long-poll Telegram inbound bridge. Runs a loop that calls `getUpdates` and hands each
 * authorized text message to the registered `onMessage` callback.
 *
 * Auth model (mirrors telegram.js #isAuthorizedIncomingMessage):
 *   - Incoming chatId must match the configured chatId.
 *   - In group / supergroup chats, the sender's userId must be in `allowedUserIds`.
 *   - In private chats, any sender from the configured chatId is accepted.
 *
 * Failures (network / 5xx) trigger a backoff and retry — the loop never crashes.
 * `stop()` aborts the in-flight fetch via AbortController and prevents further ticks.
 */
export function createTelegramInbound(opts: TelegramInboundOptions): TelegramInbound {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createTelegramInbound: no fetch implementation available");
  }
  const baseUrl = (opts.baseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
  const longPollSeconds = opts.longPollSeconds ?? DEFAULT_LONG_POLL_SECONDS;
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const allowed = new Set(opts.allowedUserIds ?? []);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let running = false;
  let offset = 0;
  let currentController: AbortController | null = null;

  function isAuthorized(msg: InboundMessage): boolean {
    if (msg.chatId !== opts.chatId) return false;
    if (msg.chatType === "group" || msg.chatType === "supergroup") {
      if (!msg.userId || !allowed.has(msg.userId)) return false;
    }
    return true;
  }

  function normalizeUpdate(raw: z.infer<typeof UpdateSchema>): {
    nextOffset: number;
    inbound: InboundMessage | null;
  } {
    const nextOffset = raw.update_id + 1;
    const m = raw.message;
    if (!m || !m.text) return { nextOffset, inbound: null };
    const chatType = (m.chat.type ?? "unknown") as InboundMessage["chatType"];
    const inbound: InboundMessage = {
      chatId: String(m.chat.id),
      chatType,
      userId: m.from?.id != null ? String(m.from.id) : null,
      username: m.from?.username ?? null,
      text: m.text,
      timestampMs: (m.date ?? 0) * 1000,
    };
    return { nextOffset, inbound };
  }

  return {
    start(onMessage) {
      if (running) return { stop: () => {} };
      running = true;

      async function loop(): Promise<void> {
        while (running) {
          const controller = new AbortController();
          currentController = controller;
          const params = new URLSearchParams({
            offset: String(offset),
            timeout: String(longPollSeconds),
          });
          const url = `${baseUrl}/bot${opts.botToken}/getUpdates?${params.toString()}`;
          try {
            const res = await fetchImpl(url, { signal: controller.signal });
            if (!res.ok) {
              opts.logger.warn("telegram-inbound", `getUpdates ${res.status}`, {
                status: res.status,
              });
              await sleep(backoffMs);
              continue;
            }
            const parsed = UpdatesResponseSchema.safeParse(await res.json());
            if (!parsed.success || !parsed.data.ok) {
              opts.logger.warn("telegram-inbound", "getUpdates response invalid");
              await sleep(backoffMs);
              continue;
            }
            for (const raw of parsed.data.result ?? []) {
              const { nextOffset, inbound } = normalizeUpdate(raw);
              if (nextOffset > offset) offset = nextOffset;
              if (!inbound) continue;
              if (!isAuthorized(inbound)) {
                opts.logger.debug("telegram-inbound", "unauthorized inbound dropped", {
                  chatId: inbound.chatId,
                  userId: inbound.userId,
                });
                continue;
              }
              try {
                await onMessage(inbound);
              } catch (err) {
                opts.logger.warn("telegram-inbound", "onMessage handler threw", {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          } catch (err) {
            // AbortError on shutdown is expected; anything else is a network hiccup.
            if (
              err instanceof Error &&
              (err.name === "AbortError" || /abort/i.test(err.message))
            ) {
              // Loop condition will short-circuit; no backoff.
            } else {
              opts.logger.warn("telegram-inbound", "poll loop threw", {
                error: err instanceof Error ? err.message : String(err),
              });
              await sleep(backoffMs);
            }
          } finally {
            currentController = null;
          }
          // Force a real macrotask yield each iteration so tests (with mocked instant sleep)
          // can interleave. In prod the getUpdates long-poll dominates iteration time.
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      void loop();

      return {
        stop() {
          if (!running) return;
          running = false;
          currentController?.abort();
        },
      };
    },
  };
}
