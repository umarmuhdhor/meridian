"use client";

import { Warning, ArrowsClockwise } from "@phosphor-icons/react";
import type { Icon } from "@/lib/icon";
import { cn } from "@/lib/cn";
import { Button } from "./ui/Button";

// Skeleton block that mimics the final shape (Design §12).
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("mrd-skeleton h-4 w-full", className)} aria-hidden />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

export function SkeletonCards({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-7 w-28 mb-2" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

// Informative empty state (Design §12): icon + one sentence + direction.
export function EmptyState({
  icon: IconEl,
  title,
  hint,
  className,
}: {
  icon?: Icon;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
      {IconEl ? <IconEl size={24} className="text-text-tertiary" /> : null}
      <p className="text-[14px] text-text-secondary">{title}</p>
      {hint ? <p className="text-[12px] text-text-tertiary max-w-[42ch]">{hint}</p> : null}
    </div>
  );
}

// Inline, contextual error with retry (Design §12).
export function ErrorState({ message, onRetry, className }: { message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-10 text-center rounded-[var(--radius-lg)] border border-border",
        className
      )}
      style={{ backgroundColor: "var(--loss-tint)" }}
    >
      <Warning size={22} className="text-loss" />
      <p className="text-[13px] text-text-secondary max-w-[46ch]">{message || "Failed to load. Try again."}</p>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <ArrowsClockwise size={14} />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
