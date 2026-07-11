"use client";

import { GitBranch } from "@phosphor-icons/react";
import { useFile } from "@/lib/hooks";
import { DecisionTimeline } from "@/components/DecisionTimeline";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/states";
import type { DecisionLogFile } from "@/lib/types";

export default function DecisionsPage() {
  const q = useFile<DecisionLogFile>("decision-log");
  const decisions = (q.data?.decisions ?? []).slice().reverse();

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
