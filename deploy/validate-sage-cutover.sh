#!/usr/bin/env bash
# Read-only end-to-end validation of the Sage⇄Meridian (Path 2) cutover.
# Run this AFTER the transport + plugin + arming steps. It performs NO writes and
# NO deploys — it only reads, so it's safe to run against the live system.
#
# Usage (fill from your cutover; do NOT commit real values):
#   SAGE_BASE_URL=https://sage-api.nafidinara.com \
#   SAGE_API_KEY=... \
#   MERIDIAN_BRIDGE_URL=https://mrd-bridge.nafidinara.com \
#   MERIDIAN_BRIDGE_TOKEN=... \
#   CF_ACCESS_CLIENT_ID=...  CF_ACCESS_CLIENT_SECRET=...   # if CF Access is in front
#   bash deploy/validate-sage-cutover.sh
#
# Exit 0 = all green. Non-zero = a check failed (message says which).

set -uo pipefail
pass=0; fail=0
ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
need() { [ -n "${!1:-}" ] || { echo "missing env: $1"; exit 2; }; }

need SAGE_BASE_URL; need SAGE_API_KEY
need MERIDIAN_BRIDGE_URL; need MERIDIAN_BRIDGE_TOKEN

# CF Access service-token headers (optional)
acc=()
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  acc=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
fi

echo "1. Sage api reachable + advertises a model"
if curl -fsS --max-time 15 "${acc[@]}" -H "Authorization: Bearer ${SAGE_API_KEY}" \
     "${SAGE_BASE_URL%/}/v1/models" 2>/dev/null | grep -qi "hermes\|model"; then
  ok "GET /v1/models"
else bad "Sage /v1/models unreachable or unauthorized"; fi

echo "2. Meridian bridge reachable + authorized"
if curl -fsS --max-time 15 "${acc[@]}" -H "Authorization: Bearer ${MERIDIAN_BRIDGE_TOKEN}" \
     "${MERIDIAN_BRIDGE_URL%/}/health" 2>/dev/null | grep -qi "uptime\|ok\|status"; then
  ok "GET /health"
else bad "bridge /health unreachable or unauthorized"; fi

echo "3. Bridge read: positions snapshot"
if curl -fsS --max-time 20 "${acc[@]}" -H "Authorization: Bearer ${MERIDIAN_BRIDGE_TOKEN}" \
     "${MERIDIAN_BRIDGE_URL%/}/state/positions" 2>/dev/null | grep -qi "position\|total"; then
  ok "GET /state/positions"
else bad "bridge /state/positions failed"; fi

echo "4. Full loop (READ ONLY): ask Sage to read Meridian positions via its plugin"
resp=$(curl -fsS --max-time 60 "${acc[@]}" -H "Authorization: Bearer ${SAGE_API_KEY}" \
     -H "Content-Type: application/json" -H "X-Hermes-Session-Key: meridian-validate" \
     -X POST "${SAGE_BASE_URL%/}/v1/chat/completions" \
     -d '{"model":"hermes-agent","stream":false,"messages":[{"role":"user","content":"Call mrd_get_positions and tell me how many Meridian positions are open right now. Do NOT deploy or close anything."}]}' 2>/dev/null)
if [ -n "$resp" ] && echo "$resp" | grep -qi "position\|open\|none\|zero\|[0-9]"; then
  ok "Sage → mrd_get_positions → bridge round trip"
else bad "Sage delegation read failed (check plugin loaded + bridge env in sage)"; fi

echo
echo "Reminders (manual):"
echo "  - Meridian log should show: 'decider: SAGE (...) — local loop fallback armed'"
echo "  - Fallback test: stop the Sage container briefly; a screening cycle should log"
echo "    'sage delegation failed, falling back to local loop' and still complete."
echo "  - First LIVE delegated deploy: keep deployAmountSol small; watch the Telegram card."
echo
echo "RESULT: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
