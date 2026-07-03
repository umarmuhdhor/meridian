import { NextRequest, NextResponse } from "next/server";
import { bridgePost } from "@/lib/bridge";

export const dynamic = "force-dynamic";

// POST { name, args, confirm? } → bridge /tool. Returns { status, body } so the
// client can read body.ok / body.result and surface blocked/error inline.
export async function POST(req: NextRequest) {
  let payload: { name?: string; args?: unknown; confirm?: boolean };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { name, args = {}, confirm = false } = payload || {};
  if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });
  try {
    const { status, body } = await bridgePost(name, args, confirm);
    return NextResponse.json(body, { status });
  } catch (e) {
    // Bridge unreachable (daemon down). Not a crash — client shows offline/error.
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
