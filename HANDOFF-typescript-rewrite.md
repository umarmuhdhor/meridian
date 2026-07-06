# Meridian TS Rewrite — Session Handoff (post-Phase-21B)

**Status:** Full cutover landed on branch `rewrite-ts` / PR #1. Legacy JS
deleted, `legacy-js` tag pinned to `main` for rollback. TypeScript daemon is
the only runtime. 339 tests, 45 test files. Not yet merged to `main` — user
holds veto pending real-env testing.

**Branch:** `rewrite-ts`
**PR:** https://github.com/umarmuhdhor/meridian/pull/1
**Rollback tag:** `legacy-js` (git tag on `main` @ 5ab14b4)

---

## TL;DR for the next session

- `main` still has legacy JS. `rewrite-ts` has the pure TS daemon. No mainnet
  merge yet.
- Real chain writes remain gated behind `MERIDIAN_WRITE_UNSAFE=true` — the
  cutover did NOT change chain risk.
- Every phase's cadence is preserved: screening, management, PnL poller,
  briefing, health-check, HiveMind sync, Telegram inbound.
- Do NOT flip `MERIDIAN_WRITE_UNSAFE=true` in a session — that's a real-money
  gate. Ask the user first, every time.

**Commands you'll type:**

```bash
npm ci
npm run typecheck            # strict tsc
npm run test:unit            # 339 vitest tests
npm run build                # → dist/
npm start                    # boot daemon (env-driven mode)
npm run dev                  # tsx watch, DRY_RUN=true

# One-shot dryrun demo
MERIDIAN_DEMO=true npm start

# Read-only real Meteora observation (no writes possible)
MERIDIAN_CHAIN=meteora MERIDIAN_MARKET=real \
  RPC_URL=... WALLET_PRIVATE_KEY=... \
  npm start

# Parallel-run harness (24h JS vs TS diff — required before Phase 21 merge)
./scripts/parallel-run/run-parallel.sh
```

**Rollback:** `git checkout legacy-js && npm ci && npm start` runs the legacy
JS daemon exactly as it was pre-cutover.

---

## Phase history

| Phase | Scope | Commit |
|---|---|---|
| 0-9 | Toolchain + domain + ports + adapters + tools + agent loop + orchestration + Meteora read | (rewrite-ts start) |
| 10a | Jupiter Price v6 oracle | 8b8fe31 |
| 10b | Jupiter Swap V6 adapter | 8b8fe31 |
| 10c | Meteora datapi PnL fetcher + `deriveOpenPnlPct` + `assessPnl` wiring | 8b8fe31 |
| 10d | Daemon `MERIDIAN_PRICE=jupiter\|static` env | 8b8fe31 |
| 11 | Full AppConfig schema (screening/llm/darwin/hiveMind/api/jupiter/indicators/tokens/pnl) | 0248894 |
| 12 | LLM decorators — provider fallback + system-role fallback + tool_choice retry | 0248894 |
| 13 | Real Telegram outbound notifier + live-message in-place edits | 0248894 |
| 14 | Real market network adapters — Meteora pool discovery + Jupiter token info | 0248894 |
| 15A | Pure `planDeploy` rule (bin math + wide-range detection) | 0bcfdfc |
| 15B | Gated write paths — deploy/close/claim behind `MERIDIAN_WRITE_UNSAFE` | bae8d51 |
| 15C | Wide-range deploy (createExtendedEmptyPosition + addLiquidityByStrategyChunkable) | 12a?? |
| 17 | rugcheck.xyz + Meteora datapi smart-wallet-checker | 8beca00 |
| 18 | PnL 30s poller + 15s two-phase trailing-TP confirm | (…) |
| 19 | Daily briefing + hourly health-check crons | (…) |
| 20 | HiveMind push/pull sync (Agent Meridian) | (…) |
| 16 | Telegram inbound REPL (long-poll + command dispatch) | (…) |
| 21A | Parallel-run harness (script + diff + README) | dc94bf1 |
| 21B | Cutover — delete legacy JS + retag + rewire package.json | 3fe5796 |

**Totals now:** ~11k LOC TS across `src/` + `tests/`. 45 test files, 339 unit
tests. Legacy JS is gone from the tree; recover it via `legacy-js` tag only.

---

## Directory map (current)

