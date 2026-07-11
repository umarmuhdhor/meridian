"use client";

// Client-side fetch helpers. The browser only ever talks to /api/* (same origin) —
// never to the bridge directly, so the token never leaves the server.

export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body && (body.error as string)) || `HTTP ${r.status}`);
  return body as T;
}

// Read-tool convenience (no confirm) via the tool proxy.
export async function callReadTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const outer = await r.json().catch(() => null);
  const payload = outer?.body ?? outer;
  if (r.status >= 400) throw new Error(payload?.error || `HTTP ${r.status}`);
  return (payload?.result ?? payload) as T;
}
