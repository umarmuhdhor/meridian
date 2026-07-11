// Per-tool arg/result adapters for the dashboard /tool path ONLY.
//
// A handful of TS core tools expose arg/result shapes that differ from what the
// dashboard web app (built against the JS tool surface) sends/reads. Rather than
// mutate the core tools (and break the agent + their tests), the bridge translates
// on the way in and out. The agent/chat path uses the real tool schemas untouched —
// these adapters apply solely to direct web `POST /tool` calls.

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const normalizeMint = (m: unknown): unknown => {
  if (typeof m !== "string") return m;
  const low = m.toLowerCase();
  if (low === "sol" || low === "native" || low === "wsol") return WRAPPED_SOL;
  return m;
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Rewrite web args → the TS tool's arg shape. Missing entry = pass through. */
export const ARG_ADAPTERS: Record<string, (args: Record<string, unknown>) => Record<string, unknown>> = {
  // web: { input_mint, output_mint:"SOL", amount } → tool: { input_mint, output_mint, amount_in }
  swap_token: (a) => {
    const out: Record<string, unknown> = { ...a };
    out.output_mint = normalizeMint(a.output_mint);
    out.input_mint = normalizeMint(a.input_mint);
    if (a.amount_in === undefined && a.amount !== undefined) out.amount_in = a.amount;
    delete out.amount;
    return out;
  },
};

/** Rewrite the TS tool's result → the shape the web reads. Missing entry = pass through. */
export const RESULT_ADAPTERS: Record<string, (result: unknown) => unknown> = {
  // tool: { picked, scanned, ... } → web: { candidates, filtered_examples, total_screened }
  get_top_candidates: (r) => {
    const o = asRecord(r);
    const rejection = Array.isArray(o.rejection_summary) ? (o.rejection_summary as unknown[]) : [];
    return {
      ...o,
      candidates: Array.isArray(o.picked) ? o.picked : [],
      filtered_examples: rejection.map((s) => ({ name: "—", reason: String(s) })),
      total_screened: typeof o.scanned === "number" ? o.scanned : 0,
    };
  },
  // tool: { count, matches } → web: { in_pool, signal }
  check_smart_wallets_on_pool: (r) => {
    const o = asRecord(r);
    const count = typeof o.count === "number" ? o.count : 0;
    return {
      ...o,
      in_pool: Array.isArray(o.matches) ? o.matches : [],
      signal: count > 0 ? `${count} tracked wallet(s) active in this pool` : "no tracked wallets in this pool",
    };
  },
  // tool: WalletBalance (SOL only) → web wants total_usd + tokens[]
  get_wallet_balance: (r) => {
    const o = asRecord(r);
    return {
      ...o,
      total_usd: typeof o.total_usd === "number" ? o.total_usd : (o.sol_usd ?? 0),
      tokens: Array.isArray(o.tokens) ? o.tokens : [],
    };
  },
};

export const adaptArgs = (name: string, args: Record<string, unknown>): Record<string, unknown> =>
  ARG_ADAPTERS[name] ? ARG_ADAPTERS[name](args) : args;

export const adaptResult = (name: string, result: unknown): unknown =>
  RESULT_ADAPTERS[name] ? RESULT_ADAPTERS[name](result) : result;
