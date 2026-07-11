"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, signColor } from "@/lib/chart";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyState } from "./states";
import type { PerformanceEntry } from "@/lib/types";

// Per-close PnL% (bars, colored by sign) + running win-rate (line, right axis).
// Chronological order from lessons.json performance[].
export function PerformanceChart({ performance }: { performance?: PerformanceEntry[] }) {
  const data = useMemo(() => {
    const perf = performance ?? [];
    let wins = 0;
    return perf.map((p, i) => {
      const pnl = Number(p.pnl_pct ?? 0);
      if (pnl > 0) wins += 1;
      return {
        i: i + 1,
        pnl: Number.isFinite(pnl) ? pnl : 0,
        winRate: ((wins / (i + 1)) * 100),
        pool: p.pool_name || p.pool || `#${i + 1}`,
      };
    });
  }, [performance]);

  if (data.length === 0) {
    return <EmptyState title="No closed trades yet." hint="Performance appears once positions have been closed." />;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 8 }}>
        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="i" stroke={CHART.grid} tick={{ fontSize: 11, fill: CHART.axis }} />
        <YAxis yAxisId="pnl" stroke={CHART.grid} tick={{ fontSize: 11, fill: CHART.axis }} unit="%" width={44} />
        <YAxis
          yAxisId="wr"
          orientation="right"
          domain={[0, 100]}
          stroke={CHART.grid}
          tick={{ fontSize: 11, fill: CHART.axis }}
          unit="%"
          width={40}
        />
        <Tooltip content={<ChartTooltip labelFmt={(l) => `Trade #${l}`} />} cursor={{ fill: CHART.cursor }} />
        <Bar yAxisId="pnl" dataKey="pnl" name="PnL" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={signColor(d.pnl)} />
          ))}
        </Bar>
        <Line
          yAxisId="wr"
          type="monotone"
          dataKey="winRate"
          name="Win rate"
          stroke={CHART.accent}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
