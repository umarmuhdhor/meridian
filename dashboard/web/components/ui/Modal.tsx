"use client";

import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";

// Accessible modal: Esc closes, overlay click closes, focus moves in, body scroll
// locked. Overlay z-50 (Design §7.3).
export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeDisabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closeDisabled) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, closeDisabled]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={() => !closeDisabled && onClose()} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-[var(--radius-xl)] border border-border bg-surface-3 shadow-lg outline-none"
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="text-[16px] font-semibold text-text-primary">{title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            className="text-text-tertiary hover:text-text-primary disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
