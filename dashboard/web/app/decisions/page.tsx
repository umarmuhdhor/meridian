"use client";

import { GitBranch } from "@phosphor-icons/react";
import { useFile } from "@/lib/hooks";
import { DecisionTimeline } from "@/components/DecisionTimeline";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/states";
import type { DecisionLogFile } from "@/lib/types";

export default function DecisionsPage() {
  const q = useFile<DecisionLogFile>("decision-log");
  // The repo stores newest-first (unshift); render as-is. The old `.reverse()`
  // showed the OLDEST decisions on top, making fresh entries look days stale.
  const decisions = q.data?.decisions ?? [];

  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.isError) return <ErrorState message="Failed to load decisions." onRetry={() => q.refetch()} />;
  if (decisions.length === 0)
    return (
      <EmptyState
        icon={GitBranch}
        title="No decisions logged yet."
        hint="The agent records deploy, close, skip and no-deploy events here as it runs."
      />
    );

  return <DecisionTimeline decisions={decisions} />;
}
