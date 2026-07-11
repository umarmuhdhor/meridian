"use client";

// Shared Recharts tooltip: monospace, tabular, themed via CSS vars (Design §16.3).
// `unit` suffixes values; `labelFmt` formats the axis label (e.g. relative time).

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  unit?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFmt,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFmt?: (l: string | number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-[var(--radius-md)] border border-border bg-surface-3 px-3 py-2 text-[12px]"
      style={{ boxShadow: "var(--shadow-lg)" }}
    >
      {label != null && label !== "" && (
        <div className="mb-1 font-mono text-text-tertiary">{labelFmt ? labelFmt(label) : String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 font-mono tnum">
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span className="text-text-secondary">{p.name}:</span>
          <span className="text-text-primary">
            {typeof p.value === "number" ? p.value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : p.value}
            {p.unit ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}
