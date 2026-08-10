# Stop-Loss Postmortem — August 5-9, 2026

6 stop losses in 5 days, net -$22.91 after fees. Kline analysis (`mrd_get_pool_kline` on each losing pool) confirmed two distinct failure modes.

## Mode 1: Spike-top entry (5 of 6 SLs)

Entered during a temporary price spike at a local top. Price reverted through all 69 bins → stop loss.

| Token | Date | PnL | Net | fee_tvl | mcap | Kline evidence |
|---|---|---|---|---|---|---|
| SISYPUSS #1 | Aug 5 | -16.38% | -$3.64 | 177% | $653K | Token bled from $7.8e-5 → $4.4e-5 (-44%). Entered mid-spike. |
| SISYPUSS #2 | Aug 5 | -20.21% | -$4.51 | 300% | $708K | Same token same day. Chased the spike deeper. |
| Doom #1 | Aug 6 | -17.51% | -$3.90 | 105% | $2.09M | Token peaked at $0.0016, now $0.0005 (-68%). |
| Doom #2 | Aug 8 | -17.10% | -$3.84 | 38% | $1.42M | 5m kline: `at_local_top=TRUE`. Token cycles spike→dump repeatedly. Entered on a bounce that failed. |
| LOUIE | Aug 9 | -15.92% | -$3.65 | n/a | n/a | MASSIVE pump-and-dump: $0.000773 → $0.00434 (+461%) → crashed to $0.00151. 1h ATR 39.8%. |

**Common signals at entry (visible on TA line):** `at_local_top=YES`, high `spike_pct`, high `fee_tvl_ratio` (>100%), high `atr_pct`.

**Veto:** `at_local_top=YES` OR `spike_pct > +25%` (5m) + `vol_x > 3` OR `spike_pct > +50%` (1h) OR `fee_tvl_ratio > 100%`.

## Mode 2: Sustained downtrend (1 of 6 SLs)

Entered mid-crash thinking the token was cheap. Token kept falling through all bins with no support.

| Token | Date | PnL | Net | fee_tvl | mcap | Kline evidence |
|---|---|---|---|---|---|---|
| NEEGY | Aug 9 | -15.05% | -$3.37 | 17.32% | $2.13M | Sustained downtrend $0.00226 → $0.000757 (-66%). `at_local_bottom=TRUE` on both TFs. No support below. |

**Key insight:** fee_tvl_ratio was LOW (17.32%) — this breaks the spike pattern. A dead token in freefall has low fees because no one is trading, not because it's stable. Do NOT confuse low fee_tvl_ratio with safety.

**Veto:** `trend=DOWN` on 1h AND `from_window_high_pct < -30%`. Also: `atr_pct > 25%` on 1h OR `atr_pct > 10%` on 5m (extreme volatility).

## What worked (contrast)

| Token | Deploys | Result | Why it worked |
|---|---|---|---|
| TOAD | 3 | All positive | Sideways/choppy at entry. Spike happened DURING position (exit at local top = TP). Not at entry. mcap $11-15M. |
| Jimothy | 2 | All positive | Large mcap ($7-15M), stable, no spike at entry. |
| BUTTHOLE | Multiple | Mostly positive | Entered on a dip (from_high -21.7% on 5m, -41% on 1h). Correct entry timing. |

## The mcap red herring

Initial analysis proposed "AVOID mcap < $2.5M" as the lesson. User corrected: **mcap is not the problem; entry timing is.** TOAD ($11-15M) won because it was chopping sideways at entry, not because it was bigger. Low mcap correlates with losses only because small tokens spike harder — the veto should be on the spike, not the mcap.

## Pinned lessons saved (via mrd_add_lesson)

1. `l-1786334165780` — AVOID 1h trend DOWN + from_window_high < -30% (downtrend veto)
2. `l-1786334166794` — AVOID 1h ATR > 25% or 5m ATR > 10% (extreme volatility veto)

Combined with existing pinned lessons (TA-first, spike-top veto, strategy per candidate), screening now has 5 pinned lessons covering all identified failure modes.

## Methodology note

This postmortem used `mrd_get_pool_kline` on each losing pool (5m + 1h, 50 candles) to verify entry quality. The performance table alone shows PnL and close_reason but not WHY the SL happened — the kline adds the entry-quality dimension (spike top vs downtrend vs extreme vol). This kline-confirmation step is now embedded in the retrospective protocol in SKILL.md.
