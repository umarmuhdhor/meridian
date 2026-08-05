import { NextRequest, NextResponse } from "next/server";
import { bridgeGet } from "@/lib/bridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

// GET /api/state/* → bridge /state/* (forwards ?force=1). Live daemon data.
// No-store headers prevent Cloudflare / browser cache from serving stale rows
// after the bridge starts returning new enrichment fields (strategy, age, etc.).
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const qs = req.nextUrl.search; // preserve ?force=1
  try {
    const data = await bridgeGet(`/state/${path.join("/")}${qs}`);
    return NextResponse.json(data, { headers: NO_CACHE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502, headers: NO_CACHE });
  }
}
