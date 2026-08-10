# GMGN CLI Setup & Screening Lessons

## GMGN CLI setup (keypair verification flow)

GMGN CLI uses a local keypair for API key verification. The flow is NOT just "paste a key" — the key must be generated against the machine's public key.

1. Check if gmgn-cli is installed: `npm list -g gmgn-cli`
2. The binary lives at `/opt/data/profiles/sage/home/.local/bin/gmgn-cli` — may not be in default PATH. Export inline: `export PATH="/opt/data/profiles/sage/home/.local/bin:$PATH"`
3. Run `gmgn-cli config` — it outputs a URL like `https://gmgn.ai/ai/generateapi?pbk=<PUBLIC_KEY>`
4. The user opens that URL in their browser, the public key is pre-filled, they create the API key there
5. User sends you the generated key (starts with `gmgn_`)
6. Apply: `gmgn-cli config --apply <KEY>`
7. Verify: `gmgn-cli config --check` (exit 0 = OK)
8. Test: `gmgn-cli token info --chain sol --address <any_mint> --raw`

**Pitfall:** If the user sends a key generated without the machine's public key, `config --apply` fails with "API Key does not match your local key pair." The keypair.pem is at `~/.config/gmgn/keypair.pem`.

## Volume timeframe lesson (2026-08-02)

The Meridian screening candidate block shows `vol=$XXXX` — this is the `volume_window` value from the pool discovery source, using the config's `timeframe` setting (currently `1h`). It is NOT 24h volume.

**Rule:** Use 1h volume as the primary liquidity signal. 24h volume is context only. A token can show $1.5M 24h volume but have only $3k in the last hour = effectively dead for fee capture.

Cross-check with GMGN when available:
```bash
gmgn-cli token info --chain sol --address <mint> --raw | python3 -c "
import sys,json; d=json.load(sys.stdin); p=d['price']
print('vol_1h:', p.get('volume_1h'), 'vol_24h:', p.get('volume_24h'))
"
```

## Veto carryover anti-pattern (2026-08-02)

**Problem:** After vetoing JORDAN 2x in early screening cycles, a self-reinforcing rule was created: "vetoed 2x → needs Alfara auth to redeploy." This blocked JORDAN for 9 consecutive cycles despite consistently clean fundamentals (rug_score 0-1, 5k+ holders, 87% organic, vol $10-23k).

**Root cause:** Treating a veto as a persistent state rather than a per-cycle decision. Meme coins change minute-to-minute — a veto 20 min ago is stale.

**Fix:** No veto carryover between cycles. Each cycle evaluates on current data. Only TrumpCoin is permanently banned (explicit Alfara decision). All other tokens: if current data passes gates, deploy.

## Strategy selection lesson (2026-08-02, updated 2026-08-05)

**Problem:** Every deploy used `bid_ask` with `bins_above=0` because it was the config default. This caused instant OOR on upward price moves for Chiikawa, HBULL, MENSA — all went out of range within hours, earning $0 fees.

**Root cause:** Treating strategy as a fixed parameter rather than a per-cycle decision based on token conditions.

**Fix:** Strategy is Sage's choice per cycle:
- Meme coins / high volatility → **spot** (default, most forgiving)
- Range-bound / stable → **curve** (max fee efficiency)
- Dumping / DCA-out thesis → **bid_ask** (capture downside)

**Update 2026-08-05:** Config default changed from `bid_ask` to `spot` via `mrd_update_config`. Daemon prompt now requires strategy justification per candidate.

**Three core rules (Alfara-confirmed 2026-08-03, strategy autonomy reconfirmed 2026-08-10):**
1. Strategy is yours to choose every deploy (SPOT/CURVE/BID_ASK). Config strategy is a fallback, not an order. State rationale sentence ("volatility X, thesis → strategy Y"). Never autopilot. User audits the rationale line.
2. Config edits when asked — no stalling, no explaining why you can't.
3. Proactive fixes — propose config changes that prevent patterns, don't just apologize.
4. TA line under each candidate = mandatory first read before anything else.
5. If any entry-quality veto condition fires, NO DEPLOY is the correct answer — no scoring penalty for skipping.

## Single-side SOL constraint (2026-08-05)

`bins_above > 0` is **impossible** with single-side SOL deposits. Bridge rejects: `"single-side SOL deploy cannot have bins_above > 0 (upper bin is the SDK active bin)"`. Active bin is always at upper edge — BY DESIGN.

This means:
- OOR on pump = expected and harmless (holding SOL, inactive)
- Real risk = dump through all bins converting SOL into crashing token
- Don't try to "fix range placement" — fix token selection instead
- Pick tokens likely to chop sideways or drift down
- fee/aTVL >300% = dump warning (TikTok lesson), not opportunity

## TikTok stop loss lesson (2026-08-05)

TikTok-SOL deployed with 724% fee/aTVL. Token dumped -25% in 1 hour. Stop loss at -15% executed at -24.85% due to 10-min management interval gap. Fees $1.93 couldn't cover -$7.45 IL.

**Rule:** fee/aTVL >300% = soft veto. Don't redeploy same token when metrics are climbing fast (overheating).

## Entry-quality veto lessons (2026-08-10, kline-confirmed)

Full postmortem of 6 SLs (Aug 5-9) via `mrd_get_pool_kline` on each losing pool. Two failure modes identified:

**Mode 1: Spike-top entry (5/6 SLs).** SISYPUSS x2, Doom x2, LOUIE. Entered during temporary price spike at local top. Signals: `at_local_top=YES`, high `spike_pct`, `fee_tvl_ratio > 100%`. Price reverted through all bins → SL.

**Mode 2: Sustained downtrend (1/6 SLs).** NEEGY. `fee_tvl_ratio` was LOW (17.32%) — breaks the spike pattern. Token in 66% downtrend, no support. Low fee_tvl_ratio ≠ safety; a dead token in freefall has low fees because no one trades it. Signals: `trend=DOWN` on 1h, `from_window_high_pct < -30%`, `atr_pct > 25%` on 1h.

**Mcap red herring:** Initial analysis proposed "AVOID mcap < $2.5M". User corrected: mcap is NOT the problem; entry timing is. TOAD ($11-15M) won because it was chopping sideways at entry, not because it was bigger. Low mcap correlates with losses only because small tokens spike harder — veto the spike, not the mcap.

**New pinned lessons:** downtrend veto (l-1786334165780), extreme-volatility veto (l-1786334166794). See `references/stop-loss-postmortem-aug-2026.md` for full analysis.

## Close tool fix (2026-08-02)

The `mrd_close_position` bridge endpoint requires a `reason` string field in args. The plugin schema was missing it, causing `args validation failed (reason: Required)` on every close attempt.

**Fix:** Patched `tools.py` to include `reason` in schema and handler. Direct bridge call also works:
```python
post_tool("close_position", {"position_address": addr, "reason": "user_authorized"}, confirm=True)
```

If close fails with "position not found in snapshot" — the position is already closed/expired on-chain. Not an error, just a stale record.
