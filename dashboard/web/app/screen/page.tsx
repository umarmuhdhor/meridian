"use client";

import { useMutation } from "@tanstack/react-query";
import { Crosshair, ProhibitInset } from "@phosphor-icons/react";
import { callReadTool } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { CandidateCard } from "@/components/CandidateCard";
import { EmptyState, ErrorState } from "@/components/states";
import { useDaemonStatus } from "@/components/DaemonStatus";
import type { TopCandidatesResult } from "@/lib/types";

export default function ScreenPage() {
  const { online } = useDaemonStatus();
  // Scan is EXPENSIVE (chained recon). On-demand only — never auto-polled (F5).
  const scan = useMutation({
    mutationFn: () => callReadTool<TopCandidatesResult>("get_top_candidates", { limit: 10 }),
  });

  const data = scan.data;
  const candidates = data?.candidates ?? [];
  const rejected = data?.filtered_examples ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Screening</h2>
          <p className="text-[12px] text-text-tertiary">Runs the full candidate scan on demand. This is slow (chained recon).</p>
        </div>
        <Button variant="primary" disabled={!online || scan.isPending} loading={scan.isPending} onClick={() => scan.mutate()}>
          <Crosshair size={16} /> Scan
        </Button>
      </div>

      {scan.isPending ? (
        <EmptyState title="Scanning candidates..." hint="Recon runs sequentially with throttling; this can take a while." />
      ) : scan.isError ? (
        <ErrorState message={(scan.error as Error).message} onRetry={() => scan.mutate()} />
      ) : data?.error ? (
        <ErrorState message={data.error} onRetry={() => scan.mutate()} />
      ) : !data ? (
        <EmptyState icon={Crosshair} title="No scan yet." hint="Press Scan to fetch the top pool candidates." />
      ) : (
        <>
          {data.total_screened != null && (
            <p className="text-[12px] text-text-tertiary">
              {candidates.length} candidate(s) from {data.total_screened} screened.
            </p>
          )}

          {candidates.length === 0 ? (
            <EmptyState icon={Crosshair} title="No candidates passed the filters." hint="Loosen screening thresholds in Config, or try again later." />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {candidates.map((c) => (
                <CandidateCard key={c.pool} c={c} />
              ))}
            </div>
          )}

          {rejected.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
                <ProhibitInset size={16} className="text-warning" /> Rejected ({rejected.length})
              </h3>
              <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
                {rejected.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <span className="font-medium text-text-primary">{r.name || "candidate"}</span>
                    <span className="text-text-tertiary">{r.reason || "-"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