```
src/
  domain/                    # PURE
    schemas/                 # Zod = single source of truth
      config.ts, config-flat.ts, position.ts, state.ts, pool-memory.ts,
      lesson.ts, decision.ts, strategy.ts, smart-wallet.ts, blacklist.ts,
      chain.ts, market.ts
    rules/
      close-rules.ts         # 5 hard close rules
      exit-signals.ts        # STOP_LOSS / TRAILING_TP / OOR / LOW_YIELD
      cooldown.ts, pnl.ts, scoring.ts, screening.ts
      deploy-planning.ts     # (Phase 15A) pure bin-range plan
    prompt/
      builder.ts, role-tools.ts
    config-load.ts

  ports/                     # interfaces only
    clock.ts, logger.ts,
    position-repo.ts, pool-memory-repo.ts, config-repo.ts,
    lesson-repo.ts, decision-log.ts, strategy-repo.ts,
    smart-wallet-repo.ts, token-blacklist-repo.ts,
    chain-client.ts, swap-client.ts, llm-client.ts, notifier.ts,
    pool-discovery.ts, token-info-client.ts, rug-check.ts,
    smart-wallet-checker.ts, price-oracle.ts, solana.ts, scheduler.ts,
    hivemind.ts, telegram-inbound.ts

  adapters/
    logger/console.ts
    persistence/json/…       # atomic write + Zod validate on load
    chain/
      dry-run.ts             # deterministic, in-memory
      meteora/
        connection.ts        # createSolanaConnection, loadWalletKeypair
        client.ts            # createMeteoraChainClient (read + gated writes)
        datapi-pnl.ts        # /pnl fetch + deriveOpenPnlPct
        write-paths.ts       # deploy/close/claim helpers, gated
    llm/
      openrouter.ts, fake.ts
      with-provider-fallback.ts, with-system-role-fallback.ts,
      with-tool-choice-retry.ts
    notify/
      null-notifier.ts, collecting-notifier.ts,
      telegram.ts            # real outbound + live message
      telegram-inbound.ts    # long-poll REPL
    market/
      jupiter-price-oracle.ts, jupiter-token-info.ts,
      meteora-pool-discovery.ts,
      rugcheck.ts, meteora-smart-wallet-checker.ts,
      static-price-oracle.ts, fake-*.ts
    swap/
      jupiter-swap.ts
    hivemind/
      agent-meridian.ts
    scheduler/
      interval.ts, manual.ts

  shared/
    result.ts, cache.ts       # TtlCache with inflight dedup

  app/
    tools/
      context.ts, types.ts, define-tool.ts, registry.ts, execute.ts
      generate-openai-schemas.ts
      safety/                 # pool-cooldown, wallet-balance, max-positions, token-blacklist
      post/                   # log-decision, notify
      impls/                  # 20 tools
    agent/
      loop.ts, session-locks.ts
    screening/cycle.ts
    management/
      cycle.ts, pnl-poller.ts # (Phase 18)
    briefing/                 # (Phase 19)
      generate.ts, cycle.ts
    health/cycle.ts           # (Phase 19)
    hivemind/sync.ts          # (Phase 20)
    telegram/router.ts        # (Phase 16)

  entrypoints/
    daemon.ts                 # ~500 LOC composition root

tests/
  unit/                       # 30+ files
  integration/                # 7 files

scripts/parallel-run/
  run-parallel.sh, diff-decisions.mjs, README.md
```

---

## Env vars the daemon reads

| Var | Values | Purpose |
|---|---|---|
| `MERIDIAN_CHAIN` | `dryrun` / `meteora` | Chain adapter selection |
| `MERIDIAN_MARKET` | `real` / `fake` | Real Meteora + Jupiter vs fakes |
| `MERIDIAN_PRICE` | `jupiter` / `static` | SOL/USD price source |
| `MERIDIAN_AUTONOMOUS` | `true` / unset | Start cron loop |
| `MERIDIAN_WRITE_UNSAFE` | `true` / unset | **Arms real chain writes** |
| `MERIDIAN_DEMO` | `true` / unset | Force FakeLLM script |
| `MERIDIAN_STATE_DIR` | absolute path | JSON state dir |
| `MERIDIAN_FROZEN_TIME` | ISO string | Deterministic clock |
| `RPC_URL`, `WALLET_PRIVATE_KEY` | | Required when `MERIDIAN_CHAIN=meteora` |
| `SOL_PRICE_USD` | number | Static price fallback (default 150) |
| `OPENROUTER_API_KEY` / `LLM_API_KEY` | | LLM key |
| `LLM_BASE_URL`, `LLM_MODEL` | | LLM overrides |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | | Enable Telegram in + out |
| `TELEGRAM_ALLOWED_USER_IDS` | comma-list | Required for group chats |
| `JUPITER_REFERRAL_ACCOUNT`, `JUPITER_REFERRAL_FEE_BPS` | | Optional referral overrides |

Fail-loud: `MERIDIAN_CHAIN=meteora` without `RPC_URL` OR `WALLET_PRIVATE_KEY` → boot exits with a clear error.

---

## Hard rules for the next session

- **Don't merge `rewrite-ts` to `main`** until the operator has completed the
  24h parallel-run and signed off.
- **Never flip `MERIDIAN_WRITE_UNSAFE=true`** from within a session — ask the
  operator every time.
