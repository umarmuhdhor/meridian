# Sage ⇄ Meridian (Path 2) — rollout runbook

Status of the build (2026-07-14):

| Piece | State |
|-------|-------|
| (C) bridge idempotency (`cycle_id`) | DONE, 408 tests green, off unless `cycle_id` sent |
| (B) screening delegation + fallback | DONE, env-gated `MERIDIAN_DECIDER=sage`, OFF by default |
| (A) Hermes `meridian` plugin | authored + syntax-verified (py3.14); **staged inert** at `~/.hermes/plugins/meridian/` on vivobook (NOT loaded — no restart yet) |
| (D) tailnet + enablement | **NOT executed** — every remaining step disrupts the live agents; listed below for a maintenance window |

Source of truth for the plugin: `deploy/hermes-meridian-plugin/` in this repo. Re-deploy with:
```
scp deploy/hermes-meridian-plugin/{plugin.yaml,__init__.py,client.py,tools.py} \
  vivobook-public:~/.hermes/plugins/meridian/
```

---

## Why the rest is gated

The live agents (bruce/herald/kodex/pulse/sage/vault) share ONE `hermes` container.
Loading the new plugin + enabling the api platform both require a **container restart**
= brief downtime for all six. So nothing below runs without your go-ahead, ideally in
a quiet window. Meridian itself keeps trading throughout (its containers are separate,
on the HK VPS).

Everything is reversible: revert the config edits + restart, or just leave
`MERIDIAN_DECIDER` unset on Meridian and it runs exactly as today.

---

## Step D1 — enable the api platform on the `sage` profile (vivobook)

Sage today runs Telegram only. Add the OpenAI-compatible api server, loopback-bound.

- Set `API_SERVER_KEY` (a strong secret) in sage's profile `.env`.
- Add the `api` platform to `~/.hermes/profiles/sage/config.yaml` platforms (loopback:8642).
- Add the `meridian` toolset so Sage sees the new tools:
  ```yaml
  toolsets:
    - hermes-cli
    - meridian
  ```
- Set the bridge coordinates for the plugin (sage `.env`):
  ```
  MERIDIAN_BRIDGE_URL=http://<meridian-tailnet-host>:8787
  MERIDIAN_BRIDGE_TOKEN=<the Meridian DASHBOARD_TOKEN>
  ```

## Step D2 — tailnet transport (both hosts)

The bridge MUST stay bound to 127.0.0.1 on the HK VPS (safety invariant). Join the HK
VPS to the same tailnet as vivobook, then front the bridge to the tailnet:

- HK VPS: `tailscale up` (join tailnet). Confirm vivobook↔HK reachability.
- HK VPS: `tailscale serve --bg --https=... ` OR a loopback→tailnet forwarder for
  port 8787 (bridge stays loopback; the Bearer token still gates it).
- vivobook: confirm `curl http://<meridian-tailnet-host>:8787/health` returns ok with
  the token.
- Meridian → Sage direction: Meridian env `SAGE_BASE_URL=http://<sage-tailnet-host>:8642`.

## Step D3 — restart the hermes container (DISRUPTIVE — the one downtime)

```
cd ~/.hermes/hermes-agent
export HERMES_UID=$(id -u) HERMES_GID=$(id -g)
docker compose restart gateway
docker compose logs -f gateway   # watch: meridian plugin registered, api on 8642
```
Verify: `hermes -p sage tools | grep mrd_` shows the 7 tools; `curl -H 'Authorization: Bearer $API_SERVER_KEY' http://127.0.0.1:8642/v1/models` returns hermes-agent.

## Step D4 — validate reads first (no writes, no risk)

From Telegram to Sage: "what are my Meridian positions?" → Sage calls `mrd_get_positions`
→ bridge `/state/positions`. Confirms the full tailnet + plugin + bridge path with zero
trading risk.

## Step D5 — arm screening delegation on Meridian (HK), DRYRUN FIRST

On the HK VPS `docker-compose.yml` for Meridian, add (start in dryrun):
```
MERIDIAN_CHAIN=dryrun          # <-- keep dryrun for the gate
MERIDIAN_DECIDER=sage
SAGE_BASE_URL=http://<sage-tailnet-host>:8642
SAGE_API_KEY=<API_SERVER_KEY>
SAGE_SESSION_KEY=meridian-trading
SAGE_TIMEOUT_MS=90000
```
Redeploy Meridian. Watch a screening cycle: log line `decider: SAGE ... fallback armed`,
then a delegated cycle. Kill the Sage endpoint mid-cycle → confirm the `falling back to
local loop` line and that the cycle still completes. Confirm no double deploy.

## Step D6 — go live

Only after D4 + D5 are green: set `MERIDIAN_CHAIN=meteora` again, keep
`MERIDIAN_DECIDER=sage`. First few cycles: small `deployAmountSol`. Watch the first live
delegated deploy end-to-end (decision log + Telegram card come from the bridge post-hooks).

