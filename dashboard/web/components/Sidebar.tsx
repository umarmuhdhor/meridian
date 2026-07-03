"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretLineLeft, CaretLineRight, X } from "@phosphor-icons/react";
import { NAV } from "./nav";
import { cn } from "@/lib/cn";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();

  const nav = (
    <nav className="flex flex-col gap-0.5 px-2 py-3">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const IconEl = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onCloseMobile}
            title={collapsed ? item.label : undefined}
            className={cn(
              "relative flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-[14px] transition-colors",
              active
                ? "text-text-primary"
                : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            )}
            style={active ? { backgroundColor: "var(--accent-tint)" } : undefined}
            aria-current={active ? "page" : undefined}
          >
            {active && (
              <span
                className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
                style={{ backgroundColor: "var(--accent-bright)" }}
                aria-hidden
              />
            )}
            <IconEl size={20} weight={active ? "bold" : "regular"} className="shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 border-r border-border bg-surface-1 transition-[width] duration-200",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div className={cn("flex h-14 items-center border-b border-border px-3", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <span className="font-mono text-[15px] font-semibold tracking-tight text-text-primary">
              Meridian
            </span>
          )}
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
          >
            {collapsed ? <CaretLineRight size={16} /> : <CaretLineLeft size={16} />}
          </button>
        </div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-20 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={onCloseMobile} aria-hidden />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-border bg-surface-1">
            <div className="flex h-14 items-center justify-between border-b border-border px-3">
              <span className="font-mono text-[15px] font-semibold text-text-primary">Meridian</span>
              <button
                onClick={onCloseMobile}
                aria-label="Close menu"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary hover:bg-surface-2"
              >
                <X size={18} />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
