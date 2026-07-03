# PRD — Meridian Control Dashboard

> Product Requirements Document
> Status: Draft v1
> Owner: @umarmuhdhor
> Tanggal: 2026-07-03
> Scope: Web dashboard untuk mengontrol & memonitor Meridian DLMM agent tanpa mengubah logika trading yang sudah ada.

---

## 1. Ringkasan

Meridian saat ini dikontrol lewat 3 permukaan: Telegram bot, REPL terminal, dan CLI one-shot.
Semua state tersimpan sebagai file JSON di root repo, dan semua aksi lewat satu pintu: `executeTool(name, args)` di `tools/executor.js`.

Dashboard ini adalah **lapisan tipis di atas yang sudah ada** — satu web UI untuk:
- memonitor portfolio, PnL, dan keputusan agent secara real-time,
- **memberi ilmu ke agent** (lessons, strategy, config, blocklist) tanpa hardcode,
- **scanning wallet** (balance, posisi, smart-wallet watchlist),
- mengeksekusi aksi (deploy / close / claim / swap) dengan safety check yang sama seperti LLM.

Prinsip utama: **additive, bukan rewrite**. Seluruh kode dashboard tinggal di folder `dashboard/`. Satu-satunya sentuhan ke kode lama adalah **satu blok boot ber-gate env** di `index.js`.

---

## 2. Tujuan & Non-Tujuan

### 2.1 Tujuan
1. Satu tempat untuk melihat seluruh keadaan agent (positions, PnL, lessons, decisions, wallet).
2. Feed pengetahuan ke agent (CRUD lessons, strategy, config) lewat UI, bukan CLI/chat.
3. Eksekusi aksi trading manual dengan konfirmasi + safety check.
4. Zero perubahan perilaku pada daemon saat dashboard mati (default OFF).
5. Isolasi penuh: dashboard crash tidak mematikan bot.

### 2.2 Non-Tujuan (v1)
- Bukan pengganti Telegram/CLI — pelengkap.
- Bukan multi-user / multi-tenant. Single operator, localhost.
- Tidak menyimpan database baru. Tetap file JSON sebagai source of truth.
- Tidak mengubah aturan deterministic close, tool schema, atau intent routing.
- Tidak expose ke internet publik (localhost-only). Remote akses = tanggung jawab operator (VPN/SSH tunnel).

---

## 3. Pengguna

| Persona | Kebutuhan |
|---|---|
| **Operator (kamu)** | Lihat sekilas status, ajarin agent, override aksi saat perlu, audit "kenapa" agent ambil keputusan. |

Single-user. Tidak ada role/permission internal.

---

