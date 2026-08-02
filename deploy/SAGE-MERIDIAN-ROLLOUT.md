# Sage ⇄ Meridian (Path 2) — live architecture & operations

**⚠️ SUPERSEDED (2026-08-01).** This doc describes the Tencent-era Path 2 architecture
where Meridian (on Tencent HK VPS) reached Sage on vivobook over a Cloudflare Tunnel
(`sage-api.nafidinara.com` + `mrd-bridge.nafidinara.com`) with CF Access service tokens.
Meridian is now co-located with Sage on vivobook; delegation is intra-host via
`http://host.docker.internal:8643` (socat → hermes:8642, no CF Access). Current
architecture in [`OPERATIONS.md §1`](OPERATIONS.md#1-architecture); migration story in
[`MIGRATION-vivobook-runbook.md`](MIGRATION-vivobook-runbook.md). Kept for git-blame
context on the delegation design.

---

**Status: LIVE (2026-07-14).** Sage (a Hermes agent on the vivobook home server) is
Meridian's primary screening decider. It reasons with its own memory, deploys real
funds through Meridian's dashboard bridge, and answers questions in the Telegram
group. Meridian's local LLM loop (OpenRouter) is the automatic fallback. Deterministic
rules (screening hard-filter, the 5 close rules, management exits) are unchanged.

This doc is the single source of truth for the integration. Code internals live in
[`../CLAUDE.md`](../CLAUDE.md); general Meridian ops in [`OPERATIONS.md`](OPERATIONS.md).

---

## What runs where

| Host | Piece |
|------|-------|
| **HK VPS** `ubuntu@101.32.216.139` | `meridian` daemon (owns netns; bridge on 127.0.0.1:8787), `meridian-web`, `meridian-cloudflared`, **`meridian-bridge-proxy`** (socat 8788→8787), `n8n`. |
| **vivobook** `nafidinara@…` (Tailscale/CF) | `hermes` container: 6 agent gateways incl. **`sage`** (Telegram + api_server:8642) + the `meridian` plugin; `hermes-dashboard`. |
| **Cloudflare** | zone `nafidinara.com`; CF Access service-token-gated hostnames `mrd-bridge.nafidinara.com` (→ HK bridge) and `sage-api.nafidinara.com` (→ Sage api). |

## Data flow

```
AUTONOMOUS SCREENING (Sage decides, real funds)
  Meridian cron (HK)                                   Sage api (vivobook)
    preflight + hardFilter + rankCandidates  [deterministic, unchanged]
    POST /v1/chat/completions ──CF Access──▶  reason w/ meridian-trading memory
      {tailored goal + candidates + cycle_id}          pick a candidate
      X-Hermes-Session-Key: meridian-trading           call mrd_deploy_position(cycle_id)
      timeout 90s                                            │
                    mrd-bridge.nafidinara.com ◀──CF Access──┘
                    → cloudflared → bridge-proxy:8788 → bridge 127.0.0.1:8787
                      → executeTool → safety gates → meteora write → on-chain
    ◀── prose summary ; Meridian reconciles positions(force) → "deploy landed"
    on timeout/transport error → OpenRouter local loop (same cycle_id; bridge
      idempotency blocks a double-deploy)

ON-DEMAND (you ↔ Sage in the "Meridian Calisto" Telegram group)
  you → Sage (@SageHermesAnd_bot) → mrd_get_positions / analyze / close → bridge
  Calisto (Meridian's own bot) posts ✅Deployed / 📪Closed cards — notify-only, no LLM
```

## Live config

**Meridian (HK) `~/meridian/.env`** — arming + Calisto static:
```
MERIDIAN_DECIDER=sage
SAGE_BASE_URL=https://sage-api.nafidinara.com
SAGE_API_KEY=<sage API_SERVER_KEY>
SAGE_SESSION_KEY=meridian-trading
SAGE_CF_ACCESS_CLIENT_ID=207fb797a4051e5696b9d4c426c110e6.access
SAGE_CF_ACCESS_CLIENT_SECRET=<held by owner>
SAGE_TIMEOUT_MS=90000
MERIDIAN_TELEGRAM_INBOUND=false     # Calisto = notify-only (cards, no LLM replies)
```
`user-config.json`: `deployAmountSol=0.2`, `maxPositions=3`, chain=meteora.
`meridian-bridge-proxy` is a durable **compose service** in `docker-compose.yml`
(`network_mode: service:meridian`) so `up -d --force-recreate` re-attaches it every deploy.

**Sage (vivobook)** — `~/.hermes/profiles/sage/.env`:
```
API_SERVER_KEY=<secret>            API_SERVER_HOST=127.0.0.1   API_SERVER_PORT=8642
MERIDIAN_BRIDGE_URL=https://mrd-bridge.nafidinara.com
MERIDIAN_BRIDGE_TOKEN=<meridian DASHBOARD_TOKEN>
MERIDIAN_BRIDGE_CF_CLIENT_ID=207fb797a4051e5696b9d4c426c110e6.access
MERIDIAN_BRIDGE_CF_CLIENT_SECRET=<secret>
```
`~/.hermes/profiles/sage/config.yaml`:
```yaml
toolsets: [hermes-cli, meridian]
platforms: { api_server: { enabled: true, extra: { port: 8642, host: 127.0.0.1 } } }
plugins:   { enabled: [meridian] }
telegram:
  allowed_chats: '-1004388814457'
  extra:
    require_mention: false                    # reply to every group message
    exclusive_bot_mentions: false
    observe_unmentioned_group_messages: true  # always ingest group context
    allowed_chats: '-1004388814457'
```
Plugin source of truth: [`hermes-meridian-plugin/`](hermes-meridian-plugin/) in this
repo. It must be installed at **`~/.hermes/profiles/sage/plugins/meridian/`** (the
profile dir — Hermes sets `HERMES_HOME` to the profile when run with `-p sage`).

## Cloudflare transport

- DNS: proxied CNAMEs `mrd-bridge`→`eaf7c027-…cfargotunnel.com`, `sage-api`→`a33a2420-…cfargotunnel.com`.
- CF Access self-hosted apps in front of both hostnames, policy = service token `meridian-sage`.
- Tunnel ingress (remotely-managed, edited via API): meridian-vps adds
  `mrd-bridge→http://meridian:8788`; vivobook adds `sage-api→http://192.168.1.26:8643`.
- vivobook `sage-api-proxy` socat (host net) `0.0.0.0:8643→127.0.0.1:8642`; **an iptables
  INPUT allow is required** (`-s 172.18.0.0/16 --dport 8643 ACCEPT`) — the host drops
  container→host ports except 22.
- Both callers send an explicit `User-Agent` (CF blocks default programmatic UAs → 403/err 1010).
- Re-create the CF side idempotently: `CF_DNS_TOKEN=… CF_ACCESS_TOKEN=… bash deploy/cf-setup-path2.sh`.

## Operating

- **Reload Sage only** (config change, no 6-agent blip):
  `docker exec hermes /command/s6-svc -r /run/service/gateway-sage`
- **Redeploy Meridian**: push to `dashboard` → CI builds + `docker compose up -d --force-recreate`
  (recreates meridian + web + bridge-proxy together). Runtime changes need a src/compose
  edit (docs/`.github`-only pushes are scope=none, skipped).
- **Verify transport**:
  `curl -A meridian-daemon/1.0 -H 'CF-Access-Client-Id: …' -H 'CF-Access-Client-Secret: …' -H 'Authorization: Bearer <key>' https://sage-api.nafidinara.com/v1/models` → 200;
  same shape against `https://mrd-bridge.nafidinara.com/state/positions?force=1` with the bridge DASHBOARD_TOKEN → 200.
- **Confirm armed**: HK `docker compose logs meridian | grep decider` → `decider: SAGE … fallback armed`.

## Rollback

- Disarm Sage (back to local loop): HK `~/meridian/.env` remove/`=loop` `MERIDIAN_DECIDER`, `docker compose up -d meridian`.
- Re-enable Calisto LLM replies: remove `MERIDIAN_TELEGRAM_INBOUND=false`, redeploy.
- Sage out of group: set `require_mention: true` (or remove `allowed_chats`), s6 restart sage.
- Backups on disk: HK `.env.bak-path2`, `user-config.json.bak-path2`; vivobook sage `config.yaml.bak-path2`, `.env.bak-path2`, `config.yaml.bak-group`.

## Gotchas hit (and fixed) — do not re-trip

1. **Hermes api is agentic**, not a raw model — it never returns `tool_calls` (tool_execution: server). So this is agentic *delegation*, not an LLMClient swap.
2. **User plugins load from the PROFILE dir** `~/.hermes/profiles/<p>/plugins/`, need `plugins.enabled: [<name>]`, and must use **relative imports** (`from .tools import …`, not `from plugins.meridian.…`).
3. **Cloudflare blocks default UAs** (Python-urllib / undici) with 403 / error 1010 → set explicit `User-Agent` on both callers.
4. **Host firewall drops container→host ports** except 22 → the `sage-api` origin needs the iptables allow for 8643.
5. **bridge-proxy orphans on meridian recreate** unless it's a compose service sharing meridian's netns (fixed).
6. **Delegation prompt must be Sage-tailored** — sending Meridian's full SCREENER prompt (12 tool names Sage lacks) made Sage flail and time out; the focused "pick a candidate, call mrd_deploy_position, no other tools" prompt is what makes Sage actually decide.
7. **Never double-restart `docker compose … gateway` mid-drain** — profiles get stranded in `draining` (reconcile only starts prior_state=running). One restart, full 120s settle; or reload one profile via s6.
