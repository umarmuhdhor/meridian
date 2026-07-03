# Meridian Control Dashboard

A thin, additive web dashboard to monitor and control the Meridian DLMM agent —
**without changing any trading logic**. Two processes:

1. **Bridge** (`dashboard/bridge/`) — a zero-dependency HTTP server that runs
   *inside* the daemon, gated by env. It exposes read state + a `POST /tool`
   endpoint that funnels every write through the daemon's existing `executeTool`
   (so audit, Telegram notifications, auto-swap, and safety checks all still fire).
2. **Web** (`dashboard/web/`) — a Next.js 15 app (its own `package.json`). API
   routes proxy the bridge so the token never reaches the browser.

The only touch to core code is a single env-gated boot block in `index.js`.
With `DASHBOARD_ENABLED` unset, no dashboard code is ever loaded and daemon
behavior is byte-for-byte identical.

---

## Running (two terminals)

### 1. Daemon with the bridge enabled (terminal 1)

```bash
# From the repo root. Use DRY_RUN=true to test without on-chain transactions.
DASHBOARD_ENABLED=true DASHBOARD_PORT=8787 DASHBOARD_TOKEN=<secret> node index.js
```

The daemon logs `bridge on 127.0.0.1:8787` on success. If `DASHBOARD_TOKEN` is
empty it logs `bridge not started` and the daemon runs normally without a bridge.

### 2. Web app (terminal 2)

```bash
cd dashboard/web
npm install
cp .env.local.example .env.local     # set BRIDGE_TOKEN = the same <secret>
npm run dev                          # http://localhost:3000
```

> The bridge binds to `127.0.0.1` only. Remote access is the operator's
> responsibility (SSH tunnel / VPN) and out of scope for this code.

---

## Environment variables

### Daemon (repo root env / `.env`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DASHBOARD_ENABLED` | — | unset (off) | Gate. Only `"true"` enables the bridge. |
| `DASHBOARD_PORT` | — | `8787` | Bridge port (localhost). |
| `DASHBOARD_TOKEN` | yes (when enabled) | — | Bearer token. Empty → bridge refuses to start. |

### Web (`dashboard/web/.env.local`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `BRIDGE_URL` | — | `http://127.0.0.1:8787` | Bridge address for the Next proxy. |
| `BRIDGE_TOKEN` | yes | — | Same value as `DASHBOARD_TOKEN`. Server-side only, never sent to the browser. |
| `MERIDIAN_ROOT` | — | resolves `../..` from `dashboard/web` | Repo root for reading static JSON via fs (read-only). |

---

## Security model

- **Localhost-only** bind (`127.0.0.1`), not configurable.
- **Bearer token** required, compared with `crypto.timingSafeEqual`. Empty → no start.
- **Tool allowlist** (deny-by-default). `self_update` is hard-denied.
- **Confirm gate** + **in-flight lock** on every write tool (double-click safe → 409).
- **Redaction** of secret keys (`/key|token|secret|mnemonic/i`) on any path that
  touches `user-config.json`, on both the bridge and the web fs reader.
- The token lives only in server env (daemon + Next server). The browser talks to
  `/api/*` on the Next server; it never sees the token or the bridge directly.

---

## Architecture notes

- Static state (lessons, decisions, pool-memory, config, blocklists, strategy,
  signal-weights, smart-wallets, state) is read **directly from disk** by the Next
  server (read-only), so those pages survive daemon downtime.
- Live data (positions + PnL, wallet balance, summary) and **all writes** go
  through the bridge → the daemon process, so there is never a second writer to
  the JSON state files (there is no file lock).
- When the daemon is down, the health check flips the UI into a read-only banner;
  static pages keep working, write buttons disable.

See `dashboard/PRD.md` for the full spec, `dashboard/Design.md` for the design
system, and `dashboard/plan/` for the per-milestone implementation plan.
