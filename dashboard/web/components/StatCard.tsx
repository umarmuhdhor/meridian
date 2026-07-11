import { ArrowUpRight, ArrowDownRight } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

// KPI / stat card (Design §11.2). Big mono value, optional sign color + trend icon.
export function StatCard({
  label,
  value,
  sub,
  valueClass,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClass?: string;
  trend?: "up" | "down" | null;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">{label}</span>
        {trend === "up" && <ArrowUpRight size={16} className="text-profit" />}
        {trend === "down" && <ArrowDownRight size={16} className="text-loss" />}
      </div>
      <div className={cn("mt-2 font-mono text-[20px] font-medium leading-7 tnum", valueClass)}>{value}</div>
      {sub != null && <div className="mt-1 text-[12px] text-text-secondary">{sub}</div>}
    </div>
  );
}
