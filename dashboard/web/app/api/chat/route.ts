import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Proxies the bridge POST /chat streaming endpoint. The browser posts here
// (same-origin, no token) and this server route adds the Bearer token when it
// opens the bridge stream — the token never reaches the browser (#6). The
// upstream body is a text/event-stream that we pass straight through.

const BASE = process.env.BRIDGE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.BRIDGE_TOKEN ?? "";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

const errorFrame = (message: string) =>
  new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, {
    status: 200,
    headers: SSE_HEADERS,
  });

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return errorFrame("invalid json");
  }
  try {
    const upstream = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: req.signal, // client disconnect → abort upstream → bridge stops writing
    });
    if (!upstream.ok || !upstream.body) return errorFrame(`bridge ${upstream.status}`);
    return new Response(upstream.body, { status: 200, headers: SSE_HEADERS });
  } catch (e) {
    // Bridge unreachable (daemon down) → one error frame; the client shows it inline.
    return errorFrame((e as Error).message);
  }
}
