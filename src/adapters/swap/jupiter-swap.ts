import { z } from "zod";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { SwapClient } from "../../ports/swap-client.js";
import type { SolanaConnection, WalletKeypair } from "../../ports/solana.js";
import type { SwapArgs, SwapResult } from "../../domain/schemas/chain.js";

/** Jupiter Quote/Swap API base URL. */
// Jupiter deprecated `quote-api.jup.ag/v6` — resolves NXDOMAIN in 2026.
// Free tier now lives at `lite-api.jup.ag/swap/v1`; paid at `api.jup.ag/swap/v1`.
// Same request/response shape as v6, only the URL changed.
export const DEFAULT_JUPITER_SWAP_BASE_URL = "https://lite-api.jup.ag/swap/v1";

const DEFAULT_TIMEOUT_MS = 8_000;

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

/** Sign a base64-encoded VersionedTransaction and land it on-chain. Returns the tx signature. */
export type SignAndSendTx = (base64Tx: string) => Promise<string>;

const JupiterQuoteSchema = z
  .object({
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    priceImpactPct: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

type JupiterQuote = z.infer<typeof JupiterQuoteSchema>;

const JupiterSwapResponseSchema = z.object({
  swapTransaction: z.string(),
});

export interface JupiterSwapOptions {
  clock: Clock;
  logger: Logger;
  wallet: WalletKeypair;
  /** Injected for tests. Falls back to globalThis.fetch. */
  fetchImpl?: FetchImpl;
  /** Test hook — when set, adapter skips the built-in web3.js sign/send path. */
  signAndSend?: SignAndSendTx;
  /** Required when `signAndSend` is not injected — used to build the real signer. */
  connection?: SolanaConnection;
  baseUrl?: string;
  defaultSlippageBps?: number;
  /** Jupiter referral (built-in fee split — mirrors tools/wallet.js). */
  referralAccount?: string;
  referralFeeBps?: number;
  timeoutMs?: number;
}

interface QuoteInputs {
  inputMint: string;
  outputMint: string;
  amountRaw: bigint;
  slippageBps: number;
  referralFeeBps?: number;
}

interface SwapPostInputs {
  quote: JupiterQuote;
  userPublicKey: string;
  referralAccount?: string;
}

/**
 * Jupiter Swap V6 adapter — quote → swap → sign+send.
 *
 * Behavior:
 *   ✓ GET /quote for the swap route
 *   ✓ POST /swap for the signed transaction blob
 *   ✓ Sign + send via injected hook (tests) OR web3.js on connection (real chain)
 *   ✓ Referral fee wiring — feeBps + feeAccount forwarded to Jupiter if configured
 *
 * `amount_in` is interpreted as **raw base units** for the input mint (lamports for SOL,
 * atomic units otherwise) so the caller controls decimal conversion. Return `amount_out` is
 * also raw base units of the output mint.
 */
export function createJupiterSwapClient(opts: JupiterSwapOptions): SwapClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createJupiterSwapClient: no fetch implementation available");
  }
  if (!opts.signAndSend && !opts.connection) {
    throw new Error(
      "createJupiterSwapClient: either `signAndSend` (test) or `connection` (real chain) must be provided",
    );
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_JUPITER_SWAP_BASE_URL).replace(/\/+$/, "");
  const defaultSlippageBps = opts.defaultSlippageBps ?? 100;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchQuote(q: QuoteInputs): Promise<JupiterQuote> {
    const params = new URLSearchParams({
      inputMint: q.inputMint,
      outputMint: q.outputMint,
      amount: q.amountRaw.toString(),
      slippageBps: q.slippageBps.toString(),
      swapMode: "ExactIn",
    });
    if (q.referralFeeBps != null && q.referralFeeBps > 0) {
      params.set("platformFeeBps", q.referralFeeBps.toString());
    }
    const url = `${baseUrl}/quote?${params.toString()}`;
    const res = await fetchWithTimeout((signal) => fetchImpl(url, { signal }));
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`jupiter quote: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const body: unknown = await res.json();
    return JupiterQuoteSchema.parse(body);
  }

  async function fetchSwapTx(p: SwapPostInputs): Promise<string> {
    const body: Record<string, unknown> = {
      quoteResponse: p.quote,
      userPublicKey: p.userPublicKey,
      wrapAndUnwrapSol: true,
    };
    if (p.referralAccount) {
      body.feeAccount = p.referralAccount;
    }
    const url = `${baseUrl}/swap`;
    const res = await fetchWithTimeout((signal) =>
      fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }),
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`jupiter swap: ${res.status} ${res.statusText} ${text}`.trim());
    }
    const parsed = JupiterSwapResponseSchema.parse(await res.json());
    return parsed.swapTransaction;
  }

  async function buildRealSigner(): Promise<SignAndSendTx> {
    if (!opts.connection) {
      throw new Error("jupiter-swap: cannot build signer without connection");
    }
    const web3 = await import("@solana/web3.js");
    const conn = opts.connection.raw as InstanceType<typeof web3.Connection>;
    const keypair = opts.wallet.raw as InstanceType<typeof web3.Keypair>;
    return async (base64Tx: string): Promise<string> => {
      const buf = Buffer.from(base64Tx, "base64");
      const tx = web3.VersionedTransaction.deserialize(buf);
      tx.sign([keypair]);
      const raw = tx.serialize();
      const sig = await conn.sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 3,
      });
      return sig;
    };
  }

  let cachedSigner: SignAndSendTx | null = opts.signAndSend ?? null;
  async function getSigner(): Promise<SignAndSendTx> {
    if (cachedSigner) return cachedSigner;
    cachedSigner = await buildRealSigner();
    return cachedSigner;
  }

  return {
    async swap(args: SwapArgs): Promise<SwapResult> {
      const slippage = args.slippage_bps ?? defaultSlippageBps;
      // Prefer the exact raw integer string when provided (no number precision loss);
      // fall back to the numeric amount for the normal LLM/dashboard swap path.
      const amountRaw =
        args.amount_in_raw != null ? BigInt(args.amount_in_raw) : BigInt(Math.floor(args.amount_in));
      const quoteInputs: QuoteInputs = {
        inputMint: args.input_mint,
        outputMint: args.output_mint,
        amountRaw,
        slippageBps: slippage,
      };
      if (opts.referralFeeBps) {
        quoteInputs.referralFeeBps = opts.referralFeeBps;
      }
      const quote = await fetchQuote(quoteInputs);

      const swapInputs: SwapPostInputs = {
        quote,
        userPublicKey: opts.wallet.address,
      };
      if (opts.referralAccount) {
        swapInputs.referralAccount = opts.referralAccount;
      }
      const swapTx = await fetchSwapTx(swapInputs);

      const signer = await getSigner();
      const txSig = await signer(swapTx);

      opts.logger.info("jupiter-swap", "swap landed", {
        input_mint: args.input_mint,
        output_mint: args.output_mint,
        tx: txSig,
        fetched_at: opts.clock.now().toISOString(),
      });

      const priceImpactPctNum =
        quote.priceImpactPct != null ? Number(quote.priceImpactPct) : Number.NaN;

      const result: SwapResult = {
        success: true,
        input_mint: args.input_mint,
        output_mint: args.output_mint,
        amount_in: Number(quote.inAmount),
        amount_out: Number(quote.outAmount),
        tx: txSig,
        dry_run: false,
      };
      if (Number.isFinite(priceImpactPctNum)) {
        result.price_impact_pct = priceImpactPctNum;
      }
      return result;
    },
  };
}
