# Meridian — CLAUDE.md

Autonomous DLMM liquidity provider agent for Meteora pools on Solana.

> **Audience**: future agents/sessions that need to make non-trivial changes
> (add a tool, change a safety rule, fix a cron race, extend a state file)
> without re-reading the whole repo. The README stays user-facing; this
> file is the engineering manual for the **TypeScript codebase under `src/`**.

---

## ⚠️ Read first

1. **Live code = the TypeScript rewrite under `src/`.** Entry point
   `src/entrypoints/daemon.ts` → built to `dist/entrypoints/daemon.js`. There is
   **no** `index.js` / `agent.js` / `tools/*.js` / `persistence/*.js` — the legacy
   JS was retired (`legacy-js` git tag). Architecture is **hexagonal**:
   `domain` (pure) → `ports` (interfaces) → `adapters` (implementations) →
   `app` (use-cases) → `entrypoints` (DI wiring).
2. **Meridian is deployed and trading live.** 2 Docker containers (`meridian` +
   `meridian-web`) on the **vivobook home server**, co-located with Sage
   (Hermes agent) for intra-host screening delegation. Auto-deployed from
   `dashboard` via GitHub Actions → GHCR → CF-Access-tunneled SSH to vivobook.
   PIN-gated dashboard at `calisto.nafidinara.com` behind Cloudflare Access.
   **All deploy/ops details live in [`deploy/OPERATIONS.md`](deploy/OPERATIONS.md)**
   — this file is code internals only. Migration history + runbook:
   [`deploy/MIGRATION-vivobook-runbook.md`](deploy/MIGRATION-vivobook-runbook.md).

---

## TL;DR

- **What it is**: Node 22+ ESM service running an LLM-driven ReAct loop
  (OpenAI-compatible) to screen Meteora DLMM pools, deploy SOL into positions,
  monitor them, and close them without a human in the loop. Telegram is the ops
  surface; a Next.js dashboard (behind the localhost bridge) is the web surface;
  Agent Meridian HiveMind provides shared learning.
- **Entry**: `node dist/entrypoints/daemon.js` (dev: `tsx watch src/entrypoints/daemon.ts`).
  `MERIDIAN_AUTONOMOUS=true` → resident daemon (cron + Telegram); otherwise a
  one-shot single screening cycle.
- **Two LLM-driven roles + one deterministic cycle** (tool access enforced by `toolFilter`, not the role):
  - `SCREENER` — every `screeningIntervalMin`, picks a pool, calls `deploy_position`. Delegated to Sage in production (`MERIDIAN_DECIDER=sage`); local loop is fallback.
  - **Management (deterministic, no LLM)** — every `managementIntervalMin`, `planForPosition` decides, `executeTool` runs it. Rewired from LLM-in-the-loop → direct calls on 2026-08-02.
  - `GENERAL` — ad-hoc chat (dashboard `/chat`). Telegram inbound is now handled by Sage (Hermes), not this role.
- **State = JSON files** at `STATE_DIR` (default cwd), one repo per file, atomic writes.
  No DB.
- **The real safety gates are `MERIDIAN_CHAIN=meteora` + `MERIDIAN_WRITE_UNSAFE=true`.**
  `DRY_RUN` is *not* consulted for gating in the TS code (it only surfaces as a
  HiveMind capability flag). Getting this wrong = fake trading or, worse, an
  unintended live write.
- **Cross-cutting invariants that are easy to break**: lazy SDK load, `force:true`
  on position reads, once-per-session tool locks (`deploy` = also `noRetry`),
  trailing-TP two-phase 15s confirm, bridge binds `127.0.0.1` only. Details below.

---

## Architecture

```
 entrypoints/daemon.ts  (composition root: boot() wires ports→adapters, main() runs)
        │
        │ AppContext { clock, logger, config, chain, swap, notifier, market{5}, repos{8} }
        ▼
 ┌─────────────────────────── app/ (use-cases) ───────────────────────────┐
 │  screening/cycle   management/cycle + pnl-poller   health   briefing    │
 │  hivemind/sync     telegram/router                                       │
 │            │                    │                                        │
 │            └──────── agent/loop.ts  runAgentLoop() (ReAct) ──────────────┤
 │                          │  buildSystemPrompt(role)  → LLMClient          │
 │                          ▼                                                │
 │              tools/execute.ts  executeTool(registry, call, ctx)          │
 │                 parse(jsonrepair) → args.zod → safety[] → execute → post[]│
 │                          │                                                │
 │              tools/impls/*.ts  (~59 tools, one file each)                 │
 └──────────────────────────┬──────────────────────────────────────────────┘
        uses ports (interfaces)  │  implemented by adapters
        ▼                        ▼
 domain/ (pure: rules, schemas, prompt, config-load)     adapters/
   rules: close-rules, pnl, exit-signals, scoring,          chain/meteora (real), chain/dry-run
          cooldown, deploy-planning, screening              market/* (jupiter, meteora, rugcheck, + fakes)
   schemas: 14 Zod shapes    ports/: 26 interfaces          persistence/json/* (9 repos, atomic)
                                                            swap, llm(+decorators), notify, scheduler,
                                                            logger, hivemind, dashboard (bridge)
```

