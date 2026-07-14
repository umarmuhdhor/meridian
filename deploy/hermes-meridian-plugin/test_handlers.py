"""End-to-end test of the meridian plugin HANDLER layer (stdlib only).

Stubs tools.registry, points the client at a local fake bridge HTTP server, and
exercises every handler — proving tools.py works handler → client → HTTP → bridge
shape without the Hermes runtime or the prod VPS.

Run: python3 deploy/hermes-meridian-plugin/test_handlers.py
"""
import json
import os
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

SRC = os.path.dirname(os.path.abspath(__file__))
root = tempfile.mkdtemp(prefix="mrd-harness-")
os.makedirs(os.path.join(root, "plugins", "meridian"))
os.makedirs(os.path.join(root, "tools"))
open(os.path.join(root, "plugins", "__init__.py"), "w").close()
open(os.path.join(root, "tools", "__init__.py"), "w").close()
for f in ("__init__.py", "client.py", "tools.py"):
    shutil.copy(os.path.join(SRC, f), os.path.join(root, "plugins", "meridian", f))
with open(os.path.join(root, "tools", "registry.py"), "w") as fh:
    fh.write(
        "import json\n"
        "def tool_error(message, **extra):\n"
        "    d={'error': str(message)}; d.update(extra); return json.dumps(d)\n"
        "def tool_result(data=None, **kwargs):\n"
        "    return json.dumps(data if data is not None else kwargs, ensure_ascii=False)\n"
    )
sys.path.insert(0, root)

calls = []


class Bridge(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        calls.append(("GET", self.path, self.headers.get("Authorization")))
        if self.path.startswith("/state/positions"):
            return self._send(200, {"positions": [{"position": "p1"}], "total_positions": 1})
        if self.path.startswith("/state/summary"):
            return self._send(200, {"summary": {"open": 1}, "balance": {"sol": 5}})
        return self._send(404, {"error": "nope"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        calls.append(("POST", self.path, body))
        return self._send(200, {"ok": True, "result": {"echo": body}})


def run():
    httpd = HTTPServer(("127.0.0.1", 0), Bridge)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    os.environ["MERIDIAN_BRIDGE_URL"] = f"http://127.0.0.1:{port}"
    os.environ["MERIDIAN_BRIDGE_TOKEN"] = "harness-tok"

    from plugins.meridian import tools as T

    def jr(s):
        return json.loads(s)

    passed = 0

    assert T._check() is True
    passed += 1

    assert jr(T._handle_get_positions({})).get("total_positions") == 1
    assert calls[-1][0] == "GET" and calls[-1][2] == "Bearer harness-tok"
    passed += 1

    assert "summary" in jr(T._handle_get_summary({}))
    passed += 1

    T._handle_get_wallet({})
    assert calls[-1][1] == "/tool" and calls[-1][2]["name"] == "get_wallet_balance"
    passed += 1

    T._handle_get_candidates({"limit": 3, "discover_limit": 20})
    assert calls[-1][2]["name"] == "get_top_candidates"
    assert calls[-1][2]["args"] == {"limit": 3, "discover_limit": 20}
    passed += 1

    T._handle_deploy({
        "pool_address": "goodPool", "amount_sol": 0.5, "strategy": "bid_ask",
        "bins_below": 40, "cycle_id": "screen-xyz",
    })
    body = calls[-1][2]
    assert body["name"] == "deploy_position" and body["confirm"] is True
    assert body["cycle_id"] == "screen-xyz" and "cycle_id" not in body["args"]
    assert body["args"]["bins_above"] == 0
    passed += 1

    T._handle_close({"position_address": "posABC"})
    assert calls[-1][2]["name"] == "close_position" and calls[-1][2]["confirm"] is True
    passed += 1

    before = len(calls)
    assert "error" in jr(T._handle_close({})) and len(calls) == before
    passed += 1

    T._handle_claim({"position_address": "posABC"})
    assert calls[-1][2]["name"] == "claim_fees"
    passed += 1

    os.environ.pop("MERIDIAN_BRIDGE_URL")
    assert T._check() is False
    assert "error" in jr(T._handle_get_positions({}))
    passed += 1

    httpd.shutdown()
    shutil.rmtree(root, ignore_errors=True)
    print(f"meridian handlers: {passed}/10 passed")
    return 0


if __name__ == "__main__":
    sys.exit(run())
