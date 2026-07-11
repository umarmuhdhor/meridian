// Map a signed value to a semantic text color class (Design §4.1).
// Zero / unknown → neutral tertiary grey (never green/red).
export function pnlColorClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-text-tertiary";
  return value > 0 ? "text-profit" : "text-loss";
}
