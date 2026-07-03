"use client";

import { useState } from "react";
import { Plus, Trash, Prohibit } from "@phosphor-icons/react";
import { useFile } from "@/lib/hooks";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Address } from "@/components/Address";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/states";
import { useDaemonStatus } from "@/components/DaemonStatus";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { TokenBlacklistFile, DevBlocklistFile } from "@/lib/types";

const inputCls = "h-9 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-primary font-mono";

function TokenTab() {
  const q = useFile<TokenBlacklistFile>("token-blacklist");
  const { online } = useDaemonStatus();
  const entries = Object.entries(q.data ?? {});

  const [addOpen, setAddOpen] = useState(false);
  const [mint, setMint] = useState("");
  const [symbol, setSymbol] = useState("");
  const [reason, setReason] = useState("");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const reset = () => {
    setMint("");
    setSymbol("");
    setReason("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!online} onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add token
        </Button>
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.isError ? (
        <ErrorState message="Failed to load token blacklist." onRetry={() => q.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={Prohibit} title="No blacklisted tokens." hint="Blacklisted mints are hard-filtered before screening." />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {entries.map(([m, meta]) => (
            <li key={m} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">{meta.symbol || "token"}</span>
                  <Address value={m} />
                </div>
                <div className="text-[12px] text-text-tertiary">
                  {meta.reason || "no reason"}
                  {meta.added_at ? ` · ${relativeTime(meta.added_at)}` : ""}
                </div>
              </div>
              <Button size="sm" variant="danger-ghost" disabled={!online} onClick={() => setRemoveTarget(m)}>
                <Trash size={14} /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Blacklist token?"
        toolName="add_to_blacklist"
        args={{ mint: mint.trim(), symbol: symbol.trim() || undefined, reason: reason.trim() }}
        variant="primary"
        confirmLabel="Add to blacklist"
        invalidateKeys={["token-blacklist"]}
        confirmDisabled={!mint.trim() || !reason.trim()}
        successMessage="Token blacklisted."
        onDone={reset}
        impact="The mint is hard-filtered out of screening from the next cycle."
        extra={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Mint (required)</label>
              <input value={mint} onChange={(e) => setMint(e.target.value)} className={inputCls} placeholder="token mint address" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Symbol</label>
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className={inputCls} placeholder="WIF" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Reason (required)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="rug / honeypot / low quality" />
            </div>
          </div>
        }
      />

      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove from blacklist?"
        toolName="remove_from_blacklist"
        args={{ mint: removeTarget }}
        variant="danger"
        confirmLabel="Remove"
        invalidateKeys={["token-blacklist"]}
        successMessage="Removed from blacklist."
        fields={removeTarget ? [{ label: "Mint", value: removeTarget }] : []}
        impact="The token can appear in screening again."
      />
    </div>
  );
}

function DevTab() {
  const q = useFile<DevBlocklistFile>("dev-blocklist");
  const { online } = useDaemonStatus();
  const entries = Object.entries(q.data ?? {});

  const [addOpen, setAddOpen] = useState(false);
  const [wallet, setWallet] = useState("");
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const reset = () => {
    setWallet("");
    setLabel("");
    setReason("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!online} onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Block deployer
        </Button>
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.isError ? (
        <ErrorState message="Failed to load dev blocklist." onRetry={() => q.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={Prohibit} title="No blocked deployers." hint="Blocked deployer wallets are hard-filtered before screening." />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {entries.map(([w, meta]) => (
            <li key={w} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">{meta.label || "deployer"}</span>
                  <Address value={w} />
                </div>
                <div className="text-[12px] text-text-tertiary">
                  {meta.reason || "no reason"}
                  {meta.added_at ? ` · ${relativeTime(meta.added_at)}` : ""}
                </div>
              </div>
              <Button size="sm" variant="danger-ghost" disabled={!online} onClick={() => setRemoveTarget(w)}>
                <Trash size={14} /> Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Block deployer?"
        toolName="block_deployer"
        args={{ wallet: wallet.trim(), label: label.trim() || undefined, reason: reason.trim() || undefined }}
        variant="primary"
        confirmLabel="Block deployer"
        invalidateKeys={["dev-blocklist"]}
        confirmDisabled={!wallet.trim()}
        successMessage="Deployer blocked."
        onDone={reset}
        impact="Pools from this deployer are hard-filtered out of screening."
        extra={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Wallet (required)</label>
              <input value={wallet} onChange={(e) => setWallet(e.target.value)} className={inputCls} placeholder="deployer wallet address" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Label</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="serial rugger" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="history of rugs" />
            </div>
          </div>
        }
      />

      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Unblock deployer?"
        toolName="unblock_deployer"
        args={{ wallet: removeTarget }}
        variant="danger"
        confirmLabel="Unblock"
        invalidateKeys={["dev-blocklist"]}
        successMessage="Deployer unblocked."
        fields={removeTarget ? [{ label: "Wallet", value: removeTarget }] : []}
        impact="Pools from this deployer can appear in screening again."
      />
    </div>
  );
}

export default function BlocklistPage() {
  const [tab, setTab] = useState<"token" | "dev">("token");
  const tabCls = (active: boolean) =>
    cn(
      "h-9 rounded-[var(--radius-md)] px-3 text-[13px] transition-colors",
      active ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:text-text-primary"
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-border pb-2">
        <button className={tabCls(tab === "token")} onClick={() => setTab("token")}>
          Token blacklist
        </button>
        <button className={tabCls(tab === "dev")} onClick={() => setTab("dev")}>
          Dev blocklist
        </button>
      </div>
      {tab === "token" ? <TokenTab /> : <DevTab />}
    </div>
  );
}
