# Hermes `meridian` plugin

Connects **Sage** (a Hermes agent) to the **Meridian** DLMM trading daemon so Sage can
read state and (on request or when delegated) deploy/close/claim via Meridian's
dashboard bridge. This directory is the **source of truth**; the deployed copy lives on
the vivobook at `~/.hermes/profiles/sage/plugins/meridian/`.

## Files
- `plugin.yaml` — manifest (`kind: backend`, 13 `provides_tools`).
- `__init__.py` — `register(ctx)`; registers the 13 tools into the `meridian` toolset. **Relative imports** (`from .tools`) — required for user-dir plugins.
- `tools.py` — tool schemas + handlers.
  - **Reads:** `mrd_get_positions/summary/wallet/candidates/config/performance/decisions/pool_kline`.
  - **Writes (`confirm:true`):** `mrd_deploy_position` (carries `cycle_id`), `mrd_close_position` (**requires `reason` string** — Zod-min:1 on Meridian side), `mrd_claim_fees`, `mrd_update_config` (flat-key patch, live-reloaded, human-gated at the bridge), `mrd_add_lesson` (PREFER/AVOID rule, auto-injected into future screening cycles).
  - **Retrospective trio:** `mrd_get_performance` + `mrd_get_decisions` + `mrd_add_lesson` power the Telegram flow *"we had N losses in a row — analyze and save a lesson"*. Saved lessons appear in Meridian's LESSONS block on the next screening cycle (pinned always; recent 5 unpinned).
  - **Technical analysis:** `mrd_get_pool_kline` returns OHLCV + computed features (spike, at_local_top, atr, vol_spike, trend, support proximity + touches) for a Meteora pool. Multi-timeframe. Screening pre-fetches the same features inline so Sage doesn't need to call this inside a cycle — use it interactively (post-mortems, "was that entry at a spike top?", sanity-check a candidate).
- `client.py` — stdlib (urllib) HTTP client to the bridge. Sends Bearer + explicit User-Agent. Post-migration (2026-08-02) the bridge is intra-host; `MERIDIAN_BRIDGE_CF_CLIENT_ID/SECRET` are unused (kept in client for compat but leave unset). Reads `MERIDIAN_BRIDGE_URL/TOKEN`.
- `test_client.py` — local client tests (`python3 test_client.py`, no Hermes runtime needed).
- `skill/SKILL.md` — Sage's `meridian-ops` operational knowledge skill (mode detection, tool inventory, playbooks, boundaries). Deployed to `~/.hermes/profiles/sage/skills/meridian-ops/SKILL.md`. **Sage's SOUL.md is intentionally NOT modified — this skill loads on demand.**

## Install / update (vivobook)
```
scp deploy/hermes-meridian-plugin/{plugin.yaml,__init__.py,client.py,tools.py} \
  vivobook-public:~/.hermes/profiles/sage/plugins/meridian/
scp deploy/hermes-meridian-plugin/skill/SKILL.md \
  vivobook-public:~/.hermes/profiles/sage/skills/meridian-ops/SKILL.md
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
- Writes go through the bridge `/tool` path → all of Meridian's safety gates + post-hooks (decision log + Telegram card + auto-swap + repo mark-closed) still fire.
- `mrd_update_config` is **hard-gated at the bridge**: `POST /tool` with `name=update_config` + any `cycle_id` → 403 (`human-gated`). Screening delegations always carry `cycle_id`; user chats never do. The plugin schema's description reinforces this ("only when the human user in the CURRENT conversation has EXPLICITLY asked"), but the code gate is authoritative — do not rely on prompt alone.
- Historical (Tencent-era CF-tunneled) architecture + design rationale: [`../SAGE-MERIDIAN-ROLLOUT.md`](../SAGE-MERIDIAN-ROLLOUT.md).
