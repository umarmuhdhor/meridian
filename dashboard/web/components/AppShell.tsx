"use client";

import { useState } from "react";
import { DaemonStatusProvider, DaemonStatusBanner } from "./DaemonStatus";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ToastViewport } from "./ui/Toast";
import { useLiveEvents } from "@/lib/useLiveEvents";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useLiveEvents(); // SSE push (positions + decisions); falls back to polling if unavailable

  return (
    <DaemonStatusProvider>
      <DaemonStatusBanner />
      <div className="flex min-h-screen">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenMobile={() => setMobileOpen(true)} />
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-4 md:px-6 md:py-6">{children}</main>
        </div>
      </div>
      <ToastViewport />
    </DaemonStatusProvider>
  );
}
