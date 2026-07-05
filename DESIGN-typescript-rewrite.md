# Meridian → TypeScript Rewrite — Design Doc

**Status:** Draft • **Author:** office-hours session • **Date:** 2026-07-05
**Scope:** Migrate 14.6k LOC ESM/JS autonomous DLMM agent to strict TypeScript. Improve maintainability + hot-path speed. Preserve runtime behavior.

---

## 1. Problem statement

Meridian is a working autonomous LP agent moving real SOL on Solana. Structural drag:

- `index.js` = **2,032 LOC god file** (cron + REPL + Telegram + PnL poller + close rules + settings menu).
- `tools/dlmm.js` = **2,087 LOC** SDK wrapper (deploy + close + claim + cache + relay + wide-range paths in one file).
- `tools/executor.js` = **909 LOC** switch-like tool dispatcher that also knows about Telegram, pool-memory, lessons, auto-swap.
- `tools/definitions.js` = **1,124 LOC** OpenAI JSON schemas hand-maintained separately from tool impls → **schema drift** every time a tool changes.
- **11 JSON state files** at repo root, hand-serialized load-full/save-full, no atomic writes, no schema validation.
- `user-config.json` is a **flat bag** whose keys must match a 50+ entry `CONFIG_MAP` in executor.js — drift silently returns `unknown: [...]`.
- No types → runtime `TypeError`s, silent NaN in PnL math, prompt template drift.
- Test suite is thin (`test/` = syntax checks).

The system works but every change is dangerous. Goal: **rewrite to TS with types as the source of truth**, so the compiler catches config/tool/state drift before deploy.

## 2. Non-goals

- Behavioral changes to trading logic (deterministic rules, cooldowns, trailing-TP recheck) — same math, same thresholds.
- Swapping the LLM protocol, Meteora SDK, or on-chain wallet flow.
- Migrating off Node 22 or off JSON persistence in phase 1.
- Rewriting the Discord selfbot subproject (leave standalone).

## 3. Premises (agree before proceeding)

1. **Types-as-truth beats layered abstraction.** Cleanest win = one Zod schema per artifact (config, state, tool args/results) that generates TS types AND the LLM JSON schemas. Kills the biggest drift bug for free.
2. **Strangler > big bang.** ~15k LOC of live-money code cannot be safely rewritten in a single PR. Migrate module-by-module behind `allowJs`, keep both toolchains until the last file flips.
3. **Node 22 + `tsx`/`tsc`, not Bun.** `@meteora-ag/dlmm` already needs a CJS-load workaround and a `patch-anchor.js` postinstall. Bun's Node compat is close but not guaranteed here — the on-chain path is not the place to discover an edge case. Revisit later.
4. **Hexagonal-lite, not full DDD.** Domain (pure logic) and infrastructure (RPC/LLM/FS/Telegram) split via a thin ports layer. No repositories-of-aggregates ceremony. A `PositionRepo` interface + JSON impl is enough.
5. **Keep JSON persistence in phase 1.** Swap to SQLite (`better-sqlite3`, WAL) in phase 2 behind the same repo interface. Migration is a one-shot script.
6. **Feature freeze during cutover.** No new tools / rules / prompts during migration weeks. Otherwise merge conflicts kill morale.

---

## 4. Chosen architecture — Hexagonal-lite + Functional Core

Layers (top depends on bottom, never sideways):

```
   ┌──────────────────────────────────────────────────────┐
   │ entrypoints/    daemon.ts  cli.ts  setup.ts          │  ← composition root
   ├──────────────────────────────────────────────────────┤
   │ app/            services/   orchestration            │  ← screening/management/agent
   │                 scheduler/  telegram-bridge/         │
   ├──────────────────────────────────────────────────────┤
   │ domain/         pure logic — no I/O                  │  ← rules, scoring, cooldowns
   │                 schemas/ (Zod) — SOURCE OF TRUTH     │
   ├──────────────────────────────────────────────────────┤
   │ ports/          interfaces                           │  ← PositionRepo, LLMClient,
   │                                                      │    ChainClient, Notifier, Clock
   ├──────────────────────────────────────────────────────┤
   │ adapters/       impls                                │  ← json-repos/, meteora/,
   │                                                      │    openrouter/, telegram/
   └──────────────────────────────────────────────────────┘
```

### 4.1 Directory layout

