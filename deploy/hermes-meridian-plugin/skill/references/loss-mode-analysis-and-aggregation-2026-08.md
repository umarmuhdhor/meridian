# Loss-mode analysis + full-history aggregation (Aug 2026)

Retrospective findings from the full closed-position archive (201 closes as of
2026-08-29) and the 3-day window (Aug 28–31). Two sources of truth:

- `mrd_get_performance` — capped at the last 100 rows, huge JSON (entry/exit
  technicals per row). Good for the last N closes, NOT for month-scale aggregation.
- The raw bridge file `GET /state/file/lessons` → `.performance` — the FULL array.
  Query it directly (Python urllib against `$MERIDIAN_BRIDGE_URL`, Bearer
  `$MERIDIAN_BRIDGE_TOKEN`) to bucket losses by `entry_technicals[].from_window_high_pct`,
  `strategy`, and `close_reason`. Do NOT rely on `mrd_get_performance` for a
  full-history PnL sum — it caps at 100 and the per-row technicals blow the
  context budget.

## Three loss modes (order of frequency)

1. **Null-technicals** — token too young for 1h/15m data. Historically the largest
   single bucket (−$66.89 across 15 losses: K-HOME, BOIÚNA, BULLSHIT). Closed by
   `rejectOnMissingTrend` + the 15m migration. Still: a candidate with null TA = decline.

2. **Dead-cat bounce (deep-from-high)** — `trend=UP` on 1h but `from_window_high_pct`
   ≤ −30%. Bought as a "recovery," actually a bounce inside a collapse. Zoe −50%,
   GTA6 −41%, Morty −34%, Sue −44%, Pistacio −41%. 8 of 28 meaningful losses read
   `trend=UP` at entry vs only 2 DOWN. Now hard-gated in code (`maxFromHighPct=−35%`),
   but the reasoning lesson stands: green candles ≠ recovery.

3. **Dead-volume / fee-dry-up (NEW)** — enters at a *shallow* drawdown (TOAD −14%,
   Qenis −23%) with low ATR (9–13%), passes the volatility veto, then quietly dies:
   both TFs drift DOWN, volume/fees dry up, no support below. **Low ATR on a
   low-liquidity meme means "nobody's trading," not "stable."** Cut by the exit
   advisor as "structure breaking" at −$9.57 / −$10.56 — barely better than a −15%
   stop, and they landed 30 min apart.

## Key numbers (7-day, Aug 22–29)

- 42 closes, 19W/23L, net −$35.30 after fees.
- 4 stop-losses = −$42.42 (two-thirds of all time lost). Entry quality — not exit
  rules — is the whole game.
- Same-pool recycling: Morty 6× (−$16.80), GTA6 9× (−$11.59). Redeploying a
  collapsing token re-buys the same knife-catch.

## Correlated dumps

Two exit-advisor "structure breaking" cuts 30 min apart on unrelated tokens = a
market-wide (SOL/BTC) move, not two independent failures. Diversifying across meme
pools does not hedge a market dump; they all die together. Only defense: not being
over-deployed heading into obvious market-wide risk.
