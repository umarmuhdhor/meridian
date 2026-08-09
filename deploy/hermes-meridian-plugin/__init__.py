"""meridian plugin — connects Sage to the Meridian DLMM trading agent.

Registers 13 tools into the ``meridian`` toolset. Reads are always safe; writes
(deploy/close/claim/update_config/add_lesson) POST the confirm-gated bridge
/tool path, which runs Meridian's own safety gates + post hooks. Tools stay
registered even when the bridge is not configured (so they show in `hermes
tools`) but refuse to dispatch via the check_fn until MERIDIAN_BRIDGE_URL +
MERIDIAN_BRIDGE_TOKEN are set.

Retrospective trio (mrd_get_performance, mrd_get_decisions, mrd_add_lesson)
powers the Telegram flow "we had N losses in a row — learn from it and save
the lesson". Saved lessons auto-inject into future screening cycles via the
LESSONS block in screening/cycle.ts.

Mirrors the plugins/spotify layout (kind: backend, register(ctx)).
"""

from __future__ import annotations

from .tools import (
    MRD_ADD_LESSON_SCHEMA,
    MRD_CLAIM_SCHEMA,
    MRD_CLOSE_SCHEMA,
    MRD_DEPLOY_SCHEMA,
    MRD_GET_CANDIDATES_SCHEMA,
    MRD_GET_CONFIG_SCHEMA,
    MRD_GET_DECISIONS_SCHEMA,
    MRD_GET_PERFORMANCE_SCHEMA,
    MRD_GET_POOL_KLINE_SCHEMA,
    MRD_GET_POSITIONS_SCHEMA,
    MRD_GET_SUMMARY_SCHEMA,
    MRD_GET_WALLET_SCHEMA,
    MRD_UPDATE_CONFIG_SCHEMA,
    _check,
    _handle_add_lesson,
    _handle_claim,
    _handle_close,
    _handle_deploy,
    _handle_get_candidates,
    _handle_get_config,
    _handle_get_decisions,
    _handle_get_performance,
    _handle_get_pool_kline,
    _handle_get_positions,
    _handle_get_summary,
    _handle_get_wallet,
    _handle_update_config,
)

_TOOLS = (
    ("mrd_get_positions", MRD_GET_POSITIONS_SCHEMA, _handle_get_positions, "📊"),
    ("mrd_get_summary", MRD_GET_SUMMARY_SCHEMA, _handle_get_summary, "🧾"),
    ("mrd_get_wallet", MRD_GET_WALLET_SCHEMA, _handle_get_wallet, "👛"),
    ("mrd_get_candidates", MRD_GET_CANDIDATES_SCHEMA, _handle_get_candidates, "🎯"),
    ("mrd_get_config", MRD_GET_CONFIG_SCHEMA, _handle_get_config, "⚙️"),
    ("mrd_get_performance", MRD_GET_PERFORMANCE_SCHEMA, _handle_get_performance, "📈"),
    ("mrd_get_decisions", MRD_GET_DECISIONS_SCHEMA, _handle_get_decisions, "🗒️"),
    ("mrd_get_pool_kline", MRD_GET_POOL_KLINE_SCHEMA, _handle_get_pool_kline, "📉"),
    ("mrd_deploy_position", MRD_DEPLOY_SCHEMA, _handle_deploy, "🚀"),
    ("mrd_close_position", MRD_CLOSE_SCHEMA, _handle_close, "🔒"),
    ("mrd_claim_fees", MRD_CLAIM_SCHEMA, _handle_claim, "💰"),
    ("mrd_update_config", MRD_UPDATE_CONFIG_SCHEMA, _handle_update_config, "🛠️"),
    ("mrd_add_lesson", MRD_ADD_LESSON_SCHEMA, _handle_add_lesson, "🎓"),
)


def register(ctx) -> None:
    """Register all Meridian tools. Called once by the plugin loader."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="meridian",
            schema=schema,
            handler=handler,
            check_fn=_check,
            emoji=emoji,
        )
