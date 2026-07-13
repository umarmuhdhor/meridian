import { NextRequest, NextResponse } from "next/server";
import { bridgeGet } from "@/lib/bridge";

export const dynamic = "force-dynamic";

// GET /api/logs → bridge /logs (forwards ?limit= & ?level=). Live daemon log ring.
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  try {
    const data = await bridgeGet(`/logs${qs}`);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
