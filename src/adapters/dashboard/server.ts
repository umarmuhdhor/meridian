// startBridge(deps): bind 127.0.0.1 only (MUST #4), refuse to start without a
// non-empty token (MUST #5). Zero external deps — node:http only (MUST NOT #1).
// Ported from dashboard/bridge/server.js; wired to the DI AppContext + registry + llm
// rather than the JS module singletons.

import http from "node:http";
import type { AppContext } from "../../app/tools/context.js";
import type { ToolRegistry } from "../../app/tools/registry.js";
import type { LLMClient } from "../../ports/llm-client.js";
import { isAuthorized } from "./auth.js";
import { handleRequest } from "./routes.js";
import { createSseHub } from "./sse.js";

export interface BridgeDeps {
  /** Localhost TCP port. Default 8787. */
  port?: number;
  /** Bearer token — REQUIRED. Bridge refuses to listen without it. */
  token?: string | undefined;
  /** Composed application context (logger, chain, repos, config, notifier). */
  ctx: AppContext;
  /** LLM client for the read-only /chat surface. */
  llm: LLMClient;
  /** Full tool registry — /tool and /chat draw allowed subsets from it. */
  registry: ToolRegistry;
  /** Model id for /chat GENERAL ticks. */
  model: string;
  /** Directory holding the JSON state files (GET /state/file/:name). */
  stateDir: string;
}

export interface BridgeHandle {
  close: () => Promise<void>;
}

export function startBridge(deps: BridgeDeps): BridgeHandle | null {
  const { ctx, token } = deps;
  const port = deps.port ?? 8787;
  const log = ctx.logger;
  if (!token) {
    log.warn("dashboard", "DASHBOARD_TOKEN empty — bridge not started");
    return null; // do NOT listen
  }
  const startedAt = Date.now();
  const sse = createSseHub({
    chain: ctx.chain,
    positions: ctx.repos.positions,
    stateDir: deps.stateDir,
  });
  const routeDeps = { ...deps, sse };
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (!isAuthorized(req, token)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        await handleRequest(routeDeps, req, res, startedAt);
      } catch (e) {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    })();
  });
  // Never bind to 0.0.0.0 (MUST #4). Localhost-only by design.
  server.listen(port, "127.0.0.1", () => log.info("dashboard", `bridge on 127.0.0.1:${port}`));
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}
