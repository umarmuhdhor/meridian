// Clears the session cookie. Middleware then redirects to /login.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session-const";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
