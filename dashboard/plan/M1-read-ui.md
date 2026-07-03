# M1 — Read UI

> Next.js 15 scaffold + semua halaman read-only inti. Proxy token server-side.
> Desain: `dashboard/Design.md` (dark default, Geist, tabular figures).
> Data & shape: [`reference.md`](reference.md).

## 1. Tujuan & prasyarat

- **Tujuan**: browser bisa lihat Overview, Positions (read), Decisions, Feed (read). Daemon mati → banner offline, halaman statis tetap jalan. Token tidak pernah ke browser.
- **Prasyarat**: [M0](M0-bridge.md) lulus (bridge `/health`, `/state/*`, `/state/file/*` jalan).
- **Output**: `dashboard/web/` (Next app), `lib/*`, API proxy routes, app shell, 4 halaman read, `dashboard/README.md`.

## 2. Tugas per file

### Scaffold & config
- [ ] `dashboard/web/` — `create-next-app` (App Router, TS, Tailwind). `npm i geist @phosphor-icons/react @tanstack/react-query recharts` + shadcn/ui init. Pin versi major di `package.json`.
- [ ] `app/globals.css` — **ganti** blok warna shadcn default dengan token Design §16.2 (dark = default). Tambah `.tnum`. Expose token domain sebagai utility bila pakai `@theme` (`bg-surface-1`, `text-profit`, dll.).
- [ ] `app/layout.tsx` — `GeistSans`/`GeistMono` variable + `className="dark"` (Design §16.1). Bungkus `QueryProvider`.
- [ ] `.env.local.example` — `BRIDGE_URL`, `BRIDGE_TOKEN`, `MERIDIAN_ROOT`.

### lib
- [ ] `lib/bridge.ts` — `bridgeGet(path)` / `bridgePost(name,args,confirm)` server-side fetch ke `BRIDGE_URL` + header `Authorization: Bearer ${BRIDGE_TOKEN}`. **Server-only** (jangan `"use client"`).
- [ ] `lib/files.ts` — `readRootJson(name)` via `MERIDIAN_ROOT` (default resolve `../..`), whitelist + redaction **sama** [`reference.md` §3/§8]. Read-only.
- [ ] `lib/types.ts` — `Position`, `StateSummary`, `WalletBalance`, `Lesson`, `Decision`, `Strategy`, dari [`reference.md` §6]. + tipe file JSON (lessons/decision-log/strategy-library).
- [ ] `lib/format.ts` — helper format (§3 skeleton). Satu-satunya tempat format angka (Design §10).
- [ ] `lib/pnl-color.ts` — `pnlColorClass(v)` → `text-profit` / `text-loss` / `text-tertiary`.
- [ ] `lib/query.ts` — QueryClient defaults + interval per jenis (§9.2 PRD): live 10s, file 30s + refetch on focus.

### API proxy (token tak bocor)
- [ ] `app/api/tool/route.ts` — `POST` → `bridgePost`. Teruskan `{name,args,confirm}` (dipakai M2+).
- [ ] `app/api/state/[...path]/route.ts` — `GET` → `bridgeGet('/state/'+path)`.
- [ ] `app/api/files/[name]/route.ts` — `GET` → `readRootJson(name)` (fs langsung, bukan lewat bridge; whitelist+redaction identik).

### Shell & komponen
- [ ] `components/AppShell.tsx` (+ `Sidebar`, `TopBar`) — Design §6.2. Sidebar 240px, item aktif garis kiri 2px `--accent-bright`, collapse rail 64px. Top bar: judul + saldo SOL live + Refresh + toggle tema.
- [ ] `components/DaemonStatusBanner.tsx` — poll `/api/state/health` (atau `/health`); gagal ≥2× → banner offline (§9.3). Design §11.9.
- [ ] `components/PositionCard.tsx`, `components/DecisionTimeline.tsx`, `components/StatCard.tsx`, komponen state (`Skeleton`, `EmptyState`, `ErrorState`).

### Halaman read
- [ ] `app/page.tsx` — **Overview** (AC-OV.*). KPI: open positions, net PnL (USD+%), win-rate (dari `lessons.json` performance), saldo SOL, daemon status. 3 kartu posisi teratas + 5 keputusan terbaru.
- [ ] `app/positions/page.tsx` — **Positions read-only** (tabel; aksi di M2). Data `/api/state/positions` + `state.json`.
- [ ] `app/decisions/page.tsx` — **Decisions** (AC-DT.*). `decision-log.json`, filter tipe/actor/pool, expand detail + `rejected[]`.
- [ ] `app/feed/page.tsx` — **Feed read-only**. `lessons.json` + `strategy-library.json` (CRUD di M2).
- [ ] `dashboard/README.md` — cara run 2 proses + daftar env (PRD Lampiran A).

## 3. Code skeleton (kunci)

