import { describe, it, expect, vi } from "vitest";
import { nullLogger } from "../../src/ports/logger.js";
import {
  createTelegramNotifier,
  type FetchImpl,
} from "../../src/adapters/notify/telegram.ts";

interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
}

function makeStub(): { fetchImpl: FetchImpl; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let nextMessageId = 1000;
  const fetchImpl: FetchImpl = async (url, init) => {
    const method = url.split("/").pop() ?? "";
    const body = JSON.parse(init?.body ?? "{}");
    calls.push({ method, body });
    const result =
      method === "sendMessage" ? { message_id: nextMessageId++ } : true;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, result }),
      text: async () => "",
    };
  };
  return { fetchImpl, calls };
}

const OPTS = {
  botToken: "1234:BOTTOKEN",
  chatId: "42",
  logger: nullLogger,
};

describe("createTelegramNotifier — outbound events", () => {
  it("sends a notify() message with a kind prefix", async () => {
    const { fetchImpl, calls } = makeStub();
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    await n.notify("info", "hello world");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendMessage");
    expect(calls[0]?.body.chat_id).toBe("42");
    expect(String(calls[0]?.body.text)).toContain("ℹ️");
    expect(String(calls[0]?.body.text)).toContain("hello world");
  });

  it("formats a deploy event with pool + strategy", async () => {
    const { fetchImpl, calls } = makeStub();
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    await n.notifyDeploy({
      success: true,
      position_address: "Pos1",
      pool_address: "PoolAaaa",
      strategy: "bid_ask",
      lower_bin: 100,
      upper_bin: 200,
      active_bin: 150,
      amount_sol: 0.5,
      tx: "SIG_1",
      dry_run: false,
    });
    const text = String(calls[0]?.body.text);
    expect(text).toContain("Deployed");
    expect(text).toContain("bid_ask");
    expect(text).toContain("100..200");
    expect(text).toContain("SIG_1");
    // Meteora deep link for one-tap open
    expect(text).toContain("https://www.meteora.ag/dlmm/PoolAaaa?referrer=portfolio");
  });

  it("marks dry-run results with [DRY]", async () => {
    const { fetchImpl, calls } = makeStub();
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    await n.notifyClaim({
      success: true,
      position_address: "PosZ",
      claimed_usd: 12.5,
      tx: null,
      dry_run: true,
    });
    expect(String(calls[0]?.body.text)).toContain("[DRY]");
  });
});

describe("live message — in-place editing", () => {
  it("startLive → toolStart → toolFinish edits the same message", async () => {
    const { fetchImpl, calls } = makeStub();
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    const live = await n.startLive("── screening cycle ──");
    await live.toolStart("get_wallet_balance", { force: true });
    await live.toolFinish("get_wallet_balance", true, "5 SOL");
    await live.toolStart("deploy_position", {});
    await live.toolFinish("deploy_position", true);
    await live.finalize("Done — 1 position deployed");
    expect(calls[0]?.method).toBe("sendMessage");
    const messageId = (calls[0]?.body as { chat_id: string }) ? 1000 : null;
    expect(messageId).toBe(1000);
    for (const c of calls.slice(1)) {
      expect(c.method).toBe("editMessageText");
      expect(c.body.message_id).toBe(1000);
    }
    const finalText = String(calls[calls.length - 1]?.body.text);
    expect(finalText).toContain("── screening cycle ──");
    expect(finalText).toContain("✅ get_wallet_balance");
    expect(finalText).toContain("✅ deploy_position");
    expect(finalText).toContain("Done — 1 position deployed");
  });

  it("toolFinish with ok=false renders ❌", async () => {
    const { fetchImpl, calls } = makeStub();
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    const live = await n.startLive("test");
    await live.toolStart("swap_token");
    await live.toolFinish("swap_token", false, "slippage");
    const finalText = String(calls[calls.length - 1]?.body.text);
    expect(finalText).toContain("❌ swap_token");
    expect(finalText).toContain("slippage");
  });

  it("fail terminates the live message with reason", async () => {
    const { fetchImpl, calls } = makeStub();
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    const live = await n.startLive("aborted");
    await live.fail("upstream timeout");
    const finalText = String(calls[calls.length - 1]?.body.text);
    expect(finalText).toContain("❌ upstream timeout");
  });

  it("no further edits after finalize", async () => {
    const { fetchImpl, calls } = makeStub();
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    const live = await n.startLive("x");
    await live.finalize("done");
    const editsBefore = calls.filter((c) => c.method === "editMessageText").length;
    await live.note("late note");
    const editsAfter = calls.filter((c) => c.method === "editMessageText").length;
    expect(editsAfter).toBe(editsBefore);
  });
});

describe("network failures", () => {
  it("logs and drops when API returns ok=false", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: FetchImpl = async (_url, init) => {
      calls.push({ method: "sendMessage", body: JSON.parse(init?.body ?? "{}") });
      return {
        ok: false,
        status: 400,
        statusText: "Bad",
        json: async () => ({ ok: false, description: "Forbidden" }),
        text: async () => "",
      };
    };
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    await expect(n.notify("info", "hello")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("swallows fetch throws instead of exploding the caller", async () => {
    const fetchImpl: FetchImpl = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const n = createTelegramNotifier({ ...OPTS, fetchImpl });
    await expect(n.notify("info", "hello")).resolves.toBeUndefined();
  });
});
