# Hermes `meridian` plugin

Connects **Sage** (a Hermes agent) to the **Meridian** DLMM trading daemon so Sage can
read state and (on request or when delegated) deploy/close/claim via Meridian's
dashboard bridge. This directory is the **source of truth**; the deployed copy lives on
the vivobook at `~/.hermes/profiles/sage/plugins/meridian/`.

## Files
- `plugin.yaml` — manifest (`kind: backend`, 7 `provides_tools`).
- `__init__.py` — `register(ctx)`; registers the 7 tools into the `meridian` toolset. **Relative imports** (`from .tools`) — required for user-dir plugins.
- `tools.py` — tool schemas + handlers. Reads: `mrd_get_positions/summary/wallet/candidates`. Writes (`confirm:true`): `mrd_deploy_position` (carries `cycle_id`), `mrd_close_position`, `mrd_claim_fees`.
- `client.py` — stdlib (urllib) HTTP client to the bridge. Sends Bearer + explicit User-Agent. Post-migration (2026-08-02) the bridge is intra-host; `MERIDIAN_BRIDGE_CF_CLIENT_ID/SECRET` are unused (kept in client for compat but leave unset). Reads `MERIDIAN_BRIDGE_URL/TOKEN`.
- `test_client.py` — local client tests (`python3 test_client.py`, no Hermes runtime needed).

## Install / update (vivobook)
```
scp deploy/hermes-meridian-plugin/{plugin.yaml,__init__.py,client.py,tools.py} \
  vivobook-public:~/.hermes/profiles/sage/plugins/meridian/
docker exec hermes /command/s6-svc -r /run/service/gateway-sage   # reload sage only
```
Requires in `sage/config.yaml`: `toolsets: [hermes-cli, meridian]` and `plugins: { enabled: [meridian] }`.

## Bridge env (vivobook, post-migration)

Meridian's dashboard bridge listens on `127.0.0.1:8787` inside the meridian
container's netns. A socat sidecar (`meridian-bridge-proxy` in Meridian's
docker-compose) forwards it to the vivobook host loopback on `:8788`. Since
`hermes` runs `network_mode: host`, the plugin reaches it directly:

```
# ~/.hermes/profiles/sage/config.yaml  (or wherever env is set for sage)
MERIDIAN_BRIDGE_URL=http://127.0.0.1:8788
MERIDIAN_BRIDGE_TOKEN=<same value as DASHBOARD_TOKEN/BRIDGE_TOKEN in Meridian's .env>
# MERIDIAN_BRIDGE_CF_CLIENT_ID=   # leave unset — no CF Access on intra-host
# MERIDIAN_BRIDGE_CF_CLIENT_SECRET=
```

Verify from the vivobook host:
```
curl -sSf -H "Authorization: Bearer $MERIDIAN_BRIDGE_TOKEN" \
  http://127.0.0.1:8788/health
```

## Notes
- Writes go through the bridge `/tool` path → all of Meridian's safety gates + post-hooks (decision log + Telegram card) still fire.
- Historical (Tencent-era CF-tunneled) architecture + design rationale: [`../SAGE-MERIDIAN-ROLLOUT.md`](../SAGE-MERIDIAN-ROLLOUT.md).