```
src/
  domain/
    schemas/                   # Zod — types + JSON schemas from same source
      config.ts                # Config schema (nested, not flat) → replaces user-config CONFIG_MAP
      position.ts              # TrackedPosition, PositionSnapshot
      pool-memory.ts           # PoolMemoryEntry, PoolSnapshot
      lesson.ts                # Lesson, PerformanceRecord
      decision.ts              # DecisionLogEntry
      signal.ts                # StagedSignal, SignalWeights
      tool-io.ts               # per-tool { args, result } schemas
    rules/
      close-rules.ts           # pure getDeterministicCloseRule(pos, cfg): CloseRule
      pnl.ts                   # pure PnL math, sanity check
      cooldown.ts              # pure isPoolOnCooldown, isBaseMintOnCooldown
      scoring.ts               # pure candidate scoring
      exit-signals.ts          # pure STOP_LOSS / TRAILING_TP / OOR / LOW_YIELD detector
    prompt/
      builder.ts               # buildSystemPrompt(role, ctx)
      role-tools.ts            # SCREENER_TOOLS, MANAGER_TOOLS, INTENT_PATTERNS
    errors.ts                  # DomainError hierarchy
  ports/
    position-repo.ts
    pool-memory-repo.ts
    lesson-repo.ts
    decision-log.ts
    signal-repo.ts
    chain-client.ts            # readActiveBin, getPositions, deployPosition, closePosition, claimFees
    llm-client.ts              # chat({model, messages, tools, tool_choice})
    swap-client.ts             # jupiter quote/swap
    price-client.ts            # helius / jupiter datapi / rugcheck
    notifier.ts                # Telegram + Discord surface
    clock.ts                   # now(), setInterval, cron — testable time
    logger.ts
  adapters/
    persistence/
      json/                    # phase-1 impls: JsonPositionRepo, etc. atomic write via temp+rename
      sqlite/                  # phase-2 impls (later)
    chain/
      meteora/
        client.ts              # thin wrapper, lazy SDK load stays here
        deploy.ts              # standard-range path
        deploy-wide.ts         # >69 bin extended-position path
        positions.ts           # getWalletPositions + cache
      solana/
        connection.ts
    llm/
      openrouter.ts
      local.ts                 # LM Studio / any OpenAI-compat
    market/
      helius.ts
      jupiter-datapi.ts
      jupiter-swap.ts
      rugcheck.ts
      agent-meridian.ts
    notify/
      telegram.ts              # long-poll, live message, /commands
      discord-listener/        # (keep in same repo but its own build target)
    logger/
      pino.ts                  # structured JSONL replacement for logger.js
  app/
    tools/
      registry.ts              # Map<name, ToolDef> — schema + impl + safety in ONE place
      define-tool.ts           # helper: defineTool(name, argsSchema, resultSchema, impl, safety?)
      execute.ts               # thin executor: validate args → safety → call → validate result
      generate-openai-schemas.ts  # walks registry, emits OpenAI tool-choice format
      impls/
        deploy-position.ts     # each tool = one file: {name, schemas, execute, safety}
        close-position.ts
        claim-fees.ts
        swap-token.ts
        get-top-candidates.ts
        ...
    agent/
      loop.ts                  # agentLoop() — ReAct, provider fallback, JSON repair
      session-locks.ts         # ONCE_PER_SESSION / NO_RETRY_TOOLS state machine
    screening/
      cycle.ts                 # runScreeningCycle
      pipeline.ts              # discover → filter → enrich → rank → LLM
    management/
      cycle.ts                 # runManagementCycle
      hybrid-decider.ts        # deterministic rules → LLM only for non-STAY
      pnl-poller.ts            # 30s interval + trailing-TP 15s confirm
    scheduler/
      cron.ts                  # startCronJobs, busy flags, race guards
    orchestration/
      hivemind-sync.ts
      lessons-evolution.ts     # evolveThresholds + signal weight recalc
      briefing.ts
    telegram-bridge/
      commands.ts              # /help /status /positions /close ...
      settings-menu.ts         # inline keyboard
      live-message.ts
      auth.ts
  entrypoints/
    daemon.ts                  # replaces index.js — composition root only
    cli.ts                     # replaces cli.js
    setup.ts                   # replaces setup.js
  shared/
    result.ts                  # Result<T, E> — replaces `{ success, error, ... }` bag
    safe-number.ts
    sanitize.ts                # sanitizeStoredText and friends
tests/
  unit/                        # pure domain — no mocks needed
  integration/                 # adapters w/ real JSON files, fake chain
  e2e/                         # DRY_RUN full loop
```