## CONCRETE CUTOVER (discovered 2026-07-14, Cloudflare + CF Access transport)

Recon facts (HK VPS `ubuntu@101.32.216.139`):
- Containers: `meridian` (daemon, owns netns, bridge on 127.0.0.1:8787, NOT published),
  `meridian-web` (shares netns), `meridian-cloudflared`, `n8n`. Docker net `meridian_mnet`.
- CF account `3f85ea8aaf60fe6e93bbe8586ae4bb27`, zone `nafidinara.com`
  `a22ddedc86f359ec5ea503a492850fb0`.
- Tunnels: `meridian-vps` `eaf7c027-7af5-4bc2-88b8-1263810a39dc` (ingress: calisto→meridian:3000),
  `vivobook` `a33a2420-1b00-4c25-afb7-f583a1b28df1` (ssh + 9router→caddy:80).
- Provided CF API token has **Tunnel:Edit but NOT DNS:Edit / Access:Edit**.

These steps are security/funds-sensitive on a LIVE box — run them yourself (or approve
outside auto mode). None restart the `meridian` daemon except the final arming.

### 1. Broaden the CF token (you, dashboard)
Add **Zone.DNS:Edit** + **Access: Apps and Policies:Edit** for `nafidinara.com`.

### 2. HK bridge sidecar (no daemon restart) — exposes 127.0.0.1:8787 to the tunnel net
```
docker rm -f meridian-bridge-proxy 2>/dev/null
docker run -d --name meridian-bridge-proxy --restart unless-stopped \
  --network container:meridian \
  alpine/socat tcp-listen:8788,fork,reuseaddr tcp-connect:127.0.0.1:8787
```
This is a security-weakening change (bridge leaves loopback) — that's why an agent in
auto mode is blocked from doing it. Verify:
```
TOK=$(docker inspect meridian --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DASHBOARD_TOKEN=//p')
docker run --rm --network meridian_mnet curlimages/curl:latest -s -H "Authorization: Bearer $TOK" http://meridian:8788/health
```

### 3. CF Access + ingress + DNS (needs the broadened token)
- Access service token (machine auth): create one; put an Access app in front of
  `mrd-bridge.nafidinara.com` and `sage-api.nafidinara.com` requiring that service token.
- meridian-vps tunnel ingress (GET current, APPEND before the 404, PUT full):
  add `{ "hostname": "mrd-bridge.nafidinara.com", "service": "http://meridian:8788" }`
  (keep the existing calisto rule first).
- vivobook tunnel ingress: add `sage-api.nafidinara.com` → the Sage api (route via
  `caddy:80` → host `:8642`, or a socat on vivobook). 
- DNS: CNAME `mrd-bridge` → `<meridian-vps-tunnel-id>.cfargotunnel.com` (proxied),
  CNAME `sage-api` → `<vivobook-tunnel-id>.cfargotunnel.com` (proxied).

### 4. Enable Sage api + plugin (vivobook) — the ONE hermes restart (6 agents blip)
- sage `.env`: `API_SERVER_KEY=…`, `MERIDIAN_BRIDGE_URL=https://mrd-bridge.nafidinara.com`,
  `MERIDIAN_BRIDGE_TOKEN=<meridian DASHBOARD_TOKEN>`, plus the CF Access service-token
  header if using Access.
- sage `config.yaml`: add `api` platform (loopback:8642) + `meridian` to `toolsets`.
- `cd ~/.hermes/hermes-agent && docker compose restart gateway`
- Verify reads: Telegram → Sage → "my Meridian positions?" → mrd_get_positions → bridge.

### 5. Arm Meridian (HK) — DISRUPTIVE to the daemon; real money on first live cycle
Edit `/home/ubuntu/meridian/.env` (or compose environment), add:
```
MERIDIAN_DECIDER=sage
SAGE_BASE_URL=https://sage-api.nafidinara.com
SAGE_API_KEY=<sage API_SERVER_KEY>
SAGE_SESSION_KEY=meridian-trading
SAGE_TIMEOUT_MS=90000
```
`docker compose up -d meridian` (recreates the daemon). Watch a cycle: `decider: SAGE …
fallback armed`. First few live cycles: keep `deployAmountSol` small.

NOTE: the live box runs `MERIDIAN_CHAIN=meteora` (real). There is no free dryrun on it;
the dryrun gate was validated locally (409 tests + the E2E integration test). On the live
box, the safety net is the OpenRouter fallback + small deploy size for the first cycles.

## Rollback

- Meridian: unset `MERIDIAN_DECIDER` (or set `=loop`) + redeploy → back to the local loop.
- Sage: remove `meridian` from `toolsets` and the `api` platform, restart gateway.
- Plugin files under `~/.hermes/plugins/meridian/` are inert once the toolset is removed.
