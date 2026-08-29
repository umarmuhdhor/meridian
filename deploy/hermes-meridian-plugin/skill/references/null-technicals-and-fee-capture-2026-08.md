# Null-technicals gap & fee-capture confirmation (Aug 2026)

Postmortem of the K-HOME + BOIÚNA losses and the 0.4 SOL / curve fee improvements.
Companion to the entry-quality veto section in SKILL.md.

## The null-technicals gap (100% of 2026-08-13 losses)

Both losses entered through the SAME hole: brand-new tokens whose 1h timeframe had
too few candles for any technical to compute.

| Token | Closed | Loss | 1h candles at entry | 1h technicals |
|---|---|---|---|---|
| BOIÚNA | SL -15.12% | -$7.14 | 10 | ALL NULL |
| K-HOME | manual (pump-dump) | -$3.86 | 19 | trend/atr/spike NULL, atr only 25.2% raw |

Why they slipped through:
- Daemon downtrend gate fail-opens on null timeframes (by design, to survive rate
  limits). A token with no computable EMA is treated as "unknown, pass with note".
- The candidate `volatility` field (K-HOME showed 2.651) is NOT the kline `atr_pct`
  (actual 43.4%). The extreme-volatility veto keys on atr_pct, so it never fired.
- 5m looked fine (K-HOME 5m trend UP, support -4% with touches) — the danger was
  only visible on 1h, which was null.

Rule: **if 1h technicals are NULL, treat as NO DEPLOY.** A token too new to assess
is too new to deploy 0.4 SOL into. Also: never assume candidate `volatility` equals
ATR — cross-check with mrd_get_pool_kline on borderline candidates.

## The 2026-08-16 gate relaxation (why the old NEEGY lesson was wrong)

Old rule: "1h trend=DOWN + from_window_high < -30% → veto" (NEEGY lesson).
This was too strict — it killed reversal setups that are DLMM's bread and butter.

New capitulation gate — veto ONLY when ALL FOUR on 1h (thresholds = backend config, final 2026-08-16):
- trend = DOWN
- from_window_high_pct < -65%  (`capitulationFromHighPct: 65` — deep drop from 20h rolling high, NOT ATH)
- support_distance_pct > 15%   (`capitulationSupportDistPct: 15` — nearest swing-low support >15% away)
- atr_pct < 15%                (`capitulationAtrPct: 15` — dead volatility, no fee generation)

Any ONE false = deploy allowed. Shallow dips, near-support entries, high-vol
downtrends PASS. Reversal setup to FAVOR: 1h DOWN + support < 5% + atr > 20% →
bin range swept both sides = fee farm; consider bid_ask at lower bins.
EXTREME-VOL OVERRIDE: reversal setup skips the 1h-ATR>25% veto up to 1h ATR ≤ 30%
(backend maxAtrPct: 30); above 30% still blocked.

Lessons unpinned in the same relaxation: NEEGY blanket-downtrend veto, blanket
support-dist < -20% veto, and the 5m-UP-+-1h-DOWN counter-trend bounce veto
(that signal is now the reversal setup we WANT). Pinned cap = 12 — do not add
a 13th without proposing what to unpin.

## 48h fee-capture confirmation (Aug 13-14)

0.4 SOL sizing + curve-on-low-vol produced 4-40x fee capture vs old 0.3 spot:

- TOAD curve: $1.99 fees / 22h (old spot records $0.05-0.49)
- GTA6: $2.82 fees, TP close
- Chiikawa: $1.62 fees, OOR close
- Momota: $1.09 fees, OOR close

Key evaluation insight: **pnl_usd alone is misleading on single-side SOL.**
TP/OOR exits showed pnl_usd of -$0.10 to -$0.40 while fees added +$1 to +$3 —
net positive after fees. Evaluate positions by (pnl_usd + fees_earned), not
pnl_usd alone. pnl_pct is token price change, NOT position profit (TOAD TP
+15.84% was -$0.10 net; BUTTHOLE TP +20% was -$0.15 net).

## Pinned-lesson management

The bridge exposes an unpin endpoint not in the mrd_* tool surface:
`post_tool("unpin_lesson", {"id": "<lesson-id>"}, confirm=True)`.
Used 2026-08-16 to retire the NEEGY blanket-downtrend lesson when Alfara relaxed
the gate. Lesson ids live in /state/file/lessons (readable via the plugin client).
