"use client";

import { ChartLineUp } from "@phosphor-icons/react";
import { usePositions } from "@/lib/hooks";
import { PositionCard } from "@/components/PositionCard";
import { PositionActions } from "@/components/PositionActions";
import { StatusBadge } from "@/components/StatusBadge";
import { Address } from "@/components/Address";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/states";
import { pnlColorClass } from "@/lib/pnl-color";
import { formatPnlPct, formatPnlUsd, formatUsd, formatDuration, binRange } from "@/lib/format";
import type { Position } from "@/lib/types";

function rowStatus(p: Position) {
  if (p.in_range === false) {
    return <StatusBadge status="out_of_range" detail={p.minutes_out_of_range != null ? formatDuration(p.minutes_out_of_range) : undefined} />;
  }
  return <StatusBadge status="in_range" />;
}

export default function PositionsPage() {
  const q = usePositions();
  const positions: Position[] = q.data?.positions ?? [];

  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.isError) return <ErrorState message="Failed to load positions." onRetry={() => q.refetch()} />;
  if (positions.length === 0)
    return <EmptyState icon={ChartLineUp} title="No open positions." hint="Run screening from the Screen page to deploy one." />;

  return (
    <div className="flex flex-col gap-4">
      {q.data?.error && (
        <div className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-[12px] text-warning" style={{ backgroundColor: "var(--warning-tint)" }}>
          {q.data.error}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-lg)] border border-border md:block">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-14 z-10 bg-surface-1">
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-tertiary">
              <th className="px-3 py-2.5 font-medium">Pool</th>
              <th className="px-3 py-2.5 font-medium">Strategy</th>
              <th className="px-3 py-2.5 text-right font-medium">Range</th>
              <th className="px-3 py-2.5 text-right font-medium">PnL %</th>
              <th className="px-3 py-2.5 text-right font-medium">PnL $</th>
              <th className="px-3 py-2.5 text-right font-medium">Fee</th>
              <th className="px-3 py-2.5 text-right font-medium">Age</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {positions.map((p) => (
              <tr key={p.position} className="hover:bg-surface-2">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-text-primary">{p.pool_name || p.pair || "-"}</div>
                  <Address value={p.position} chars={4} />
                </td>
                <td className="px-3 py-2.5 text-text-secondary">{p.strategy || "-"}</td>
                <td className="px-3 py-2.5 text-right font-mono text-text-secondary tnum">
                  {binRange(p.lower_bin ?? null, p.upper_bin ?? null)}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono tnum ${pnlColorClass(p.pnl_pct)}`}>
                  {formatPnlPct(p.pnl_pct)}
                  {p.peak_pnl_pct != null && <div className="text-[11px] text-text-tertiary">peak {formatPnlPct(p.peak_pnl_pct)}</div>}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono tnum ${pnlColorClass(p.pnl_usd)}`}>{formatPnlUsd(p.pnl_usd)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-text-secondary tnum">{formatUsd(p.unclaimed_fees_usd)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-text-secondary tnum">{formatDuration(p.age_minutes)}</td>
                <td className="px-3 py-2.5">{rowStatus(p)}</td>
                <td className="px-3 py-2.5">
                  <PositionActions p={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="grid grid-cols-1 gap-4 md:hidden">
        {positions.map((p) => (
          <PositionCard key={p.position} p={p} actions={<PositionActions p={p} />} />
        ))}
      </div>
    </div>
  );
}
