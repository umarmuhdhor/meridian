# Meridian — Operations Manual (A-Z)

> **Canonical source of truth for how Meridian is deployed and operated in
> production.** If anything here disagrees with an older doc (`PRD-deployment.md`,
> `PLAN-deployment.md`), this file wins. Last major update: 2026-07-12.

---

## 0. Current state at a glance

| | |
|---|---|
| **Live code** | TypeScript rewrite under `src/` (entry `src/entrypoints/daemon.ts` → `dist/entrypoints/daemon.js`). The legacy JS layout in `CLAUDE.md` is retired. |
| **Branch** | `dashboard` (this is the deployed branch, not `main`) |
| **Host** | Tencent Cloud VPS, **Hong Kong**, `ubuntu@101.32.216.139` (Ubuntu 24.04) |
| **App dir** | `~/meridian` · state volume `~/meridian-data` → `/opt/data` |
| **Runtime** | 3 Docker containers (below), `sudo docker compose` |
| **Trading** | LIVE — real wallet, `DRY_RUN=false`, `MERIDIAN_WRITE_UNSAFE=true` |
| **Dashboard** | https://calisto.nafidinara.com (Cloudflare Access + 6-digit PIN) |
| **Deploy** | push to `dashboard` → GitHub Actions → GHCR → VPS auto-pulls |
| **Registry** | `ghcr.io/umarmuhdhor/meridian` (private) |
| **Kill switch** | `cd ~/meridian && sudo docker compose stop` |

---

## 1. Architecture

```
                         ┌───────────────── GitHub (umarmuhdhor/meridian) ─────────────────┐
   git push dashboard ──►│  Actions: test → build → push image → SSH deploy                 │
                         └───────────────────────────────┬─────────────────────────────────┘
                                                         │ ghcr.io/…:<sha>
                                                         ▼
   Browser ── https://calisto.nafidinara.com        Tencent HK VPS (101.32.216.139)
      │                                              ~/meridian (docker compose)
      ▼                                              ┌──────────────────────────────────────┐
   Cloudflare edge ── TLS + Access (email OTP) ──────┤ cloudflared  → http://meridian:3000   │
      │ (GATE 1: identity)                           │                                        │
      ▼                                              │ meridian (daemon)  ── owns netns +     │
   cloudflared tunnel (outbound-only, no open ports) │   bridge 127.0.0.1:8787 + state vol    │
                                                     │        ▲ network_mode: service         │
                                                     │ meridian-web (Next.js :3000)           │
                                                     │   GATE 2: PIN middleware               │
                                                     └──────────────────────────────────────┘
                                                              │
                                                       daemon → Solana wallet (LIVE)
```

**Two containers, one image.** Both run `ghcr.io/umarmuhdhor/meridian:dashboard`,
selecting one PM2 app via `--only`:

- **`meridian`** — the trading daemon. Owns the Docker network namespace, the
  control bridge on `127.0.0.1:8787` (localhost-only, never exposed), and the
  state volume. Restarts only when daemon/core code changes.
- **`meridian-web`** — the Next.js dashboard. Uses `network_mode: "service:meridian"`
  to share the daemon's namespace so it can reach the localhost bridge and listen
  on `:3000` there. Redeploys with **zero daemon interruption**.
- **`cloudflared`** — Cloudflare Tunnel connector → `http://meridian:3000`.

Why split: a dashboard change should not restart a live trading daemon.

---

## 2. Access

- **SSH:** `ssh ubuntu@101.32.216.139` (passwordless sudo; `ubuntu` is in the
  `docker` group but a re-login is needed to drop `sudo`, so scripts use `sudo docker`).
- **Dashboard (public):** https://calisto.nafidinara.com → Cloudflare Access
  (email one-time PIN) → 6-digit app PIN.
- **Dashboard (admin, no CF):** SSH tunnel — `ssh -L 3000:127.0.0.1:3000 ubuntu@101.32.216.139`
  then http://localhost:3000 (still PIN-gated).
