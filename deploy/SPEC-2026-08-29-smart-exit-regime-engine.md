# Smart-Exit Regime Engine — Design

**Date:** 2026-08-29
**Status:** Approved (design), pending implementation plan
**Branch target:** `dashboard`
**Scope:** Position **exit** logic only. Entry logic (the `maxFromHighPct` drawdown gate) already shipped separately and is out of scope here.

---

## 1. Problem

Three consecutive live losses (Zoe −16.6%, GTA6 −20.4%, Morty −18.9%, ~−$34 total) all closed on the single static rule `pnl_pct <= stopLossPct` (live `stopLossPct = -15`). Root-cause analysis against production data (`~/meridian-data/lessons.json` performance records):

- All three were **entry** failures (bought −33% to −50% below window high on a 1h dead-cat bounce). The entry gate fix (`maxFromHighPct`) addresses that.
- The **exit** itself exposed a separate weakness: a single static `pnl_pct` threshold is too crude for two opposite regimes:
  - **Collapsing positions** were already dead (OOR-below, support broken, mcap halved) well before −15% — the static stop cut them *late*, at −16 to −20% after slippage past the threshold (management cycle only evaluates every 10 min).
  - **Healthy in-range positions** earning real fees can show temporary paper IL; a static −15% could cut a still-working position prematurely. (Not what killed these three, but a real cost on choppy pools.)

Fee data confirms fees are a rounding error against IL on a collapse: Zoe earned +$2.05 fees vs −$11 IL; Morty +$0.44 vs −$15.4. Net `pnl_pct` (IL + fees) is the correct exit variable; the problem is the *decision function*, not the variable.

**Goal:** Replace the static stop with a **regime-aware exit engine** that (a) cuts dying positions *faster* and (b) holds healthy in-range positions *longer*, with a hard catastrophic floor as backstop.

---

## 2. Decision model

**Deterministic first, Sage escalates the ambiguous middle.** The deterministic layer runs every tick and resolves all clear cases autonomously. Only positions it classifies as genuinely AMBIGUOUS are escalated to Sage (Hermes) for a hold-or-cut verdict. Sage is a rare second opinion, never consulted per-position-per-tick.

### 2.1 Regime matrix

Per open position, classify into exactly one regime (evaluated in priority order top→bottom):

| Priority | Regime | Trigger (deterministic) | Action |
|---|---|---|---|
| 1 | **CATASTROPHIC** | `pnl_pct <= exitHardFloorPct` (default −25%) | **CLOSE** — unconditional backstop |
| 2 | **DYING** | OOR-below **AND** (support broken **OR** both-TF trend DOWN **OR** ATR/vol collapse); **OR** `consecutive_red_count >= dyingConsecutiveRed` **AND** fee velocity near-zero | **CLOSE** now — fires before −15%, ~−6 to −10% |
| 3 | **HEALTHY** | in-range **AND** `fee_per_tvl_24h >= healthyFeeVelocityMin` **AND** NOT both-TF trend DOWN | **HOLD** — ignore paper pnl down to the catastrophic floor |
| 4 | **AMBIGUOUS** | anything else (in-range but deep paper loss; mixed signals; trend flip while vol alive) | **ESCALATE to Sage** |

Definitions:
- **OOR-below**: `active_bin < lower_bin` (price dropped below the range; single-side SOL liquidity fully converted to the falling base token — no fees crossing).
- **support broken**: `nearest_support` is null on the 1h row, OR last close is below the prior `nearest_support` (price fell through the swing-low floor).
- **both-TF trend DOWN**: both 15m and 1h `trend === "DOWN"`.
- **ATR/vol collapse**: 1h `atr_pct < dyingAtrCollapsePct` (dead pool — nothing to farm even on a reversal).
- **fee velocity**: existing on-chain `fee_per_tvl_24h`. "near-zero" = below a small floor (reuse `minFeePerTvl24h` or a dedicated `dyingFeeFloor`; decided in plan).

Existing rules preserved unchanged: OOR-**pump** close (old rule 3), low-yield (old rule 4), take-profit (old rule 2), trailing-TP (pnl-poller). Only the old rule-1 static stop is replaced by this engine.

### 2.2 Deterministic → Sage boundary

- Only **AMBIGUOUS** escalates.
- Sage receives a compact single-position signal block and returns `{ action: "CLOSE" | "HOLD", reason: string }`.
- **Cooldown**: a position escalates to Sage at most once per `sageExitCooldownMin` (default 20 min). Tracked per position (last-escalated timestamp on the tracked position record). Between escalations, an AMBIGUOUS position uses the last Sage verdict if still within cooldown, else HOLD.
- **Timeout / unreachable → conditional deterministic fallback**: in-range AND not catastrophic → **HOLD**; otherwise → **CLOSE**. Never blocks the tick.
- **Sage advises, deterministic layer executes.** Sage does NOT perform exit on-chain writes. The management layer runs the close via existing `executeTool` (safety gates + post-hooks + notify card + decision log + auto-swap all still fire). This is deliberately simpler/safer than the screening execute-in-Sage model.

---

## 3. Cadence (two-tier, matches existing loops)

- **PnL poller (30s, on-chain only, no OHLCV):** evaluates CATASTROPHIC floor + a cheap DYING proxy (`active_bin < lower_bin` AND `pnl_pct <= exitOorProxyPct`, default −12 — an OOR-below position already this far down is not coming back inside the range before the next 10-min management tick). Fast crash protection at zero API cost. Keeps existing trailing-TP behavior. Adds `exitOorProxyPct` to the config field set (default −12).
- **Management cycle (10 min, fetches OHLCV per open position):** full regime classification (candle momentum + structure + HEALTHY + AMBIGUOUS→Sage). 10-min granularity is adequate (the losses bled over hours); the poller covers fast crashes.

