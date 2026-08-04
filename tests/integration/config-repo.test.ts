import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createJsonConfigRepo } from "../../src/adapters/persistence/json/config-repo.js";
import { flatToNested, nestedToFlat, parseAppConfig } from "../../src/domain/config-load.js";
import { FlatUserConfigSchema } from "../../src/domain/schemas/config-flat.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";

const created: string[] = [];

afterEach(async () => {
  while (created.length) {
    const d = created.pop();
    if (d) await rmDir(d);
  }
});

const flatFixture = {
  // risk / management
  maxPositions: 3,
  stopLossPct: -50,
  takeProfitPct: 5,
  outOfRangeWaitMinutes: 30,
  minFeePerTvl24h: 7,
  minAgeBeforeYieldCheck: 60,
  minClaimAmount: 5,
  trailingTakeProfit: true,
  trailingTriggerPct: 3,
  trailingDropPct: 1.5,
  deployAmountSol: 0.5,
  gasReserve: 0.2,
  positionSizePct: 0.35,
  pnlSanityMaxDiffPct: 5,
  solMode: false,
  // strategy
  strategy: "bid_ask" as const,
  binsBelow: 69,
  // schedule
  managementIntervalMin: 10,
  screeningIntervalMin: 30,
  healthCheckIntervalMin: 60,
  // extras (untouched via passthrough)
  rpcUrl: "https://example.com",
  llmModel: "test-model",
};

describe("flatToNested / nestedToFlat", () => {
  it("nests flat correctly", () => {
    const flat = FlatUserConfigSchema.parse(flatFixture);
    const nested = flatToNested(flat);
    expect(nested.risk.maxPositions).toBe(3);
    expect(nested.management.stopLossPct).toBe(-50);
    expect(nested.strategy.strategy).toBe("bid_ask");
    expect(nested.schedule.managementIntervalMin).toBe(10);
  });

  it("round-trips: nested → flat → nested equal on known keys", () => {
    const flat = FlatUserConfigSchema.parse(flatFixture);
    const nested1 = flatToNested(flat);
    const backFlat = nestedToFlat(nested1);
    const merged = FlatUserConfigSchema.parse({ ...flatFixture, ...backFlat });
    const nested2 = flatToNested(merged);
    expect(nested2).toEqual(nested1);
  });

  it("defaults new sections when flat file omits them", () => {
    const r = parseAppConfig(flatFixture);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.screening.minTvl).toBe(10_000);
    expect(r.value.llm.maxTokens).toBe(4096);
    expect(r.value.hiveMind.pullMode).toBe("auto");
    expect(r.value.jupiter.referralFeeBps).toBe(50);
    expect(r.value.tokens.SOL).toBe("So11111111111111111111111111111111111111112");
  });
});

describe("parseAppConfig", () => {
  it("accepts valid flat, rejects on missing required keys", () => {
    expect(parseAppConfig(flatFixture).ok).toBe(true);
    const { stopLossPct: _unused, ...missing } = flatFixture;
    const r = parseAppConfig(missing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("flat_invalid");
  });

  it("rejects when binsBelow < 35 (safety floor)", () => {
    const r = parseAppConfig({ ...flatFixture, binsBelow: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("flat_invalid");
  });
});

describe("JsonConfigRepo", () => {
  it("loads flat file and returns nested AppConfig", async () => {
    const dir = await mkTmpDir("cfg");
    created.push(dir);
    const file = path.join(dir, "user-config.json");
    await fs.writeFile(file, JSON.stringify(flatFixture), "utf8");
    const repo = createJsonConfigRepo({ filePath: file });
    const r = await repo.load();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.risk.maxPositions).toBe(3);
      expect(r.value.management.stopLossPct).toBe(-50);
    }
  });

  it("returns parse-kind error on schema mismatch", async () => {
    const dir = await mkTmpDir("cfg-bad");
    created.push(dir);
    const file = path.join(dir, "user-config.json");
    await fs.writeFile(file, JSON.stringify({ maxPositions: -1 }), "utf8");
    const repo = createJsonConfigRepo({ filePath: file });
    const r = await repo.load();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("parse");
  });

  it("returns load-kind error on missing file", async () => {
    const dir = await mkTmpDir("cfg-nf");
    created.push(dir);
    const repo = createJsonConfigRepo({ filePath: path.join(dir, "nope.json") });
    const r = await repo.load();
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "load") {
      expect(r.error.error.kind).toBe("not_found");
    } else {
      throw new Error("expected load/not_found");
    }
  });
});
