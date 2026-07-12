// Shared auth constants. Kept dependency-free and edge-safe so both the
// middleware (edge runtime) and the route handlers (node runtime) can import
// them without pulling in node:crypto.

export const SESSION_COOKIE = "meridian_dash";

/** Session lifetime in seconds (8h sliding). */
export const SESSION_TTL_SEC = 60 * 60 * 8;
