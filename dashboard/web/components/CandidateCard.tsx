"use client";

import { useState } from "react";
import { Rocket } from "@phosphor-icons/react";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ConfirmModal";
import { Address } from "./Address";
import { useDaemonStatus } from "./DaemonStatus";
import { compact, formatRatio, formatUsd } from "@/lib/format";
import type { Candidate } from "@/lib/types";

const LP = ["bid_ask", "spot", "curve"];
const inputCls = "h-9 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-primary font-mono";

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</span>
      <span className="font-mono text-[13px] text-text-primary tnum">{value}</span>
    </div>
  );
}

export function CandidateCard({ c }: { c: Candidate }) {
  const { online } = useDaemonStatus();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [strategy, setStrategy] = useState("bid_ask");
  const [bins, setBins] = useState("69");

  const name = c.name || `${c.base?.symbol ?? "?"}/${c.quote?.symbol ?? "?"}`;
  const binsN = Number(bins);
  const valid = Number(amount) > 0 && Number.isFinite(binsN) && binsN >= 35;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-text-primary">{name}</div>
          <Address value={c.pool} />
        </div>
        {c.launchpad && <span className="text-[11px] text-text-tertiary">{c.launchpad}</span>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="TVL" value={compact(c.tvl ?? null)} />
        <Metric label="Fee/TVL" value={formatRatio(c.fee_active_tvl_ratio ?? null)} />
        <Metric label="Organic" value={c.organic_score ?? "-"} />
        <Metric label="Holders" value={compact(c.holders ?? null)} />
        <Metric label="Mcap" value={c.mcap != null ? formatUsd(c.mcap) : "-"} />
        <Metric label="Bin step" value={c.bin_step ?? "-"} />
      </div>

      <Button variant="danger" disabled={!online} onClick={() => setOpen(true)}>
        <Rocket size={16} /> Deploy
      </Button>

      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Deploy position?"
        toolName="deploy_position"
        args={{
          pool_address: c.pool,
          pool_name: c.name,
          base_mint: c.base?.mint,
          bin_step: c.bin_step,
          base_fee: c.fee_pct,
          volatility: c.volatility,
          fee_tvl_ratio: c.fee_active_tvl_ratio,
          organic_score: c.organic_score,
          amount_sol: Number(amount),
          strategy,
          bins_below: binsN,
        }}
        variant="danger"
        confirmLabel="Deploy"
        invalidateKeys={["positions", "summary"]}
        confirmDisabled={!valid}
        successMessage={`Deployed into ${name}.`}
        impact="Opens a position on-chain. It is re-validated against live pool thresholds and may be blocked by safety checks."
        fields={[
          { label: "Pool", value: name },
          { label: "Amount", value: amount ? `${amount} SOL` : "-" },
          { label: "Strategy", value: strategy },
          { label: "Bins below", value: bins },
        ]}
        extra={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Amount (SOL)</label>
              <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="0.5" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Strategy</label>
              <select className={inputCls} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                {LP.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Bins below (min 35)</label>
              <input value={bins} inputMode="numeric" onChange={(e) => setBins(e.target.value)} className={inputCls} />
            </div>
          </div>
        }
      />
    </div>
  );
}