- **Fallback host:** the original **vivobook** home server (`100.100.154.123`,
  Tailscale-only, flaky Wi-Fi) is retired as the target. Its Caddy+Tunnel compose
  variant is kept at `deploy/docker-compose.vivobook.yml` for reference.

---

## 3. The deploy pipeline

**Trigger:** any push to `dashboard`.

```
push → .github/workflows/deploy-dashboard.yml
  1. Daemon tests   (npm ci + npm test = typecheck + vitest)      red → STOP
  2. Web tests      (dashboard/web: npm ci + npm test + build)    red → STOP
  3. Scope          docs-only → skip deploy;  web/** only → web-only;  else → full
  4. Build + push   ghcr.io/…:<sha> + :dashboard   (buildx + gha cache)
  5. scp            docker-compose.yml + deploy/deploy.sh → VPS
  6. SSH deploy     deploy/deploy.sh <sha> <scope>
```

**`deploy/deploy.sh` on the VPS:**
```
tag :dashboard → :previous          (rollback point)
pull :<sha> → tag :<sha> → :dashboard
cutover (--force-recreate):
    web-only → up -d --no-deps meridian-web     (daemon keeps trading)
    full     → up -d                             (daemon + web, ~15s reconciled gap)
health-check ≤ 60s:
    daemon container up (not crash-looping) + PM2 online + web /login = 200
    healthy   → done (prune old images)
    unhealthy → retag :previous → :dashboard → up -d (same scope) → exit 1
```

- **Serialized:** a `concurrency` group means two pushes never race the box.
- **Deploy gated on secrets:** the deploy steps skip (run stays green) until the
  GitHub secrets exist — see §4.
- **Scopes:** `docs-only` skips build+deploy entirely (no daemon restart for a
  README change); `web-only` = seamless; `full` = daemon restart.

### Manual deploy (bypass CI)
```bash
ssh ubuntu@101.32.216.139
cd ~/meridian
sudo docker login ghcr.io -u umarmuhdhor          # if not already
./deploy/deploy.sh <sha> full                     # or web-only
# dry-run first: ./deploy/deploy.sh <sha> full --dry-run
```

---

## 4. First-time setup (already done — here for rebuilds / new maintainers)

**GitHub repo secrets** (`umarmuhdhor/meridian` → Settings → Secrets → Actions):
| Secret | Value |
|---|---|
| `VPS_HOST` | `101.32.216.139` |
| `VPS_USER` | `ubuntu` |
| `VPS_SSH_KEY` | private key of a deploy keypair whose public key is in the VPS `~/.ssh/authorized_keys` |

GHCR push uses the built-in `GITHUB_TOKEN` (no secret needed).

**On the VPS** (one-time): let it pull the private image:
```bash
echo "<GITHUB_PAT_with_read:packages>" | sudo docker login ghcr.io -u umarmuhdhor --password-stdin
```

**Cloudflare** (dashboard exposure):
- Zero Trust → Networks → Tunnels → `meridian-vps` → Public Hostname
  `calisto.nafidinara.com` → `http://meridian:3000`.
- Zero Trust → Access → Applications → `Meridian` (domain `calisto.nafidinara.com`),
  policy Allow → Emails (your address + teammates).
- Zero Trust → Integrations → Identity providers → **One-time PIN** enabled;
  app Authentication → "Accept all available identity providers" (so teammates
  without a Cloudflare account get an email code).

---

## 5. Secrets & env (`~/meridian/.env`, chmod 600, gitignored)

