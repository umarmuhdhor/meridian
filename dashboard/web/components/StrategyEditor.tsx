"use client";

import { useState } from "react";
import { Plus, Star, Trash } from "@phosphor-icons/react";
import { useFile } from "@/lib/hooks";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ConfirmModal";
import { SkeletonRows, EmptyState, ErrorState } from "./states";
import { useDaemonStatus } from "./DaemonStatus";
import type { StrategyLibraryFile, Strategy } from "@/lib/types";

const LP = ["bid_ask", "spot", "curve"];
const inputCls = "h-9 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-primary";

export function StrategyEditor() {
  const q = useFile<StrategyLibraryFile>("strategy-library");
  const { online } = useDaemonStatus();
  const strategies = Object.values(q.data?.strategies ?? {});
  const active = q.data?.active;

  const [addOpen, setAddOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [lp, setLp] = useState("bid_ask");
  const [bestFor, setBestFor] = useState("");
  const [raw, setRaw] = useState("");

  const [activeTarget, setActiveTarget] = useState<Strategy | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Strategy | null>(null);

  const resetAdd = () => {
    setId("");
    setName("");
    setLp("bid_ask");
    setBestFor("");
    setRaw("");
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-text-primary">
          Strategy library <span className="text-[12px] font-normal text-text-tertiary">({strategies.length})</span>
        </h2>
        <Button size="sm" variant="primary" disabled={!online} onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add strategy
        </Button>
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={3} />
      ) : q.isError ? (
        <ErrorState message="Failed to load strategies." onRetry={() => q.refetch()} />
      ) : strategies.length === 0 ? (
        <EmptyState title="No strategies saved." hint="Add one to make it selectable as the active screening strategy." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {strategies.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text-primary">{s.name}</span>
                {s.id === active && <Badge tone="profit">Active</Badge>}
              </div>
              <div className="font-mono text-[12px] text-text-tertiary">{s.id}</div>
              {s.lp_strategy && <div className="text-[12px] text-text-secondary">LP: {s.lp_strategy}</div>}
              {s.best_for && <div className="text-[12px] text-text-tertiary">{s.best_for}</div>}
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="secondary" disabled={!online || s.id === active} onClick={() => setActiveTarget(s)}>
                  <Star size={14} /> Set active
                </Button>
                <Button size="sm" variant="danger-ghost" disabled={!online} onClick={() => setRemoveTarget(s)}>
                  <Trash size={14} /> Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add strategy */}
      <ConfirmModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add strategy?"
        toolName="add_strategy"
        args={{ id: id.trim(), name: name.trim(), lp_strategy: lp, best_for: bestFor.trim(), raw: raw.trim() }}
        variant="primary"
        confirmLabel="Add strategy"
        invalidateKeys={["strategy-library"]}
        confirmDisabled={!id.trim() || !name.trim()}
        successMessage="Strategy added."
        onDone={resetAdd}
        impact="Saved to the strategy library. Set it active to use it in screening."
        extra={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Id (required)</label>
              <input value={id} onChange={(e) => setId(e.target.value)} className={inputCls} placeholder="my_strategy" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Name (required)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="My Strategy" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">LP strategy</label>
              <select className={inputCls} value={lp} onChange={(e) => setLp(e.target.value)}>
                {LP.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Best for</label>
              <input value={bestFor} onChange={(e) => setBestFor(e.target.value)} className={inputCls} placeholder="trending tokens with strong volume" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Notes / raw</label>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={2}
                className="w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 py-2 text-[13px] text-text-primary"
              />
            </div>
          </div>
        }
      />

      {/* Set active */}
      <ConfirmModal
        open={!!activeTarget}
        onClose={() => setActiveTarget(null)}
        title="Set active strategy?"
        toolName="set_active_strategy"
        args={{ id: activeTarget?.id }}
        variant="primary"
        confirmLabel="Set active"
        invalidateKeys={["strategy-library"]}
        successMessage="Active strategy updated."
        fields={activeTarget ? [{ label: "Strategy", value: activeTarget.name }] : []}
        impact="The screener uses this strategy on its next cycle."
      />

      {/* Remove */}
      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove strategy?"
        toolName="remove_strategy"
        args={{ id: removeTarget?.id }}
        variant="danger"
        confirmLabel="Remove"
        invalidateKeys={["strategy-library"]}
        successMessage="Strategy removed."
        fields={removeTarget ? [{ label: "Strategy", value: removeTarget.name }] : []}
        impact="Deletes this strategy from the library."
      />
    </section>
  );
}
