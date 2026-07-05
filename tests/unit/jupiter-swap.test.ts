import { describe, it, expect, vi } from "vitest";
import { fixedClock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";
import type { WalletKeypair } from "../../src/ports/solana.js";
import {
  createJupiterSwapClient,
  type FetchImpl,
  type SignAndSendTx,
} from "../../src/adapters/swap/jupiter-swap.js";

const clock = fixedClock("2026-07-05T12:00:00.000Z");
const wallet: WalletKeypair = {
  address: "WalletAddr11111111111111111111111111111111",
  raw: {},
};

function jsonResponse(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function baseQuote(overrides: Record<string, unknown> = {}): unknown {
  return {
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    inAmount: "1000000000",
    outAmount: "150000000",
    priceImpactPct: "0.0012",
    swapMode: "ExactIn",
    ...overrides,
  };
}

describe("createJupiterSwapClient", () => {
  it("runs quote → swap → sign+send and returns a SwapResult", async () => {
    const fetchImpl = vi.fn<FetchImpl>();
    fetchImpl.mockImplementation(async (url: string, init) => {
      if (url.includes("/quote?")) return jsonResponse(baseQuote());
      if (url.endsWith("/swap")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body ?? "{}");
        expect(body.userPublicKey).toBe(wallet.address);
        expect(body.wrapAndUnwrapSol).toBe(true);
        return jsonResponse({ swapTransaction: "base64tx" });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const signAndSend = vi.fn<SignAndSendTx>(async (tx: string) => {
      expect(tx).toBe("base64tx");
      return "TXSIG_1";
    });

    const swap = createJupiterSwapClient({
      clock,
      logger: nullLogger,
      wallet,
      fetchImpl,
      signAndSend,
    });

    const result = await swap.swap({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 1_000_000_000,
      slippage_bps: 100,
    });

    expect(result.success).toBe(true);
    expect(result.amount_in).toBe(1_000_000_000);
    expect(result.amount_out).toBe(150_000_000);
    expect(result.tx).toBe("TXSIG_1");
    expect(result.dry_run).toBe(false);
    expect(result.price_impact_pct).toBeCloseTo(0.0012);
    expect(signAndSend).toHaveBeenCalledTimes(1);
  });

  it("passes slippage_bps and swapMode into the quote URL", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      if (url.includes("/quote?")) {
        expect(url).toContain("slippageBps=150");
        expect(url).toContain("swapMode=ExactIn");
        return jsonResponse(baseQuote());
      }
      return jsonResponse({ swapTransaction: "tx" });
    });
    const swap = createJupiterSwapClient({
      clock,
      logger: nullLogger,
      wallet,
      fetchImpl,
      signAndSend: async () => "sig",
    });
    await swap.swap({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 1_000_000,
      slippage_bps: 150,
    });
  });

  it("wires referral fee (platformFeeBps + feeAccount) when configured", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string, init) => {
      if (url.includes("/quote?")) {
        expect(url).toContain("platformFeeBps=50");
        return jsonResponse(baseQuote());
      }
      if (url.endsWith("/swap")) {
        const body = JSON.parse(init?.body ?? "{}");
        expect(body.feeAccount).toBe("ReferralAcct111");
        return jsonResponse({ swapTransaction: "tx" });
      }
      throw new Error(`unexpected: ${url}`);
    });
    const swap = createJupiterSwapClient({
      clock,
      logger: nullLogger,
      wallet,
      fetchImpl,
      signAndSend: async () => "sig",
      referralAccount: "ReferralAcct111",
      referralFeeBps: 50,
    });
    await swap.swap({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 1_000_000,
      slippage_bps: 100,
    });
  });

  it("throws when quote endpoint returns non-2xx", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse({ error: "bad route" }, 400),
    );
    const swap = createJupiterSwapClient({
      clock,
      logger: nullLogger,
      wallet,
      fetchImpl,
      signAndSend: async () => "sig",
    });
    await expect(
      swap.swap({
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 1000,
        slippage_bps: 100,
      }),
    ).rejects.toThrow(/jupiter quote: 400/);
  });

  it("throws when swap endpoint returns non-2xx", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      if (url.includes("/quote?")) return jsonResponse(baseQuote());
      return jsonResponse({ error: "no route" }, 500);
    });
    const swap = createJupiterSwapClient({
      clock,
      logger: nullLogger,
      wallet,
      fetchImpl,
      signAndSend: async () => "sig",
    });
    await expect(
      swap.swap({
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 1000,
        slippage_bps: 100,
      }),
    ).rejects.toThrow(/jupiter swap: 500/);
  });

  it("rejects malformed quote body", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      if (url.includes("/quote?")) return jsonResponse({ nope: true });
      return jsonResponse({ swapTransaction: "tx" });
    });
    const swap = createJupiterSwapClient({
      clock,
      logger: nullLogger,
      wallet,
      fetchImpl,
      signAndSend: async () => "sig",
    });
    await expect(
      swap.swap({
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 1000,
        slippage_bps: 100,
      }),
    ).rejects.toThrow();
  });

  it("refuses to construct without signAndSend or connection", () => {
    expect(() =>
      createJupiterSwapClient({
        clock,
        logger: nullLogger,
        wallet,
        fetchImpl: (async () => jsonResponse({})) as unknown as FetchImpl,
      }),
    ).toThrow(/signAndSend.*connection/);
  });

  it("omits price_impact_pct when Jupiter returns a non-numeric value", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      if (url.includes("/quote?"))
        return jsonResponse(baseQuote({ priceImpactPct: "not-a-number" }));
      return jsonResponse({ swapTransaction: "tx" });
    });
    const swap = createJupiterSwapClient({
      clock,
      logger: nullLogger,
      wallet,
      fetchImpl,
      signAndSend: async () => "sig",
    });
    const result = await swap.swap({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 1000,
      slippage_bps: 100,
    });
    expect(result.price_impact_pct).toBeUndefined();
  });
});
