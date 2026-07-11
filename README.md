# Meridian

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs. TypeScript rewrite.**

**Links:** [Website](https://agentmeridian.xyz) | [Telegram](https://t.me/agentmeridian) | [X](https://x.com/meridian_agent)

Meridian runs continuous screening and management cycles, deploying capital into
high-quality Meteora DLMM pools and closing positions based on live PnL, yield,
and range data. It learns from every position it closes.

---

## Status

Runs on the strict TypeScript rewrite (branch `rewrite-ts`, tag `v2.0.0`).
Hexagonal-lite architecture: `src/domain/` (pure) / `src/ports/` (interfaces) /
`src/adapters/` (impls) / `src/app/` (services) / `src/entrypoints/` (composition).
Zod is the single source of truth for schemas, types, and OpenAI tool
definitions.

Legacy JavaScript daemon is preserved at git tag `legacy-js` for instant
rollback (`git checkout legacy-js`).

---

## What it does

- **Screens pools** — scans Meteora DLMM pools against configurable thresholds
  (fee/TVL ratio, organic score, holder count, mcap, bin step) and surfaces
  high-quality opportunities.
- **Manages positions** — monitors, claims fees, and closes LP positions
  autonomously; decides via 5 deterministic close rules, then hands off only
  non-STAY actions to the LLM.
- **Trailing take-profit** — dedicated 30s poller with a 15s two-phase drop
  confirm before firing a close.
- **Learns from performance** — records structured lessons and shared learning
  via HiveMind, evolves screening thresholds based on closed position history.
- **Telegram REPL** — full inbound long-poll + outbound live-message notifier
  with in-place edits, plus deploy/close/OOR alerts and daily briefings.
- **Discord signals** — optional Discord listener queues LP Army channel calls
  for screening (retained from legacy — separate subproject).

---

## Architecture at a glance

```
   ┌────────────────────────────────────────────────────────┐
   │ entrypoints/daemon.ts    ← composition root (~500 LOC) │
   ├────────────────────────────────────────────────────────┤
   │ app/                     ← agent loop, cycles, poller  │
   ├────────────────────────────────────────────────────────┤
   │ domain/                  ← pure rules + Zod schemas    │
   ├────────────────────────────────────────────────────────┤
   │ ports/                   ← interfaces only             │
   ├────────────────────────────────────────────────────────┤
   │ adapters/                ← concrete impls behind ports │
   │  chain/{dry-run, meteora/…}    llm/{openrouter, fake}  │
   │  market/{jupiter-*, meteora-*, rugcheck}               │
   │  notify/{telegram, telegram-inbound}                   │
   │  swap/jupiter-swap        hivemind/agent-meridian      │
   │  persistence/json/…       scheduler/{interval, manual} │
   └────────────────────────────────────────────────────────┘
```

339 unit tests across 45 files.

---

## Requirements

- Node.js 22+
- [OpenRouter](https://openrouter.ai) API key (or any OpenAI-compatible endpoint)
- Solana RPC — Helius recommended
- Base58 wallet private key
- Optional: Telegram bot token + chat id for the REPL bridge

---

## Quick start

```bash
npm install
cp user-config.example.json user-config.json   # edit thresholds to taste
npm run build                                  # tsc → dist/
npm start                                      # boot the daemon
```

### Environment flags

| Var | Values | Purpose |
|---|---|---|
| `MERIDIAN_CHAIN` | `dryrun` (default) / `meteora` | Which chain adapter |
| `MERIDIAN_MARKET` | `real` (default when chain=meteora) / `fake` | Real vs mock market adapters |
| `MERIDIAN_PRICE` | `jupiter` / `static` | SOL/USD price source |
| `MERIDIAN_AUTONOMOUS` | `true` / unset | Start cron loop (screening + management + pnl-poller + briefing + health + hivemind + telegram inbound) |
| `MERIDIAN_WRITE_UNSAFE` | `true` / unset | **Arms real Meteora write paths.** Without this, deploy/close/claim throw `MeteoraWritePathNotPortedError`. |
| `MERIDIAN_STATE_DIR` | absolute path | Directory for JSON state files (defaults to `cwd`) |
| `MERIDIAN_FROZEN_TIME` | ISO string | Freeze clock for deterministic runs |
| `MERIDIAN_DEMO` | `true` / unset | Force the fake LLM script for one-shot demo |
| `RPC_URL`, `WALLET_PRIVATE_KEY` | | Required when `MERIDIAN_CHAIN=meteora` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | | Enables Telegram outbound + inbound |
| `TELEGRAM_ALLOWED_USER_IDS` | comma list | Required for group chats |
| `OPENROUTER_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | | LLM provider config |
| `DASHBOARD_ENABLED` | `true` / unset | Start the localhost control-dashboard bridge. Without it the bridge module is never imported — daemon behavior is identical. |
| `DASHBOARD_PORT` | port (default `8787`) | Bridge TCP port (bound to `127.0.0.1` only) |
| `DASHBOARD_TOKEN` | secret | **Required** to arm the bridge — it refuses to listen without a non-empty token. The web app sends it as `Bearer`. |

### Modes

```bash
# One-shot dryrun with fake LLM
MERIDIAN_DEMO=true npm start

# Real read-only Meteora observation (no writes possible)
MERIDIAN_CHAIN=meteora \
  RPC_URL="https://…" \
  WALLET_PRIVATE_KEY="…" \
  npm start

# Autonomous production loop with real Telegram + HiveMind
MERIDIAN_AUTONOMOUS=true \
  MERIDIAN_CHAIN=meteora \
  MERIDIAN_MARKET=real \
  MERIDIAN_WRITE_UNSAFE=true \
  TELEGRAM_BOT_TOKEN="…" \
  TELEGRAM_CHAT_ID="…" \
  npm start
```

---

## Control dashboard

An optional web dashboard lives under `dashboard/`:

- `dashboard/web/` — Next.js app (its own npm project). Talks only to same-origin
  `/api/*` proxies, which forward to the bridge with the `Bearer` token server-side —
  the token never reaches the browser.
- `src/adapters/dashboard/` — the **bridge**: a `node:http` server (zero external deps,
  bound to `127.0.0.1` only) wired to the daemon's DI context. Exposes `/health`,
  `/state/positions`, `/state/summary`, `/state/file/:name` (whitelisted, `user-config`
  redacted), `/events` (SSE, piggybacks the PnL-poller cache — no new RPC), `POST /tool`
  (allowlisted; write tools require `confirm:true` + an in-flight lock), and `POST /chat`
  (streaming GENERAL agent tick restricted to a read-only tool surface).

Enable it at boot:

```bash
DASHBOARD_ENABLED=true \
  DASHBOARD_TOKEN="$(openssl rand -hex 16)" \
  MERIDIAN_AUTONOMOUS=true \
  npm start

# then, in dashboard/web:  BRIDGE_TOKEN=<same token> npm run dev
```

See `dashboard/PRD.md`, `dashboard/Design.md`, and `dashboard/plan/` for the full spec.

---

## Rollback

Legacy JS daemon lives at the `legacy-js` git tag.

```bash
git checkout legacy-js
npm ci
npm start                 # runs the legacy JS daemon (index.js)
```

Use this if any TS phase misbehaves in production. See
`scripts/parallel-run/README.md` for the pre-cutover parallel-run procedure that
gates every future rewrite.

---

## Development

```bash
npm run typecheck         # strict tsc
npm run test              # typecheck + vitest
npm run dev               # tsx watch, DRY_RUN=true
npm run build             # tsc → dist/
```

See `CLAUDE.md` for the engineering manual, `DESIGN-typescript-rewrite.md` for
the architecture, and `HANDOFF-typescript-rewrite.md` for the phase-by-phase
history.
