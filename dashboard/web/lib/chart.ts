// Chart color tokens as CSS-var strings so Recharts SVG attributes resolve them
// live and flip with the theme (Design §4.4 / §16.3). Never hardcode hex here.
export const CHART = {
  grid: "var(--border)",
  axis: "var(--text-tertiary)",
  profit: "var(--profit)",
  loss: "var(--loss)",
  accent: "var(--accent-bright)",
  neutral: "var(--text-tertiary)",
  cursor: "var(--surface-2)",
  series: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--chart-6)",
  ],
} as const;

// Color a value by sign (Design §4.1). Zero → neutral, never green/red.
export const signColor = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) || v === 0 ? CHART.neutral : v > 0 ? CHART.profit : CHART.loss;