### 4.2 Why hexagonal-lite (not the alternatives)

| Pattern | Verdict | Why |
|---|---|---|
| **Hexagonal-lite + functional core** ✅ chosen | wins | Pure rules are already 60% of value; ports let JSON→SQLite migration land without touching them; testable without mocking the chain. |
| Full DDD (aggregates, repositories, domain events) | reject | Overkill for a solo agent with ~30 modules. Ceremony tax without payoff. |
| Class-based OOP (`PositionManager`, `PoolScreener` classes) | reject | Reintroduces the mutable-state coupling this refactor is trying to kill. |
| Event-driven / actor model | reject | Adds an event bus you have to reason about on top of already-async cron + LLM loop. Neat but not our bottleneck. |
| Keep functional-modules, just add types (`.d.ts` or JSDoc) | partial | We *keep* functional style inside `domain/`. But **layering** is the real fix; types alone don't unbreak the god file. |

### 4.3 The two force-multipliers

**(a) Zod as single source of truth.** One schema powers three consumers:

```ts
// domain/schemas/tool-io.ts
export const DeployPositionArgs = z.object({
  pool_address: z.string(),
  amount_sol: z.number().positive(),
  strategy: z.enum(["spot", "curve", "bid_ask"]),
  bins_below: z.number().int().min(35).max(69),
});
export type DeployPositionArgs = z.infer<typeof DeployPositionArgs>;

// app/tools/impls/deploy-position.ts
export const deployPositionTool = defineTool({
  name: "deploy_position",
  args: DeployPositionArgs,
  result: DeployPositionResult,
  safety: [checkOncePerSession, checkPoolThresholdsFresh, checkSolBalance],
  execute: async (args, ctx) => ctx.chain.deployPosition(args),
});

// app/tools/generate-openai-schemas.ts
// walks registry, calls zod-to-json-schema → the object the LLM sees
// No more definitions.js drift.
```

Same trick for `Config` (nested schema replaces flat CONFIG_MAP), for every state file, for every tool result. **The compiler now enforces what `unknown: [...]` used to silently swallow.**

**(b) Tool registry replaces `toolMap` + `definitions.js` + `runSafetyChecks` switch.**

Each tool = one file with `{ name, args, result, execute, safety[] }`. Executor becomes ~50 LOC: validate args → run safety chain → call → validate result → return. Adding a tool = adding a file, not editing three.

### 4.4 What each pain point becomes

| Today | After |
|---|---|
| `index.js` 2,032 LOC | `entrypoints/daemon.ts` ~150 LOC (composition), rest in `app/scheduler/`, `app/telegram-bridge/`, `app/management/pnl-poller.ts` |
| Flat `user-config.json` + 50-entry CONFIG_MAP | Nested `Config` Zod schema; `update_config` walks a typed path; `unknown` becomes a type error |
| `definitions.js` drift | Auto-generated from Zod; impossible to drift |
| Load-full/save-full JSON with no atomicity | `JsonRepo.save()` = write tmp + fsync + rename; typed load with `.parse()`; corrupt files caught at boot, not at 3am |
| Executor knows about Telegram/lessons/auto-swap | Executor is thin. Side effects = post-hooks registered per tool: `onSuccess: [notifyTelegram, autoSwapBase, recordPerformance]` |
| Lazy SDK dance in `tools/dlmm.js:33` | Isolated to `adapters/chain/meteora/client.ts`; rest of code holds a `ChainClient` interface — DRY_RUN adapter needs zero SDK |
| Global mutable `config` object | `Config` passed via `AppContext`; hot-reload = swap the context, no global mutation |
| Test suite = syntax checks | Domain tests are pure functions, no mocks. `close-rules.test.ts` runs in ms. |

## 5. Migration plan — Strangler (7 phases, ~3–4 weeks calendar)

Feature freeze the whole time. Every phase ends green: `pnpm test && node --check dist/*.js && DRY_RUN=true node dist/entrypoints/daemon.js` boots.

