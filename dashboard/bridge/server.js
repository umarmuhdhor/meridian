// dashboard/bridge/server.js
// startBridge({port, token}): bind 127.0.0.1 only (MUST #4), refuse to start without a
// non-empty token (MUST #5). Zero external deps — node:http only (MUST NOT #1).

import http from "node:http";
import { log } from "../../logger.js";
import { isAuthorized } from "./auth.js";
import { handleRequest } from "./routes.js";

export function startBridge({ port = 8787, token } = {}) {
  if (!token) {
    log("dashboard_warn", "DASHBOARD_TOKEN empty — bridge not started");
    return null; // do NOT listen
  }
  const startedAt = Date.now();
  const server = http.createServer(async (req, res) => {
    try {
      if (!isAuthorized(req, token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      await handleRequest(req, res, startedAt);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  // Never bind to 0.0.0.0 (MUST #4). Localhost-only by design.
  server.listen(port, "127.0.0.1", () => log("dashboard", `bridge on 127.0.0.1:${port}`));
  return { close: () => new Promise((r) => server.close(r)) };
}
