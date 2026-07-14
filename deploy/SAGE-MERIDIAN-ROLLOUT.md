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

## Rollback

- Meridian: unset `MERIDIAN_DECIDER` (or set `=loop`) + redeploy → back to the local loop.
- Sage: remove `meridian` from `toolsets` and the `api` platform, restart gateway.
- Plugin files under `~/.hermes/plugins/meridian/` are inert once the toolset is removed.
