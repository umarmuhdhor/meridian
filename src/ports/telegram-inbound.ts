/** A single normalized inbound message the app layer reacts to. */
export interface InboundMessage {
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel" | "unknown";
  userId: string | null;
  username: string | null;
  text: string;
  timestampMs: number;
}

/**
 * Inbound Telegram bridge. Adapters run a long-poll loop and invoke `onMessage`
 * for every authorized message. `start()` returns a stop handle; the loop is
 * gracefully cancellable so daemon shutdown doesn't hang.
 */
export interface TelegramInbound {
  /** Begin the long-poll loop. Idempotent — a second call while running is a no-op. */
  start(onMessage: (msg: InboundMessage) => Promise<void> | void): { stop(): void };
}
