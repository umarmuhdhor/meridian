"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { List, ArrowsClockwise } from "@phosphor-icons/react";
import { fetchJson } from "@/lib/api";
import { LIVE_INTERVAL } from "@/lib/query";
import { formatSol } from "@/lib/format";
import { titleForPath } from "./nav";
import { ThemeToggle } from "./ThemeToggle";
import { DaemonDot } from "./DaemonStatus";
import type { SummaryResponse } from "@/lib/types";

export function TopBar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const lastForce = useRef(0);

  const { data } = useQuery({
    queryKey: ["summary"],
    queryFn: () => fetchJson<SummaryResponse>("/api/state/summary"),
    refetchInterval: LIVE_INTERVAL,
  });

  const sol = data?.balance?.sol;

  const refresh = async () => {
    setRefreshing(true);
    try {
      // Client-side throttle 10s on the force call (bridge also rate-limits).
      const now = Date.now();
      if (now - lastForce.current > 10_000) {
        lastForce.current = now;
        await fetch("/api/state/positions?force=1", { cache: "no-store" }).catch(() => {});
      }
      await qc.invalidateQueries();
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface-1/95 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenMobile}
          aria-label="Open menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-text-secondary hover:bg-surface-2 md:hidden"
        >
          <List size={20} />
        </button>
        <h1 className="text-[18px] font-semibold text-text-primary">{titleForPath(pathname)}</h1>
      </div>

      <div className="flex items-center gap-2">
        <DaemonDot />
        <span className="hidden font-mono text-[13px] text-text-secondary tnum sm:inline" title="Wallet SOL balance">
          {formatSol(sol)}
        </span>
        <button
          onClick={refresh}
          aria-label="Refresh now"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
        >
          <ArrowsClockwise size={18} className={refreshing ? "mrd-spin" : undefined} />
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
