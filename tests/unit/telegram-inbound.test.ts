import { describe, it, expect, vi } from "vitest";
import { nullLogger } from "../../src/ports/logger.js";
import {
  createTelegramInbound,
  type FetchImpl,
} from "../../src/adapters/notify/telegram-inbound.js";

function updateEnvelope(updates: unknown[]): unknown {
  return { ok: true, result: updates };
}

function res(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const OPTS = {
  logger: nullLogger,
  botToken: "1234:token",
  chatId: "42",
};

// Waits for a microtask + one timer so the async loop can settle.
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
}

describe("createTelegramInbound", () => {
  it("delivers an authorized private-chat text message", async () => {
    const messages: unknown[] = [];
    const fetchImpl = vi.fn<FetchImpl>();
    fetchImpl
      .mockResolvedValueOnce(
        res(
          updateEnvelope([
            {
              update_id: 1,
              message: {
                message_id: 100,
                date: 1_720_170_000,
                chat: { id: 42, type: "private" },
                from: { id: 99, username: "alice" },
                text: "hello",
              },
            },
          ]),
        ),
      )
      .mockImplementation(async () => res(updateEnvelope([])));
    const inbound = createTelegramInbound({
      ...OPTS,
      fetchImpl,
      sleep: async () => {},
    });
    const handle = inbound.start(async (m) => {
      messages.push(m);
    });
    await flush();
    handle.stop();
    expect(messages).toHaveLength(1);
    expect((messages[0] as { text: string }).text).toBe("hello");
    expect((messages[0] as { username: string }).username).toBe("alice");
  });

  it("drops messages from an unauthorized chat", async () => {
    const messages: unknown[] = [];
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      res(
        updateEnvelope([
          {
            update_id: 5,
            message: {
              message_id: 100,
              chat: { id: 999, type: "private" },
              from: { id: 99 },
              text: "hi from stranger",
            },
          },
        ]),
      ),
    );
    const inbound = createTelegramInbound({
      ...OPTS,
      fetchImpl,
      sleep: async () => {},
    });
    const handle = inbound.start(async (m) => {
      messages.push(m);
    });
    await flush();
    handle.stop();
    expect(messages).toEqual([]);
  });

  it("requires a matching userId in group chats", async () => {
    const messages: unknown[] = [];
    const fetchImpl = vi.fn<FetchImpl>();
    fetchImpl.mockResolvedValueOnce(
      res(
        updateEnvelope([
          {
            update_id: 1,
            message: {
              message_id: 100,
              chat: { id: 42, type: "group" },
              from: { id: 88 }, // NOT in allowedUserIds
              text: "hello",
            },
          },
          {
            update_id: 2,
            message: {
              message_id: 101,
              chat: { id: 42, type: "group" },
              from: { id: 99 }, // in allowedUserIds
              text: "ok",
            },
          },
        ]),
      ),
    );
    fetchImpl.mockImplementation(async () => res(updateEnvelope([])));
    const inbound = createTelegramInbound({
      ...OPTS,
      allowedUserIds: ["99"],
      fetchImpl,
      sleep: async () => {},
    });
    const handle = inbound.start(async (m) => {
      messages.push(m);
    });
    await flush();
    handle.stop();
    expect(messages).toHaveLength(1);
    expect((messages[0] as { text: string }).text).toBe("ok");
  });

  it("advances offset after each batch — same update never delivered twice", async () => {
    const messages: unknown[] = [];
    const seenOffsets: string[] = [];
    const fetchImpl = vi.fn<FetchImpl>();
    fetchImpl.mockImplementation(async (url: string) => {
      const off = new URL(url).searchParams.get("offset") ?? "?";
      seenOffsets.push(off);
      if (seenOffsets.length === 1) {
        return res(
          updateEnvelope([
            {
              update_id: 10,
              message: {
                message_id: 1,
                chat: { id: 42, type: "private" },
                from: { id: 99 },
                text: "one",
              },
            },
            {
              update_id: 11,
              message: {
                message_id: 2,
                chat: { id: 42, type: "private" },
                from: { id: 99 },
                text: "two",
              },
            },
          ]),
        );
      }
      return res(updateEnvelope([]));
    });
    const inbound = createTelegramInbound({
      ...OPTS,
      fetchImpl,
      sleep: async () => {},
    });
    const handle = inbound.start(async (m) => {
      messages.push(m);
    });
    await flush();
    handle.stop();
    expect(seenOffsets[0]).toBe("0");
    expect(seenOffsets[1]).toBe("12");
    expect(messages).toHaveLength(2);
  });

  it("backs off + retries on getUpdates 5xx without crashing", async () => {
    const messages: unknown[] = [];
    let called = 0;
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      called++;
      if (called === 1) return res({ err: 1 }, 500);
      if (called === 2)
        return res(
          updateEnvelope([
            {
              update_id: 1,
              message: {
                message_id: 1,
                chat: { id: 42, type: "private" },
                from: { id: 99 },
                text: "after backoff",
              },
            },
          ]),
        );
      return res(updateEnvelope([]));
    });
    const sleep = vi.fn(async () => {});
    const inbound = createTelegramInbound({
      ...OPTS,
      fetchImpl,
      sleep,
    });
    const handle = inbound.start(async (m) => {
      messages.push(m);
    });
    await flush();
    handle.stop();
    expect(sleep).toHaveBeenCalled(); // backoff fired on 500
    expect(messages).toHaveLength(1);
  });

  it("swallows handler errors — a bad onMessage does not kill the poll loop", async () => {
    const seen: unknown[] = [];
    const fetchImpl = vi.fn<FetchImpl>();
    fetchImpl
      .mockResolvedValueOnce(
        res(
          updateEnvelope([
            {
              update_id: 1,
              message: {
                message_id: 1,
                chat: { id: 42, type: "private" },
                from: { id: 99 },
                text: "boom",
              },
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        res(
          updateEnvelope([
            {
              update_id: 2,
              message: {
                message_id: 2,
                chat: { id: 42, type: "private" },
                from: { id: 99 },
                text: "recovered",
              },
            },
          ]),
        ),
      )
      .mockImplementation(async () => res(updateEnvelope([])));
    let first = true;
    const inbound = createTelegramInbound({
      ...OPTS,
      fetchImpl,
      sleep: async () => {},
    });
    const handle = inbound.start(async (m) => {
      seen.push(m);
      if (first) {
        first = false;
        throw new Error("handler exploded");
      }
    });
    await flush();
    handle.stop();
    expect(seen).toHaveLength(2);
    expect((seen[1] as { text: string }).text).toBe("recovered");
  });

  it("stop() halts the loop", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => res(updateEnvelope([])));
    const inbound = createTelegramInbound({
      ...OPTS,
      fetchImpl,
      sleep: async () => {},
    });
    const handle = inbound.start(async () => {});
    handle.stop();
    // Post-stop, no further ticks — flush shouldn't add new calls.
    const before = fetchImpl.mock.calls.length;
    await flush();
    const after = fetchImpl.mock.calls.length;
    // Allow at most one in-flight tick from the first loop iteration.
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