| Key | Purpose |
|---|---|
| `WALLET_PRIVATE_KEY` | base58 Solana key (JSON array also accepted). NOT base64. |
| `RPC_URL` | mainnet RPC (Helius). Wallet balance uses `getBalance` on this. |
| `OPENROUTER_API_KEY` | LLM. Model set per-role in `user-config.json`. |
| `DASHBOARD_TOKEN` / `BRIDGE_TOKEN` | same value; the daemon↔web bridge token. |
| `MERIDIAN_DASHBOARD_PIN_HASH` | `salt:scryptHash` of the dashboard PIN (see §7). |
| `MERIDIAN_SESSION_SECRET` | 32-byte hex, signs the dashboard session cookie. |
| `CLOUDFLARE_TUNNEL_TOKEN` | cloudflared connector token. |
| `DRY_RUN` / `MERIDIAN_WRITE_UNSAFE` | live gates: `false` / `true`. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | ops surface. |
| `HELIUS_API_KEY` | **unused in the TS rewrite** (leftover); safe to leave blank. |

Adapter selection lives in `docker-compose.yml` env, not `.env`:
`MERIDIAN_CHAIN=meteora` (→ cascades `MERIDIAN_MARKET=real`, `MERIDIAN_PRICE=jupiter`).
**`DRY_RUN=false` alone is not enough — without `MERIDIAN_CHAIN=meteora` the daemon
boots demo adapters (fake market, static $150 price).**

> `.env` never leaves the box and is never committed. Do not paste the wallet key
> into chat. Quotes around values break things — `sudo docker compose env_file`
> passes them literally (Next.js then sees `"salt:hash"` and login fails).

---

## 6. Config management (`~/meridian/user-config.json`)

- Flat trading params (thresholds, sizing, intervals, per-role models). Loaded at
  boot; mounted into the container at `/app/user-config.json`.
- **Gotcha — the inode trap:** it's a single-file bind mount. Editing/rsyncing it
  swaps the inode, so the running container keeps the OLD file. Apply changes with
  `sudo docker compose up -d --force-recreate meridian` (or edit live via Telegram
  `/set`, which reloads without a restart).
- **Schema caveats (deployed branch):** `strategy` must be `spot`|`curve`|`bid_ask`
  (no `auto`); model fields must be exact OpenRouter slugs, e.g.
  `minimax/minimax-m2.7`. Newer configs (`strategy:"auto"`, opportunity-poll) need
  a newer Meridian version and will fail schema validation → crash-loop.

---

## 7. Dashboard auth (PIN + Cloudflare Access)

Two independent gates in front of the wallet control panel:

1. **Cloudflare Access** (edge) — email OTP; only allow-listed emails pass.
   Add teammates: Access → Applications → Meridian → Policies → Include → Emails.
2. **6-digit PIN** (app) — Next.js middleware (`dashboard/web/middleware.ts`) +
   `iron-session` cookie; scrypt + constant-time compare; per-IP lockout
   (5 tries / 15 min). Logout button top-right.

**Generate / rotate the PIN hash** (run on the VPS; PIN never stored plaintext):
```bash
read -s -p "PIN: " PIN; echo
sudo docker exec -e PIN="$PIN" meridian node -e \
 'const c=require("crypto");const s=c.randomBytes(16).toString("hex");console.log("MERIDIAN_DASHBOARD_PIN_HASH="+s+":"+c.scryptSync(process.env.PIN,s,64).toString("hex"))'; unset PIN
# paste the line into ~/meridian/.env, then:
sudo docker compose up -d --force-recreate meridian-web
```
`MERIDIAN_SESSION_SECRET`: `openssl rand -hex 32`.

The PIN is **shared** across all Access-allowed users. Cloudflare's Access log
(Zero Trust → Logs) shows who authenticated.

---

## 8. Runbook

```bash
ssh ubuntu@101.32.216.139 && cd ~/meridian
sudo docker compose ps                          # container status
sudo docker compose logs -f meridian            # daemon logs
sudo docker compose logs -f meridian-web        # dashboard logs
sudo docker exec meridian pm2 list              # process status
sudo docker compose restart meridian-web        # bounce web only
sudo docker compose up -d --force-recreate meridian   # reload daemon (config change)
sudo docker compose stop                        # KILL SWITCH (positions stay open on-chain)
sudo docker compose up -d                       # bring everything back
```
Health probe (what deploy.sh checks): daemon container up + PM2 online + web
`/login` returns 200. Public reachability: `curl -sI https://calisto.nafidinara.com`
should be `302` (redirect into Access).

