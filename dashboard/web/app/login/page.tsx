"use client";

// PIN login screen. Renders bare (AppShell bypasses it on /login). Posts the
// 6-digit PIN to /api/auth/login; on success navigates to ?next or /.

import { useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy || pin.length !== 6) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        if (res.ok) {
          router.replace(next.startsWith("/") ? next : "/");
          return;
        }
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error || (res.status === 429 ? "Too many attempts" : "Invalid PIN"));
        setPin("");
      } catch {
        setError("Network error");
      } finally {
        setBusy(false);
      }
    },
    [busy, pin, next, router],
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xs rounded-xl border border-border bg-surface p-6 shadow-lg"
      >
        <h1 className="mb-1 text-lg font-semibold text-text-primary">Meridian Control</h1>
        <p className="mb-5 text-sm text-text-secondary">Enter your 6-digit PIN</p>
        <input
          autoFocus
          inputMode="numeric"
          pattern="\d*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none focus:border-accent"
          placeholder="______"
          aria-label="6-digit PIN"
        />
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || pin.length !== 6}
          className="w-full rounded-lg bg-accent px-3 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
