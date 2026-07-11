"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Wallet, MagnifyingGlass, ArrowsClockwise } from "@phosphor-icons/react";
import { callReadTool } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Address } from "@/components/Address";
import { SmartWalletList } from "@/components/SmartWalletList";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/states";
import { formatSol, formatUsd, formatPnlPct, binRange } from "@/lib/format";
import { pnlColorClass } from "@/lib/pnl-color";
import type { WalletBalance, PositionsResponse, SmartWalletCheck } from "@/lib/types";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const inputCls = "h-9 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-primary font-mono";

function OwnBalance() {
  const q = useQuery({
    queryKey: ["wallet-balance"],
    queryFn: () => callReadTool<WalletBalance>("get_wallet_balance"),
  });
  const b = q.data;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text-primary">
          <Wallet size={18} /> My wallet
        </h2>
        <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}>
          <ArrowsClockwise size={14} className={q.isFetching ? "mrd-spin" : undefined} /> Refresh
        </Button>
      </div>
      {q.isLoading ? (
        <SkeletonRows rows={2} />
      ) : q.isError || b?.error ? (
        <ErrorState message={b?.error || "Failed to load balance."} onRetry={() => q.refetch()} />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[20px] font-medium text-text-primary tnum">{formatSol(b?.sol)}</span>
            <span className="font-mono text-[14px] text-text-secondary tnum">{formatUsd(b?.total_usd)}</span>
          </div>
          {b?.tokens && b.tokens.length > 0 && (
            <ul className="mt-3 divide-y divide-border border-t border-border">
              {b.tokens.map((t) => (
                <li key={t.mint} className="flex items-center justify-between py-2 text-[13px]">
                  <span className="flex items-center gap-2">
                    <span className="text-text-primary">{t.symbol || "token"}</span>
                    <Address value={t.mint} />
                  </span>
                  <span className="font-mono text-text-secondary tnum">
                    {t.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    {t.usd != null ? ` · ${formatUsd(t.usd)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ScanWallet() {
  const [addr, setAddr] = useState("");
  const m = useMutation({
    mutationFn: (wallet_address: string) => callReadTool<PositionsResponse>("get_wallet_positions", { wallet_address }),
  });
  const valid = BASE58.test(addr.trim());
  const data = m.data;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-text-primary">
        <MagnifyingGlass size={18} /> Scan any wallet
      </h2>
      <div className="flex gap-2">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} className={inputCls} placeholder="wallet address (base58)" />
        <Button variant="primary" disabled={!valid || m.isPending} loading={m.isPending} onClick={() => m.mutate(addr.trim())}>
          Scan
        </Button>
      </div>
      {addr && !valid && <p className="mt-1 text-[12px] text-loss">Not a valid base58 address (32-44 chars).</p>}

      {m.isError ? (
        <ErrorState className="mt-3" message={(m.error as Error).message} />
      ) : data?.error ? (
        <ErrorState className="mt-3" message={data.error} />
      ) : data ? (
        (data.positions ?? []).length === 0 ? (
          <EmptyState title="No DLMM positions for this wallet." />
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-[var(--radius-lg)] border border-border">
            {data.positions.map((p) => (
              <li key={p.position} className="flex items-center justify-between px-4 py-3 text-[13px]">
                <div>
                  <div className="text-text-primary">{p.pool_name || p.pair || "position"}</div>
                  <Address value={p.position} />
                </div>
                <div className="text-right">
                  <div className={`font-mono tnum ${pnlColorClass(p.pnl_pct)}`}>{formatPnlPct(p.pnl_pct)}</div>
                  <div className="font-mono text-[12px] text-text-tertiary tnum">{binRange(p.lower_bin ?? null, p.upper_bin ?? null)}</div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

function CheckOnPool() {
  const [pool, setPool] = useState("");
  const m = useMutation({
    mutationFn: (pool_address: string) => callReadTool<SmartWalletCheck>("check_smart_wallets_on_pool", { pool_address }),
  });
  const valid = BASE58.test(pool.trim());
  const data = m.data;
  const inPool = data?.in_pool ?? []; // tool returns { in_pool, signal, ... }, not `matches`

  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold text-text-primary">Check smart wallets on a pool</h2>
      <div className="flex gap-2">
        <input value={pool} onChange={(e) => setPool(e.target.value)} className={inputCls} placeholder="pool address" />
        <Button variant="secondary" disabled={!valid || m.isPending} loading={m.isPending} onClick={() => m.mutate(pool.trim())}>
          Check
        </Button>
      </div>
      {m.isError ? (
        <ErrorState className="mt-3" message={(m.error as Error).message} />
      ) : data ? (
        <div className="mt-3 flex flex-col gap-2">
          {data.signal && <p className="text-[13px] text-text-secondary">{data.signal}</p>}
          {inPool.length === 0 ? (
            <p className="text-[13px] text-text-tertiary">No tracked smart wallets found on this pool.</p>
          ) : (
            <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
              {inPool.map((w, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                  <span className="text-text-primary">
                    {w.name || "wallet"}
                    {w.category ? <span className="ml-2 text-[11px] text-text-tertiary">{w.category}</span> : null}
                  </span>
                  <Address value={w.address} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function WalletPage() {
  return (
    <div className="flex flex-col gap-8">
      <OwnBalance />
      <ScanWallet />
      <CheckOnPool />
      <SmartWalletList />
    </div>
  );
}
