"use client";

import { useEffect, useState } from "react";
import { Warning, ShieldWarning } from "@phosphor-icons/react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { toast } from "./ui/Toast";
import { useToolMutation, ToolError } from "@/lib/mutation";
import type { ToolResult } from "@/lib/types";
import { useDaemonStatus } from "./DaemonStatus";

export interface ConfirmField {
  label: string;
  value: React.ReactNode;
}

// Generic confirm gate for every WRITE tool (Design §11.6). Shows the affected
// args, an impact sentence, optional extra options (e.g. skip_swap), and an
// optional typed extra-confirmation (e.g. "DELETE" for clear_lessons). Blocked
// results show `reason` inline; the modal stays open. Pending disables all buttons.
export function ConfirmModal({
  open,
  onClose,
  title,
  toolName,
  args,
  fields,
  impact,
  extra,
  confirmLabel = "Confirm",
  variant = "danger",
  invalidateKeys = [],
  extraConfirmWord,
  confirmDisabled = false,
  successMessage,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  toolName: string;
  args: Record<string, unknown>;
  fields?: ConfirmField[];
  impact?: string;
  extra?: React.ReactNode;
  confirmLabel?: string;
  variant?: "danger" | "primary";
  invalidateKeys?: string[];
  extraConfirmWord?: string;
  confirmDisabled?: boolean;
  successMessage?: string;
  onDone?: (result: ToolResult) => void;
}) {
  const mutation = useToolMutation(invalidateKeys);
  const { online } = useDaemonStatus();
  const [error, setError] = useState<{ msg: string; blocked: boolean } | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) {
      setError(null);
      setTyped("");
    }
  }, [open]);

  const pending = mutation.isPending;
  const extraOk = !extraConfirmWord || typed === extraConfirmWord;

  const submit = async () => {
    setError(null);
    try {
      const result = await mutation.mutateAsync({ name: toolName, args });
      toast.success(successMessage ?? `${title.replace(/\?$/, "")} done.`);
      onDone?.(result);
      onClose();
    } catch (e) {
      const te = e as ToolError;
      setError({ msg: te.message, blocked: te.kind === "blocked" });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      closeDisabled={pending}
      icon={
        variant === "danger" ? (
          <Warning size={20} className="text-loss" weight="fill" />
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={variant} onClick={submit} loading={pending} disabled={pending || !extraOk || !online || confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {fields && fields.length > 0 && (
          <dl className="flex flex-col gap-1.5">
            {fields.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 text-[13px]">
                <dt className="text-text-tertiary">{f.label}</dt>
                <dd className="text-right font-mono text-text-primary tnum">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {extra}

        {impact && <p className="text-[12px] text-text-secondary">{impact}</p>}

        {extraConfirmWord && (
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-text-tertiary">
              Type <span className="font-mono text-text-primary">{extraConfirmWord}</span> to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-9 rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 font-mono text-[13px] text-text-primary"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {!online && (
          <p className="flex items-center gap-1.5 text-[12px] text-warning">
            <Warning size={14} /> Daemon offline. Actions are disabled.
          </p>
        )}

        {error && (
          <div
            className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-[12px]"
            style={{ backgroundColor: error.blocked ? "var(--warning-tint)" : "var(--loss-tint)" }}
          >
            <ShieldWarning size={15} className={error.blocked ? "text-warning" : "text-loss"} weight="bold" />
            <span className={error.blocked ? "text-warning" : "text-loss"}>
              {error.blocked ? "Blocked by safety check: " : ""}
              {error.msg}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
