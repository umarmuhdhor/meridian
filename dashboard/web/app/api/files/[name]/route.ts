import { NextRequest, NextResponse } from "next/server";
import { readRootJson, isWhitelistedFile } from "@/lib/files";

export const dynamic = "force-dynamic";

// GET /api/files/:name → fs read of a whitelisted root JSON (redacted for user-config).
// Reads directly from disk (not via bridge) so static data survives daemon downtime.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!isWhitelistedFile(name)) {
    return NextResponse.json({ error: "invalid file name" }, { status: 400 });
  }
  try {
    const data = await readRootJson(name);
    // Missing file → return empty object so pages render an empty state, not an error.
    return NextResponse.json(data ?? {});
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
