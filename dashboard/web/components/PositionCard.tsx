import { StatusBadge } from "./StatusBadge";
import { pnlColorClass } from "@/lib/pnl-color";
import { formatPnlPct, formatPnlUsd, formatUsd, formatDuration, binRange } from "@/lib/format";
import type { Position } from "@/lib/types";
import { cn } from "@/lib/cn";

function statusOf(p: Position): { status: "in_range" | "out_of_range"; detail?: string } {
  if (p.in_range === false) {
    const m = p.minutes_out_of_range;
    return { status: "out_of_range", detail: m != null ? formatDuration(m) : undefined };
  }
  return { status: "in_range" };
}

// Compact position card for the Overview top-3 (Design §11.3).
export function PositionCard({ p, actions }: { p: Position; actions?: React.ReactNode }) {
  const { status, detail } = statusOf(p);
  const name = p.pool_name || p.pair || "Position";

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-text-primary">{name}</div>
          <div className="text-[12px] text-text-tertiary">{p.strategy || "-"}</div>
        </div>
        <StatusBadge status={status} detail={detail} />
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className={cn("font-mono text-[20px] font-medium leading-7 tnum", pnlColorClass(p.pnl_pct))}>
            {formatPnlPct(p.pnl_pct)}
          </div>
          <div className="text-[12px] text-text-secondary tnum">
            <span className={pnlColorClass(p.pnl_usd)}>{formatPnlUsd(p.pnl_usd)}</span>
            {p.peak_pnl_pct != null && (
              <span className="ml-2 text-text-tertiary">peak {formatPnlPct(p.peak_pnl_pct)}</span>
            )}
          </div>
        </div>
        <div className="text-right text-[12px] text-text-tertiary">
          <div className="font-mono tnum">{binRange(p.lower_bin ?? null, p.upper_bin ?? null)}</div>
          <div className="tnum">fee {formatUsd(p.unclaimed_fees_usd)}</div>
          <div className="tnum">{formatDuration(p.age_minutes)}</div>
        </div>
      </div>

      {p.instruction && (
        <div className="rounded-[var(--radius-md)] border border-border px-2 py-1 text-[12px] text-text-secondary" style={{ backgroundColor: "var(--accent-tint)" }}>
          Note: {p.instruction}
        </div>
      )}

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