- **Rollback path stays intact.** Don't retag `legacy-js` and don't rewrite
  its history. If the tag is gone, stop and re-tag from `main` @ 5ab14b4.
- **Zod schema first.** New types = new schema. No raw `interface` at any
  I/O or LLM boundary.
- **Ports/adapters isolation.** `@meteora-ag/dlmm` and `@solana/web3.js` only
  inside `src/adapters/chain/meteora/`. `@jup-ag/*` (or raw Jupiter HTTP) only
  inside `src/adapters/{market,swap}/jupiter-*`. bn.js and bs58 similar.
- **Clock injected.** No `new Date()` outside real adapters. Everything else
  takes a `Clock`.
- **Fail loud at boot.** Missing env / broken config → throw before any real
  request.
- **Every phase must end with:** `typecheck` clean, `test:unit` green,
  `npm start` demo boot working, and a note in HANDOFF-typescript-rewrite.md
  if scope changed.

---

## What's NOT ported yet / follow-up scope

| Item | Notes |
|---|---|
| `.claude/commands/*.md` + `.claude/agents/*.md` | 8 files referencing deleted `cli.js` were removed (retired — operator can re-add on their terms). Remaining: `pool-compare.md`, `pool-ohlcv.md` (pure curl, still functional). |
| Telegram command surface | Router covers `/help /status /wallet /positions /briefing`. Mutating commands (`/close /deploy /pause /resume /stop`) stubbed for future Telegram-bridge phase. |
| Inline settings menu | JS had `/settings` inline-keyboard menu. Not ported — future scope. |
| `.claude/settings.json` operational hooks | Still forbids `run_in_background: true`. Fine as-is; note if you tweak. |
| GMGN fee source | Legacy `tools/gmgn.js` was optional. Not ported. Add if `config.gmgnFeeSource === "gmgn"` becomes a live path. |
| Discord listener | Standalone subproject with selfbot — deleted with cutover. Reintroduce as its own package if you want it back. |
| `envcrypt` | XOR obfuscation for `.env`. Deleted. Users on encrypted envs need a replacement or re-decrypt. |
| `setup.js` first-run wizard | Not ported. Users hand-edit `user-config.json` from `user-config.example.json`. |

---

## Contact points in the code

- **Where post-hooks fire:** `src/app/tools/execute.ts` — after result validation.
- **Where session locks are enforced:** `src/app/agent/loop.ts` — checked BEFORE the executor.
- **Where the LLM never fires:** `src/app/management/cycle.ts` — `all_stay` short-circuit.
- **Where DryRun cache is invalidated:** `src/adapters/chain/dry-run.ts:setState` + after every deploy/close/claim.
- **Where the Meteora SDK is imported:** `src/adapters/chain/meteora/{client,write-paths}.ts` — lazy CJS import. NOWHERE ELSE.
- **Where deploy safety chain lives:** `src/app/tools/impls/deploy-position.ts:safety` — 4 gates, order matters.
- **Where the `MERIDIAN_WRITE_UNSAFE` gate lives:** `src/entrypoints/daemon.ts` passes `writesEnabled` into `createMeteoraChainClient`.
- **Where the trailing-TP two-phase confirm runs:** `src/app/management/pnl-poller.ts:tickPnlPoller`.
- **Where the Telegram REPL routes text:** `src/app/telegram/router.ts:routeTelegramMessage`.

---

## Test-and-run sanity check for the next session

Run these before writing any code:

```bash
git checkout rewrite-ts && git pull
npm ci

npm run typecheck             # → clean
npm run test:unit             # → 339 passed
npm run build                 # → dist/ rebuilt

# One-shot dryrun demo — must end with "outcome: invoked"
rm -rf /tmp/meridian-demo && mkdir -p /tmp/meridian-demo
MERIDIAN_DEMO=true \
  MERIDIAN_STATE_DIR=/tmp/meridian-demo \
  MERIDIAN_FROZEN_TIME=2026-07-05T12:00:00.000Z \
  npm start

# Fail-loud check — Meteora without RPC
MERIDIAN_CHAIN=meteora npm start
# Expected: boot failed: Error: MERIDIAN_CHAIN=meteora requires RPC_URL
```

If any of these breaks, **stop** and fix the regression before new work.

---

## Files to read first in a new session

Priority order:

1. **This file** — you're reading it.
2. [DESIGN-typescript-rewrite.md](DESIGN-typescript-rewrite.md) — original architecture.
3. [CLAUDE.md](CLAUDE.md) — engineering manual (still describes some legacy quirks; treat those as history).
4. `src/entrypoints/daemon.ts` — the composition root; shows every wiring choice.
5. The tool file closest to the task. `get-wallet-balance.ts` for reads, `deploy-position.ts` for writes.

---

Good luck.
