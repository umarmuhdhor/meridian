#!/usr/bin/env bash
# Boot BOTH the JS legacy daemon and the new TS daemon side-by-side in isolated
# state directories, both in DRY_RUN mode. Neither daemon touches real chain.
#
# Usage:
#   ./scripts/parallel-run/run-parallel.sh [duration_seconds]
#
# Environment (required — same for both daemons so comparisons are apples-to-apples):
#   RPC_URL                       Solana RPC (read-only for observation)
#   OPENROUTER_API_KEY / LLM_API_KEY
#   MERIDIAN_STATE_DIR_BASE       Optional. Defaults to /tmp/meridian-parallel
#
# Environment (optional, for TS daemon):
#   MERIDIAN_CHAIN=meteora        Read-only Meteora observation. Requires WALLET_PRIVATE_KEY.
#   MERIDIAN_MARKET=real          Use real market adapters (Meteora datapi + Jupiter).
#
# On exit, both daemons are stopped and the decision-log diff is run.

set -euo pipefail

DURATION="${1:-86400}"   # default 24h
BASE_DIR="${MERIDIAN_STATE_DIR_BASE:-/tmp/meridian-parallel}"
JS_DIR="$BASE_DIR/js"
TS_DIR="$BASE_DIR/ts"

log() { printf '[parallel] %s\n' "$*"; }

if [ ! -f "package.json" ]; then
  log "ERROR: run this from the repo root (package.json not found)"
  exit 2
fi

mkdir -p "$JS_DIR" "$TS_DIR"

# Cross-mount both state dirs against the same user-config.example.json to keep
# thresholds identical — real deployments should copy their own user-config.json in.
if [ -f "user-config.json" ]; then
  cp user-config.json "$JS_DIR/user-config.json"
  cp user-config.json "$TS_DIR/user-config.json"
else
  cp user-config.example.json "$JS_DIR/user-config.json"
  cp user-config.example.json "$TS_DIR/user-config.json"
fi

# ── Boot legacy JS daemon ─────────────────────────────────
log "starting JS daemon in $JS_DIR (DRY_RUN=true)"
(
  cd "$JS_DIR"
  DRY_RUN=true \
    RPC_URL="${RPC_URL:-}" \
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    LLM_API_KEY="${LLM_API_KEY:-}" \
    node "$OLDPWD/index.js" > js-daemon.log 2>&1 &
  echo $! > js-daemon.pid
) || { log "FAILED to boot JS daemon"; exit 2; }

# ── Boot TS daemon ────────────────────────────────────────
log "starting TS daemon in $TS_DIR (MERIDIAN_AUTONOMOUS=true, MERIDIAN_WRITE_UNSAFE unset)"
(
  cd "$TS_DIR"
  MERIDIAN_AUTONOMOUS=true \
    MERIDIAN_STATE_DIR="$TS_DIR" \
    MERIDIAN_CHAIN="${MERIDIAN_CHAIN:-dryrun}" \
    MERIDIAN_MARKET="${MERIDIAN_MARKET:-fake}" \
    RPC_URL="${RPC_URL:-}" \
    WALLET_PRIVATE_KEY="${WALLET_PRIVATE_KEY:-}" \
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    LLM_API_KEY="${LLM_API_KEY:-}" \
    node "$OLDPWD/dist/entrypoints/daemon.js" > ts-daemon.log 2>&1 &
  echo $! > ts-daemon.pid
) || { log "FAILED to boot TS daemon"; exit 2; }

JS_PID=$(cat "$JS_DIR/js-daemon.pid")
TS_PID=$(cat "$TS_DIR/ts-daemon.pid")
log "JS PID=$JS_PID  TS PID=$TS_PID"

cleanup() {
  log "stopping daemons..."
  kill "$JS_PID" "$TS_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  log "running decision-log diff:"
  node scripts/parallel-run/diff-decisions.mjs \
    --js "$JS_DIR/decision-log.json" \
    --ts "$TS_DIR/decision-log.json" \
    --window-min "$((DURATION / 60))" || true
}
trap cleanup EXIT INT TERM

log "running for ${DURATION}s — logs at $JS_DIR/js-daemon.log and $TS_DIR/ts-daemon.log"
sleep "$DURATION"
