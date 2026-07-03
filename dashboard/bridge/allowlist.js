// dashboard/bridge/allowlist.js
// Tool + file allowlists for the dashboard bridge.
// Names verified against tools/definitions.js per 2026-07-03 (PRD §8.8, reference.md §3).
// self_update and anything outside these two sets is denied by default.

export const READ_TOOLS = new Set([
  "get_my_positions", "get_position_pnl", "get_wallet_balance", "get_wallet_positions",
  "get_top_candidates", "get_pool_detail", "get_active_bin", "get_pool_memory",
  "get_recent_decisions", "get_performance_history", "list_lessons", "list_strategies",
  "list_smart_wallets", "list_blacklist", "list_blocked_deployers", "check_smart_wallets_on_pool",
]);

export const WRITE_TOOLS_DASHBOARD = new Set([
  "deploy_position", "close_position", "claim_fees", "swap_token", "set_position_note",
  "add_lesson", "pin_lesson", "unpin_lesson", "clear_lessons", "add_strategy", "remove_strategy",
  "set_active_strategy", "update_config", "add_to_blacklist", "remove_from_blacklist",
  "add_smart_wallet", "remove_smart_wallet", "block_deployer", "unblock_deployer",
]);

// :name → file at repo root (GET /state/file/:name). user-config is redacted before send.
export const FILE_WHITELIST = {
  "lessons": "lessons.json",
  "decision-log": "decision-log.json",
  "pool-memory": "pool-memory.json",
  "signal-weights": "signal-weights.json",
  "strategy-library": "strategy-library.json",
  "smart-wallets": "smart-wallets.json",
  "token-blacklist": "token-blacklist.json",
  "dev-blocklist": "dev-blocklist.json",
  "state": "state.json",
  "user-config": "user-config.json",
};

export const isReadTool = (n) => READ_TOOLS.has(n);
export const isWriteTool = (n) => WRITE_TOOLS_DASHBOARD.has(n);
export const isAllowedTool = (n) => isReadTool(n) || isWriteTool(n); // self_update & others → false
export const resolveFile = (name) => (Object.prototype.hasOwnProperty.call(FILE_WHITELIST, name) ? FILE_WHITELIST[name] : null);
