import "server-only";

// Server-only bridge client. The token lives ONLY here (server env) and never
// reaches the browser (PRD §5 MUST NOT #6). Client code talks to /api/* instead.

const BASE = process.env.BRIDGE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.BRIDGE_TOKEN ?? "";

const authHeaders = () => ({ Authorization: `Bearer ${TOKEN}` });

export async function bridgeGet(path: string): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, { headers: authHeaders(), cache: "no-store" });
  if (!r.ok) throw new Error(`bridge ${r.status}`);
  return r.json();
}

export async function bridgePost(
  name: string,
  args: unknown,
  confirm = false
): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${BASE}/tool`, {
    method: "POST",
    cache: "no-store",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, args, confirm }),
  });
  return { status: r.status, body: await r.json() };
}

// Raw health check used by the /api/health proxy (returns status so the client
// can distinguish "offline" from "degraded" without leaking the token).
export async function bridgeHealth(): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const r = await fetch(`${BASE}/health`, { headers: authHeaders(), cache: "no-store" });
    const body = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { error: (e as Error).message } };
  }
}