---

## 9. Troubleshooting (every gotcha this project has hit)

| Symptom | Cause / fix |
|---|---|
| Daemon crash-loop `Directory import … @coral-xyz/anchor … not supported` or `does not provide an export named 'BN'` | Node 22 + `@meteora-ag/dlmm`. Needs `scripts/patch-anchor.js` (wired as `postinstall`). If missing, restore it. |
| `wallet: X SOL ($150)`, `market: fake`, `chain: dryrun` | `MERIDIAN_CHAIN=meteora` not set → demo adapters. It's in compose env. |
| `jupiter-price: all attempts failed → fallback $150` | v6 endpoint sunset. Code uses `lite-api.jup.ag/price/v3` (flat `{mint:{usdPrice}}`). |
| `wallet secret: base58 decode failed` at boot | `WALLET_PRIVATE_KEY` is base64/truncated. Must be base58 (~87-88 chars) or a JSON byte-array. |
| Login always fails / `server not configured` | `.env` value wrapped in quotes (compose passes them literally), or `MERIDIAN_DASHBOARD_PIN_HASH`/`MERIDIAN_SESSION_SECRET` missing. Strip quotes. |
| `Failed to load user-config.json: parse` crash-loop | Schema rejected the config (e.g. `strategy:"auto"`). See §6. Restore a backup from `~/meridian-data/user-config.backup.*.json`. |
| Config edit didn't take effect | Single-file mount inode trap. `up -d --force-recreate meridian`. |
| Cloudflare "That account does not have access" | The login email isn't in the Access policy. Add it, or enable One-time PIN. |
| Browser shows red "Dangerous" | Chrome Enhanced Safe Browsing false positive on a new domain + login form (not on Google's blocklist — transparency report shows "no available data"). Standard Protection users don't see it. |
| Deploy didn't recreate the container | `docker compose up` skips recreate on a repointed tag — deploy.sh uses `--force-recreate`. |
| `MERIDIAN_IMAGE`/`MERIDIAN_REG` override ignored | `sudo docker compose` strips env without `-E`. Only relevant for local-registry testing. |

---

## 10. Rollback & recovery

- **Automatic:** deploy.sh health-checks every release and retags `:previous` →
  `:dashboard` + recreates (same scope) if unhealthy. A bad push never leaves
  trading down.
- **Manual rollback:** `sudo docker tag ghcr.io/umarmuhdhor/meridian:previous
  ghcr.io/umarmuhdhor/meridian:dashboard && sudo docker compose up -d --force-recreate`.
- **State is safe across restarts:** all JSON state persists on `~/meridian-data`
  (`/opt/data` volume); the daemon reconciles open positions on boot.
- **Disarm without stopping:** set `MERIDIAN_WRITE_UNSAFE=false` in `.env` +
  `up -d --force-recreate meridian` — keeps monitoring, blocks new chain writes.

---

## 11. Repo map (deployment-relevant files)

| Path | What |
|---|---|
| `.github/workflows/deploy-dashboard.yml` | the CI/CD pipeline |
| `deploy/deploy.sh` | on-VPS pull → cutover → health-check → rollback |
| `docker-compose.yml` | the 3-container production stack (standalone VPS) |
| `deploy/docker-compose.vivobook.yml` | Caddy + CF-Tunnel variant (retired host) |
| `Dockerfile` | node:22 image; `postinstall` runs `patch-anchor.js` |
| `ecosystem.config.cjs` | PM2 apps `meridian` + `meridian-web` (selected via `--only`) |
| `dashboard/web/` | the Next.js dashboard (auth in `middleware.ts`, `lib/auth-core.ts`) |
| `deploy/PRD-deployment.md`, `PLAN-deployment.md` | **historical** (original vivobook design) — see the note at their top |
