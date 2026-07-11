"use client";

import { useState } from "react";
import { Copy, Check, ArrowSquareOut } from "@phosphor-icons/react";
import { truncateAddress } from "@/lib/format";
import { cn } from "@/lib/cn";

// Truncated, copyable address with an explorer link (Design §10).
export function Address({
  value,
  chars = 4,
  explorer = "https://solscan.io/account/",
  className,
}: {
  value: string | null | undefined;
  chars?: number;
  explorer?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="font-mono text-text-tertiary">-</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-[13px]", className)}>
      <button
        onClick={copy}
        title={value}
        aria-label={`Copy address ${value}`}
        className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors"
      >
        {truncateAddress(value, chars)}
        {copied ? <Check size={13} className="text-profit" /> : <Copy size={13} />}
      </button>
      <a
        href={`${explorer}${value}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open in explorer"
        className="text-text-tertiary hover:text-accent-bright transition-colors"
      >
        <ArrowSquareOut size={13} />
      </a>
    </span>
  );
}
