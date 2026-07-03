// dashboard/bridge/auth.js
// Bearer-token check, timing-safe (PRD §11.2, MUST #14).

import { timingSafeEqual } from "node:crypto";

export function isAuthorized(req, token) {
  if (!token) return false;
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}
