// Dashboard auth gate (edge runtime).
//
//   request ─► middleware
//               │  /login, /api/auth/*, static  ─► allow
//               │  valid session cookie          ─► allow
//               │  no/invalid cookie, /api/*      ─► 401 (XHR/SSE fail clean)
//               └─ no/invalid cookie, page        ─► redirect /login?next=…
//
// The session cookie is an iron-session sealed blob ({ authed: true }). We
// only unseal here (edge-safe via iron-session's uncrypto); it is written in
// app/api/auth/login. The daemon bridge (127.0.0.1:8787) is never reachable
// from the internet — this only gates the human-facing dashboard.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { unsealData } from "iron-session";
import { SESSION_COOKIE, SESSION_TTL_SEC } from "@/lib/session-const";

interface Sealed {
  authed?: boolean;
}

async function isAuthed(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return false;
  const password = process.env.MERIDIAN_SESSION_SECRET;
  if (!password || password.length < 32) return false;
  try {
    const data = await unsealData<Sealed>(cookie, { password, ttl: SESSION_TTL_SEC });
    return data?.authed === true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Public: the login page and the auth endpoints themselves.
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  if (await isAuthed(req)) return NextResponse.next();

  // Unauthenticated. APIs get a clean 401 (so fetch/EventSource don't follow a
  // 30x into an HTML login page); pages redirect to the PIN screen.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

// Run on everything except Next internals and static assets. /login and
// /api/auth are allowed inside the handler (kept in the matcher so a stale
// cookie on /login still short-circuits correctly).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)"],
};
