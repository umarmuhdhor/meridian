"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/lib/chart";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyState } from "./states";
import { relativeTime } from "@/lib/format";
import type { PoolMemoryFile } from "@/lib/types";

// Per-pool 48-point snapshot trend (pool-memory.json snapshots[]). Pool picker,
// then pnl_pct over time. In-range/out shown via the tooltip and point count.
export function PoolTrendChart({ poolMemory }: { poolMemory?: PoolMemoryFile }) {
  const pools = useMemo(() => {
    const entries = Object.entries(poolMemory ?? {}).filter(
      ([, v]) => Array.isArray(v?.snapshots) && v.snapshots.length > 0
    );
    // Most snapshots first — the most active pools.
    return entries.sort((a, b) => (b[1].snapshots?.length ?? 0) - (a[1].snapshots?.length ?? 0));
  }, [poolMemory]);

  const [sel, setSel] = useState<string>("");
  const active = sel || pools[0]?.[0] || "";
  const entry = active ? poolMemory?.[active] : undefined;

  const data = useMemo(() => {
    const snaps = (entry?.snapshots ?? []) as Array<Record<string, unknown>>;
    return snaps.map((s, i) => ({
      i,
      ts: s.ts as string,
      pnl: s.pnl_pct == null ? null : Number(s.pnl_pct),
      fee: s.unclaimed_fees_usd == null ? null : Number(s.unclaimed_fees_usd),
      inRange: s.in_range,
    }));
  }, [entry]);

  if (pools.length === 0) {
    return <EmptyState title="No pool snapshots yet." hint="Snapshots accumulate (5min x 4h) while positions are open." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={active}
          onChange={(e) => setSel(e.target.value)}
          aria-label="Select pool"
          className="h-8 rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-2 text-[13px] text-text-primary"
        >
          {pools.map(([addr, v]) => (
            <option key={addr} value={addr}>
              {v.name || `${addr.slice(0, 6)}…`} ({v.snapshots?.length ?? 0})
            </option>
          ))}
        </select>
        <span className="text-[12px] text-text-tertiary">{data.length} snapshot(s)</span>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 8 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts"
            stroke={CHART.grid}
            tick={{ fontSize: 11, fill: CHART.axis }}
            tickFormatter={(t) => relativeTime(t)}
            minTickGap={40}
          />
          <YAxis yAxisId="pnl" stroke={CHART.grid} tick={{ fontSize: 11, fill: CHART.axis }} unit="%" width={44} />
          <Tooltip content={<ChartTooltip labelFmt={(l) => relativeTime(l)} />} cursor={{ stroke: CHART.neutral }} />
          <Line
            yAxisId="pnl"
            type="monotone"
            dataKey="pnl"
            name="PnL %"
            stroke={CHART.accent}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
