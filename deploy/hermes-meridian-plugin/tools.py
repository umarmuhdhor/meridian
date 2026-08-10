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
    "description": (
        "Deploy SOL into a Meridian DLMM pool (single-side SOL). Pass cycle_id verbatim if it "
        "appears in the task. ALWAYS forward the candidate's enrichment fields when they "
        "appear in the candidate block — `bin_step`, `mcap`, `holders`, `organic_score`, "
        "`fee_tvl_ratio`, `volatility`, `smart_wallets_present` — so the position record + "
        "dashboard show real values (mcap range, holders at entry, fee/TVL, etc.) instead of "
        "dashes. Missing them means the tracked position stores nulls for those fields."
    ),
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
            "bin_step": _INT,
            "mcap": _NUM,
            "holders": _INT,
            "organic_score": _NUM,
            "fee_tvl_ratio": _NUM,
            "volatility": _NUM,
            "smart_wallets_present": {"type": "boolean"},
            "cycle_id": _STR,
        },
        "required": [
            "pool_address",
            "amount_sol",
            "strategy",
            "bins_below",
            "pool_name",
            "bin_step",
            "mcap",
            "holders",
            "organic_score",
            "fee_tvl_ratio",
            "volatility",
            "smart_wallets_present",
        ],
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
    "description": (
        "Close a Meridian position by its on-chain position_address (user-initiated). "
        "You MUST provide a short human-readable `reason` — it becomes the "
        "close_reason on the performance record + the Telegram card + the decision "
        "log entry. Quote or paraphrase what the user asked (e.g. \"user asked to "
        "exit BONK\", \"user liquidating before travel\")."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "position_address": _STR,
            "reason": {
                "type": "string",
                "description": "Short human-readable reason for the close. Required.",
            },
        },
        "required": ["position_address", "reason"],
    },
}


def _handle_close(args: dict, **kw) -> str:
    try:
        addr = str(args.get("position_address") or "").strip()
        if not addr:
            return tool_error("position_address is required")
        reason = str(args.get("reason") or "").strip() or "user requested"
        return tool_result(post_tool("close_position", {"position_address": addr, "reason": reason}, confirm=True))
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
        "HUMAN-GATED CONFIG PATCH. Only call this tool when the human user in the "
        "CURRENT conversation has EXPLICITLY asked to change a config value "
        "(e.g. \"lower the stop loss\", \"raise deploy amount to 0.5\", \"pause "
        "screening\"). NEVER call it autonomously — not during screening "
        "delegation, not during scheduled runs, not as a self-improvement, and "
        "not because you inferred a config change would help. If the user only "
        "asked you to REVIEW / EXPLAIN the config, call mrd_get_config and stop. "
        "\n\n"
        "Behavior: patches one or more flat keys in Meridian's user-config.json. "
        "Applies live (no restart). Unknown keys are reported, not applied. Type "
        "coercion is best-effort (number/boolean). Include a short `reason` "
        "quoting the user's request so the decision log has context. "
        "\n\n"
        "Common keys: stopLossPct, takeProfitPct, trailingTriggerPct, "
        "trailingDropPct, deployAmountSol, maxPositions, minFeeActiveTvlRatio, "
        "minVolume, minHolders, screeningIntervalMin, managementIntervalMin, "
        "strategy, defaultBinsBelow."
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


# ── retrospective / learning tools ─────────────────────────────────────────
# Read past closes + past screening decisions so Sage can analyze patterns when
# the user asks ("we had 3 losses in a row, learn from it"). Write a pinned
# lesson via add_lesson so future screening cycles inject the rule automatically
# (LESSONS block in screening/cycle.ts feeds pinned + recent 5).

def _clip(n, default: int, hi: int) -> int:
    try:
        v = int(n)
    except Exception:
        return default
    if v < 1:
        return 1
    if v > hi:
        return hi
    return v


MRD_GET_PERFORMANCE_SCHEMA = {
    "name": "mrd_get_performance",
    "description": (
        "Recent CLOSED-position performance (from lessons.json.performance). Each row: "
        "pool, pool_name, base_mint, strategy, pnl_pct, pnl_usd, fees_earned_usd, "
        "entry_mcap, exit_mcap, volatility, minutes_held, close_reason, closed_at. "
        "Use this to spot patterns after a losing streak (\"which strategies lost?\", "
        "\"which mcap bucket?\", \"same base_mint twice?\"). Prefer a small limit "
        "(default 20) — the last N closes are usually enough."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "How many most-recent closes to return (1-100, default 20)."}
        },
    },
}


def _handle_get_performance(args: dict, **kw) -> str:
    try:
        limit = _clip(args.get("limit"), 20, 100)
        raw = get("/state/file/lessons")
        perf = raw.get("performance") if isinstance(raw, dict) else None
        if not isinstance(perf, list):
            perf = []
        # newest-last on disk; return the tail so the model reads chronologically.
        return tool_result({"performance": perf[-limit:], "total": len(perf)})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_GET_DECISIONS_SCHEMA = {
    "name": "mrd_get_decisions",
    "description": (
        "Recent screening decisions from decision-log.json. Each entry: type "
        "(deploy|close|skip|no_deploy|note), actor, pool, pool_name, summary, "
        "reason, metrics, rejected. Use alongside mrd_get_performance when "
        "diagnosing WHY a losing streak happened — e.g. \"the last 5 no_deploys "
        "all rejected on low fee/TVL, meanwhile we DEPLOYED into 3 losers\"."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "How many most-recent decisions to return (1-100, default 20)."}
        },
    },
}


