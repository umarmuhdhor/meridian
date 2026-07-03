"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WarningCircle } from "@phosphor-icons/react";
import { fetchJson } from "@/lib/api";
import { LIVE_INTERVAL } from "@/lib/query";
import { formatDuration } from "@/lib/format";

type DaemonState = "online" | "degraded" | "offline";

interface DaemonStatusValue {
  state: DaemonState;
  online: boolean;
  uptimeSec?: number;
}

const Ctx = createContext<DaemonStatusValue>({ state: "online", online: true });

export function useDaemonStatus() {
  return useContext(Ctx);
}

interface HealthPayload {
  online?: boolean;
  uptime_sec?: number;
}

export function DaemonStatusProvider({ children }: { children: React.ReactNode }) {
  const failRef = useRef(0);
  const [state, setState] = useState<DaemonState>("online");
  const [uptimeSec, setUptimeSec] = useState<number | undefined>();

  const { data, isSuccess, isError, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthPayload>("/api/health"),
    refetchInterval: LIVE_INTERVAL,
    retry: false,
  });

  useEffect(() => {
    // Don't judge health while the first request is still in flight — otherwise
    // every page load flashes "degraded" before the first response arrives.
    if (isLoading) return;
    const healthy = isSuccess && data?.online === true;
    if (healthy) {
      failRef.current = 0;
      setState("online");
      setUptimeSec(data?.uptime_sec);
    } else {
      failRef.current += 1;
      // 1 miss → degraded; ≥2 consecutive → offline (≈20s at 10s interval, ≤30s AC-OV.2).
      setState(failRef.current >= 2 ? "offline" : "degraded");
    }
  }, [data, isSuccess, isError, isLoading]);

  return <Ctx.Provider value={{ state, online: state === "online", uptimeSec }}>{children}</Ctx.Provider>;
}

// Full-width banner, only visible when state ≠ online (Design §11.9).
export function DaemonStatusBanner() {
  const { state } = useDaemonStatus();
  if (state === "online") return null;

  const offline = state === "offline";
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex h-12 items-center justify-center gap-2 px-4 text-[13px] font-medium border-b border-border"
      style={{
        backgroundColor: offline ? "var(--loss-tint)" : "var(--warning-tint)",
        color: offline ? "var(--loss)" : "var(--warning)",
      }}
    >
      <WarningCircle size={16} weight="bold" />
      {offline ? "Daemon offline - read-only mode" : "Daemon slow to respond"}
    </div>
  );
}

// Small live dot for the top bar (green pulse when online).
export function DaemonDot() {
  const { state, uptimeSec } = useDaemonStatus();
  const color = state === "online" ? "var(--profit)" : state === "degraded" ? "var(--warning)" : "var(--loss)";
  const label =
    state === "online"
      ? uptimeSec != null
        ? `Daemon live · ${formatDuration(uptimeSec / 60)}`
        : "Daemon live"
      : state === "degraded"
        ? "Daemon slow"
        : "Daemon offline";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-text-tertiary" title={label}>
      <span
        className={state === "online" ? "mrd-pulse" : undefined}
        style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: color, display: "inline-block" }}
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