## 4. Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│  PROSES 1: Daemon (index.js) — TIDAK DIUBAH logikanya        │
│  cron • REPL • Telegram • PnL poller • executeTool           │
│                                                              │
│   └─(1 blok boot, env-gated)─► dashboard/bridge (node:http)  │
│        • bind 127.0.0.1 only                                 │
│        • bearer token auth                                   │
│        • GET  /state/*   → baca state in-memory + JSON       │
│        • POST /tool      → executeTool(name,args) + allowlist │
│        • GET  /events    → SSE live PnL (v3)                  │
└───────────────────────────────▲──────────────────────────────┘
                                 │ HTTP localhost (token)
┌───────────────────────────────┴──────────────────────────────┐
│  PROSES 2: dashboard/web (Next.js) — bisa restart/crash bebas │
│  • Server (API routes) proxy ke bridge (token disembunyikan)  │
│  • Baca JSON statis langsung via fs (lessons, decisions, dll) │
│  • UI: React + Tailwind + shadcn/ui + TanStack Query          │
└───────────────────────────────────────────────────────────────┘
```

### 4.1 Kenapa 2 proses
- **Isolasi keselamatan**: bug/crash di UI tidak menyentuh event loop trading.
- **Deploy independen**: rebuild UI tanpa restart bot.
- Trade-off: butuh bridge tipis. Diterima.

### 4.2 Kenapa bridge pakai `node:http` (bukan Express/Fastify)
Bridge di-import oleh `index.js`, jadi depend-nya masuk `package.json` root. Untuk **tidak menambah dependency root sama sekali**, bridge memakai modul bawaan `node:http`. Web app (proses terpisah) bebas pakai framework berat karena punya `package.json` sendiri.

### 4.3 Pembagian baca vs tulis

| Jenis data | Sumber | Jalur |
|---|---|---|
| Statis (lessons, decisions, pool-memory, config, blocklist, strategy) | file JSON root | Next server-side `fs` (read-only) |
| Live (positions PnL, active bin, wallet balance) | in-memory cache + RPC | **bridge** `/state/*` |
| Semua aksi (deploy/close/claim/swap/feed/config) | `executeTool` | **bridge** `POST /tool` |

Alasan: data live & aksi harus lewat proses daemon supaya tidak ada dua proses menulis on-chain (race). Data statis boleh dibaca langsung untuk mengurangi beban bridge.

---

## 5. Tech Stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Bridge (in-daemon) | `node:http` (zero dep) | tidak menambah dependency root |
| Web framework | **Next.js 15 (App Router) + TypeScript** | API routes buat proxy + struktur folder rapi |
| Styling | Tailwind CSS + shadcn/ui | komponen cepat, konsisten, dark mode |
| Data fetching | TanStack Query | caching, polling, refetch interval untuk live data |
| Charts | Recharts | PnL trend, signal weights, pool-memory snapshots |
| State ringan | Zustand (opsional) | UI state (filter, modal) |
| Auth UI→bridge | Bearer token via Next API route (token di server, tak bocor ke browser) | keamanan |

---

## 6. Struktur Folder

```
dashboard/
├── PRD.md                      # dokumen ini
├── README.md                   # cara run
├── bridge/                     # TIER 1 — in-daemon, zero-dep
│   ├── server.js               # http.createServer, bind 127.0.0.1
│   ├── auth.js                 # cek bearer token
│   ├── routes.js               # /state/*, /tool, /health, /events
│   └── allowlist.js            # tool mana yang boleh dari dashboard
└── web/                        # TIER 2 — Next.js, package.json sendiri
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.ts
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                    # Overview
    │   ├── positions/page.tsx
    │   ├── screen/page.tsx
    │   ├── feed/page.tsx               # ⭐ feed ilmu
    │   ├── wallet/page.tsx             # ⭐ wallet scanner
    │   ├── decisions/page.tsx
    │   ├── learning/page.tsx
    │   ├── config/page.tsx
    │   ├── logs/page.tsx
    │   └── api/                        # proxy ke bridge (server-side)
    │       ├── tool/route.ts
    │       └── state/[...path]/route.ts
    ├── lib/
    │   ├── bridge.ts                   # client ke bridge (token dari env server)
    │   ├── files.ts                    # pembaca JSON root langsung (read-only)
    │   └── types.ts
    └── components/
        ├── PositionCard.tsx
        ├── LessonEditor.tsx
        ├── ConfigForm.tsx
        └── DecisionTimeline.tsx
```

Integrasi ke daemon (satu-satunya sentuhan `index.js`, env-gated):

```js
// index.js — dekat startup, setelah executeTool tersedia
if (process.env.DASHBOARD_ENABLED === "true") {
  const { startBridge } = await import("./dashboard/bridge/server.js");
  startBridge({
    port: Number(process.env.DASHBOARD_PORT ?? 8787),
    token: process.env.DASHBOARD_TOKEN,   // wajib, kalau kosong bridge tak start
  });
}
```

Default `DASHBOARD_ENABLED` tidak diset → perilaku daemon 100% sama seperti sekarang.

---

## 7. Sumber Data (peta panel → file/tool)

| Panel | Baca dari | Tulis lewat tool |
|---|---|---|
| Overview | `state.json`, bridge `/state/positions` | — |
| Positions | bridge `/state/positions`, `state.json` | `close_position`, `claim_fees`, `set_position_note`, `swap_token` |
| Screening | bridge `get_top_candidates` | `deploy_position` |
| Feed/Teach | `lessons.json`, `strategy-library.json` | `add_lesson`, `pin_lesson`, `unpin_lesson`, `clear_lessons`, `add_strategy`, `set_active_strategy` |
| Wallet scanner | Helius balance (bridge), `smart-wallets.json` | `get_wallet_positions`, `check_smart_wallets_on_pool`, add/remove wallet |
| Decisions | `decision-log.json` | — |
| Learning | `signal-weights.json`, `lessons.json` (performance) | `evolve` (opsional) |
| Config | `user-config.json` | `update_config` |
| Blocklist | `token-blacklist.json`, `dev-blocklist.json` | `add_to_blacklist`, remove |
| Logs/Audit | `logs/actions-*.jsonl` | — |

---

## 8. Kontrak API (Bridge)

Base: `http://127.0.0.1:8787`. Semua request wajib header `Authorization: Bearer <DASHBOARD_TOKEN>`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/health` | `{ ok: true, uptime, daemon: "running" }` |
| GET | `/state/positions` | posisi live + PnL (dari cache daemon, `force` optional) |
| GET | `/state/summary` | ringkasan portfolio + win-rate |
| GET | `/state/file/:name` | isi 1 file JSON whitelisted (lessons, decision-log, dll) |
| POST | `/tool` | body `{ name, args, confirm }` → `executeTool` |
| GET | `/events` | SSE stream PnL tick (v3) |

`POST /tool` alur:
1. cek token,
2. cek `name` ada di `allowlist.js`,
3. kalau tool mutating (deploy/close/swap/claim) → wajib `confirm: true`,
4. panggil `executeTool(name, args)`,
5. **panggil `logAction(...)` eksplisit** (karena bridge melewati loop `agent.js` yang biasanya menulis audit),
6. balikan hasil apa adanya.

Allowlist default (v1):
- Read: `get_my_positions`, `get_position_pnl`, `get_wallet_balance`, `get_wallet_positions`, `get_top_candidates`, `get_pool_memory`, `get_recent_decisions`, `get_performance_history`, `list_lessons`, `check_smart_wallets_on_pool`.
- Write (perlu `confirm`): `close_position`, `claim_fees`, `swap_token`, `deploy_position`, `set_position_note`, `add_lesson`, `pin_lesson`, `unpin_lesson`, `clear_lessons`, `add_strategy`, `set_active_strategy`, `update_config`, `add_to_blacklist`.

---

## 9. Modul / Fitur (detail + acceptance)

### 9.1 Overview (MVP)
- **User story**: sebagai operator, saat buka dashboard aku langsung lihat kesehatan agent.
- **Isi**: total open positions, net PnL live, win-rate all-time, saldo SOL, status daemon (up/down), 3 kartu posisi teratas, feed keputusan terbaru.
- **Acceptance**: PnL refresh tiap ≤15s; kalau daemon mati → banner "Daemon offline (read-only)".

### 9.2 Positions (MVP)
- Tabel/kartu semua posisi: pool, strategy, range, PnL%, fee earned, umur, status OOR.
- Aksi per posisi: **Close**, **Claim**, **Set note** (instruction), **Swap base→SOL**.
- Setiap aksi tulis → modal konfirmasi (nominal, dampak) sebelum `POST /tool` dengan `confirm:true`.
- **Acceptance**: close/claim tercermin di state ≤1 cycle; tombol ter-debounce (lihat §11 race).

### 9.3 Feed / Teach ⭐ (MVP)
- **Lessons**: list (filter role/tag/pinned), tambah lesson (rule + tags + role + pinned), pin/unpin, hapus (all / by keyword).
- **Strategy**: lihat strategy library, tambah strategy (form terstruktur), set active.
- **Acceptance**: lesson baru muncul di prompt agent pada cycle berikutnya (tanpa restart); pinned tetap ada meski cap 3-tier.
- Catatan: edit teks lesson per-ID **belum ada** di core (CRUD "U" = pin saja). v1 pakai delete+add. Tandai sebagai backlog "add `editLesson`".

### 9.4 Wallet Scanner ⭐ (v2)
- Saldo wallet sendiri (SOL + token, USD) via Helius.
- Posisi DLMM wallet (`get_wallet_positions`).
- **Smart-wallet watchlist**: list, add, remove (name/address/type lp|holder).
- Cek smart-wallet di pool tertentu (`check_smart_wallets_on_pool`) → sinyal confidence.
- **Acceptance**: input address valid → tampil holdings/positions; add wallet persist ke `smart-wallets.json`.

### 9.5 Screening (v2)
- Jalankan `get_top_candidates` on-demand, tampil kandidat + skor + alasan reject.
- Deploy manual dari kandidat terpilih (form: amount SOL, strategy, bins).
- **Acceptance**: deploy lewat safety check (`runSafetyChecks`) sama seperti LLM; gagal → tampil alasan.

### 9.6 Decision Timeline (v2)
- Baca `decision-log.json` (max 100): deploy/close/skip/no_deploy dengan actor, reason, risks, rejected.
- Filter per tipe/actor/pool. Jawab "kenapa agent begini".
- **Acceptance**: entri terbaru muncul ≤1 cycle setelah aksi.

### 9.7 Learning / Darwin (v3)
- Visual `signal-weights.json` (bar bobot per sinyal, history recalc).
- Performance history (PnL per close, win-rate trend).
- Pool-memory snapshots (trend 48-titik per pool).
- Tombol `evolve` manual (opsional).

### 9.8 Config (MVP-lite / v2)
- Form seluruh key `user-config.json` (grouped: risk, screening, management, strategy, schedule, llm).
- Simpan lewat `update_config` (bukan tulis file mentah) → dapat coercion + clamp + restart cron kalau interval berubah.
- **Acceptance**: perubahan `managementIntervalMin`/`screeningIntervalMin` me-restart cron; key tak dikenal → tampil `unknown[]`.

### 9.9 Logs / Audit (v3)
- Tail `logs/actions-*.jsonl`, filter per tool, sukses/gagal, durasi.

---

## 10. Keamanan

1. **Bind 127.0.0.1 saja** — bridge tidak listen di `0.0.0.0`.
2. **Bearer token wajib** (`DASHBOARD_TOKEN`). Bridge tak start kalau token kosong. Token disimpan di server Next (env), **tidak pernah dikirim ke browser** — browser bicara ke Next API route, Next yang pegang token.
3. **Tool allowlist** — hanya tool yang di-allowlist boleh dipanggil.
4. **Confirm gate** untuk semua tool mutating (deploy/close/swap/claim/update_config).
5. **Tidak ada endpoint yang membaca `.env`** atau mengembalikan private key. File whitelist eksplisit di `/state/file/:name`.
6. **Audit**: setiap `POST /tool` memanggil `logAction` → `logs/actions-*.jsonl`.
7. Remote akses lewat SSH tunnel / VPN; jangan port-forward ke publik.

---

## 11. Risiko & Mitigasi (repo-spesifik)

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Race write** — tak ada DB/lock, file di-load+save tiap call | dashboard + daemon menulis JSON barengan → clobber | semua tulis lewat `executeTool`, **jangan** `fs.writeFile` mentah dari web |
| **Bypass `ONCE_PER_SESSION`** — lock ada di `agent.js`, bukan `executor.js` | tombol deploy/close dipencet 2x → dobel eksekusi | bridge debounce + confirm modal + idempotency key per aksi; disable tombol saat in-flight |
| **Blocking event loop** — bridge in-process | request berat menghambat cron trading | handler bridge ringan; kerja berat tetap async; tak ada loop sinkron |
| **Private key di proses** | permukaan serang | localhost-only + token + tak ada endpoint env |
| **Data live saat daemon mati** | UI tampil basi | web fallback baca JSON + banner "offline"; aksi disable |
| **Drift key config** | `update_config` skip key tak dikenal | form config generate dari daftar `CONFIG_MAP` yang sama |

---

## 12. Milestone

| Fase | Isi | Definisi selesai |
|---|---|---|
| **M0 — Bridge** | `node:http` bridge + auth + `/health` + `/state/positions` + boot hook env-gated | curl token bisa baca posisi; daemon default tak berubah |
| **M1 — Read UI** | Next.js scaffold + Overview + Positions (read) + Decisions + Feed (list) | bisa lihat semua, belum ada aksi |
| **M2 — Write** | Positions actions (close/claim/note) + Feed CRUD + Config form | aksi jalan lewat `executeTool` + confirm + audit |
| **M3 — Scan & Deploy** | Wallet scanner + Screening + deploy manual | deploy/scan dari UI |
| **M4 — Insight** | Learning/Darwin viz + Audit log + SSE live | chart + live tick |

MVP = M0–M2. Ini ~80% nilai (monitor + feed + kelola posisi).

---

## 13. Pertanyaan Terbuka

1. Perlu `editLesson`/`removeLessonById` granular? (butuh nambah fungsi di `lessons.js` — sentuh core kecil). Default: skip di MVP.
2. SSE live vs polling TanStack Query? Default polling dulu (lebih simpel), SSE di M4.
3. Web app dijalankan bareng daemon di mesin sama (asumsi ya) atau remote? Default: same host, localhost.
4. Butuh histori PnL time-series persisten? Sekarang tak ada; pool-memory punya snapshot 48-titik. Kalau mau grafik panjang, perlu store baru (backlog).

---

## Lampiran A — Perintah run (rencana)

```bash
# 1. Daemon dengan bridge aktif
DASHBOARD_ENABLED=true DASHBOARD_TOKEN=<rahasia> node index.js

# 2. Web (proses terpisah)
cd dashboard/web
npm install
BRIDGE_URL=http://127.0.0.1:8787 BRIDGE_TOKEN=<rahasia> npm run dev
# buka http://localhost:3000
```
