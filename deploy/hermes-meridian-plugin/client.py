"""HTTP client to the Meridian dashboard bridge.

The bridge binds 127.0.0.1 on the Meridian host and is fronted to the tailnet
(tailscale serve) with a Bearer token. Reads:

- ``MERIDIAN_BRIDGE_URL``   e.g. http://meridian-host.tailnet:8787  (no trailing /)
- ``MERIDIAN_BRIDGE_TOKEN`` the bridge DASHBOARD_TOKEN

Stdlib-only (urllib) so the plugin adds no dependency to the Hermes image.
Handlers are synchronous, matching the Hermes tool contract.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional


class BridgeError(Exception):
    """Raised on any non-2xx response or transport failure."""


def _base_url() -> str:
    return (os.getenv("MERIDIAN_BRIDGE_URL") or "").rstrip("/")


def _token() -> str:
    return os.getenv("MERIDIAN_BRIDGE_TOKEN") or ""


def bridge_configured() -> bool:
    """True when both the bridge URL and token are set (used as the tool check_fn)."""
    return bool(_base_url() and _token())


def _request(method: str, path: str, body: Optional[dict] = None, timeout: float = 30.0) -> Any:
    base = _base_url()
    if not base or not _token():
        raise BridgeError("Meridian bridge not configured (set MERIDIAN_BRIDGE_URL + MERIDIAN_BRIDGE_TOKEN)")
    url = f"{base}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    # Cloudflare blocks the default "Python-urllib" User-Agent (403 / error 1010),
    # so set an explicit one. The endpoint is auth-gated by CF Access + Bearer.
    req.add_header("User-Agent", "meridian-sage-plugin/0.1")
    req.add_header("Authorization", f"Bearer {_token()}")
    # Cloudflare Access service-token auth (when the bridge is fronted by CF Access).
    cf_id = os.getenv("MERIDIAN_BRIDGE_CF_CLIENT_ID")
    cf_secret = os.getenv("MERIDIAN_BRIDGE_CF_CLIENT_SECRET")
    if cf_id and cf_secret:
        req.add_header("CF-Access-Client-Id", cf_id)
        req.add_header("CF-Access-Client-Secret", cf_secret)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:  # non-2xx
        detail = ""
        try:
            detail = exc.read().decode("utf-8")[:300]
        except Exception:
            pass
        raise BridgeError(f"bridge {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:  # DNS / connection / timeout
        raise BridgeError(f"bridge unreachable: {exc.reason}") from exc
    return json.loads(raw) if raw else {}


def get(path: str, timeout: float = 30.0) -> Any:
    return _request("GET", path, None, timeout)


def post_tool(
    name: str,
    args: dict,
    confirm: bool = False,
    cycle_id: Optional[str] = None,
    timeout: float = 60.0,
) -> Any:
    """POST /tool. Writes require confirm=True; cycle_id gives idempotent writes."""
    body: dict = {"name": name, "args": args, "confirm": confirm}
    if cycle_id:
        body["cycle_id"] = cycle_id
    return _request("POST", "/tool", body, timeout)
