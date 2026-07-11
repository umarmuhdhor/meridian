import { NextRequest, NextResponse } from "next/server";
import { bridgeGet } from "@/lib/bridge";

export const dynamic = "force-dynamic";

// GET /api/state/* → bridge /state/* (forwards ?force=1). Live daemon data.
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const qs = req.nextUrl.search; // preserve ?force=1
  try {
    const data = await bridgeGet(`/state/${path.join("/")}${qs}`);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
