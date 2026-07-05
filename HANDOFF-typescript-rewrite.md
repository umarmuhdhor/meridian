# Meridian TS Rewrite — Session Handoff

**Status:** Phase 9 complete. 196 tests green. Autonomous daemon runs against DryRun chain; Meteora chain read paths gated behind env flag; write paths deliberately stubbed until Phase 10.

**Branch:** `rewrite-ts` (see [DESIGN-typescript-rewrite.md](DESIGN-typescript-rewrite.md) for the original plan)

**Start here in next session:** Read this file top to bottom, then jump to [§ Next session — pick one](#next-session--pick-one).

---

## TL;DR for the next session

- Legacy JS in repo root (`index.js`, `agent.js`, `tools/`, `state.js`, etc.) is UNCHANGED. Both toolchains coexist. Nothing risky has been swapped yet.
- TS lives entirely under `src/`. Tests under `tests/`. Build → `dist/`.
- `npm start` still runs the JS daemon (safe default). TS runs via `node dist/entrypoints/daemon.js`.
- Real chain writes (deploy/close/claim) throw `MeteoraWritePathNotPortedError` — no risk of accidental real-money moves.

**Commands you'll actually type:**

```bash
npm run typecheck    # strict tsc
npm run test:unit    # 196 vitest tests
npm run build        # → dist/
node dist/entrypoints/daemon.js                                      # one-shot dryrun
MERIDIAN_DEMO=true node dist/entrypoints/daemon.js                   # fake LLM one-shot
MERIDIAN_AUTONOMOUS=true MERIDIAN_DEMO=true node dist/entrypoints/daemon.js  # cron loop
MERIDIAN_STATE_DIR=/tmp/meridian-demo ...                            # isolate JSON writes
MERIDIAN_FROZEN_TIME=2026-07-05T12:00:00.000Z ...                    # deterministic time
MERIDIAN_CHAIN=meteora RPC_URL=... WALLET_PRIVATE_KEY=... ...        # real chain (read-only)
```

**Key rule:** don't add SDK imports outside `src/adapters/chain/meteora/`. Every other file must stay SDK-free.

---

## Progress by phase

| Phase | Scope | Status | Tests | Highlights |
|---|---|---|---|---|
| **0** | Toolchain (tsc, vitest, zod) | ✅ | 6 smoke | `strict: true, noUncheckedIndexedAccess, exactOptionalPropertyTypes` |
| **1** | Pure domain (rules, schemas) | ✅ | +44 | close-rules, exit-signals, cooldown, pnl, scoring, Zod schemas |
| **2** | Ports + JSON adapters (state/pool-memory/config) | ✅ | +22 | atomic write, load-time Zod validate, flat→nested config |
| **3** | Tool registry + Zod-driven schema gen | ✅ | +23 | `defineTool`, `executeTool`, `generateOpenAiToolSchemas`, first 2 tools |
| **4** | Chain / LLM / notify / swap ports + DryRun + cache | ✅ | +17 | `ChainClient`, `LLMClient`, `Notifier`, `TtlCache` w/ inflight dedup, `DryRunChainClient` |
| **5** | Agent loop + session locks + OpenRouter | ✅ | +15 | `runAgentLoop`, ReAct, `oncePerSession`/`noRetry`, FakeLLM |
| **6** | 5 more repos + prompt builder + 12 tools + post-hooks | ✅ | +18 | lessons/decisions/strategies/smart-wallets/blacklist, `PostHook`, 14 tools total |
| **7** | Market clients + pure screening pipeline + 6 tools | ✅ | +26 | `PoolDiscoveryClient`, `TokenInfoClient`, `RugCheckClient`, `hardFilter`, `get_top_candidates`, 20 tools total |
| **8** | Scheduler + screening/management orchestrators | ✅ | +17 | `IntervalScheduler`, `ManualScheduler`, `runScreeningCycle`, `runManagementCycle`, `MERIDIAN_AUTONOMOUS=true` |
| **9** | Meteora chain adapter — read paths | ✅ | +8 | `SolanaConnection`, `WalletKeypair`, `createMeteoraChainClient` (balance/activeBin/positions), write paths gated |

**Totals:** ~6,900 LOC TS, **196 tests, 30 files**, 20 tools, 19 ports, 2 chain adapters (DryRun + Meteora-read).

---

## Directory map (current)

```
src/
  domain/                                  # PURE — no I/O, no external imports
    schemas/                               # Zod = source of truth
      config.ts, config-flat.ts            # AppConfig + flat user-config shape
      position.ts, state.ts, pool-memory.ts
      lesson.ts, decision.ts, strategy.ts, smart-wallet.ts, blacklist.ts
      chain.ts, market.ts                  # ActiveBin, DeployArgs, CandidatePool, TokenInfo, ...
    rules/
      close-rules.ts                       # 5 hard rules (index.js:900)
      exit-signals.ts                      # STOP_LOSS/TRAILING_TP/OOR/LOW_YIELD (state.js)
      cooldown.ts                          # pool + base-mint cooldown checks
      pnl.ts                               # assessPnl + roundNum
      scoring.ts                           # scoreCandidate formula
      screening.ts                         # hardFilter + rankCandidates + summarizeRejections
    prompt/
      builder.ts                           # buildSystemPrompt(role, ctx)
      role-tools.ts                        # SCREENER_TOOLS / MANAGER_TOOLS / GENERAL_TOOLS
    config-load.ts                         # flat→nested pipeline

  ports/                                   # Interfaces only — no impls
    clock.ts, logger.ts
    position-repo.ts, pool-memory-repo.ts, config-repo.ts
    lesson-repo.ts, decision-log.ts, strategy-repo.ts, smart-wallet-repo.ts, token-blacklist-repo.ts
    chain-client.ts, swap-client.ts, llm-client.ts, notifier.ts
    pool-discovery.ts, token-info-client.ts, rug-check.ts, smart-wallet-checker.ts
    price-oracle.ts, solana.ts, scheduler.ts

  adapters/                                # Concrete impls behind ports
    logger/console.ts
    persistence/json/                      # atomic write + Zod validate on load
      atomic-write.ts, position-repo.ts, pool-memory-repo.ts, config-repo.ts,
      lesson-repo.ts, decision-log.ts, strategy-repo.ts, smart-wallet-repo.ts, token-blacklist-repo.ts
    chain/
      dry-run.ts                           # deterministic, in-memory
      meteora/                             # real Meteora SDK (LAZY import)
        connection.ts                      # createSolanaConnection + loadWalletKeypair + lamportsToSol
        client.ts                          # createMeteoraChainClient (read only)
    llm/
      openrouter.ts                        # thin wrap over openai npm
      fake.ts                              # scripted for tests
    notify/
      null-notifier.ts, collecting-notifier.ts   # real Telegram deferred
    market/
      fake-pool-discovery.ts, fake-token-info.ts, fake-rug-check.ts, fake-smart-wallet-checker.ts
      static-price-oracle.ts
    scheduler/
      interval.ts, manual.ts

  shared/
    result.ts                              # Result<T, E>
    cache.ts                               # TtlCache with inflight dedup

  app/
    tools/
      context.ts                           # AppContext = clock+logger+config+chain+swap+notifier+market+repos
      types.ts, define-tool.ts, registry.ts, execute.ts
      generate-openai-schemas.ts           # Zod → OpenAI tool schemas (replaces definitions.js)
      safety/
        pool-cooldown.ts, wallet-balance.ts, max-positions.ts, token-blacklist.ts
      post/
        log-decision.ts, notify.ts
      impls/                               # 20 tools — one file per tool
        # reads
        get-pool-memory.ts, get-wallet-balance.ts, get-active-bin.ts, get-my-positions.ts,
        get-recent-decisions.ts, list-blacklist.ts, list-smart-wallets.ts, get-active-strategy.ts,
        # writes
        assert-pool-deployable.ts, deploy-position.ts, close-position.ts, claim-fees.ts, swap-token.ts,
        add-to-blacklist.ts,
        # screening
        search-pools.ts, get-token-info.ts, get-token-holders.ts, get-token-narrative.ts,
        check-smart-wallets-on-pool.ts, get-top-candidates.ts
    agent/
      loop.ts                              # runAgentLoop (ReAct v1)
      session-locks.ts                     # oncePerSession + noRetry
    screening/cycle.ts                     # runScreeningCycle
    management/cycle.ts                    # runManagementCycle + planForPosition

  entrypoints/
    daemon.ts                              # composition root — 240 LOC

tests/
  unit/       (~24 files)
  integration/ (7 files — real JSON I/O in tmp dirs)
```

---

## Env vars daemon reads

| Var | Values | Purpose |
|---|---|---|
| `MERIDIAN_CHAIN` | `dryrun` (default) / `meteora` | Which chain adapter. Meteora requires RPC + wallet. |
| `MERIDIAN_DEMO` | `true` / unset | Force FakeLLM script (no OpenRouter key needed). |
| `MERIDIAN_AUTONOMOUS` | `true` / unset | Start cron scheduler (screening + management). |
| `MERIDIAN_ROLE` | `SCREENER` / `GENERAL` | Currently only affects the *pre-cycle* one-shot demo. |
| `MERIDIAN_STATE_DIR` | absolute path | Where JSON stores live. Defaults to `process.cwd()`. Use `/tmp/meridian-demo` for isolated runs. |
| `MERIDIAN_FROZEN_TIME` | ISO string | Freeze the clock — deterministic runs for demo/debug. |
| `RPC_URL` | Solana RPC | Required when `MERIDIAN_CHAIN=meteora`. |
| `WALLET_PRIVATE_KEY` | base58 or JSON array | Required when `MERIDIAN_CHAIN=meteora`. Never logged. |
| `SOL_PRICE_USD` | number (default 150) | Static price used by Meteora read path until Jupiter oracle lands. |
| `OPENROUTER_API_KEY` | key | Enables real LLM (skipped when `MERIDIAN_DEMO=true`). |
| `LLM_BASE_URL` | override | Any OpenAI-compat endpoint (LM Studio etc). |
| `LLM_MODEL` | slug | Model id passed to the LLM. |

Fail-loud checks: `MERIDIAN_CHAIN=meteora` without `RPC_URL` OR `WALLET_PRIVATE_KEY` → boot exits with a clear error.

---

## Key design decisions (don't re-litigate)

1. **Hexagonal-lite + functional core.** Domain (pure) / ports (interfaces) / adapters (impls) / app (services) / entrypoints (composition). No DDD ceremony.
2. **Zod = one source of truth.** Every schema powers TS types + runtime validation + OpenAI tool-schema JSON. Kills the `definitions.js` drift bug.
3. **Tool registry replaces `toolMap` + `definitions.js` + `runSafetyChecks`.** One file per tool: `{name, args, result, safety[], post[], execute}`. Executor is thin (validate → safety → run → validate result → post-hooks).
4. **Post-hooks are the notify/log-decision layer.** Tools don't know about Telegram or the decision log. Executor runs `post[]` after successful result validation. Hook errors log-and-continue, never fail the tool.
5. **Session locks live in agent-loop, not executor.** `oncePerSession` locks on success only; `noRetry` locks on first attempt regardless. Enforced *before* the executor sees the call.
6. **DryRun ChainClient is the target contract.** The real Meteora adapter must produce identical shapes. Every tool test today runs against DryRun; when Meteora write paths land, the same tests re-run against Meteora with recorded RPC.
7. **Lazy CJS import for `@meteora-ag/dlmm`.** Never eager. Isolated to `src/adapters/chain/meteora/client.ts` — the rest of the codebase is SDK-free.
8. **Clock injected everywhere.** No `Date.now()` in domain/app layers. `Clock` port + `fixedClock` for tests. `MERIDIAN_FROZEN_TIME` for reproducible demo boots.
9. **`TtlCache` primitive is shared.** Same object used by DryRun's positions cache and by the Meteora adapter. Inflight dedup proven correct with 5 tests once, used everywhere.
10. **Real writes gated by a typed error class.** `MeteoraWritePathNotPortedError` — tests assert with `.toBeInstanceOf`, error message points at `MERIDIAN_CHAIN=dryrun` escape.

---

## Known gotchas that already bit us (don't repeat)

- **`z.ZodType<T>` binds `T` to input; `.default()` makes fields optional in output.** Use `<S extends z.ZodTypeAny>` + `z.output<S>` on generic helpers. See `readJsonValidated`.
- **`exactOptionalPropertyTypes: true`** rejects `.optional()` producing `T | undefined` where the target is `T | null`. Widen target types to `T | null | undefined` in safety/hook argument shapes.
- **Registry input widened to `RegistrableTool`** at the boundary to avoid generic-variance friction. Storage is opaque; `defineTool` preserves inference at the source.
- **Discriminated union return values need `as const` on the literal discriminant.** `{ known: false as const, ... }`. Otherwise TS widens `false → boolean` and the union match fails.
- **Zod `.default({})` returns the same object reference** — do NOT shallow-spread it. Use a factory (`emptyState()`) that returns a fresh instance.
- **OpenAI SDK + strict TS:** don't spread conditional `tool_choice` into a call. Build the request as a typed variable and conditionally assign fields.
- **Fake LLM script exhaustion throws** — always end script with an `assistant` step, or the loop hangs at the LLM boundary.
- **Reminder-mode flag, not step-count.** Agent loop `requireToolOnFirstStep` uses a `reminderPending` boolean; do NOT key on `step === 0` (that check misfires after the reminder push).
- **`MeteoraChainClient` returns `pnl_pct_suspicious: true` today.** By design — real PnL derive lands with the Jupiter price adapter. Any test asserting a numeric `pnl_pct` from Meteora will fail until then.

---

## What's NOT ported yet (in priority order)

| Ticket | Rough scope | Blocked-by |
|---|---|---|
| **Meteora WRITE paths** | `deployPosition` (standard + wide-range >69 bins), `closePosition`, `claimFees`. Real SDK calls. Needs devnet target. | — |
| Real Jupiter price oracle | `PriceOracle` adapter — replaces `StaticPriceOracle`. Also enables `pnl_pct` derive. | — |
| Real Jupiter swap adapter | `SwapClient` port already sealed. Small file. | — |
| Real Telegram notifier | `Notifier` port sealed. Auth + long-poll + live-message. | — |
| Real market network adapters | Helius / Jupiter datapi / rugcheck / agent-meridian. Fakes in place; ports sealed. | — |
| Provider fallback + system-role fallback + `tool_choice` retry | Wrap `LLMClient` as decorators — `withProviderFallback(llm, [primary, secondary])`. | — |
| PnL 15s trailing-TP two-phase confirm | Currently rolled into management cycle. Extract as `pnl-poller` running every 30s. | Real chain writes — otherwise nothing to trail |
| Briefing + health-check crons | Daily HTML briefing (1:00 UTC), hourly health check. | Real chain writes |
| HiveMind push/pull sync | Fire-and-forget push to Agent Meridian; injection into prompt via `getSharedLessonsForPrompt`. | Real market clients (they hit the same API) |
| Full config schema | `screening` + `llm` + `darwin` + `hiveMind` + `api` + `jupiter` + `indicators` sections. Currently only `risk/management/strategy/schedule` in `AppConfigSchema`. | — |
| Discord listener port | Standalone subproject — leave alone until everything else lands. | — |
| Kill `index.js` | Only after every above ✅. Then DRY_RUN parallel for 24h against prod. | Everything |

---

## Next session — pick one

### Recommended: Real Jupiter price oracle + swap adapter (2–3 hours)

**Why:** unblocks PnL derive in the Meteora read layer (replaces `pnl_pct_suspicious: true`), and swap is required before any auto-swap-on-close can work. Both are network-only, no state mutation, low risk.

**Plan:**
1. `src/adapters/market/jupiter-price-oracle.ts` — fetches SOL/USD from Jupiter Price API v6. TTL cache 30s.
2. `src/adapters/swap/jupiter-swap.ts` — implements `SwapClient`. Quote → swap tx → sign + send via wallet.
3. Add real PnL derive to `src/adapters/chain/meteora/client.ts` — populate `pnl_pct`, `pnl_pct_suspicious: false` when both reported + derived priced (mirror `tools/dlmm.js:1219–1242` via new pure `assessPnl` from Phase 1).
4. Daemon wires: `MERIDIAN_PRICE=jupiter | static` env, default jupiter when `MERIDIAN_CHAIN=meteora`.
5. Tests: mock the fetch layer, assert TTL + retry + fallback shape.

### Alternative: Meteora WRITE paths (Phase 10 — biggest single ticket, ~4–6 hours)

**Why:** the last real-money gate. Deploy/close/claim. Once done, the TS daemon can trade.

**Plan:**
1. Port `deployPosition` standard-range path — `initializePositionAndAddLiquidityByStrategy`. Include the pool-detail fresh fetch safety check + bin-array init rent check (see `tools/dlmm.js:452–890`).
2. Port `deployPosition` wide-range path — `createExtendedEmptyPosition` + `addLiquidityByStrategyChunkable` for `totalBins > 69`.
3. Port `closePosition` — `removeLiquidityByRange` + close position.
4. Port `claimFees` — `claimAllRewards` (also called `claimSwapFee` in some SDK versions; check current shape).
5. All three must produce `dry_run: false` results matching the schema in `src/domain/schemas/chain.ts`.
6. Test via **devnet** (grab a devnet Meteora pool) OR by recording RPC responses and replaying.
7. Behavioral parity: run the existing screening + management cycle tests once against Meteora, assert identical outcomes.

**DO NOT** ship this to production without: (a) devnet dry run, (b) DRY_RUN parallel run for 24h, (c) explicit user sign-off. The design doc §5 Phase 6 flow applies.

### Alternative: Real Telegram notifier (2 hours)

**Why:** unlocks real ops visibility. Notify port sealed; drop-in.

**Plan:**
1. Port `telegram.js` under `src/adapters/notify/telegram.ts`.
2. `startPolling(onMessage)` + `createLiveMessage` (in-place edits) + auth guard.
3. Env: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` + `TELEGRAM_ALLOWED_USER_IDS`.
4. Fall back to `nullNotifier` if unconfigured (already the default).

---

## Rules for the next session

- **Don't touch legacy JS.** `index.js`, `agent.js`, `tools/`, `state.js`, etc. are the safety net.
- **Never bypass the port layer.** SDK/network calls belong in `src/adapters/`. Anything else importing `@meteora-ag/dlmm` or `@solana/web3.js` outside `src/adapters/chain/meteora/` is a code-review reject.
- **Zod schema first, always.** New types = new schema. No `interface` at the boundary if the value crosses I/O or LLM.
- **Every tool file end with `.ts`, exports one `defineTool({...})` call.** Copy an existing tool (`get-wallet-balance.ts` is the smallest) as the template.
- **Post-hooks are the way to add side effects.** Do NOT put notify/decision-log calls inside `execute`. Add them to `post: [...]`.
- **Safety checks are the way to block calls.** Do NOT put balance / cooldown / blacklist checks inside `execute`. Add them to `safety: [...]`.
- **Test the tool AND the pipeline.** Tools get unit tests (via `executeTool` + `makeCtx`). Pipelines get their own tests (see `screening-cycle.test.ts` / `management-cycle.test.ts`).
- **Preserve the frozen-clock invariant.** Any new code that reads time must accept a `Clock` port. Never call `new Date()` outside adapters that need a real clock (logger, `createSolanaConnection`).
- **Fail loud at boot.** Missing env / missing config → `throw` before serving any request. See daemon's chain-mode gate.

---

## Test-and-run sanity check for the next session

Before writing any new code, run these — they should all be green:

```bash
npm run typecheck
# > tsc -p tsconfig.test.json --noEmit
# (no output = clean)

npm run test:unit
# > vitest run
# Test Files  30 passed (30)
#      Tests  196 passed (196)

npm run build
# > tsc -p tsconfig.json
# (no output = clean, dist/ updated)

# One-shot dryrun demo — should end with "outcome: invoked"
rm -rf /tmp/meridian-demo && mkdir -p /tmp/meridian-demo
MERIDIAN_DEMO=true \
  MERIDIAN_STATE_DIR=/tmp/meridian-demo \
  MERIDIAN_FROZEN_TIME=2026-07-05T12:00:00.000Z \
  node dist/entrypoints/daemon.js

# Meteora mode without RPC — should FAIL loud
MERIDIAN_CHAIN=meteora node dist/entrypoints/daemon.js
# Expected: boot failed: Error: MERIDIAN_CHAIN=meteora requires RPC_URL
```

If any of these break, DO NOT proceed with new work — fix the regression first.

---

## Files to read first in the next session

Priority order:

1. **This file** ([HANDOFF-typescript-rewrite.md](HANDOFF-typescript-rewrite.md)) — you're reading it.
2. [DESIGN-typescript-rewrite.md](DESIGN-typescript-rewrite.md) — the original architecture decisions.
3. [CLAUDE.md](CLAUDE.md) — the engineering manual for the codebase.
4. Whichever tool file is closest to what you're about to port. `get-wallet-balance.ts` for reads, `deploy-position.ts` for writes.
5. `src/entrypoints/daemon.ts` — the composition root; see how everything wires up.

---

## Contact points (in the code, not people)

- **Where post-hooks fire:** `src/app/tools/execute.ts:78` (after result validation).
- **Where session locks are enforced:** `src/app/agent/loop.ts:runOneToolCall` (checked BEFORE executor).
- **Where the LLM never fires:** `src/app/management/cycle.ts:runManagementCycle` — `all_stay` short-circuit.
- **Where DryRun cache is invalidated:** `src/adapters/chain/dry-run.ts:setState` + after every deploy/close/claim.
- **Where Meteora SDK is imported:** `src/adapters/chain/meteora/client.ts:loadDlmmSdk` — the ONLY place.
- **Where deploy safety chain lives:** `src/app/tools/impls/deploy-position.ts:safety` — 4 gates, order matters (cooldown first, blacklist, balance, max positions).

---

Good luck.