Everything flows through `AppContext` (ports only — no concrete impls) assembled at
boot in `src/app/tools/context.ts`. Adapters are selected by env in `daemon.ts`.

### Layer map (read before editing)

**`src/entrypoints/daemon.ts`** (611) — composition root. `boot()` (L162-408) loads
config + selects adapters + builds `AppContext`; `main()` (L410-606) wires cron/modes.
- **Adapter selection cascade** (env-driven, defaults chain off each other):
  `MERIDIAN_CHAIN` (`dryrun`|`meteora`, default dryrun, L193) → meteora requires
  `RPC_URL`+`WALLET_PRIVATE_KEY` (throws if missing). `MERIDIAN_PRICE` defaults
  `jupiter` when chain=meteora else `static` (L194). `MERIDIAN_MARKET` defaults
  `real` when chain=meteora else `fake` (L284); selects 5 market ports
  independently. LLM: `MERIDIAN_DEMO=true` or no key → fake LLM; else OpenRouter.
  Notifier: telegram if `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` else collecting.
- **Write arming**: `writesEnabled = MERIDIAN_WRITE_UNSAFE === "true"` (L227), passed
  into the meteora chain client (the real gate lives in the adapter). Recomputed
  in 3 places (L227, L512, L565) — keep consistent.
- **`STATE_DIR`** = `MERIDIAN_STATE_DIR` ?? cwd (L101). Roots all 8 repos. Config
  path uses cwd (`REPO_ROOT`), so config + state can diverge.
- **Modes**: `MERIDIAN_AUTONOMOUS=true` → schedule cycles + Telegram inbound +
  shutdown handlers, stay resident (L456). Else one-shot screening (L586).
- **Dashboard bridge** started (both modes) only if `DASHBOARD_ENABLED=true`, via a
  **dynamic import** (L438) inside try/catch — must never throw fatally.

**`src/domain/`** — pure logic + Zod schemas, no I/O.
- `rules/close-rules.ts:39` `getDeterministicCloseRule` — the **5 hard exit rules**
  (stop-loss, take-profit, pumped-above-range, OOR-wait, low-yield); rules 1&2
  suppressed when PnL is suspect.
