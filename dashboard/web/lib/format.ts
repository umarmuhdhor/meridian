// Central number/format helpers (Design §10). The ONLY place we format numbers.
// No em-dash in displayed text (Design §13). Empty placeholder = "-" (hyphen) or "n/a".

export const DASH = "-";

export const formatSol = (n: number | null | undefined, d = 3): string =>
  n == null || !Number.isFinite(n)
    ? DASH
    : `${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} SOL`;

export const formatUsd = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? DASH
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");

export const formatPnlPct = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `${sign(n)}${Math.abs(n).toFixed(2)}%`;

export const formatPnlUsd = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `${sign(n)}$${Math.abs(n).toFixed(2)}`;

export const formatPct = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? DASH : `${n.toFixed(d)}%`;

export const formatRatio = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : n.toPrecision(4).replace(/\.?0+$/, "") || "0";

export const compact = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? DASH
    : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const truncateAddress = (a: string | null | undefined, n = 4): string =>
  a && a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a ?? DASH;

export function relativeTime(ts: string | number | null | undefined): string {
  if (ts == null) return DASH;
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return DASH;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Absolute UTC string for hover titles.
export function absoluteTime(ts: string | number | null | undefined): string {
  if (ts == null) return "";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// Compact local date-time for table cells: "9 Jul 18:16" (this year) or "9 Jul 25 18:16".
export function shortDateTime(ts: string | number | null | undefined): string {
  if (ts == null) return DASH;
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return DASH;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "2-digit" }) });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

// Compact duration from minutes: "4h 12m", "3d 2h".
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return DASH;
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export const binRange = (lo: number | null, hi: number | null): string =>
  lo == null || hi == null ? DASH : `[${lo}, ${hi}]`;