**Phase 0 — Toolchain (day 1)**
- `pnpm add -D typescript tsx @types/node vitest zod zod-to-json-schema tsconfig-paths`
- `tsconfig.json`: `"strict": true, "moduleResolution": "bundler", "allowJs": true, "checkJs": false, "target": "ES2023", "module": "ESNext", "outDir": "dist"`
- `package.json` scripts: `"dev": "tsx watch src/entrypoints/daemon.ts"`, `"build": "tsc -p ."`, `"start": "node dist/entrypoints/daemon.js"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`
- Keep old `index.js` running. New `src/` grows alongside.
- Add path alias `"@/*": ["src/*"]` for clean imports.

**Phase 1 — Pure domain (~3 days)**
Order: leaves first, no infra imports allowed.
1. `domain/schemas/*` — port every JSON shape into Zod. `Config` gets nested (breaking format handled by migration script).
2. `domain/rules/close-rules.ts` ← port `getDeterministicCloseRule` from `index.js:895`. Unit test all 5 rules.
3. `domain/rules/exit-signals.ts` ← port `updatePnlAndCheckExits` core from `state.js`.
4. `domain/rules/cooldown.ts` ← port `isPoolOnCooldown` + `isBaseMintOnCooldown`.
5. `domain/rules/scoring.ts` ← port score formula from `screening.js`.
6. `domain/rules/pnl.ts` ← port PnL sanity check.
7. `domain/prompt/builder.ts` ← port `prompt.js`.

Exit criterion: `pnpm vitest run domain/` — 100% of ported rules covered with fixtures from real closed positions.

**Phase 2 — Ports + JSON adapters (~3 days)**
1. Write port interfaces.
2. `adapters/persistence/json/*` — each existing `.json` file gets a typed repo with atomic write. Read path validates via Zod on load — corrupt file = clear error, not a mysterious NaN.
3. Migration script `scripts/migrate-config.ts`: flat `user-config.json` → nested. Runs once, backs up original.

**Phase 3 — Tool registry (~4 days)**
1. `app/tools/define-tool.ts` + `registry.ts` + `execute.ts`.
2. Port tools in dependency order — read-only first (`get_wallet_balance`, `get_top_candidates`, `get_active_bin`), then writes (`swap_token`, `claim_fees`, `close_position`), then the big one (`deploy_position`).
3. **Swap `tools/executor.js` in `agent.js` for the new executor behind a feature flag**: `USE_TS_TOOLS=true`. Both live for one deploy.
4. Delete `tools/definitions.js` when `generate-openai-schemas.ts` matches its output diff-clean.

**Phase 4 — Adapters (chain / LLM / market / notify) (~4 days)**
1. `adapters/chain/meteora/*` — split `tools/dlmm.js` into `client.ts` (lazy SDK load), `deploy.ts`, `deploy-wide.ts` (extended range), `positions.ts` (cache + dedup). Preserve exact caching semantics.
2. `adapters/llm/openrouter.ts` — replaces provider handling in `agent.js`.
3. `adapters/notify/telegram.ts` — port `telegram.js`. Live-message state becomes an object with methods, not closure soup.
4. `adapters/market/*` — Helius, Jupiter, rugcheck, agent-meridian each own a file.

**Phase 5 — Agent + orchestration (~3 days)**
1. `app/agent/loop.ts` — port `agentLoop`. Session locks become an explicit state machine.
2. `app/screening/pipeline.ts` — the discover→filter→enrich→rank pipeline, each stage a pure function returning `Result<Stage, RejectReason>`. Kills the current mid-function `return { skipped: … }` bailouts.
3. `app/management/hybrid-decider.ts` — deterministic-first, LLM-only-for-non-STAY.
4. `app/management/pnl-poller.ts` — 30s interval + trailing confirm.

**Phase 6 — Composition root + kill `index.js` (~2 days)**
1. `entrypoints/daemon.ts` wires everything: `const ctx = buildAppContext(config); startCron(ctx); startRepl(ctx); startTelegram(ctx); startPnlPoller(ctx);` — ~150 LOC.
2. Delete `index.js`. First deploy at this milestone is the risky one; run in DRY_RUN parallel to prod for 24h.

**Phase 7 — Polish (~1 week, ongoing)**
- Structured logger (`pino`).
- `Result<T, E>` on every tool result.
- Vitest coverage target: 80% on `domain/`, 60% on `app/`.
- Optional: swap JSON repos for SQLite (`better-sqlite3`, WAL mode). Interface unchanged; migration script runs once.