- `rules/pnl.ts:17` `assessPnl` — reported vs derived; **divergence is informational
  only, does NOT gate exits** (deliberate — don't re-add gating). `pnl_pct_suspicious`
  fires only when a tick is genuinely unpriceable.
- `rules/exit-signals.ts:35` `evaluateExit` — stateful diff variant (flips
  `trailing_active`, sets `out_of_range_since`, emits STOP_LOSS/TRAILING_TP/OOR/LOW_YIELD).
- `rules/deploy-planning.ts:55` `planDeploy` — pure bin-range validator. Single-side
  SOL only (`amountX` must be 0), total bins ≥ `MIN_SAFE_BINS_BELOW` (35),
  `WIDE_RANGE_THRESHOLD` = 69 flags the multi-tx path.
- `rules/screening.ts:84` `hardFilter` + `rankCandidates`. `defaultThresholds`
  reads straight from `cfg.screening.*`, so `user-config.json` (and live dashboard
  Config edits, applied in-place by `update_config`) drive the hard filter. (Was
  a `void cfg` no-op until 2026-07-13 — that config-drift footgun is fixed.)
- `rules/scoring.ts:14`, `rules/cooldown.ts:7` (`isPoolOnCooldown`/`isBaseMintOnCooldown`).
- `schemas/` (14) — `config.ts`/`config-flat.ts`, `position.ts` (TrackedPosition +
  LivePositionSnapshot), `chain.ts`, `market.ts`, `pool-memory.ts`, `strategy.ts`,
  `decision.ts` (MAX_DECISIONS=100), `lesson.ts`, `state.ts`, `study.ts`,
  `smart-wallet.ts`, `blacklist.ts`, `dev-blocklist.ts`.
- `prompt/builder.ts:95` `buildSystemPrompt(ctx)` — pure assembler; `roleInstructions`
  = the 3 role prompts. `prompt/role-tools.ts` — `MANAGER_TOOLS`/`SCREENER_TOOLS`/`GENERAL_TOOLS`.
- `config-load.ts:147` `parseAppConfig(raw): Result<AppConfig,…>` — two-stage Zod:
  flat (`.passthrough()`) → `flatToNested` → nested. Never throws; returns a Result.

**`src/ports/`** (26 interfaces) — the DI contracts. Chain/trading: `ChainClient`
(writes return `{success}` in-band, never throw), `SwapClient`, `SolanaConnection`,
`PriceOracle`. Market: `PoolDiscoveryClient`, `TokenInfoClient`, `RugCheckClient`,
`SmartWalletChecker`, `StudyClient`. Persistence (all `load(): Result` + mutators):
`ConfigRepo`, `PositionRepo`, `PoolMemoryRepo`, `DecisionLogRepo`, `LessonRepo`,
`StrategyRepo`, `SmartWalletRepo`, `TokenBlacklistRepo`, `DevBlocklistRepo`. Also
`LLMClient`, `SageDecider` (Path 2 screening delegation — agentic, returns prose not
tool_calls), `Notifier`+`LiveMessageHandle`, `TelegramInbound`, `HiveMindClient`,
`Clock`, `Scheduler`, `Logger`.

**`src/adapters/`** — implementations.
- `chain/meteora/connection.ts` — `loadWalletKeypair` accepts JSON byte-array OR
  base58 (never base64); `createSolanaConnection` lazy-imports `@solana/web3.js`.
- `chain/meteora/client.ts:137` — read paths + write dispatch. **Positions cache 5min
  TTL + inflight dedup**; `force` bypasses. `getWalletBalance/getMyPositions/getActiveBin`.
  Lazy `@meteora-ag/dlmm` import (`loadDlmmSdk`, CJS explodes on eager ESM import →
  `postinstall scripts/patch-anchor.js` is required). `MeteoraWritePathNotPortedError`
  thrown by `assertWritable` when not armed.
- `chain/meteora/write-paths.ts` — `deploy`/`close`/`claim`, gated. Standard (≤69 bins)
  = one tx; **wide-range (>69) = two-phase multi-tx** (`createExtendedEmptyPosition` +
  `addLiquidityByStrategyChunkable`) due to Solana's 10240-byte realloc cap.
- `chain/dry-run.ts` — deterministic fake chain (no network); preserves cache/force/dedup.
- `market/` — real: `jupiter-price-oracle` (**Jupiter Price v3** `lite-api.jup.ag/price/v3`,
  30s TTL, retry×2), `jupiter-token-info`, `meteora-pool-discovery`, `rugcheck`,
  `meteora-smart-wallet-checker`, `agent-meridian-study`; test doubles: `fake-*`,
  `static-price-oracle`.
- `persistence/json/` — 9 repos over `atomic-write.ts` (temp+fsync+rename, crash-safe):
  `position-repo` (state.json; caps `recentEvents` to 20), `pool-memory-repo`,
  `lesson-repo`, `decision-log` (caps to 100), `strategy-repo`, `smart-wallet-repo`,
  `token-blacklist-repo`, `dev-blocklist-repo`, `config-repo`. **No `signal-weights`
  repo** (not ported).
- `swap/jupiter-swap.ts` — **Jupiter Swap/Quote v6**. `llm/openrouter.ts` (real),
  `llm/fake.ts`, plus decorators `with-provider-fallback`, `with-system-role-fallback`,
  `with-tool-choice-retry` (available but **not wired by default** in daemon.ts — the
  loop is intentionally thin, so resilience is opt-in via these decorators).
- `llm/sage-decider-http.ts` — `SageDecider` impl (Path 2). OpenAI-compatible POST to
  Hermes' api server; sends `X-Hermes-Session-Key` + CF Access headers + an explicit
  `User-Agent` (CF blocks default UAs → 403/1010); throws `SageTransportError` on
  timeout/transport so the screening cycle falls back to the local loop.
- `notify/` (telegram, telegram-inbound, collecting, null), `scheduler/`
  (interval, manual), `logger/console.ts`, `hivemind/agent-meridian.ts`.
- `dashboard/` — the control bridge (see § Dashboard bridge).

**`src/app/`** — use-cases (see the dedicated sections below).

---

## The ReAct loop (`src/app/agent/loop.ts:62`)

`runAgentLoop(deps={llm,registry,ctx}, opts)` — the single entry (no `agentLoop` alias).
- `opts`: `role`, `goal`, `systemPrompt`, `model`, `maxSteps` (default 20), `history`,
  `toolFilter`, `requireToolOnFirstStep`, `onToolStart/onToolFinish`.
- Each step: `llm.chat({...})`. `tool_choice="required"` only when
  `requireToolOnFirstStep && step===0`, else `"auto"`.
- **No-tool retry**: if a tool was required on step 0 and the model returned text, it
  injects a reminder and continues once; a second text-only reply ends with
  `no_tool_after_reminder`.
- **Once-per-session tool locks** (`agent/session-locks.ts`): `oncePerSession` locks
  after **success**; `noRetry` locks after the **first attempt regardless of outcome**.
  `deploy_position` = both (double-spend guard); `close_position`/`swap_token` =
  `oncePerSession`. A blocked call returns a `safety_blocked` error, never throws.
- **JSON repair** lives in the executor (`tools/execute.ts` `parseArgs` → `jsonrepair`),
  not the loop. **Provider fallback is NOT in the loop** (v1 assumes a well-behaved
  provider); use the `llm/with-*` decorators if you need it.
- **`role` is a label** — tool access is enforced purely by `toolFilter` →
  `registry.subset(names)`. Pass a role without the matching filter and the whole
  registry leaks.

---

## Agent roles & tool access

| Role | Tool list (`src/domain/prompt/role-tools.ts`) | Caller |
|---|---|---|
| `SCREENER` | `SCREENER_TOOLS` (12) — deploy + discovery/enrichment | `screening/cycle.ts:167`, `requireToolOnFirstStep:true` |
| `MANAGER` | `MANAGER_TOOLS` (5) — close/claim/swap + reads | `health/cycle.ts:65` (management cycle no longer uses this — it calls `executeTool` directly since 2026-08-02) |
| `GENERAL` | `GENERAL_TOOLS` (10) | `telegram/router.ts:365`, `requireToolOnFirstStep:false` |

There is **no INTENT-pattern matcher** in the TS version — GENERAL is simply the
`GENERAL_TOOLS` list. The dashboard `/chat` surface uses a separate read-only
`CHAT_READ_TOOLS` list (`src/adapters/dashboard/allowlist.ts`) so it literally cannot
pick a write tool.

### Adding a new tool

1. **`src/app/tools/impls/<name>.ts`** — `defineTool({ name, description, args (Zod),
   result (Zod), execute, safety?, post?, oncePerSession?, noRetry? })`. The Zod
   schemas are the single source for both the OpenAI JSON-Schema contract and runtime
   validation (no drift).
2. **Register it** — add to the registry assembly (`createRegistry([...])`) so
   `ToolRegistry` knows it.
3. **Role access** — add the name to `MANAGER_TOOLS` / `SCREENER_TOOLS` /
   `GENERAL_TOOLS` in `src/domain/prompt/role-tools.ts` as appropriate.
4. **If it writes on-chain** — give it a `safety[]` gate chain + `oncePerSession`
   (+ `noRetry` for deploy-like double-spend risk), and add it to the dashboard
   `WRITE_TOOLS_DASHBOARD` allowlist (it stays behind the `/tool` confirm gate).

### Tool execution pipeline (`src/app/tools/execute.ts:32`)

`parseArgs` (JSON.parse → jsonrepair fallback) → `args.safeParse` → **safety chain**
(each `SafetyCheck` returns `null`=pass / `{reason}`=deny, runs BEFORE execute) →
`execute` (thrown errors → `execute_failed`) → `result.safeParse` → **post hooks**.
Every failure is a discriminated `ToolError`, never a throw.
- **Safety gates** (`tools/safety/*`): `poolCooldownGate`, `walletBalanceGate`,
  `maxPositionsGate` (uses `force:true`), `tokenBlacklistGate`, `deployerBlocklistGate`
  (**fails OPEN** on enrichment error; the other four fail closed).
- **Post hooks** (`tools/post/*`): `notify.*` (Telegram cards, guarded on
  `result.success`), `log-decision.*` (append to decision log — plain-English
  summary + reason since 2026-08-02, see `domain/format/decision-strings.ts`),
  `consolidate.ts` (auto-swap base → SOL after close), `track-position.ts` (upsert
  tracked position on deploy), and `mark-closed.ts` (flip repo `closed:true` on
  close — added 2026-08-02 to stop state.json ghost-open accumulation).
  **Post-hook failures are swallowed + logged, never fail the tool.**

---

## Cron & cycle architecture

Scheduled in `main()` (autonomous mode) via `createIntervalScheduler`:

| Task | Cadence | Function |
|---|---|---|
| screening | `screeningIntervalMin` | `runScreeningCycle` (`src/app/screening/cycle.ts:53`) |
| management | `managementIntervalMin` | `runManagementCycle` (`src/app/management/cycle.ts:88`) |
| pnl-poller | 30s (+15s confirm) | `createPnlPoller` (`src/app/management/pnl-poller.ts:141`) |
| health | `healthCheckIntervalMin` | `runHealthCycle` (`src/app/health/cycle.ts:24`) |
| briefing | 24h (hardcoded) | `runBriefingCycle` (`src/app/briefing/cycle.ts:16`) |
| hivemind-sync | 15m (hardcoded) | `createHiveMindSync` (`src/app/hivemind/sync.ts:38`) |

The scheduler skips overlapping ticks per label (the `_busy` guard is built in).

### Screening cycle
1. **Preflight**: wallet/positions(`force:true`)/strategy/decisions. Skip (write a
   `skip` decision) if at `maxPositions` or `wallet.sol < deployAmountSol + gasReserve`.
2. **Candidates**: `get_top_candidates` tool → discovery → `hardFilter` → `rankCandidates`.
3. **0 candidates** → `no_deploy` decision, no LLM.
4. **Diligence pre-enrichment** (added 2026-08-02): `enrichCandidates` fetches
   `rugCheck.check(mint)` + `tokenInfo.getHolders(mint, 10)` in parallel per candidate
   with a 3s per-call timeout, fails open. Result is injected as a `diligence:` line
   per candidate in `formatCandidatesBlock`. This lets Sage's autonomous cycle veto
   / override on FRESH data without racing the 90s timeout on gmgn-cli side calls.
5. **Decision** — two deciders, selected by `MERIDIAN_DECIDER`:
   - default (`loop`): SCREENER prompt + candidate block, `runAgentLoop` `maxSteps:8`,
     `requireToolOnFirstStep:true` — the local LLM must call `deploy_position` (or justify).
   - **`sage`** (Path 2): delegate to the external Sage agent via the `SageDecider` port
     (`src/ports/sage-decider.ts` + `adapters/llm/sage-decider-http.ts`). Sage reasons
     with its own memory AND deploys itself through the dashboard bridge, so it returns
     only prose — "did a deploy happen?" is answered by **position-id set diff**
     (robust to a concurrent close), not the text. A `cycle_id` is passed for
     idempotency. On transport error/timeout → **fall back to the local loop** (same
     `cycle_id`); skipped if a deploy already landed (no double-deploy). A clean Sage
     "no-deploy" is NOT a failure — never falls back on it. Full ops:
     [`deploy/SAGE-MERIDIAN-ROLLOUT.md`](deploy/SAGE-MERIDIAN-ROLLOUT.md).

### Management cycle (fully deterministic — no LLM)
1. `getMyPositions({force:true})`.
2. **Forward reconcile**: any on-chain position missing from state.json → upsert
   into tracking store (deploy_position hook missed it, or was deployed pre-fix).
3. **Reverse reconcile** (added 2026-08-02): any tracked position marked open but
   NOT in the on-chain snap → flip `closed:true, closed_at:now` and note
   "reconciled: no longer on-chain". Catches historical ghost records + external
   closes (pnl-poller direct chain call, Meteora UI, ad-hoc script). Without this,
   `buildStateSummary` reports stale open counts (e.g. dashboard summary showed
   36 records vs 0 on-chain before the fix).
4. `planForPosition` per position: deterministic close rule → else CLAIM if
   `unclaimed_fees_usd >= minClaimAmount` → else STAY.
5. If **all STAY → `{kind:"all_stay"}`**.
6. Else iterate non-STAY actions sequentially, invoke `close_position` /
   `claim_fees` **directly via `executeTool`** (safety gates + post-hooks + notify
   card + decision log + auto-swap still fire). Returns `{kind:"executed", results}`.
   No LLM: zero token cost, no latency, no once-per-session cap on closes-per-tick
   (the LLM loop's `oncePerSession` lock on `close_position` was silently capping
   this to 1 close per cycle). Removed 2026-08-02.

### PnL poller (trailing-TP two-phase confirm)
- Tick 1: a trailing drop (`peak - current >= trailingDropPct`, with
  `peak >= trailingTriggerPct`) is **queued**, not fired.
- ~15s later: re-check; fire `close_confirmed` only if the drop still holds within
  1% tolerance. **`peak_pnl_pct` is merged from the position repo** before the pure
  tick — forget it and trailing-TP silently never triggers.

---

## Position lifecycle & the 5 deterministic close rules

`getDeterministicCloseRule` (`src/domain/rules/close-rules.ts:39`):
1. **Stop loss** — `pnl_pct <= stopLossPct`
2. **Take profit** — `pnl_pct >= takeProfitPct`
3. **Pumped above range** — `active_bin > upper_bin + outOfRangeBinsToClose`
4. **OOR wait** — `active_bin > upper_bin && minutes_out_of_range >= outOfRangeWaitMinutes`
5. **Low yield** — `fee_per_tvl_24h < minFeePerTvl24h && age_minutes >= 60`

Rules 1 & 2 are suppressed when PnL is suspect (`isPnlSuspect`); range rules (3-4)
fire regardless. On close, `post/log-decision` records it and `post/notify` sends the
Telegram card. Cooldowns live in `pool-memory` + `rules/cooldown.ts`.

---

## Persistent files (JSON at `STATE_DIR`, atomic writes)

| File | Repo | Owns |
|---|---|---|
| `state.json` | position-repo | tracked positions + recent-events ring (capped 20) |
| `pool-memory.json` | pool-memory-repo | per-pool deploy history, win rates, cooldowns |
| `lessons.json` | lesson-repo | lessons + performance records |
| `decision-log.json` | decision-log | rolling 100 decisions (deploy/close/skip/no_deploy/note) |
| `strategy-library.json` | strategy-repo | saved strategies + active pointer |
| `smart-wallets.json` | smart-wallet-repo | tracked KOL/alpha wallets (type lp\|holder) |
| `token-blacklist.json` | token-blacklist-repo | mint → reason |
| `dev-blocklist.json` | dev-blocklist-repo | deployer wallet → reason |
| `user-config.json` | config-repo | the live config (loaded → nested `AppConfig`) |

All writes are temp-file + fsync + atomic rename. Config redaction (`*key/token/secret*`)
happens when a file is served over the bridge. In production these live on the
`/opt/data` volume (`MERIDIAN_STATE_DIR=/opt/data`) — see `deploy/OPERATIONS.md`.

---

## Config system

`user-config.json` (flat on disk) → `parseAppConfig` (`src/domain/config-load.ts`):
- `FlatUserConfigSchema` (`schemas/config-flat.ts`, `.passthrough()` so unknown keys
  survive) → `flatToNested` → `AppConfigSchema` (`schemas/config.ts`, 13 subsections:
  `risk, management, strategy, schedule, screening, llm, darwin, hiveMind, api, jupiter,
  indicators, tokens, pnl`). Returns a `Result` — never throws.
- **`strategy` enum = `spot | curve | bid_ask` only (no `auto`).** A config with
  `strategy:"auto"` fails validation → if a caller throws on that Result, the daemon
  crash-loops. Model fields must be exact provider slugs (e.g. `minimax/minimax-m2.7`).
- `bins*` fields hard-floor at `MIN_SAFE_BINS_BELOW` (35). `pnl.source` = `rpc|meteora`
  (default rpc, `pnlRpcUrl` default `https://pump.helius-rpc.com`).
- `update_config` writes back via `nestedToFlat` merged with the original flat
  (its doc comment is stale — trust the code).

---

## Environment variables

| Var | Role |
|---|---|
| `WALLET_PRIVATE_KEY` | base58 or JSON byte-array (NOT base64). Required for meteora. |
| `RPC_URL` | Solana RPC. Required for meteora. Wallet balance = `getBalance` on this. |
| `OPENROUTER_API_KEY` (or `LLM_API_KEY`) | LLM. `LLM_BASE_URL` overrides endpoint. |
| **`MERIDIAN_CHAIN`** | `meteora` selects the real chain (+ cascades market=real, price=jupiter). Default `dryrun`. |
| **`MERIDIAN_WRITE_UNSAFE`** | `true` arms real writes. Without it, write paths throw. |
| `MERIDIAN_MARKET` / `MERIDIAN_PRICE` | override the cascade (`real`/`fake`, `jupiter`/`static`). |
| `MERIDIAN_AUTONOMOUS` | `true` = resident daemon; else one-shot. |
| `MERIDIAN_STATE_DIR` | where JSON state lives (default cwd). |
| `MERIDIAN_DEMO` | `true` forces the fake LLM. |
| `DASHBOARD_ENABLED` / `DASHBOARD_PORT` / `DASHBOARD_TOKEN` | bridge on/off, port (8787), Bearer token. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `TELEGRAM_ALLOWED_USER_IDS` | ops surface + auth. In production (since 2026-08-02) `TELEGRAM_BOT_TOKEN` is Sage's bot token — Meridian and Hermes share the same bot identity (@SageHermesAnd_bot); Meridian only writes, Hermes handles inbound. |
| `MERIDIAN_TELEGRAM_INBOUND` | **must be `false` in production** — two processes polling the shared token = `getUpdates` 409. Set as compose default. |
| **`MERIDIAN_DECIDER`** | `sage` → screening delegates the deploy decision to Sage (Path 2); anything else / unset = local LLM loop. **Compose default is `sage` since 2026-08-02.** |
| `SAGE_BASE_URL` / `SAGE_API_KEY` / `SAGE_SESSION_KEY` / `SAGE_TIMEOUT_MS` | Sage endpoint (Hermes api), memory-scope header, delegation timeout (default 90s). Only read when `MERIDIAN_DECIDER=sage`. On vivobook production the URL is intra-host: `http://host.docker.internal:8643` (see `docker-compose.yml` `extra_hosts`). |
| `SAGE_CF_ACCESS_CLIENT_ID` / `SAGE_CF_ACCESS_CLIENT_SECRET` | **Historical** — CF Access service-token headers used when Sage was fronted by Cloudflare Access (pre-2026-08-01 Tencent era). Intra-host path drops them; the code still reads them if set. |
| `SOL_PRICE_USD` | static-price fallback (default 150). |
| `DRY_RUN` | **surfaced only as a HiveMind capability flag — NOT a gating var in the TS code.** |

> The old JS-era `DRY_RUN`-as-master-switch is gone. The gates are `MERIDIAN_CHAIN`
> + `MERIDIAN_WRITE_UNSAFE`. Production sets these in `docker-compose.yml`, not `.env`.

---

## Dashboard bridge (`src/adapters/dashboard/`)

A `node:http` server (zero external deps) bound to **`127.0.0.1` only** (never
`0.0.0.0`), token-authed. Started from `daemon.ts` when `DASHBOARD_ENABLED=true`.
- Routes: `GET /health`, `/state/positions` (`?force=1` throttled 1×/10s),
  `/state/summary`, `/state/file/:name` (whitelisted, `user-config` redacted; the
  `user-config` case reads via `ctx.configPath`, NOT `stateDir` — fixed 2026-08-02
  after the empty-stub-at-stateDir 404 bug), `/events` (SSE — piggybacks the
  PnL-poller cache, **no new RPC**), `POST /tool` (allowlist + write `confirm:true`
  + in-flight lock + optional `cycle_id` idempotency + human-gate on `update_config`),
  `POST /chat` (GENERAL tick, read-only via `CHAT_READ_TOOLS`).
- **`update_config` human-gate**: `POST /tool` with `name=update_config` AND a
  `cycle_id` returns 403 (`human-gated; not permitted inside a delegation cycle`).
  Only autonomous screening delegations attach `cycle_id`, so this hard-blocks
  Sage (or any Path 2 delegate) from patching config mid-cycle. User chats never
  carry a `cycle_id` → allowed. This is code-enforced, not prompt-enforced.
- **`cycle_id` idempotency** (`dashboard/idempotency.ts`): a write carrying a `cycle_id`
  commits the key on success; a later write with the same key → 409. Guards the Path 2
  delegate→timeout→fallback double-deploy on the bridge path (the bridge bypasses the
  agent once-per-session lock — see `inflight.ts`). Path 2's Sage deploys go through
  this `/tool` path, so all safety gates + post-hooks + the card notification still fire.
- **The Next.js web app** (`dashboard/web/`) is the only public surface. It talks to
  the bridge server-side only (token never reaches the browser) via same-origin
  `/api/*` proxies. PIN auth: `middleware.ts` (iron-session cookie) + `lib/auth-core.ts`
  (scrypt + constant-time + rate-limit). Deployment/auth details → `deploy/OPERATIONS.md`.

---

## Telegram ops surface (`src/app/telegram/router.ts`)

`routeTelegramMessage` dispatches: read-only `/help /status /wallet /positions /briefing`;
cron control `/pause /resume /stop` (need `scheduler`/`shutdown` deps); write commands
`/close <n> /closeall /deploy <pool> [sol]` (gated on `deps.writesEnabled`). Free-form
text → GENERAL agent tick (`GENERAL_TOOLS`, `maxSteps:8`). **Auth (chat-id / user
allowlist) is upstream** (the inbound adapter), not in the router.

**Notify-only mode (production default)**: with `MERIDIAN_TELEGRAM_INBOUND=false` the
daemon never starts the inbound REPL — only posts outbound deploy/close cards. Since
2026-08-02 the token itself is Sage's (@SageHermesAnd_bot), so those cards appear from
the same bot that replies to you conversationally. Hermes is the sole `getUpdates` poller
on the shared token — flipping inbound back on would cause a 409 Conflict. Calisto bot
retired; env backups on the host at `~/meridian/.env.bak-sagebot-*`. See
[`deploy/SAGE-MERIDIAN-ROLLOUT.md`](deploy/SAGE-MERIDIAN-ROLLOUT.md).

---

## Known issues / gotchas (verified against the code)

- **`DRY_RUN` is not a gate** in TS — only `MERIDIAN_CHAIN` + `MERIDIAN_WRITE_UNSAFE`.
- **Config path vs web read-path divergence**: the daemon loads config from cwd
  (`/app/user-config.json`), but the web container reads `MERIDIAN_ROOT=/opt/data`.
  `docker-compose.yml` bind-mounts the same host config file into the web container
  at `/opt/data/user-config.json` (ro) so the Config page isn't blank — keep that
  mount in sync if either path moves.
- **Provider fallback / system-role / tool-choice retry are decorators, not wired by
  default** — `daemon.ts` uses `createOpenRouterLLMClient` directly. Wrap it if you need resilience.
- **`role` is label-only**; the `activeRegistry` ternary in the loop is a dead no-op —
  tool scoping happens through `toolFilter`/schema emission.
- **Config vs state root can diverge** (config uses cwd, repos use `MERIDIAN_STATE_DIR`).
- **`FILE_WHITELIST` + redaction are duplicated** in the bridge (`allowlist.ts`/`redact.ts`)
  and the web fs path (`dashboard/web/lib/files.ts`) — keep them in sync.
- **`patch-anchor.js` (postinstall) is mandatory on Node 22** or `@meteora-ag/dlmm`
  fails to load (anchor ESM directory-import + `BN` export). See `deploy/OPERATIONS.md`.
- **Jupiter Price v6 is sunset** — code uses `lite-api.jup.ag/price/v3`; swap uses v6.
- **Deploys are single-side SOL only** (`planDeploy` throws otherwise); wide-range (>69
  bins) is multi-tx with different slippage units per path.
- **No `signal-weights` repo, no bin-array rent assert** (named in the legacy doc; never
  ported to TS).

---

## Patterns to copy

- **New on-chain read** → copy the cache + inflight-dedup + `force` pattern from
  `chain/meteora/client.ts` `getMyPositions`. `force:true` is what safety gates rely on.
- **New persistent store** → copy a repo from `persistence/json/` (factory over a file
  path, `writeJsonAtomic`, Zod-validated read, `Result` return). Cap any growing array.
- **New tool** → `defineTool` with Zod args/result + safety gates + post hooks; never
  throw, return `ToolError`.
- **New scheduled work** → `scheduler.every(ms, job, label)` (overlap-skip is built in);
  add teardown to the shutdown sequence in `daemon.ts`.
- **New pre-LLM enrichment** → cheap checks first (in-memory/file), then network, each
  pass/reject logged with a stage name (see `rules/screening.ts` `hardFilter`).

---

## What to read next

- Add a tool → `src/app/tools/impls/`, `tools/registry.ts`, `domain/prompt/role-tools.ts`.
- Change safety/exit rules → `src/domain/rules/close-rules.ts` + `tools/safety/*`.
- Change the LLM contract → `src/app/agent/loop.ts` + `domain/prompt/builder.ts`.
- Change deploy/close on-chain behavior → `src/adapters/chain/meteora/write-paths.ts` +
  `client.ts` (post-tool side-effects are in `tools/post/*`).
- Config schema → `src/domain/schemas/config*.ts` + `config-load.ts`.
- Dashboard/bridge → `src/adapters/dashboard/` + `dashboard/web/`.
- **Deployment / ops / secrets / troubleshooting → [`deploy/OPERATIONS.md`](deploy/OPERATIONS.md).**
