import { cn } from "@/lib/cn";

type Tone = "neutral" | "profit" | "loss" | "warning" | "accent" | "danger";

const TONES: Record<Tone, { color: string; bg: string }> = {
  neutral: { color: "var(--text-tertiary)", bg: "var(--surface-2)" },
  profit: { color: "var(--profit)", bg: "var(--profit-tint)" },
  loss: { color: "var(--loss)", bg: "var(--loss-tint)" },
  warning: { color: "var(--warning)", bg: "var(--warning-tint)" },
  accent: { color: "var(--accent-bright)", bg: "var(--accent-tint)" },
  danger: { color: "var(--loss)", bg: "var(--danger-tint)" },
};

export function Badge({
  tone = "neutral",
  children,
  className,
  mono,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  mono?: boolean;
}) {
  const t = TONES[tone];
  return (
    <span
      style={{ color: t.color, backgroundColor: t.bg }}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium leading-4",
        mono && "font-mono tnum",
        className
      )}
    >
      {children}
    </span>
  );
}
