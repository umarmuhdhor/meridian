// dashboard/bridge/routes.js
// Bridge router: /health, /state/positions, /state/summary, /state/file/:name, POST /tool.
//
// Reuses existing daemon functions only — the bridge is thin glue:
//   executeTool        (tools/executor.js)  — already logs (F1) + notifies Telegram + auto-swaps (F2)
//   getMyPositions     (tools/dlmm.js)      — 5min cache, PnL poller keeps it fresh (F5)
//   getStateSummary    (state.js)
//   getWalletBalances  (tools/wallet.js)
//   log                (logger.js)
//
// MUST NOT import @meteora-ag/dlmm (F7/#8) — importing getMyPositions is safe (lazy-load stays intact).
// MUST NOT call logAction (F1 — dobel audit). MUST NOT fs.writeFile state (#3).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executeTool } from "../../tools/executor.js";
import { getMyPositions } from "../../tools/dlmm.js";
import { getStateSummary } from "../../state.js";
import { getWalletBalances } from "../../tools/wallet.js";
import { log } from "../../logger.js";
import { agentLoop } from "../../agent/agent.js"; // non-SDK — lazy-load of @meteora-ag/dlmm stays intact (F7/#8)
import { config } from "../../config.js";
import { isAllowedTool, isWriteTool, resolveFile, CHAT_READ_TOOLS } from "./allowlist.js";
import { acquire, release } from "./inflight.js";
import { redactSecrets } from "./redact.js";
import { sseSubscribe, sseUnsubscribe } from "./sse.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

// Strip model <think> blocks before surfacing to the UI (mirrors index.js stripThink).
const stripThink = (t = "") => String(t).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
// Write one SSE frame; swallow errors if the socket already closed.
const sseFrame = (res, event, data) => {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
};

// rate-limit ?force=1 on positions: at most 1× / 10s (F5)
let _lastForce = 0;

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw); // throw → caller → 400
}

export async function handleRequest(req, res, startedAt) {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;

  // ── GET /health ──────────────────────────────────────────────
  if (req.method === "GET" && p === "/health") {
    return json(res, 200, {
      ok: true,
      uptime_sec: Math.round((Date.now() - startedAt) / 1000),
      daemon: "running",
      bridge_version: "1",
    });
  }

  // ── GET /state/positions[?force=1] ───────────────────────────
  if (req.method === "GET" && p === "/state/positions") {
    let force = url.searchParams.get("force") === "1";
    if (force && Date.now() - _lastForce < 10_000) force = false; // throttle
    if (force) _lastForce = Date.now();
    const r = await getMyPositions({ force, silent: true }).catch((e) => ({ error: e.message }));
    return json(res, 200, r);
  }

  // ── GET /events (SSE; piggybacks poller cache, no new RPC — §8.7/#8) ──
  if (req.method === "GET" && p === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    const hb = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* closed */ }
    }, 30_000);
    sseSubscribe(res);
    req.on("close", () => {
      clearInterval(hb);
      sseUnsubscribe(res);
    });
    return; // keep the connection open — do NOT json()/end
  }

  // ── GET /state/summary ───────────────────────────────────────
  if (req.method === "GET" && p === "/state/summary") {
    const [summary, bal] = await Promise.all([
      Promise.resolve().then(() => getStateSummary()).catch(() => null),
      getWalletBalances().catch(() => null),
    ]);
    return json(res, 200, { summary, balance: bal });
  }

  // ── GET /state/file/:name (whitelist + redaction) ────────────
  if (req.method === "GET" && p.startsWith("/state/file/")) {
    const name = p.slice("/state/file/".length);
    const file = resolveFile(name); // null unless exact whitelist key
    if (!file) return json(res, 400, { error: "invalid file name" });
    try {
      const data = JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
      return json(res, 200, name === "user-config" ? redactSecrets(data) : data);
    } catch {
      return json(res, 404, { error: "not found" });
    }
  }

  // ── POST /tool ───────────────────────────────────────────────
  if (req.method === "POST" && p === "/tool") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid json" }); }
    const { name, args = {}, confirm = false } = body || {};
    if (!name) return json(res, 400, { error: "missing name" });
    if (!isAllowedTool(name)) return json(res, 403, { error: `tool not allowed: ${name}` });

    const write = isWriteTool(name);
    if (write && confirm !== true) return json(res, 403, { error: "confirm required" });
    if (write && !acquire(name)) return json(res, 409, { error: "in-flight", tool: name });

    try {
      if (write) log("dashboard", `tool=${name}`); // one line only; NEVER logAction (F1)
      const result = await executeTool(name, args); // audit + Telegram notify + auto-swap internal (F1/F2)
      const ok = result?.success !== false && !result?.error && !result?.blocked; // F6
      return json(res, 200, { ok, result });
    } finally {
      if (write) release(name);
    }
  }

  // ── POST /chat (streaming; read-only agentLoop GENERAL — M5 Fase A) ──
  // Body: { message: string, history?: [{role,content}] }. Streams SSE frames:
  //   event: tool  data: {phase:"start"|"finish", name, success?}
  //   event: done  data: {content}   |   event: error data: {message}
  // Read-only by construction: agentLoop only sees CHAT_READ_TOOLS, so the LLM
  // cannot pick a write tool. Writes stay on the confirm-gated /tool path (M2).
  if (req.method === "POST" && p === "/chat") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid json" }); }
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return json(res, 400, { error: "missing message" });
    const history = Array.isArray(body?.history)
      ? body.history
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-10)
      : [];

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    let closed = false;
    const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 20_000);
    req.on("close", () => { closed = true; clearInterval(hb); });

    try {
      log("dashboard", "chat"); // one line only; executeTool inside agentLoop does the audit (F1)
      const { content } = await agentLoop(
        message,
        config.llm.maxSteps,
        history,
        "GENERAL",
        config.llm.generalModel,
        null,
        {
          allowedTools: CHAT_READ_TOOLS, // read-only surface (Fase A)
          onToolStart:  ({ name })          => { if (!closed) sseFrame(res, "tool", { phase: "start",  name }); },
          onToolFinish: ({ name, success }) => { if (!closed) sseFrame(res, "tool", { phase: "finish", name, success }); },
        },
      );
      sseFrame(res, "done", { content: stripThink(content) });
    } catch (e) {
      sseFrame(res, "error", { message: e?.message || "chat failed" });
    } finally {
      clearInterval(hb);
      try { res.end(); } catch { /* already closed */ }
    }
    return; // stream ended — do NOT json()/end again
  }

  return json(res, 404, { error: "not found" });
}
