"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/lib/chart";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyState } from "./states";

// Darwinian signal weights (signal-weights.json `weights`). Values shown verbatim,
// no transform, so the bars match the file exactly (AC-LD.1). Baseline 1.0 = neutral;
// >1 boosted (profit), <1 decayed (loss).
export function SignalWeightChart({ weights }: { weights?: Record<string, number> }) {
  const data = Object.entries(weights ?? {})
    .map(([name, weight]) => ({ name, weight: Number(weight) }))
    .filter((d) => Number.isFinite(d.weight))
    .sort((a, b) => b.weight - a.weight);

  if (data.length === 0) {
    return <EmptyState title="No signal weights yet." hint="Weights appear after enough closes for the Darwinian recalculation." />;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 30)}>
      <BarChart layout="vertical" data={data} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
        <XAxis
          type="number"
          domain={[0, (max: number) => Math.max(1.2, Math.ceil(max * 10) / 10)]}
          stroke={CHART.grid}
          tick={{ fontSize: 11, fill: CHART.axis }}
        />
        <YAxis type="category" dataKey="name" width={150} stroke={CHART.grid} tick={{ fontSize: 11, fill: CHART.axis }} />
        <ReferenceLine x={1} stroke={CHART.neutral} strokeDasharray="3 3" />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART.cursor }} />
        <Bar dataKey="weight" name="weight" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.weight >= 1 ? CHART.profit : CHART.loss} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
