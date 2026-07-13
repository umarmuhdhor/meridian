"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Scroll, Pause, Play } from "@phosphor-icons/react";
import { fetchJson } from "@/lib/api";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/states";
import { cn } from "@/lib/cn";

type Level = "debug" | "info" | "warn" | "error";
interface LogLine {
  ts: string;
  level: Level;
  scope: string;
  msg: string;
  meta?: Record<string, unknown>;
}

const LEVELS: Array<Level | "all"> = ["all", "debug", "info", "warn", "error"];

// Color per level via known CSS vars (globals.css).
const LEVEL_COLOR: Record<Level, string> = {
  error: "var(--loss)",
  warn: "var(--warning)",
  info: "var(--text-secondary)",
  debug: "var(--text-tertiary)",
};

function hhmmss(ts: string): string {
  // ISO → HH:MM:SS (local); fall back to raw on parse failure.
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toTimeString().slice(0, 8);
}

export default function LogsPage() {
  const [level, setLevel] = useState<Level | "all">("all");
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const q = useQuery({
    queryKey: ["logs", level],
    queryFn: () =>
      fetchJson<{ lines: LogLine[] }>(
        `/api/logs?limit=500${level === "all" ? "" : `&level=${level}`}`
      ),
    refetchInterval: paused ? false : 4_000,
    refetchOnWindowFocus: true,
  });

  const lines = useMemo(() => q.data?.lines ?? [], [q.data]);

  // Track whether the user is pinned to the bottom (so we don't yank the scroll
  // position while they're reading history).
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // Auto-follow the tail on new data, only when already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={cn(
                "h-8 rounded-[var(--radius-md)] px-3 text-[12px] font-medium capitalize transition-colors",
                level === l
                  ? "text-text-primary"
                  : "text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
              )}
              style={level === l ? { backgroundColor: "var(--accent-tint)" } : undefined}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary">{lines.length} lines</span>
          <button
            onClick={() => setPaused((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
          >
            {paused ? <Play size={14} weight="fill" /> : <Pause size={14} weight="fill" />}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={12} />
      ) : q.isError ? (
        <ErrorState
          message="Failed to load logs — is the daemon running?"
          onRetry={() => q.refetch()}
        />
      ) : lines.length === 0 ? (
        <EmptyState
          icon={Scroll}
          title="No log lines yet"
          hint="The daemon streams its output here once it logs at this level. Try a lower level, or wait for the next cycle."
        />
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-lg)] border border-border bg-surface-1 p-3 font-mono text-[12px] leading-relaxed"
        >
          {lines.map((l, i) => (
            <div key={`${l.ts}-${i}`} className="flex gap-2 whitespace-pre-wrap break-words py-0.5">
              <span className="shrink-0 text-text-tertiary">{hhmmss(l.ts)}</span>
              <span
                className="shrink-0 uppercase"
                style={{ color: LEVEL_COLOR[l.level], minWidth: "3rem" }}
              >
                {l.level}
              </span>
              <span className="shrink-0 text-accent-bright">{l.scope}</span>
              <span className="text-text-primary">
                {l.msg}
                {l.meta ? (
                  <span className="text-text-tertiary"> {JSON.stringify(l.meta)}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
