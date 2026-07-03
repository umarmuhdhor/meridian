"use client";

import { forwardRef } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
  secondary: "bg-surface-2 text-text-primary border border-border-strong hover:border-accent-bright",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-2 border border-transparent",
  danger: "text-white border border-transparent",
  "danger-ghost": "bg-transparent text-loss border border-transparent hover:bg-[var(--loss-tint)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-9 px-3 text-[14px]",
  lg: "h-10 px-4 text-[14px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, style, ...rest },
  ref
) {
  const isDanger = variant === "danger";
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      style={isDanger ? { backgroundColor: "var(--danger-fill)", ...style } : style}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] font-medium",
        "transition-colors duration-150 active:scale-[0.98]",
        "disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading && <CircleNotch size={16} className="mrd-spin" aria-hidden />}
      {children}
    </button>
  );
});
