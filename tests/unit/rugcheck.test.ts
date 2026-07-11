import { describe, it, expect, vi } from "vitest";
import { nullLogger } from "../../src/ports/logger.js";
import {
  createRugcheckAdapter,
  type FetchImpl,
} from "../../src/adapters/market/rugcheck.js";

function jsonRes(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const MINT = "MemeMint111111111111111111111111111111111";

describe("createRugcheckAdapter", () => {
  it("passes a low-score, low-concentration token", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonRes({ score: 200, topHolders: [{ pct: 5 }, { pct: 4 }, { pct: 3 }] }),
    );
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl });
    const result = await r.check(MINT);
    expect(result.passes).toBe(true);
    expect(result.score).toBe(200);
    expect(result.top10_pct).toBeCloseTo(12);
    expect(result.reason).toBeNull();
  });

  it("fails on rugged=true", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ rugged: true, score: 100 }));
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl });
    const result = await r.check(MINT);
    expect(result.passes).toBe(false);
    expect(result.reason).toBe("rugcheck: token is rugged");
  });

  it("fails on high score", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ score: 75_000 }));
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl });
    const result = await r.check(MINT);
    expect(result.passes).toBe(false);
    expect(result.reason).toContain("75000");
  });

  it("fails on top10 > ceiling (default 60%)", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonRes({
        score: 100,
        topHolders: Array.from({ length: 10 }, () => ({ pct: 8 })), // 80%
      }),
    );
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl });
    const result = await r.check(MINT);
    expect(result.passes).toBe(false);
    expect(result.reason).toContain("top10");
    expect(result.top10_pct).toBeCloseTo(80);
  });

  it("accepts `percentage` field as an alias for `pct`", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonRes({ score: 0, topHolders: [{ percentage: "3" }, { percentage: "2" }] }),
    );
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl });
    const result = await r.check(MINT);
    expect(result.top10_pct).toBeCloseTo(5);
    expect(result.passes).toBe(true);
  });

  it("passes on API 5xx when passOnError=true (default)", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: 1 }, 500));
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl });
    const result = await r.check(MINT);
    expect(result.passes).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("fails on API 5xx when passOnError=false", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: 1 }, 500));
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl, passOnError: false });
    const result = await r.check(MINT);
    expect(result.passes).toBe(false);
    expect(result.reason).toContain("API unavailable");
  });

  it("passes without HTTP call when mint is empty", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({}));
    const r = createRugcheckAdapter({ logger: nullLogger, fetchImpl });
    const result = await r.check("");
    expect(result.passes).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
