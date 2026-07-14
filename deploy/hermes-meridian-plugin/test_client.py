"""Local tests for client.py (stdlib-only, no Hermes runtime needed).

Run: python3 deploy/hermes-meridian-plugin/test_client.py
"""

import io
import json
import os
import sys
import urllib.error

import client as c


def _reset_env(url="http://bridge.tailnet:8787", token="tok"):
    if url is None:
        os.environ.pop("MERIDIAN_BRIDGE_URL", None)
    else:
        os.environ["MERIDIAN_BRIDGE_URL"] = url
    if token is None:
        os.environ.pop("MERIDIAN_BRIDGE_TOKEN", None)
    else:
        os.environ["MERIDIAN_BRIDGE_TOKEN"] = token


class _FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _install_opener(capture, *, raise_exc=None, body=None):
    def fake_urlopen(req, timeout=None):
        capture["url"] = req.full_url
        capture["method"] = req.get_method()
        capture["headers"] = dict(req.header_items())
        capture["data"] = req.data
        if raise_exc:
            raise raise_exc
        return _FakeResp(json.dumps(body if body is not None else {"ok": True}).encode())

    c.urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]


def run():
    passed = 0

    # 1. not configured → bridge_configured False + BridgeError
    _reset_env(url=None, token=None)
    assert c.bridge_configured() is False
    try:
        c.get("/state/positions")
        raise AssertionError("expected BridgeError")
    except c.BridgeError:
        passed += 1

    # 2. configured → bridge_configured True
    _reset_env()
    assert c.bridge_configured() is True
    passed += 1

    # 3. GET builds URL + auth header, trims trailing slash
    _reset_env(url="http://bridge.tailnet:8787/")
    cap = {}
    _install_opener(cap, body={"positions": []})
    out = c.get("/state/positions?force=1")
    assert cap["url"] == "http://bridge.tailnet:8787/state/positions?force=1", cap["url"]
    assert cap["method"] == "GET"
    assert cap["headers"].get("Authorization") == "Bearer tok"
    assert out == {"positions": []}
    passed += 1

    # 4. post_tool sends confirm + cycle_id + json body
    _reset_env()
    cap = {}
    _install_opener(cap, body={"ok": True})
    c.post_tool("deploy_position", {"pool_address": "p"}, confirm=True, cycle_id="screen-x")
    body = json.loads(cap["data"].decode())
    assert body == {"name": "deploy_position", "args": {"pool_address": "p"}, "confirm": True, "cycle_id": "screen-x"}, body
    assert cap["headers"].get("Content-type") == "application/json"
    passed += 1

    # 5. post_tool omits cycle_id when not given
    cap = {}
    _install_opener(cap, body={"ok": True})
    c.post_tool("close_position", {"position_address": "a"}, confirm=True)
    body = json.loads(cap["data"].decode())
    assert "cycle_id" not in body, body
    passed += 1

    # 6. HTTPError → BridgeError with status
    cap = {}
    _install_opener(cap, raise_exc=urllib.error.HTTPError("u", 409, "dup", {}, io.BytesIO(b"duplicate cycle_id")))
    try:
        c.post_tool("deploy_position", {}, confirm=True, cycle_id="x")
        raise AssertionError("expected BridgeError")
    except c.BridgeError as e:
        assert "409" in str(e), str(e)
    passed += 1

    # 7. URLError → BridgeError (unreachable)
    cap = {}
    _install_opener(cap, raise_exc=urllib.error.URLError("timed out"))
    try:
        c.get("/state/summary")
        raise AssertionError("expected BridgeError")
    except c.BridgeError as e:
        assert "unreachable" in str(e), str(e)
    passed += 1

    print(f"client.py: {passed}/7 tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(run())