def _handle_get_decisions(args: dict, **kw) -> str:
    try:
        limit = _clip(args.get("limit"), 20, 100)
        raw = get("/state/file/decision-log")
        decisions = raw.get("decisions") if isinstance(raw, dict) else None
        if not isinstance(decisions, list):
            decisions = []
        return tool_result({"decisions": decisions[-limit:], "total": len(decisions)})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


MRD_ADD_LESSON_SCHEMA = {
    "name": "mrd_add_lesson",
    "description": (
        "Save a PREFER/AVOID/WORKED/FAILED rule that Meridian's next screening "
        "cycle will inject into its LESSONS block (pinned lessons always shown; "
        "recent 5 unpinned also shown). Use this after a retrospective when the "
        "user confirms a pattern is worth remembering. Keep the rule ONE short "
        "sentence, imperative and specific — good: \"AVOID bid_ask with "
        "bins_above=0 on meme coins — instant-OOR risk (Chiikawa, HBULL, MENSA).\" "
        "Bad: \"be careful with bid_ask\". Pin the rule when the evidence is "
        "strong (≥3 confirming closes) so it survives beyond the recent-5 window. "
        "Tags help future filtering — suggested tags: strategy, mcap, volatility, "
        "base_mint, holders, retrospective. NEVER add a lesson without user "
        "confirmation in the same conversation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "rule": {
                "type": "string",
                "description": "One sentence, imperative, specific. Max 500 chars (server truncates).",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional labels for future filtering (e.g. [\"strategy\", \"bid_ask\", \"meme\"]).",
            },
            "pinned": {
                "type": "boolean",
                "description": "True = always injected into future screening prompts. Default false.",
            },
        },
        "required": ["rule"],
    },
}


def _handle_add_lesson(args: dict, **kw) -> str:
    try:
        rule = str(args.get("rule") or "").strip()
        if len(rule) < 3:
            return tool_error("rule is required (min 3 chars)")
        tags_raw = args.get("tags") or []
        tags = [str(t).strip() for t in tags_raw if isinstance(t, (str, int, float)) and str(t).strip()]
        pinned = bool(args.get("pinned"))
        payload = {"rule": rule, "tags": tags, "pinned": pinned}
        return tool_result(post_tool("add_lesson", payload, confirm=True))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── technical analysis (OHLCV + computed features via GeckoTerminal) ────────

_KLINE_TFS = ("1m", "5m", "15m", "1h", "4h", "1d")


MRD_GET_POOL_KLINE_SCHEMA = {
    "name": "mrd_get_pool_kline",
    "description": (
        "Fetch OHLCV + computed technicals for a Meteora pool. Multi-timeframe. "
        "Returns per-timeframe: raw candles + a technicals summary (spike_pct, "
        "at_local_top, at_local_bottom, atr_pct, vol_spike, trend UP|DOWN|FLAT, "
        "from_window_high_pct, nearest_support, support_distance_pct, "
        "support_touches) PLUS a compact `formatted` string. Use this on demand "
        "to check if an entry was at a spike top / near tested support, or to "
        "sanity-check a candidate outside a screening cycle. Never call inside "
        "an autonomous screening cycle — screening already has these numbers "
        "inline in its candidate block."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "pool_address": _STR,
            "timeframes": {
                "type": "array",
                "items": {"type": "string", "enum": list(_KLINE_TFS)},
                "description": "One or more timeframes. Default [\"5m\", \"1h\"] — the same pair screening pre-fetches.",
            },
            "limit": {"type": "integer", "description": "Candles per timeframe (1-500, default 100)."},
        },
        "required": ["pool_address"],
    },
}


def _handle_get_pool_kline(args: dict, **kw) -> str:
    try:
        pool = str(args.get("pool_address") or "").strip()
        if not pool:
            return tool_error("pool_address is required")
        tfs_raw = args.get("timeframes") or ["5m", "1h"]
        if not isinstance(tfs_raw, list) or not tfs_raw:
            return tool_error("timeframes must be a non-empty array")
        tfs = [t for t in tfs_raw if isinstance(t, str) and t in _KLINE_TFS]
        if not tfs:
            return tool_error(f"timeframes must include at least one of {_KLINE_TFS}")
        limit_raw = args.get("limit", 100)
        try:
            limit = int(limit_raw)
        except Exception:
            limit = 100
        if limit < 1:
            limit = 1
        if limit > 500:
            limit = 500
        payload = {"pool_address": pool, "timeframes": tfs, "limit": limit}
        return tool_result(post_tool("get_pool_kline", payload))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)