## 6. Speed (the "fast" ask)

Where TS itself buys nothing but the refactor does:

1. **Position cache stays**, but becomes explicit (`PositionsCache` class with TTL + inflight dedup) — no more scattered `_positionsCache*` globals.
2. **JSON I/O**: current pattern reads the whole file every call. Wrap repos in a write-through in-memory layer, batched fsync every 5s (`pino`-style). ~10× fewer syscalls on the hot path.
3. **Screening enrichment** currently sequential with 150ms throttle. Replace with a p-limit(3) — still under Jupiter rate limits, ~3× faster candidate scan.
4. **Tool arg validation** via Zod is O(schema-size) but runs microseconds — trivial.
5. **`tsc` build once, run compiled with `node`** — no `tsx` in prod, saves ~150ms boot.
6. **Structured logs** stop being `JSON.stringify` per line in a hot loop — `pino` uses a fast worker.

Deliberately not doing: switching to Bun, precompiling Solana instructions, or an in-process SQLite. Those are phase-8 questions if they matter.

## 7. Clean-code posture

- **`strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true`**. Loose TS is worse than JS.
- No `any`. `unknown` at boundaries, narrow with Zod.
- No enums — string literal unions.
- No barrel `index.ts` files (they wreck tree-shake + build time).
- Tools never throw for expected failures — return `Result<T, ToolError>`. Throw only on programmer bugs.
- Files ≤ 300 LOC. If a rule file grows past that, it's two rules.
- Comments only for non-obvious *why* (per CLAUDE.md conventions).
- Biome or ESLint+Prettier: pick one, wire pre-commit.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Behavior drift during rule port | Snapshot-test each rule against a bank of real closed positions from `state.json` history. |
| SDK CJS import breaks under stricter TS | Keep the exact `await import()` pattern in `adapters/chain/meteora/client.ts`. Type via `@ts-expect-error` at the boundary. |
| Config-format break | One-shot migration script, backup original, log the mapping. |
| Migration takes longer than 4 weeks | Feature freeze is the lever. Extend freeze, don't skip a phase. |
| Real money incident during phase 6 | Run new daemon in DRY_RUN parallel for 24h; diff decisions vs prod; only cut over when identical. |
| Loss of `.claude/settings.json` guardrails | Port them 1:1 — deny `rm -rf`, `wget`, `read(./.env*)`, and the `run_in_background: true` hook. |

## 9. What we're NOT changing (guarded)

- Deterministic close rule *values* (stop-loss %, trailing-drop %, OOR wait minutes).
- LLM tool-call protocol.
- On-chain path (Meteora SDK version, wide-range logic, referral wallet).
- Trailing-TP 15s recheck semantics.
- Position cache TTL (5 min) + inflight dedup.
- HiveMind push/pull cadence.

## 10. Alternatives considered (short)

- **Rust rewrite** — biggest speed win, biggest risk. Solana ecosystem tempting but Meteora TS SDK is the reference impl; going Rust means writing your own wrapper. Reject unless the goal is a service others use.
- **Bun** — attractive DX, but CJS interop + Solana web3.js corners = don't discover a bug at 4am with real capital. Revisit after phase 7.
- **NestJS / Effect-TS** — heavy frameworks. Effect-TS's `Effect<R, E, A>` type is beautiful but the team-of-one learning cost is real. Hexagonal-lite with `Result<T, E>` gets 80% of the benefit.
- **Deno** — nice but the Solana + Meteora SDKs' Node-shaped assumptions bite.

## 11. Assignment (do this next)

1. **Today:** create branch `ts-rewrite`, land Phase 0 (toolchain + empty `src/` skeleton + `pnpm typecheck` in CI). Zero behavior change.
2. **This week:** Phase 1. Port `close-rules.ts` first, write the snapshot tests, prove parity on the last 50 closed positions in `state.json`.
3. **Decision gate before Phase 3:** review the `defineTool` shape on a real tool (`get_wallet_balance` — small, read-only). If the ergonomics don't feel obviously better than `toolMap` today, redesign the registry before porting the other 40.
4. **Freeze `main` for new tools/rules** until Phase 6 lands.

Anything you'd change before we start Phase 0?
