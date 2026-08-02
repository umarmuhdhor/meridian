"""Meridian bridge tools for Hermes/Sage.

Read tools (positions/summary/wallet/candidates) map to bridge GET /state/* and
read POST /tool calls. Write tools (deploy/close/claim) POST /tool with
confirm=True — they still pass through Meridian's own safety-gate chain + post
hooks on the bridge side; nothing here bypasses that.

deploy_position accepts an optional cycle_id: when the autonomous screening
delegation supplies one (surfaced in the goal text), passing it through gives the
bridge idempotency guard, so a delegate→timeout→fallback sequence cannot double
deploy. On-demand (user-initiated) calls omit it.
"""

from __future__ import annotations

from typing import Any

from .client import BridgeError, bridge_configured, get, post_tool
from tools.registry import tool_error, tool_result

_STR = {"type": "string"}
_NUM = {"type": "number"}
_INT = {"type": "integer"}


def _check() -> bool:
    return bridge_configured()


def _err(exc: Exception) -> str:
    if isinstance(exc, BridgeError):
        return tool_error(str(exc))
    return tool_error(f"meridian tool failed: {type(exc).__name__}: {exc}")


# ── read tools ────────────────────────────────────────────────────────────

MRD_GET_POSITIONS_SCHEMA = {
    "name": "mrd_get_positions",
    "description": "List Meridian's open DLMM positions (live snapshot: pair, bins, in-range, PnL%, unclaimed fees).",
    "parameters": {"type": "object", "properties": {}},
}


def _handle_get_positions(args: dict, **kw) -> str:
    try:
        return tool_result(get("/state/positions?force=1"))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_GET_SUMMARY_SCHEMA = {
    "name": "mrd_get_summary",
    "description": "Meridian portfolio summary + wallet balance (open count, totals).",
    "parameters": {"type": "object", "properties": {}},
}


def _handle_get_summary(args: dict, **kw) -> str:
    try:
        return tool_result(get("/state/summary"))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_GET_WALLET_SCHEMA = {
    "name": "mrd_get_wallet",
    "description": "Meridian wallet balance (SOL + tokens + USD).",
    "parameters": {"type": "object", "properties": {}},
}


def _handle_get_wallet(args: dict, **kw) -> str:
    try:
        return tool_result(post_tool("get_wallet_balance", {}))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_GET_CANDIDATES_SCHEMA = {
    "name": "mrd_get_candidates",
    "description": "Top screened Meridian pool candidates (hard-filtered + ranked).",
    "parameters": {
        "type": "object",
        "properties": {"limit": _INT, "discover_limit": _INT},
    },
}


def _handle_get_candidates(args: dict, **kw) -> str:
    try:
        limit = int(args.get("limit") or 5)
        discover = int(args.get("discover_limit") or 50)
        return tool_result(post_tool("get_top_candidates", {"limit": limit, "discover_limit": discover}))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── write tools (confirm=True; gated + logged on the bridge) ────────────────

MRD_DEPLOY_SCHEMA = {
    "name": "mrd_deploy_position",
    "description": "Deploy SOL into a Meridian DLMM pool (single-side SOL). Pass cycle_id verbatim if it appears in the task.",
    "parameters": {
        "type": "object",
        "properties": {
            "pool_address": _STR,
            "amount_sol": _NUM,
            "strategy": {"type": "string", "enum": ["spot", "curve", "bid_ask"]},
            "bins_below": _INT,
            "bins_above": _INT,
            "base_mint": _STR,
            "pool_name": _STR,
            "cycle_id": _STR,
        },
        "required": ["pool_address", "amount_sol", "strategy", "bins_below"],
    },
}


def _handle_deploy(args: dict, **kw) -> str:
    try:
        cycle_id = args.get("cycle_id")
        payload = {k: v for k, v in args.items() if k != "cycle_id" and v is not None}
        payload.setdefault("bins_above", 0)
        return tool_result(post_tool("deploy_position", payload, confirm=True, cycle_id=cycle_id))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_CLOSE_SCHEMA = {
    "name": "mrd_close_position",
    "description": "Close a Meridian position by its on-chain position address (user-initiated).",
    "parameters": {
        "type": "object",
        "properties": {"position_address": _STR},
        "required": ["position_address"],
    },
}


def _handle_close(args: dict, **kw) -> str:
    try:
        addr = str(args.get("position_address") or "").strip()
        if not addr:
            return tool_error("position_address is required")
        return tool_result(post_tool("close_position", {"position_address": addr}, confirm=True))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_CLAIM_SCHEMA = {
    "name": "mrd_claim_fees",
    "description": "Claim accrued fees on a Meridian position by its on-chain position address.",
    "parameters": {
        "type": "object",
        "properties": {"position_address": _STR},
        "required": ["position_address"],
    },
}


def _handle_claim(args: dict, **kw) -> str:
    try:
        addr = str(args.get("position_address") or "").strip()
        if not addr:
            return tool_error("position_address is required")
        return tool_result(post_tool("claim_fees", {"position_address": addr}, confirm=True))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── config tools (read + patch; secrets are redacted server-side) ───────────

MRD_GET_CONFIG_SCHEMA = {
    "name": "mrd_get_config",
    "description": (
        "Read Meridian's live user-config.json — every knob Meridian trades by "
        "(screening thresholds, exit rules, deploy amount, cadence, LLM models, "
        "strategy, etc.). Flat key/value shape. Secrets are redacted server-side. "
        "Call this BEFORE mrd_update_config so you know the exact key names + "
        "current values you are changing."
    ),
    "parameters": {"type": "object", "properties": {}},
}


def _handle_get_config(args: dict, **kw) -> str:
    try:
        return tool_result(get("/state/file/user-config"))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_UPDATE_CONFIG_SCHEMA = {
    "name": "mrd_update_config",
    "description": (
        "Patch one or more flat keys in Meridian's user-config.json. Applies live "
        "(no restart). Unknown keys are reported, not applied. Type coercion is "
        "best-effort (number/boolean). Include a short `reason` so the change "
        "shows up in the decision log with context. "
        "Common keys: stopLossPct, takeProfitPct, trailingTriggerPct, trailingDropPct, "
        "deployAmountSol, maxPositions, minFeeActiveTvlRatio, minVolume, minHolders, "
        "screeningIntervalMin, managementIntervalMin, strategy, defaultBinsBelow."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "changes": {
                "type": "object",
                "description": "Flat map of key → new value. Example: {\"stopLossPct\": -20, \"takeProfitPct\": 8}",
            },
            "reason": {
                "type": "string",
                "description": "One-line reason for this change (surfaces in the decision log).",
            },
        },
        "required": ["changes"],
    },
}


def _handle_update_config(args: dict, **kw) -> str:
    try:
        changes = args.get("changes")
        if not isinstance(changes, dict) or not changes:
            return tool_error("changes must be a non-empty object of key → value")
        payload: dict = {"changes": changes}
        reason = args.get("reason")
        if isinstance(reason, str) and reason.strip():
            payload["reason"] = reason.strip()
        return tool_result(post_tool("update_config", payload, confirm=True))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)
