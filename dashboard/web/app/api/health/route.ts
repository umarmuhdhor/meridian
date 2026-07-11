import { NextResponse } from "next/server";
import { bridgeHealth } from "@/lib/bridge";

export const dynamic = "force-dynamic";

// GET /api/health → bridge /health. Used by DaemonStatusBanner to detect offline.
export async function GET() {
  const h = await bridgeHealth();
  // Always 200 to the client; the payload carries the real daemon state.
  return NextResponse.json(
    h.ok ? { ...(h.body as object), online: true } : { online: false, status: h.status }
  );
}
