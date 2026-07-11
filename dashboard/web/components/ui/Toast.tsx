"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Info, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

// Minimal toast store (Design §11.10). Transient feedback only — persistent
// errors/blocks are shown inline in modals/forms, not here.

export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let seq = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

function push(kind: ToastKind, message: string) {
  const id = seq++;
  items = [...items, { id, kind, message }];
  emit();
  // Auto-dismiss after 4s except errors (manual dismiss).
  if (kind !== "error") setTimeout(() => dismiss(id), 4000);
  return id;
}

export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m),
  info: (m: string) => push("info", m),
};

const ICONS = {
  success: <CheckCircle size={18} className="text-profit" weight="fill" />,
  error: <XCircle size={18} className="text-loss" weight="fill" />,
  info: <Info size={18} className="text-accent-bright" weight="fill" />,
};

export function ToastViewport() {
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    const l: Listener = (next) => setList(next);
    listeners.add(l);
    setList(items);
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" role="region" aria-label="Notifications">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-2 rounded-[var(--radius-lg)] border border-border bg-surface-3 px-3 py-2.5 shadow-lg",
            "min-w-[240px] max-w-[380px] text-[13px] text-text-primary"
          )}
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <span className="mt-0.5 shrink-0">{ICONS[t.kind]}</span>
          <span className="flex-1 break-words">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 text-text-tertiary hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
