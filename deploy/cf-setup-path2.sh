#!/usr/bin/env bash
# Cloudflare-side setup for Path 2 (Sage <-> Meridian transport).
#
# Auto-mode agents are blocked from mutating live DNS / Access, so run this
# yourself:   bash deploy/cf-setup-path2.sh
#
# It is idempotent — safe to re-run. Creates:
#   1. DNS CNAMEs  mrd-bridge / sage-api  -> the two tunnels (proxied)
#   2. an Access SERVICE TOKEN (machine auth) — prints client id + secret ONCE
#   3. Access self-hosted apps in front of both hostnames requiring that token
#
# It does NOT touch the tunnels' ingress (those are LOCAL configs on each host —
# edit cloudflared config on HK + vivobook per deploy/SAGE-MERIDIAN-ROLLOUT.md).
set -euo pipefail

# Two tokens (complementary scopes) — passed via env, NEVER hardcoded (no secrets in git).
#   CF_DNS_TOKEN    = a token with Zone:DNS:Edit + Account:Cloudflare Tunnel
#   CF_ACCESS_TOKEN = a token with Account:Access Apps and Policies:Edit + Service Tokens
# Run:  CF_DNS_TOKEN=cfat_... CF_ACCESS_TOKEN=cfat_... bash deploy/cf-setup-path2.sh
DNS_TOKEN="${CF_DNS_TOKEN:?set CF_DNS_TOKEN (DNS:Edit + Tunnel)}"
ACCESS_TOKEN="${CF_ACCESS_TOKEN:?set CF_ACCESS_TOKEN (Access:Edit)}"

ACCT=3f85ea8aaf60fe6e93bbe8586ae4bb27
ZONE=a22ddedc86f359ec5ea503a492850fb0
MVPS=eaf7c027-7af5-4bc2-88b8-1263810a39dc   # meridian-vps tunnel (bridge side)
VIVO=a33a2420-1b00-4c25-afb7-f583a1b28df1   # vivobook tunnel (sage side)
API=https://api.cloudflare.com/client/v4

jqget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

dns_upsert(){ # name content
  local name="$1" content="$2" fqdn="$1.nafidinara.com"
  local existing
  existing=$(curl -s -H "Authorization: Bearer $DNS_TOKEN" \
    "$API/zones/$ZONE/dns_records?name=$fqdn" | jqget "len(d.get('result',[]))")
  if [ "$existing" != "0" ]; then echo "DNS $fqdn already exists — skip"; return; fi
  curl -s -H "Authorization: Bearer $DNS_TOKEN" -H "Content-Type: application/json" \
    "$API/zones/$ZONE/dns_records" \
    -d "{\"type\":\"CNAME\",\"name\":\"$name\",\"content\":\"$content\",\"proxied\":true,\"comment\":\"Path2 Sage<->Meridian\"}" \
    | jqget "'DNS $name -> '+('OK' if d.get('success') else str(d.get('errors')))"
}

echo "== 1. DNS =="
dns_upsert mrd-bridge "${MVPS}.cfargotunnel.com"
dns_upsert sage-api   "${VIVO}.cfargotunnel.com"

echo "== 2. Access service token =="
ST_JSON=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  "$API/accounts/$ACCT/access/service_tokens" \
  -d '{"name":"meridian-sage"}')
ST_OK=$(echo "$ST_JSON" | jqget "d.get('success')")
if [ "$ST_OK" = "True" ]; then
  CLIENT_ID=$(echo "$ST_JSON" | jqget "d['result']['client_id']")
  CLIENT_SECRET=$(echo "$ST_JSON" | jqget "d['result'].get('client_secret','(only shown on create — reuse existing)')")
  TOKEN_ID=$(echo "$ST_JSON" | jqget "d['result']['id']")
  echo "service token created:"
  echo "  CF-Access-Client-Id:     $CLIENT_ID"
  echo "  CF-Access-Client-Secret: $CLIENT_SECRET   <-- SAVE NOW, shown once"
else
  echo "service token create failed: $(echo "$ST_JSON" | jqget 'd.get("errors")')"
  echo "(if this is an auth error, the ACCESS token is invalid or lacks Access:Service Tokens Write)"
  echo "existing service tokens:"; curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API/accounts/$ACCT/access/service_tokens" | jqget "[ (t['id'],t['name'],t['client_id']) for t in (d.get('result') or []) ]"
  TOKEN_ID=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" "$API/accounts/$ACCT/access/service_tokens" \
    | jqget "next((t['id'] for t in (d.get('result') or []) if t.get('name')=='meridian-sage'),'')")
  if [ -z "$TOKEN_ID" ]; then echo "No usable Access token — fix the token or run without CF Access."; exit 1; fi
fi

app_upsert(){ # hostname label
  local host="$1" label="$2"
  local existing
  existing=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" "$API/accounts/$ACCT/access/apps" \
    | jqget "next((a['id'] for a in d.get('result',[]) if a.get('domain')=='$host'),'')")
  if [ -n "$existing" ]; then echo "Access app for $host exists ($existing) — skip"; return; fi
  curl -s -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
    "$API/accounts/$ACCT/access/apps" \
    -d "{\"name\":\"$label\",\"domain\":\"$host\",\"type\":\"self_hosted\",\"session_duration\":\"24h\",\"policies\":[{\"name\":\"svc-token\",\"decision\":\"non_identity\",\"include\":[{\"service_token\":{\"token_id\":\"$TOKEN_ID\"}}]}]}" \
    | jqget "'Access app $host -> '+('OK' if d.get('success') else str(d.get('errors')))"
}

echo "== 3. Access apps (service-token gated) =="
app_upsert mrd-bridge.nafidinara.com "Meridian Bridge"
app_upsert sage-api.nafidinara.com   "Sage API"

echo
echo "DONE (Cloudflare side). Next: host-side steps in deploy/SAGE-MERIDIAN-ROLLOUT.md"
echo "  - HK: bridge sidecar (8788) + cloudflared ingress mrd-bridge -> meridian:8788"
echo "  - vivobook: cloudflared ingress sage-api -> sage api :8642"
echo "  - put CF-Access-Client-Id/Secret into BOTH callers so they pass the Access gate"
