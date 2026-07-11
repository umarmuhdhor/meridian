"use client";

import { useState } from "react";
import { Plus, Trash, Eye } from "@phosphor-icons/react";
import { useFile } from "@/lib/hooks";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ConfirmModal";
import { Address } from "./Address";
import { SkeletonRows, EmptyState, ErrorState } from "./states";
import { useDaemonStatus } from "./DaemonStatus";
import type { SmartWalletsFile } from "@/lib/types";

const inputCls = "h-9 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-primary font-mono";

export function SmartWalletList() {
  const q = useFile<SmartWalletsFile>("smart-wallets");
  const { online } = useDaemonStatus();
  const wallets = q.data?.wallets ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState<"lp" | "holder">("lp");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setAddress("");
    setCategory("");
    setType("lp");
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text-primary">
          <Eye size={18} /> Smart-wallet watchlist <span className="text-[12px] font-normal text-text-tertiary">({wallets.length})</span>
        </h2>
        <Button size="sm" variant="primary" disabled={!online} onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add wallet
        </Button>
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={3} />
      ) : q.isError ? (
        <ErrorState message="Failed to load watchlist." onRetry={() => q.refetch()} />
      ) : wallets.length === 0 ? (
        <EmptyState icon={Eye} title="No tracked wallets." hint="Add KOL / alpha wallets; screening uses them as a deploy-confidence signal." />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {wallets.map((w) => (
            <li key={w.address} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">{w.name}</span>
                  <Badge tone={w.type === "holder" ? "neutral" : "accent"}>{w.type || "lp"}</Badge>
                  {w.category && <span className="text-[11px] text-text-tertiary">{w.category}</span>}
                </div>
                <Address value={w.address} />
              </div>
              <Button size="sm" variant="danger-ghost" disabled={!online} onClick={() => setRemoveTarget(w.address)}>
                <Trash size={14} /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add smart wallet?"
        toolName="add_smart_wallet"
        args={{ name: name.trim(), address: address.trim(), category: category.trim() || undefined, type }}
        variant="primary"
        confirmLabel="Add wallet"
        invalidateKeys={["smart-wallets"]}
        confirmDisabled={!name.trim() || !address.trim()}
        successMessage="Wallet added to watchlist."
        onDone={reset}
        impact="The screener checks this wallet's activity on the next cycle."
        extra={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Name (required)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Alpha KOL" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Address (required)</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="wallet address" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} placeholder="kol / whale" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Type</label>
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as "lp" | "holder")}>
                <option value="lp">lp (checks positions)</option>
                <option value="holder">holder (checks token holdings)</option>
              </select>
            </div>
          </div>
        }
      />

      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove smart wallet?"
        toolName="remove_smart_wallet"
        args={{ address: removeTarget }}
        variant="danger"
        confirmLabel="Remove"
        invalidateKeys={["smart-wallets"]}
        successMessage="Wallet removed."
        fields={removeTarget ? [{ label: "Address", value: removeTarget }] : []}
        impact="The screener no longer tracks this wallet."
      />
    </section>
  );
}