Rationale: candle/structure signals need OHLCV, which is expensive to fetch every 30s. Splitting keeps the 30s loop cheap while still enabling fast catastrophic cuts.

---

## 4. Components & changes

### 4.1 `src/domain/format/technicals.ts` (pure)
- Add `consecutive_red_count: number | null` to `TechnicalsSummary` (schema in `schemas/kline.ts`) and compute in `computeTechnicals` (count of trailing candles where `c < o`, from the last candle backward). Null on empty history.
- Unit-tested; no I/O.

### 4.2 `src/domain/rules/close-rules.ts` (pure)
- Introduce `classifyRegime(signals): Regime` and `getExitDecision(signals, cfg): ExitDecision` where `ExitDecision = { action: "CLOSE" | "HOLD" | "ESCALATE"; regime: Regime; reason: string }`.
- `getDeterministicCloseRule` is refactored so rules 2/3/4 and PnL-suspect suppression remain; rule-1 static stop is replaced by `getExitDecision`.
- Regime classification is a pure function over a `PositionExitSignals` struct (on-chain fields + optional technicals rows). When technicals are absent (poller path / OHLCV fail-open), only CATASTROPHIC + on-chain DYING proxy are reachable; HEALTHY/AMBIGUOUS require technicals.

### 4.3 `src/ports/sage-exit-advisor.ts` (new port)
- `interface SageExitAdvisor { decide(input): Promise<{ action: "CLOSE" | "HOLD"; reason: string }> }`.
- Advisory only. Throws `SageTransportError` on timeout/transport (caller applies the conditional fallback).

### 4.4 `src/adapters/llm/sage-exit-advisor-http.ts` (new adapter)
- Reuses the `sage-decider-http.ts` transport pattern: OpenAI-compatible POST, `X-Hermes-Session-Key`, explicit `User-Agent`, CF Access headers if set, timeout → `SageTransportError`.
- Exit-specific system prompt: given ONE position's signals, reply `CLOSE: <reason>` or `HOLD: <reason>`. No tools, no config writes.

### 4.5 `src/app/management/cycle.ts`
- Add per-position OHLCV enrichment mirroring screening's `enrichTechnicals` (same fail-open contract, per-timeframe timeout).
- `planForPosition` calls `getExitDecision`; on `ESCALATE`, check per-position cooldown → call `SageExitAdvisor.decide` → map verdict/fallback to CLOSE/HOLD → execute close via `executeTool` as today.
- Emit a per-position log line each tick: classified regime + the signals that drove it (for the dark-launch shadow period).

### 4.6 `src/app/management/pnl-poller.ts`
- Add CATASTROPHIC floor + OOR-below fast-cut (on-chain only), alongside existing trailing-TP two-phase confirm. Same execute + notify + consolidate path.

### 4.7 Config (`schemas/config-flat.ts`, `schemas/config.ts`, `config-load.ts`)
New fields (flat defaults; nested schema; `flatToNested` mapping; `nestedToFlat` auto-covered by the `...screening`/`...management` spread — place fields under the appropriate section):
- `smartExitEnabled: boolean` (default **false** — dark launch)
- `exitHardFloorPct: number` (default −25)
- `exitOorProxyPct: number` (default −12 — poller fast-cut proxy for OOR-below positions)
- `dyingConsecutiveRed: number` (default 4)
- `dyingAtrCollapsePct: number` (default 10 — 1h ATR below this = dead vol; calibratable)
- `healthyFeeVelocityMin: number` (default 12 — 2× the `minFeePerTvl24h=6` low-yield floor, so "healthy" means clearly earning; calibratable)
- `sageExitEnabled: boolean` (default false until Sage exit prompt validated)
- `sageExitCooldownMin: number` (default 20)

When `smartExitEnabled === false`, exit behavior is **exactly today's static rule-1** (`pnl_pct <= stopLossPct`). Zero behavior change on deploy.

### 4.8 Tracked position record (`schemas/position.ts`)
- Add `last_sage_exit_escalation_at?: string` for the escalation cooldown. Nullable; backward-compatible.

---

## 5. Rollout & safety

- **Dark launch:** ship behind `smartExitEnabled=false`. Deploy is a no-op behaviorally. The shadow log line lets the user watch regime classifications against live positions before arming.
- **Arm via dashboard** Config page once classifications look right; `sageExitEnabled` armed separately after the exit prompt is validated (until then, AMBIGUOUS uses the conditional deterministic fallback).
- Live config is host-bind-mounted (`~/meridian/user-config.json`); flat-schema defaults inject the new keys at boot, so no manual server edit and no clobber of tuned values.

---

## 6. Testing

- `computeTechnicals`: `consecutive_red_count` — all-red, all-green, mixed-tail, empty.
- `classifyRegime`: table-driven, one case per regime plus each boundary (CATASTROPHIC vs DYING at the floor; DYING OOR-below combinations; HEALTHY fee-velocity boundary; AMBIGUOUS fallthrough).
- Sage escalation: cooldown suppresses a second call within the window; timeout → conditional fallback (in-range→HOLD, OOR→CLOSE); clean CLOSE/HOLD verdict honored.
- Management cycle: OHLCV fail-open (missing candles → CATASTROPHIC/on-chain-proxy still reachable, no throw).
- Regression: with `smartExitEnabled=false`, existing close-rule tests pass unchanged.

---

## 7. Out of scope (YAGNI)

- Fee-vs-IL trajectory tracker (explicitly dropped).
- Entry logic changes (already shipped: `maxFromHighPct`).
- New dashboard UI beyond the config fields.
- Lowering `managementIntervalMin` (a config tune, not a code change).
- Deferred, separate follow-ups from the audit: repo↔live config-drift cleanup (P4).
