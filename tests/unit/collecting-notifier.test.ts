import { describe, it, expect } from "vitest";
import { createCollectingNotifier } from "../../src/adapters/notify/collecting-notifier.js";
import type { DeployResult } from "../../src/domain/schemas/chain.js";

const fakeDeploy: DeployResult = {
  success: true,
  position_address: "posX",
  pool_address: "poolX",
  strategy: "bid_ask",
  lower_bin: 100,
  upper_bin: 110,
  active_bin: 105,
  amount_sol: 1,
  tx: "tx-1",
  dry_run: true,
};

describe("CollectingNotifier", () => {
  it("records notify + deploy calls in order", async () => {
    const n = createCollectingNotifier();
    await n.notify("info", "hello");
    await n.notifyDeploy(fakeDeploy);
    expect(n.recorded).toHaveLength(2);
    expect(n.recorded[0]).toEqual({ type: "notify", kind: "info", text: "hello" });
    expect(n.recorded[1]?.type).toBe("deploy");
  });

  it("live message handle records start/finish/finalize sequence", async () => {
    const n = createCollectingNotifier();
    const live = await n.startLive("cycle");
    await live.toolStart("get_pool_memory", { pool_address: "poolA" });
    await live.toolFinish("get_pool_memory", true, "known");
    await live.note("proceeding to deploy");
    await live.finalize("done");
    expect(n.recorded.map((r) => r.type)).toEqual([
      "live_start",
      "live_tool_start",
      "live_tool_finish",
      "live_note",
      "live_finalize",
    ]);
  });

  it("clear resets recording", async () => {
    const n = createCollectingNotifier();
    await n.notify("warn", "x");
    n.clear();
    expect(n.recorded).toHaveLength(0);
  });
});
