# Hermes `meridian` plugin

Connects **Sage** (a Hermes agent) to the **Meridian** DLMM trading daemon so Sage can
read state and (on request or when delegated) deploy/close/claim via Meridian's
dashboard bridge. This directory is the **source of truth**; the deployed copy lives on
the vivobook at `~/.hermes/profiles/sage/plugins/meridian/`.

## Files
- `plugin.yaml` — manifest (`kind: backend`, 7 `provides_tools`).
- `__init__.py` — `register(ctx)`; registers the 7 tools into the `meridian` toolset. **Relative imports** (`from .tools`) — required for user-dir plugins.
- `tools.py` — tool schemas + handlers. Reads: `mrd_get_positions/summary/wallet/candidates`. Writes (`confirm:true`): `mrd_deploy_position` (carries `cycle_id`), `mrd_close_position`, `mrd_claim_fees`.
- `client.py` — stdlib (urllib) HTTP client to the bridge. Sends Bearer + CF Access headers + explicit User-Agent. Reads `MERIDIAN_BRIDGE_URL/TOKEN` + `MERIDIAN_BRIDGE_CF_CLIENT_ID/SECRET`.
- `test_client.py` — local client tests (`python3 test_client.py`, no Hermes runtime needed).

## Install / update (vivobook)
```
scp deploy/hermes-meridian-plugin/{plugin.yaml,__init__.py,client.py,tools.py} \
  vivobook-public:~/.hermes/profiles/sage/plugins/meridian/
docker exec hermes /command/s6-svc -r /run/service/gateway-sage   # reload sage only
```
Requires in `sage/config.yaml`: `toolsets: [hermes-cli, meridian]` and `plugins: { enabled: [meridian] }`.

## Notes
- Writes go through the bridge `/tool` path → all of Meridian's safety gates + post-hooks (decision log + Telegram card) still fire.
- Full architecture, CF Access transport, and gotchas: [`../SAGE-MERIDIAN-ROLLOUT.md`](../SAGE-MERIDIAN-ROLLOUT.md).
