// Bearer-token check, timing-safe (PRD §11.2, MUST #14).
// Ported from dashboard/bridge/auth.js (JS) to TS for the rewrite-ts branch.

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function isAuthorized(req: IncomingMessage, token: string): boolean {
  if (!token) return false;
  const h = req.headers["authorization"] ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(h) ? (h[0] ?? "") : h);
  if (!m || !m[1]) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}
