import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Proxies the bridge SSE stream. EventSource cannot send an Authorization header,
// so the browser connects here (same-origin) and this server route adds the Bearer
// token when it opens the bridge stream — the token never reaches the browser (#6).

const BASE = process.env.BRIDGE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.BRIDGE_TOKEN ?? "";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export async function GET(req: NextRequest) {
  try {
    const upstream = await fetch(`${BASE}/events`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "text/event-stream" },
      cache: "no-store",
      signal: req.signal, // client disconnect → abort upstream → bridge unsubscribe
    });
    if (!upstream.ok || !upstream.body) {
      return new Response("event: error\ndata: {}\n\n", { status: 200, headers: SSE_HEADERS });
    }
    return new Response(upstream.body, { status: 200, headers: SSE_HEADERS });
  } catch {
    // Bridge unreachable → emit one error frame; client falls back to polling.
    return new Response("event: error\ndata: {}\n\n", { status: 200, headers: SSE_HEADERS });
  }
}
