"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ConfirmModal";
import { toast } from "./ui/Toast";
import { useDaemonStatus } from "./DaemonStatus";
import { formatPnlPct, formatUsd, formatSol, truncateAddress } from "@/lib/format";
import type { Position, ToolResult } from "@/lib/types";

type ModalKind = "close" | "claim" | "note" | "swap" | null;

const inputCls =
  "h-9 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 font-mono text-[13px] text-text-primary";

export function PositionActions({ p }: { p: Position }) {
  const { online } = useDaemonStatus();
  const [modal, setModal] = useState<ModalKind>(null);
  const [skipSwap, setSkipSwap] = useState(false);
  const [note, setNote] = useState(p.instruction ?? "");
  const [amount, setAmount] = useState("");

  const name = p.pool_name || p.pair || "position";
  const invalidate = ["positions", "summary"];

  const closeDone = (r: ToolResult) => {
    if (r.auto_swapped) toast.info(`Auto-swapped base to SOL${r.sol_received ? ` (+${formatSol(r.sol_received)})` : ""}.`);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="danger" disabled={!online} onClick={() => setModal("close")}>
        Close
      </Button>
      <Button size="sm" variant="secondary" disabled={!online} onClick={() => setModal("claim")}>
        Claim
      </Button>
      <Button size="sm" variant="ghost" disabled={!online} onClick={() => setModal("note")}>
        Note
      </Button>
      <Button size="sm" variant="ghost" disabled={!online || !p.base_mint} onClick={() => setModal("swap")}>
        Swap
      </Button>

      {/* Close */}
      <ConfirmModal
        open={modal === "close"}
        onClose={() => setModal(null)}
        title="Close position?"
        toolName="close_position"
        args={{ position_address: p.position, reason: "manual from dashboard", skip_swap: skipSwap }}
        variant="danger"
        confirmLabel="Close position"
        invalidateKeys={invalidate}
        successMessage={`Closed ${name}.`}
        onDone={closeDone}
        fields={[
          { label: "Pool", value: name },
          { label: "PnL", value: formatPnlPct(p.pnl_pct) },
          { label: "Value", value: formatUsd(p.total_value_usd) },
        ]}
        impact="Position is closed on-chain, fees are claimed, and base is auto-swapped to SOL unless you skip it."
        extra={
          <label className="flex items-center gap-2 text-[13px] text-text-secondary">
            <input type="checkbox" checked={skipSwap} onChange={(e) => setSkipSwap(e.target.checked)} />
            Don&apos;t auto-swap base to SOL (skip_swap)
          </label>
        }
      />

      {/* Claim */}
      <ConfirmModal
        open={modal === "claim"}
        onClose={() => setModal(null)}
        title="Claim fees?"
        toolName="claim_fees"
        args={{ position_address: p.position }}
        variant="primary"
        confirmLabel="Claim fees"
        invalidateKeys={invalidate}
        successMessage={`Claimed fees on ${name}.`}
        fields={[
          { label: "Pool", value: name },
          { label: "Unclaimed", value: formatUsd(p.unclaimed_fees_usd) },
        ]}
        impact="Unclaimed fees are collected to your wallet."
      />

      {/* Note / instruction */}
      <ConfirmModal
        open={modal === "note"}
        onClose={() => setModal(null)}
        title="Set position note?"
        toolName="set_position_note"
        args={{ position_address: p.position, instruction: note.trim() }}
        variant="primary"
        confirmLabel="Save note"
        invalidateKeys={invalidate}
        confirmDisabled={!note.trim()}
        successMessage={`Note set on ${name}.`}
        fields={[{ label: "Pool", value: name }]}
        impact="The agent checks this instruction each management cycle and acts when its condition is met."
        extra={
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-text-tertiary">Instruction (max 280 chars)</label>
            <textarea
              value={note}
              maxLength={280}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 py-2 text-[13px] text-text-primary"
              placeholder="e.g. close if pnl drops below -5%"
            />
            <span className="text-right text-[11px] text-text-tertiary">{note.length}/280</span>
          </div>
        }
      />

      {/* Swap base → SOL */}
      <ConfirmModal
        open={modal === "swap"}
        onClose={() => setModal(null)}
        title="Swap base to SOL?"
        toolName="swap_token"
        args={{ input_mint: p.base_mint, output_mint: "SOL", amount: Number(amount) }}
        variant="danger"
        confirmLabel="Swap"
        invalidateKeys={invalidate}
        confirmDisabled={!(Number(amount) > 0)}
        successMessage="Swap submitted."
        fields={[
          { label: "From", value: truncateAddress(p.base_mint) },
          { label: "To", value: "SOL" },
        ]}
        impact="Swaps the given amount of base token to SOL via Jupiter."
        extra={
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-text-tertiary">Amount (base token)</label>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
              placeholder="0.0"
            />
          </div>
        }
      />
    </div>
  );
}
