#!/usr/bin/env bash
#
# deploy.sh <image-sha> <scope> [--dry-run]
#
# Runs ON the VPS (invoked by the GitHub Actions deploy step over SSH). Pulls a
# pre-built, pre-tested image from GHCR, cuts over the right container(s), health
# checks, and AUTO-ROLLS-BACK to the previous image if the new one is unhealthy.
# A bad push must never leave trading down.
#
#   scope = web-only  → recreate ONLY meridian-web (daemon keeps trading)
#         = full       → recreate daemon + web (~15s trading gap)
#
#   pull :sha → tag current :dashboard → :previous (rollback point)
#             → tag :sha → :dashboard → up -d (scoped)
#             → health-check ≤ HEALTH_TIMEOUT
#                   healthy   → done
#                   unhealthy → retag :previous → :dashboard → up -d → exit 1
#
set -euo pipefail

SHA="${1:?usage: deploy.sh <sha> <scope> [--dry-run]}"
SCOPE="${2:?usage: deploy.sh <sha> <scope> [--dry-run]}"
DRY_RUN="no"
[ "${3:-}" = "--dry-run" ] && DRY_RUN="yes"

# Registry/image base. Override MERIDIAN_REG for testing against a local registry.
REG="${MERIDIAN_REG:-ghcr.io/umarmuhdhor/meridian}"
COMPOSE_DIR="${MERIDIAN_DIR:-$HOME/meridian}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
DC="sudo docker"

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }
run() {
  if [ "$DRY_RUN" = "yes" ]; then echo "DRY-RUN> $*"; else eval "$*"; fi
}

case "$SCOPE" in web-only|full) ;; *) echo "invalid scope: $SCOPE (want web-only|full)"; exit 2 ;; esac
cd "$COMPOSE_DIR"

# ── container health probes ──────────────────────────────────────────────────
container_up() {
  # running AND not stuck restarting (crash-loop)
  local name="$1"
  local running restarting
  running=$($DC inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)
  restarting=$($DC inspect -f '{{.State.Restarting}}' "$name" 2>/dev/null || echo true)
  [ "$running" = "true" ] && [ "$restarting" = "false" ]
}
web_serves() {
  $DC exec meridian-web node -e \
    'fetch("http://127.0.0.1:3000/login").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' \
    >/dev/null 2>&1
}
daemon_ok() {
  # daemon container healthy + its PM2 app online (armed line is logged at boot;
  # a crash-loop shows as Restarting=true / pm2 errored, both caught here).
  container_up meridian || return 1
  $DC exec meridian pm2 jlist 2>/dev/null | grep -q '"name":"meridian".*"status":"online"' \
    || $DC exec meridian pm2 list 2>/dev/null | grep -qE "meridian .*online"
}

healthcheck() {
  local deadline=$(( SECONDS + HEALTH_TIMEOUT ))
  while [ $SECONDS -lt $deadline ]; do
    if daemon_ok && web_serves; then log "healthy"; return 0; fi
    sleep 3
  done
  log "UNHEALTHY after ${HEALTH_TIMEOUT}s"
  return 1
}

rollback() {
  log "ROLLING BACK to :previous"
  run "$DC tag ${REG}:previous ${REG}:dashboard"
  # Roll back the SAME scope we deployed — a failed web deploy must not restart
  # the trading daemon.
  if [ "$SCOPE" = "web-only" ]; then
    run "$DC compose up -d --no-deps --force-recreate meridian-web"
  else
    run "$DC compose up -d --force-recreate"
  fi
  # Give the rollback a moment; report but don't loop.
  sleep 8
  if [ "$DRY_RUN" = "no" ] && daemon_ok; then log "rollback healthy"; else log "rollback state uncertain — CHECK MANUALLY"; fi
}

# ── deploy ───────────────────────────────────────────────────────────────────
log "deploy sha=$SHA scope=$SCOPE dry_run=$DRY_RUN"

# Save the current image as the rollback point (best-effort; first deploy has none).
run "$DC tag ${REG}:dashboard ${REG}:previous 2>/dev/null || true"

log "pulling ${REG}:${SHA}"
run "$DC pull ${REG}:${SHA}"
run "$DC tag ${REG}:${SHA} ${REG}:dashboard"

if [ "$SCOPE" = "web-only" ]; then
  log "web-only cutover (daemon untouched)"
  # --force-recreate: the tag was repointed to a new image ID; without it
  # compose may see the same tag string and skip the recreate.
  run "$DC compose up -d --no-deps --force-recreate meridian-web"
else
  log "full cutover (daemon + web)"
  run "$DC compose up -d --force-recreate"
fi

if [ "$DRY_RUN" = "yes" ]; then log "dry-run complete"; exit 0; fi

if healthcheck; then
  log "deploy OK — sha=$SHA live"
  $DC image prune -f >/dev/null 2>&1 || true
  exit 0
else
  rollback
  exit 1
fi