### `lib/format.ts` (Design §10 / §16.4)
```ts
export const formatSol = (n: number, d = 3) => `${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} SOL`;
export const formatUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatPnlPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)}%`;
export const formatPnlUsd = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
export const truncateAddress = (a: string, n = 4) => (a && a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
export const compact = (n: number) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export function relativeTime(ts: string | number): string {
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
// TIDAK ada em-dash di teks tampil (Design §13). Placeholder kosong = "-" (hyphen) atau "n/a".
```

### `lib/bridge.ts` (server-only)
```ts
import "server-only";
const BASE = process.env.BRIDGE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.BRIDGE_TOKEN ?? "";
const auth = { Authorization: `Bearer ${TOKEN}` };

export async function bridgeGet(path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: auth, cache: "no-store" });
  if (!r.ok) throw new Error(`bridge ${r.status}`);
  return r.json();
}
export async function bridgePost(name: string, args: unknown, confirm = false) {
  const r = await fetch(`${BASE}/tool`, {
    method: "POST", cache: "no-store",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name, args, confirm }),
  });
  return { status: r.status, body: await r.json() };   // teruskan status+body ke client
}
```

### `app/api/state/[...path]/route.ts`
```ts
import { NextRequest, NextResponse } from "next/server";
import { bridgeGet } from "@/lib/bridge";
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const qs = req.nextUrl.search;                        // teruskan ?force=1
  try { return NextResponse.json(await bridgeGet(`/state/${path.join("/")}${qs}`)); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
```

> `app/api/tool/route.ts` (kerangka): baca `{name,args,confirm}` dari body → `bridgePost` → kembalikan `{status, body}`. Client baca `body.ok` / `body.result`. Detail pemakaian di [M2](M2-write.md).

### Pola halaman (client + TanStack Query)
```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
function usePositions() {
  return useQuery({ queryKey: ["positions"], queryFn: () => fetch("/api/state/positions").then(r => r.json()), refetchInterval: 10_000 });
}
// Wajib render 4 state: isLoading→Skeleton, error→ErrorState, data kosong→EmptyState, data→konten.
```

## 4. Peta AC

| AC | Dipenuhi oleh |
|---|---|
| AC-OV.1 (PnL refresh ≤15s tanpa reload) | `usePositions` `refetchInterval:10_000` di Overview |
| AC-OV.2 (daemon mati → banner ≤30s, tak crash) | `DaemonStatusBanner` (health gagal ≥2×) + error boundary tiap panel |
| AC-OV.3 (tanpa posisi → empty state) | `EmptyState` di Overview & Positions |
| AC-DT.1 (entri baru ≤1 interval) | Decisions `refetchInterval:30_000` on `/api/files/decision-log` |
| AC-DT.2 (`no_deploy` tampilkan `rejected[]`) | `DecisionTimeline` expand detail |

Feed read-only di M1 memvalidasi baca `lessons.json`/`strategy-library.json`; CRUD-nya (AC-FT.*) di M2.

## 5. Gotchas

- **#6 (token)**: `lib/bridge.ts` `import "server-only"`. API routes = server. Halaman client fetch ke `/api/*`, **tak pernah** ke bridge langsung → cek Network tab: tak ada `Authorization`/`8787`.
- **F5**: positions polling 10s cukup (cache daemon fresh ≤3s). Jangan `?force=1` di auto-poll — hanya tombol Refresh (throttle client 10s).
- **Design**: dark default; angka finansial Geist Mono + `.tnum` rata kanan; PnL warna by-sign + tanda; alamat truncate+copy; **nol em-dash**; empty/loading/error/offline wajib ada (Design §12).
- **Win-rate** dihitung dari `lessons.json` `performance[]` (bukan endpoint khusus) — baca via `/api/files/lessons`.
- **Mobile** (<768px): grid → 1 kolom, sidebar → drawer (Design §6.3). Nyatakan eksplisit per halaman.
- `MERIDIAN_ROOT` default `path.resolve(process.cwd(), "../..")` dari `dashboard/web` — pastikan benar saat `npm run dev` dijalankan dari `dashboard/web`.

## 6. Verifikasi (DoD)

1. `cd dashboard/web && npm install && cp .env.local.example .env.local` (isi `BRIDGE_TOKEN` = token daemon) → `npm run dev`, buka `http://localhost:3000`.
2. Overview menampilkan positions/PnL/saldo/status; angka mono tabular, PnL berwarna by-sign.
3. Positions/Decisions/Feed menampilkan data dari file JSON + `/state/*`.
4. Matikan daemon → dalam ≤30s `DaemonStatusBanner` muncul "Daemon offline — mode read-only"; halaman statis (Decisions/Feed dari fs) tetap tampil; tidak crash.
5. DevTools → Network: tidak ada request ke `127.0.0.1:8787` dari browser, tidak ada header `Authorization` bocor. Semua lewat `/api/*`.
6. Empty state muncul saat tanpa posisi (bukan error/blank).
