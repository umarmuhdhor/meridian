# PRD — Meridian Control Dashboard

| Field | Nilai |
|---|---|
| Versi | **v2** (rewrite dari Draft v1) |
| Status | Siap implementasi |
| Update terakhir | 2026-07-03 |
| Lokasi kode | `dashboard/` — **satu-satunya folder kerja** |
| Sentuhan ke core | 1 blok env-gated di `index.js` (§6.2) — tidak ada perubahan lain |
| Referensi wajib | `CLAUDE.md` (peta repo), `tools/definitions.js` (schema tool), `tools/executor.js` (executeTool) |

> Scope: Web dashboard untuk mengontrol & memonitor Meridian DLMM agent
> **tanpa mengubah logika trading yang sudah ada**.

---

## 0. Cara Membaca Dokumen Ini (untuk agent pelaksana)

1. **Konvensi kata kunci**: **MUST** = wajib, **MUST NOT** = dilarang, **SHOULD** = sangat disarankan, **MAY** = opsional. Pelanggaran MUST/MUST NOT = implementasi salah.
2. **Urutan implementasi** mengikuti milestone di §13 (M0 → M4). Setiap milestone punya checklist tugas + cara verifikasi. Jangan lompat milestone.
3. **Semua nama tool dan skema argumen** di dokumen ini sudah diverifikasi langsung terhadap `tools/definitions.js` dan `tools/executor.js` per 2026-07-03. Skema lengkap ada di Lampiran B.
4. **Fakta kode** ditulis dengan referensi `file:line` (Lampiran C). Kalau kode berubah setelah tanggal di atas, verifikasi ulang baris tersebut sebelum implementasi.
5. **Acceptance criteria** diberi ID (`AC-x.y`) supaya bisa dirujuk saat testing.
6. Batasan keras ada di **§5** — baca §5 sebelum menulis kode apa pun.

---

## 1. Ringkasan

Meridian saat ini dikontrol lewat 3 permukaan: Telegram bot, REPL terminal, dan CLI one-shot. Semua state tersimpan sebagai file JSON di root repo (tidak ada database), dan **semua aksi lewat satu pintu**: `executeTool(name, args)` di `tools/executor.js:637`.

Dashboard ini adalah **lapisan tipis di atas yang sudah ada** — satu web UI untuk:

1. **Monitor** — portfolio, PnL live, keputusan agent, audit log.
2. **Feed ilmu ke agent** — CRUD lessons, strategy, config, blocklist lewat form (bukan hardcode / chat).
3. **Wallet scanning** — balance sendiri, posisi DLMM wallet mana pun, smart-wallet watchlist.
4. **Eksekusi aksi manual** — deploy / close / claim / swap dengan safety check yang sama persis seperti yang dilewati LLM.

Prinsip utama: **additive, bukan rewrite**. Seluruh kode dashboard tinggal di `dashboard/`. Satu-satunya sentuhan ke kode lama adalah satu blok boot ber-gate env di `index.js` (§6.2). Kalau env tidak diset, perilaku daemon 100% identik dengan sekarang.

---

## 2. Tujuan & Non-Tujuan

### 2.1 Tujuan (terukur)

| # | Tujuan | Ukuran keberhasilan |
|---|---|---|
| G1 | Satu tempat melihat seluruh keadaan agent | Overview memuat positions, PnL, win-rate, saldo, status daemon dalam 1 layar |
| G2 | Feed pengetahuan lewat UI | Lesson/strategy/config yang di-submit muncul di prompt agent pada cycle berikutnya, tanpa restart daemon |
| G3 | Aksi trading manual yang aman | Semua aksi write lewat `executeTool` + confirm gate + audit otomatis |
| G4 | Zero dampak saat mati | `DASHBOARD_ENABLED` tidak diset → daemon byte-for-byte berperilaku sama |
| G5 | Isolasi crash | Web app crash/restart tidak mengganggu proses daemon |

### 2.2 Non-Tujuan (v1)

- **Bukan** pengganti Telegram/CLI — pelengkap.
- **Bukan** multi-user/multi-tenant. Single operator, localhost-only.
- **Tidak** menambah database. File JSON tetap source of truth.
- **Tidak** mengubah aturan deterministic close, tool schema, intent routing, atau prompt.
- **Tidak** diekspos ke internet publik. Remote akses = tanggung jawab operator (SSH tunnel/VPN).
- **Tidak** menyimpan histori PnL time-series baru (backlog, §15).

---

## 3. Pengguna

| Persona | Kebutuhan |
|---|---|
| **Operator (single user)** | Lihat sekilas status; ajarkan agent (lessons/strategy/config); override aksi saat perlu; audit "kenapa agent mengambil keputusan itu". |

Tidak ada role/permission internal. Autentikasi = 1 bearer token (§11).

---

## 4. Arsitektur

```
┌──────────────────────────────────────────────────────────────┐
│  PROSES 1: Daemon (index.js) — logika TIDAK DIUBAH           │
│  cron • REPL • Telegram • PnL poller • executeTool           │
│                                                              │
│   └─(1 blok boot, env-gated)─► dashboard/bridge  (node:http) │
│        • bind 127.0.0.1 only, port 8787                      │
│        • bearer token auth (timing-safe)                     │
│        • GET  /health, /state/*  → baca state + file JSON    │
│        • POST /tool              → executeTool + allowlist   │
│        • GET  /events            → SSE live tick (M4)        │
└───────────────────────────────▲──────────────────────────────┘
                                │ HTTP localhost (token)
┌───────────────────────────────┴──────────────────────────────┐
│  PROSES 2: dashboard/web (Next.js) — bebas restart/crash     │
│  • API routes = proxy ke bridge (token disimpan server-side) │
│  • File JSON statis dibaca langsung via fs (read-only)       │
│  • UI: React + Tailwind + shadcn/ui + TanStack Query         │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 Kenapa 2 proses

- **Isolasi keselamatan**: bug/crash/memory leak di UI tidak menyentuh event loop trading.
- **Deploy independen**: rebuild/restart UI tanpa restart bot.
- Trade-off yang diterima: butuh bridge tipis di dalam daemon.

### 4.2 Kenapa bridge pakai `node:http` (bukan Express/Fastify)

Bridge di-import oleh `index.js`, jadi dependency-nya akan masuk `package.json` root. Untuk **tidak menambah satu pun dependency root**, bridge hanya boleh memakai modul bawaan Node (`node:http`, `node:crypto`, `node:fs`, `node:path`, `node:url`). Web app adalah proses terpisah dengan `package.json` sendiri di `dashboard/web/`, jadi bebas pakai framework apa pun.

### 4.3 Pembagian baca vs tulis

| Jenis data | Sumber | Jalur |
|---|---|---|
| Statis (lessons, decisions, pool-memory, config, blocklist, strategy, signal-weights, smart-wallets) | file JSON di root repo | Next server-side `fs` **read-only** (fallback: bridge `/state/file/:name`) |
| Live (positions + PnL, active bin, wallet balance, portfolio summary) | in-memory cache daemon + RPC | bridge `GET /state/*` |
| **Semua aksi tulis** (deploy/close/claim/swap/lesson/config/…) | `executeTool` | bridge `POST /tool` — **tidak ada jalur lain** |

Alasan: data live & semua aksi harus lewat proses daemon supaya tidak pernah ada dua proses yang menulis state/on-chain bersamaan (tidak ada file lock). Data statis boleh dibaca langsung (read-only) untuk mengurangi beban bridge.

### 4.4 Fakta kode terverifikasi (WAJIB dipahami sebelum koding)

| # | Fakta | Konsekuensi untuk dashboard |
|---|---|---|
| F1 | `executeTool(name, args)` (`tools/executor.js:637`) **sudah memanggil `logAction` secara internal** — sukses di `:669`, error di `:708`. | Bridge **MUST NOT** memanggil `logAction` lagi untuk hasil tool (dobel audit). Bridge MAY menulis log level request-nya sendiri via `log()`. |
| F2 | `executeTool` untuk tool sukses **otomatis mengirim notifikasi Telegram** (`notifyDeploy/notifyClose/notifySwap`, `executor.js:678-701`) dan **auto-swap base→SOL setelah close** kecuali `args.skip_swap`. | Aksi dari dashboard tetap memicu notifikasi Telegram + auto-swap. Ini perilaku yang diinginkan — jangan di-bypass, jangan diduplikasi di UI. |
| F3 | Lock `ONCE_PER_SESSION` / `NO_RETRY_TOOLS` hidup di **`agent.js:180-182`** (variabel `firedOnce` per pemanggilan `agentLoop`), **bukan** di executor. | Panggilan via bridge **melewati lock ini**. Bridge MUST punya in-flight guard sendiri per tool mutating (§8.6). |
| F4 | `PROTECTED_TOOLS = {deploy_position, claim_fees, close_position, swap_token, self_update}` (`executor.js:587-596`) tetap melewati `runSafetyChecks` di dalam `executeTool`. Hasil blokir = `{ blocked: true, reason }`. | Safety check TIDAK perlu direplikasi di bridge. UI cukup menampilkan `reason` saat `blocked`. |
| F5 | `getMyPositions({ force, silent, wallet_address })` (`tools/dlmm.js:1140`) punya cache 5 menit, tapi PnL poller daemon me-refresh dengan `force:true` tiap `config.pnl.pollIntervalSec` (default 3 detik) saat ada posisi terbuka (`index.js:724-732`). | Bridge `GET /state/positions` **tanpa `force`** sudah cukup fresh. `?force=1` hanya untuk tombol "Refresh now" manual, di-rate-limit. |
| F6 | Hasil `executeTool` untuk tool tidak dikenal = `{ error: "Unknown tool: …" }`; error runtime = `{ error, tool }`. Tidak pernah throw ke pemanggil. | Bridge cukup meneruskan result apa adanya; deteksi sukses = `result.success !== false && !result.error && !result.blocked`. |
| F7 | Repo adalah **Node 22+ ESM** (`"type": "module"`). `@meteora-ag/dlmm` di-lazy-load di `tools/dlmm.js:33`. | Bridge MUST ESM. Bridge MUST NOT meng-import SDK Meteora — cukup import `executeTool`, invariant lazy-load tetap aman. |
| F8 | `.claude/settings.json` melarang `run_in_background: true` untuk sesi Claude Code di repo ini. | Saat verifikasi milestone, jalankan daemon/web di terminal terpisah oleh operator, atau foreground bergantian. |

---

## 5. Batasan Keras (Invariants)

### MUST NOT

1. **MUST NOT** menambah dependency apa pun ke `package.json` root. Bridge = built-in Node modules saja.
2. **MUST NOT** mengubah file core mana pun **kecuali** satu blok env-gated di `index.js` (§6.2). Semua kode lain di `dashboard/`.
3. **MUST NOT** menulis file JSON state (`state.json`, `lessons.json`, `user-config.json`, dll.) langsung dengan `fs.writeFile` dari web ataupun bridge. Semua mutasi lewat `executeTool`.
4. **MUST NOT** bind bridge selain ke `127.0.0.1`.
5. **MUST NOT** menjalankan bridge tanpa `DASHBOARD_TOKEN` yang non-kosong (bridge menolak start + log warning).
6. **MUST NOT** mengirim `DASHBOARD_TOKEN` ke browser. Token hanya hidup di server Next (env), browser bicara ke Next API route.
7. **MUST NOT** memasukkan `self_update`, `block_deployer` massal, atau tool di luar allowlist §8.8 ke bridge.
8. **MUST NOT** meng-import `@meteora-ag/dlmm` (langsung ataupun tidak) di bridge — hanya `executeTool` + fungsi read yang sudah ada.
9. **MUST NOT** membuat endpoint yang membaca `.env`, private key, atau mengembalikan field secret di `user-config.json` tanpa redaction (§8.5).
10. **MUST NOT** melakukan pekerjaan sinkron berat (parse file besar, loop panjang) di handler bridge — event loop ini juga menjalankan trading.

### MUST

11. **MUST** default OFF: tanpa `DASHBOARD_ENABLED=true`, tidak ada satu baris pun kode dashboard yang tereksekusi.
12. **MUST** mensyaratkan `confirm: true` pada semua tool WRITE (§8.8) — tanpa itu bridge menolak dengan 403.
13. **MUST** menerapkan in-flight lock per tool mutating di bridge (§8.6) — panggilan kedua saat yang pertama masih berjalan ditolak 409.
14. **MUST** membandingkan token dengan `crypto.timingSafeEqual`.
15. **MUST** membatasi `GET /state/file/:name` ke whitelist eksplisit (§8.5).

---

## 6. Struktur Folder & Titik Integrasi

### 6.1 Struktur folder

```
dashboard/
├── PRD.md                      # dokumen ini
├── README.md                   # cara run (dibuat di M1)
├── bridge/                     # TIER 1 — in-daemon, zero-dep, ESM
│   ├── server.js               # http.createServer, bind 127.0.0.1, startBridge()
│   ├── auth.js                 # bearer check (timing-safe)
│   ├── routes.js               # router: /health, /state/*, /tool, /events
│   ├── allowlist.js            # READ_TOOLS / WRITE_TOOLS / FILE_WHITELIST
│   └── inflight.js             # in-flight lock per tool mutating
└── web/                        # TIER 2 — Next.js 15, package.json sendiri
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.ts
    ├── .env.local.example      # BRIDGE_URL, BRIDGE_TOKEN, MERIDIAN_ROOT
    ├── app/
    │   ├── layout.tsx          # shell: sidebar nav + daemon status banner
    │   ├── page.tsx            # Overview          (M1)
    │   ├── positions/page.tsx  #                   (M1 read, M2 aksi)
    │   ├── feed/page.tsx       # ⭐ feed ilmu       (M1 read, M2 CRUD)
    │   ├── decisions/page.tsx  #                   (M1)
    │   ├── config/page.tsx     #                   (M2)
    │   ├── blocklist/page.tsx  #                   (M2)
    │   ├── wallet/page.tsx     # ⭐ wallet scanner  (M3)
    │   ├── screen/page.tsx     #                   (M3)
    │   ├── learning/page.tsx   #                   (M4)
    │   ├── logs/page.tsx       #                   (M4)
    │   └── api/                # proxy server-side (token tidak bocor)
    │       ├── tool/route.ts           # POST → bridge /tool
    │       ├── state/[...path]/route.ts# GET  → bridge /state/*
    │       └── files/[name]/route.ts   # GET  → fs read JSON root (whitelist sama §8.5)
    ├── lib/
    │   ├── bridge.ts           # fetch ke bridge; BRIDGE_URL+BRIDGE_TOKEN dari env server
    │   ├── files.ts            # pembaca JSON root via MERIDIAN_ROOT (read-only)
    │   ├── types.ts            # tipe untuk Position, Lesson, Decision, Config, dll.
    │   └── query.ts            # TanStack Query defaults (interval per jenis data §9.2)
    └── components/
        ├── PositionCard.tsx
        ├── ConfirmModal.tsx    # dipakai SEMUA aksi write
        ├── LessonEditor.tsx
        ├── StrategyEditor.tsx
        ├── ConfigForm.tsx
        ├── DecisionTimeline.tsx
        └── DaemonStatusBanner.tsx
```

### 6.2 Titik integrasi ke daemon (SATU-SATUNYA sentuhan `index.js`)

Ditempatkan sekali di jalur startup utama daemon (di dekat `startCronJobs()` pada startup — sekitar `index.js:2022`; sesuaikan bila baris bergeser):

```js
// index.js — satu-satunya blok dashboard, env-gated
if (process.env.DASHBOARD_ENABLED === "true") {
  const { startBridge } = await import("./dashboard/bridge/server.js");
  startBridge({
    port: Number(process.env.DASHBOARD_PORT ?? 8787),
    token: process.env.DASHBOARD_TOKEN, // kosong → bridge menolak start (log warning, daemon jalan terus)
  }).catch((e) => log("dashboard_warn", `Bridge failed to start: ${e.message}`));
}
```

Sifat blok ini:
- `import()` dinamis → tanpa env, file bridge **tidak pernah di-load**.
- Kegagalan bridge **tidak boleh** menghentikan daemon (catch + log warning).
- `startBridge` mengembalikan handle `{ close() }`; SHOULD dipanggil di jalur `shutdown()` yang sudah ada bila mudah, MAY dilewatkan (proses exit menutup socket).

### 6.3 Environment variables

| Var | Proses | Wajib | Default | Fungsi |
|---|---|---|---|---|
| `DASHBOARD_ENABLED` | daemon | — | (unset = off) | Gate seluruh fitur. Hanya `"true"` yang mengaktifkan. |
| `DASHBOARD_PORT` | daemon | — | `8787` | Port bridge (localhost). |
| `DASHBOARD_TOKEN` | daemon | ya (saat enabled) | — | Bearer token. Kosong → bridge tidak start. |
| `BRIDGE_URL` | web | — | `http://127.0.0.1:8787` | Alamat bridge untuk proxy Next. |
| `BRIDGE_TOKEN` | web | ya | — | Token yang sama dengan `DASHBOARD_TOKEN`. Server-side only. |
| `MERIDIAN_ROOT` | web | — | resolve `../..` dari `dashboard/web` | Path root repo untuk baca JSON via fs. |

---

## 7. Tech Stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Bridge (in-daemon) | `node:http` + `node:crypto` (zero dep, ESM) | Tidak menambah dependency root (§4.2) |
| Web framework | Next.js 15 (App Router) + TypeScript | API routes untuk proxy token + struktur rapi |
| Styling | Tailwind CSS + shadcn/ui | Komponen cepat, konsisten, dark mode |
| Data fetching | TanStack Query | Polling interval per jenis data, cache, retry |
| Charts | Recharts | PnL trend, signal weights, snapshots (M4) |
| UI state ringan | Zustand — MAY, hanya jika perlu | Filter/modal state; hindari kalau useState cukup |

Web app SHOULD pin versi major di `dashboard/web/package.json` saat scaffold (hasil `create-next-app` terbaru diterima).

---

## 8. Kontrak API Bridge

Base URL: `http://127.0.0.1:8787`. Semua request **MUST** membawa header `Authorization: Bearer <DASHBOARD_TOKEN>`. Semua response `Content-Type: application/json` (kecuali SSE).

### 8.1 Status code & bentuk error

| Code | Kapan | Body |
|---|---|---|
| 200 | Sukses (termasuk tool yang mengembalikan `{blocked}`/`{error}` — itu hasil valid dari executor) | payload |
| 400 | Body bukan JSON valid / `name`/`args` hilang / file name tidak valid | `{ "error": "…" }` |
| 401 | Token hilang/salah | `{ "error": "unauthorized" }` |
| 403 | Tool tidak ada di allowlist, atau tool WRITE tanpa `confirm:true` | `{ "error": "…" }` |
| 404 | Route/file tidak dikenal | `{ "error": "not found" }` |
| 409 | Tool mutating yang sama masih in-flight | `{ "error": "in-flight", "tool": "…" }` |
| 500 | Exception tak tertangani di bridge | `{ "error": "…" }` |

### 8.2 `GET /health`

```json
{ "ok": true, "uptime_sec": 12345, "daemon": "running", "bridge_version": "1" }
```

### 8.3 `GET /state/positions[?force=1]`

Meneruskan `getMyPositions({ force })` dari daemon. Tanpa `force` membaca cache (fresh ≤3 detik saat ada posisi — F5). `force=1` SHOULD di-rate-limit di bridge: maksimal 1× per 10 detik, kelebihan dilayani dari cache.

Response = bentuk asli hasil `getMyPositions` (array `positions` dengan `position`, `pool`, `pnl_pct`, `pnl_usd`, fee, range, dll.) — **jangan** di-remap di bridge; mapping dilakukan di `lib/types.ts` web.

### 8.4 `GET /state/summary`

Gabungan ringan: `getStateSummary()` (`state.js:323`) + saldo terakhir yang diketahui. Untuk kartu Overview.

### 8.5 `GET /state/file/:name` — whitelist + redaction

Fallback bila web tidak satu host dengan daemon; jalur utama data statis tetap fs langsung di web (§4.3). Whitelist eksplisit (`allowlist.js`):

| `:name` | File |
|---|---|
| `lessons` | `lessons.json` |
| `decision-log` | `decision-log.json` |
| `pool-memory` | `pool-memory.json` |
| `signal-weights` | `signal-weights.json` |
| `strategy-library` | `strategy-library.json` |
| `smart-wallets` | `smart-wallets.json` |
| `token-blacklist` | `token-blacklist.json` |
| `dev-blocklist` | `dev-blocklist.json` |
| `state` | `state.json` |
| `user-config` | `user-config.json` **dengan redaction** |

**Redaction (MUST)**: sebelum dikirim, semua key yang cocok `/key|token|secret|mnemonic/i` (mis. `jupiter.apiKey`, `hiveMind.apiKey`, `api.publicApiKey`) diganti `"[redacted]"`. Berlaku juga untuk `app/api/files/[name]/route.ts` di web.

### 8.6 `POST /tool`

Request:

```json
{ "name": "close_position", "args": { "position_address": "…", "reason": "manual from dashboard" }, "confirm": true }
```

Alur di bridge (urutan MUST persis):

1. Cek token (401).
2. Cek `name` ∈ allowlist (403).
3. Jika `name` ∈ WRITE_TOOLS_DASHBOARD → wajib `confirm === true` (403).
4. Jika `name` ∈ WRITE_TOOLS_DASHBOARD → ambil in-flight lock per-tool; gagal → 409. Lock dilepas di `finally`.
5. `const result = await executeTool(name, args)` — audit log & notifikasi Telegram otomatis terjadi di dalamnya (F1, F2). **Jangan panggil `logAction` lagi.**
6. Response 200: `{ "ok": <boolean>, "result": <result apa adanya> }` di mana `ok = result.success !== false && !result.error && !result.blocked`.

**In-flight lock (`inflight.js`)**: `Map<string, true>` per nama tool. Tujuannya menambal fakta F3 (lock `ONCE_PER_SESSION` di `agent.js` tidak berlaku untuk bridge). Dikombinasikan dengan disable tombol di UI saat mutation pending (§9.2).

### 8.7 `GET /events` (SSE — M4, jangan bangun sebelum M4)

- `Content-Type: text/event-stream`, heartbeat comment tiap 30 detik.
- Event: `pnl_tick` (payload ringkas positions+pnl), `decision` (entri decision-log baru).
- Sumber data: menumpang hasil PnL poller yang sudah ada — **MUST NOT** menambah poller/RPC call baru.

### 8.8 Tool allowlist (nama diverifikasi terhadap `tools/definitions.js`)

**READ (tanpa `confirm`):**
`get_my_positions`, `get_position_pnl`, `get_wallet_balance`, `get_wallet_positions`, `get_top_candidates`, `get_pool_detail`, `get_active_bin`, `get_pool_memory`, `get_recent_decisions`, `get_performance_history`, `list_lessons`, `list_strategies`, `list_smart_wallets`, `list_blacklist`, `list_blocked_deployers`, `check_smart_wallets_on_pool`

**WRITE (wajib `confirm:true` + in-flight lock):**
`deploy_position`, `close_position`, `claim_fees`, `swap_token`, `set_position_note`, `add_lesson`, `pin_lesson`, `unpin_lesson`, `clear_lessons`, `add_strategy`, `remove_strategy`, `set_active_strategy`, `update_config`, `add_to_blacklist`, `remove_from_blacklist`, `add_smart_wallet`, `remove_smart_wallet`, `block_deployer`, `unblock_deployer`

**DENY (tidak pernah, hard-coded):** `self_update` — dan semua nama di luar dua daftar di atas.

---

## 9. Spesifikasi Web App

### 9.1 Halaman

| Route | Panel | Milestone | Data | Aksi (tool) |
|---|---|---|---|---|
| `/` | Overview | M1 | `/state/summary`, `/state/positions`, `decision-log.json` | — |
| `/positions` | Positions | M1 (read) / M2 (aksi) | `/state/positions`, `state.json` | `close_position`, `claim_fees`, `set_position_note`, `swap_token` |
| `/feed` | Feed / Teach ⭐ | M1 (read) / M2 (CRUD) | `lessons.json`, `strategy-library.json` | `add_lesson`, `pin_lesson`, `unpin_lesson`, `clear_lessons`, `add_strategy`, `remove_strategy`, `set_active_strategy` |
| `/decisions` | Decision Timeline | M1 | `decision-log.json` | — |
| `/config` | Config | M2 | `user-config.json` (redacted) | `update_config` |
| `/blocklist` | Blocklist | M2 | `token-blacklist.json`, `dev-blocklist.json` | `add_to_blacklist`, `remove_from_blacklist`, `block_deployer`, `unblock_deployer` |
| `/wallet` | Wallet Scanner ⭐ | M3 | `get_wallet_balance`, `get_wallet_positions`, `smart-wallets.json` | `add_smart_wallet`, `remove_smart_wallet`, `check_smart_wallets_on_pool` |
| `/screen` | Screening & Deploy | M3 | `get_top_candidates`, `get_pool_detail` | `deploy_position` |
| `/learning` | Learning / Darwin | M4 | `signal-weights.json`, `lessons.json` (performance), `pool-memory.json` | — |
| `/logs` | Logs / Audit | M4 | `logs/actions-*.jsonl` (tail via fs) | — |

### 9.2 Aturan data fetching

| Jenis | Cara | Interval |
|---|---|---|
| Positions & summary (live) | TanStack Query → `/api/state/...` | `refetchInterval: 10_000` (10 dtk) |
| File JSON statis | TanStack Query → `/api/files/:name` | `refetchInterval: 30_000` + refetch on window focus |
| Kandidat screening | manual (tombol "Scan") | on-demand saja — panggilannya berat (recon berantai) |
| Tombol "Refresh now" | `/api/state/positions?force=1` | client-side throttle 10 dtk |

Aturan mutasi (MUST):
1. Semua aksi write lewat `ConfirmModal` yang menampilkan tool, args penting (nominal/alamat), dan dampak.
2. Tombol aksi disabled selama mutation pending (jaga-jaga di atas in-flight lock bridge).
3. Setelah mutation sukses → invalidate query positions/summary/file terkait.
4. Jika `result.blocked === true` → tampilkan `result.reason` (safety check daemon); jika `result.error` → tampilkan error; keduanya bukan crash.

### 9.3 Perilaku saat daemon mati

- `GET /health` gagal ≥2× berturut → `DaemonStatusBanner`: **"Daemon offline — mode read-only"**.
- Halaman statis tetap hidup (fs read). Semua tombol aksi disabled. Query live berhenti retry agresif (backoff).

---

## 10. Modul / Fitur — detail & acceptance

> Setiap AC harus bisa diverifikasi manual. Format ID: `AC-<modul>.<nomor>`.

### 10.1 Overview (M1)

**User story**: sebagai operator, saat membuka dashboard aku langsung melihat kesehatan agent dalam satu layar.

**Isi**: total open positions, net PnL live (USD & %), win-rate all-time (dari `lessons.json` performance), saldo SOL, status daemon (up/down + uptime), 3 kartu posisi teratas, 5 keputusan terbaru.

- [ ] **AC-OV.1** — Data PnL ter-refresh otomatis ≤15 detik tanpa reload halaman.
- [ ] **AC-OV.2** — Daemon dimatikan → banner offline muncul ≤30 detik, halaman tidak crash.
- [ ] **AC-OV.3** — Tanpa posisi terbuka → empty state informatif (bukan error).

### 10.2 Positions (M1 read, M2 aksi)

**Isi**: tabel/kartu semua posisi: pool name, strategy, bin range, PnL% (+peak), fee earned, umur, status in/out-of-range, instruction aktif.

**Aksi per posisi** (semua lewat `ConfirmModal` → `POST /tool` + `confirm:true`):

| Aksi | Tool | Args |
|---|---|---|
| Close | `close_position` | `position_address` (wajib), `reason: "manual from dashboard"`, `skip_swap` opsional (checkbox "jangan auto-swap") |
| Claim | `claim_fees` | `position_address` |
| Set note / instruction | `set_position_note` | `position_address`, `instruction` (≤280 char — sanitasi sisi core sudah ada) |
| Swap base→SOL | `swap_token` | `input_mint`, `output_mint: "SOL"`, `amount` |

- [ ] **AC-PO.1** — Close/claim sukses tercermin di list positions ≤1 interval polling setelah selesai.
- [ ] **AC-PO.2** — Klik ganda tombol aksi tidak menghasilkan eksekusi ganda (tombol disabled + bridge 409).
- [ ] **AC-PO.3** — Close yang diblokir safety check menampilkan `reason` dari daemon, bukan error generik.
- [ ] **AC-PO.4** — Setelah close tanpa `skip_swap`, UI menampilkan info auto-swap dari result (`auto_swapped`/`sol_received`) — tidak menawarkan swap kedua.

### 10.3 Feed / Teach ⭐ (M1 read, M2 CRUD)

**Lessons**: list dengan filter (role / tag / pinned), form tambah (`rule`* + `tags[]` + `role` + `pinned`), pin/unpin per ID, hapus (`clear_lessons` dengan `mode`: `all` | `keyword` + konfirmasi ekstra ketik "DELETE").
**Strategy**: list library, detail, form tambah (`id`*, `name`*, `lp_strategy`, `entry`, `range`, `exit`, `best_for`, …), set active, remove.

- [ ] **AC-FT.1** — Lesson baru tersimpan ke `lessons.json` dan (karena prompt dibangun ulang tiap cycle) terbawa ke prompt agent pada cycle berikutnya tanpa restart.
- [ ] **AC-FT.2** — Pin/unpin langsung terlihat di list; lesson pinned tidak hilang oleh cap 3-tier.
- [ ] **AC-FT.3** — `clear_lessons` tanpa konfirmasi ekstra tidak bisa dieksekusi.
- [ ] **AC-FT.4** — `set_active_strategy` mengubah strategi yang tampil sebagai "ACTIVE" dan tercermin di `strategy-library.json`.

Catatan scope: edit teks lesson per-ID **tidak ada** di core (update = pin/unpin saja). v1 memakai pola delete+add. `editLesson` masuk backlog (§15).

### 10.4 Config (M2)

- Form seluruh key `user-config.json`, dikelompokkan: risk / screening / management / strategy / schedule / llm / darwin / indicators.
- **Sumber daftar key (MUST)**: mirror daftar flat-key `CONFIG_MAP` di `tools/executor.js` (±50 key) — jangan mengarang key sendiri; drift key = risiko #6 (§12).
- Simpan lewat `update_config` dengan `changes: { key: value }` + `reason: "dashboard"` — **bukan** tulis file. Dapat gratis: coercion, clamp `binsBelow ≥ 35`, restart cron bila interval berubah, lesson `[SELF-TUNED]`.

- [ ] **AC-CF.1** — Ubah `managementIntervalMin` → response sukses dan cron daemon restart (cek log daemon).
- [ ] **AC-CF.2** — Key tidak dikenal → UI menampilkan isi `unknown[]` dari result.
- [ ] **AC-CF.3** — Field secret (`apiKey` dll.) tampil `[redacted]` dan tidak pernah terkirim balik lewat form.

### 10.5 Decision Timeline (M1)

- Baca `decision-log.json` (rolling 100): `deploy` / `close` / `skip` / `no_deploy` dengan actor, summary, reason, risks[], metrics{}, rejected[].
- Filter per tipe / actor / pool; expand untuk detail lengkap. Menjawab "kenapa agent melakukan X".

- [ ] **AC-DT.1** — Entri baru muncul ≤1 interval polling setelah aksi agent.
- [ ] **AC-DT.2** — Entri `no_deploy` menampilkan daftar `rejected[]` per kandidat beserta alasannya.

### 10.6 Wallet Scanner ⭐ (M3)

- Saldo wallet sendiri: SOL + token + nilai USD (`get_wallet_balance`).
- Scan wallet mana pun: input address → `get_wallet_positions` (posisi DLMM wallet itu).
- **Smart-wallet watchlist**: list / add (`name`*, `address`*, `category`, `type: "lp"|"holder"`) / remove — persist ke `smart-wallets.json`.
- Cek smart wallets pada pool tertentu: `check_smart_wallets_on_pool` → sinyal confidence.

- [ ] **AC-WS.1** — Address valid → holdings/positions tampil; address tidak valid → pesan error jelas, bukan crash.
- [ ] **AC-WS.2** — Add/remove wallet tercermin di `smart-wallets.json` dan digunakan screening cycle berikutnya.

### 10.7 Screening & Deploy (M3)

- Tombol "Scan" → `get_top_candidates {limit: 10}` (on-demand, tampilkan spinner — panggilan lambat).
- Tampilkan kandidat: skor, TVL, fee/TVL, organic, holders, alasan reject untuk yang gugur.
- Deploy manual dari kandidat: form pre-filled `pool_address`, `pool_name`, `base_mint`, metrik konteks; input operator: `amount_sol`, `strategy` (spot/curve/bid_ask), `bins_below`.
- Deploy melewati `runSafetyChecks` daemon apa adanya (F4) — hasil `blocked` ditampilkan dengan `reason`.

- [ ] **AC-SC.1** — Deploy sukses membuat posisi (cek `/positions`) + entri decision-log + notifikasi Telegram (otomatis, F2).
- [ ] **AC-SC.2** — Deploy yang melanggar threshold (mis. TVL turun) ditolak dengan alasan safety check yang terbaca.
- [ ] **AC-SC.3** — Klik ganda "Deploy" tidak menghasilkan 2 posisi (in-flight lock — ini pengganti `NO_RETRY_TOOLS` untuk jalur bridge).

### 10.8 Learning / Darwin (M4)

- Bar chart bobot per sinyal dari `signal-weights.json` + history recalc.
- Performance history: PnL per close, win-rate trend (dari `lessons.json` `performance[]`).
- Pool-memory: trend snapshot 48-titik per pool (pilih pool → chart).

- [ ] **AC-LD.1** — Bobot yang tampil identik dengan isi `signal-weights.json` saat itu.

### 10.9 Logs / Audit (M4)

- Tail `logs/actions-YYYY-MM-DD.jsonl` (fs, server-side; baca N baris terakhir — MUST NOT load seluruh file ke memori): filter per tool / sukses-gagal / durasi.

- [ ] **AC-LG.1** — Aksi yang barusan dilakukan dari dashboard muncul di audit log (bukti F1 bekerja).

### 10.10 Blocklist (M2)

- Dua tab: token blacklist (`token-blacklist.json`) dan dev blocklist (`dev-blocklist.json`).
- Add/remove token: `add_to_blacklist {mint*, symbol, reason*}` / `remove_from_blacklist {mint*}`.
- Block/unblock deployer: `block_deployer {wallet*, label, reason}` / `unblock_deployer {wallet*}`.

- [ ] **AC-BL.1** — Mint yang ditambahkan tidak lolos `getTopCandidates` pada screening berikutnya.

---

## 11. Keamanan

1. **Bind `127.0.0.1` saja** — bridge tidak pernah listen di `0.0.0.0` (tidak configurable).
2. **Bearer token wajib** — kosong → bridge tidak start. Perbandingan pakai `crypto.timingSafeEqual`. Token hanya di env server (daemon & Next server); tidak pernah menyentuh browser.
3. **Tool allowlist** (§8.8) — deny-by-default; `self_update` hard-deny.
4. **Confirm gate** untuk semua WRITE + in-flight lock (§8.6).
5. **Redaction** field secret pada semua jalur yang menyentuh `user-config.json` (§8.5).
6. **Tidak ada endpoint `.env` / private key** — whitelist file eksplisit; path traversal (`..`, `/`) ditolak 400.
7. **Audit otomatis** — setiap `POST /tool` teraudit lewat `logAction` internal `executeTool` (F1); tambahan: bridge menulis satu baris `log("dashboard", ...)` per request write.
8. Remote akses hanya via SSH tunnel / VPN — di luar tanggung jawab kode ini.

---

## 12. Risiko & Mitigasi (repo-spesifik)

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| 1 | **Race write JSON** — tidak ada DB/lock; file di-load+save per call | Dashboard + daemon menulis bersamaan → clobber | Semua mutasi lewat `executeTool` di **proses daemon yang sama** (§5.3); web/bridge tidak pernah `fs.writeFile` state |
| 2 | **Bypass `ONCE_PER_SESSION`** — lock di `agent.js:180`, jalur bridge tidak lewat `agentLoop` (F3) | Dobel deploy/close karena klik ganda/retry | In-flight lock per tool di bridge (409) + confirm modal + tombol disabled saat pending |
| 3 | **Blocking event loop** — bridge in-process dengan trading | Cron/poller telat | Handler ringan, semua I/O async, tail file dengan batas baris, tidak ada loop sinkron besar |
| 4 | **Private key satu proses dengan HTTP server** | Permukaan serang bertambah | Localhost-only + token timing-safe + tidak ada endpoint env/secret + allowlist |
| 5 | **Data basi saat daemon mati** | Operator mengambil keputusan dari data lama | Banner offline (§9.3) + aksi disabled + timestamp "last updated" di kartu live |
| 6 | **Drift key config** — `update_config` skip key yang tidak dikenal | Perubahan diam-diam tidak terjadi | Form di-generate dari mirror `CONFIG_MAP`; selalu tampilkan `applied[]`/`unknown[]` dari result |
| 7 | **Dobel audit/notifikasi** — salah paham F1/F2 | Log ganda, spam Telegram | MUST NOT panggil `logAction`/notify dari bridge — sudah di dalam `executeTool` |
| 8 | **SSE menambah beban RPC** (M4) | 429 dari RPC | `/events` hanya menumpang data poller yang ada; tidak ada RPC call baru |

---

## 13. Milestone & Checklist Implementasi

> MVP = **M0–M2**. Setiap milestone selesai = semua checkbox tercentang + verifikasi lulus.
> Testing tanpa dana: jalankan daemon dengan `DRY_RUN=true` — write tools tidak mengirim tx on-chain.

### M0 — Bridge (fondasi)

**Scope**: bridge berjalan di dalam daemon, read + tool endpoint, tanpa UI.

- [ ] `dashboard/bridge/allowlist.js` — export `READ_TOOLS`, `WRITE_TOOLS`, `FILE_WHITELIST` (isi persis §8.5 & §8.8)
- [ ] `dashboard/bridge/auth.js` — `isAuthorized(req, token)` timing-safe
- [ ] `dashboard/bridge/inflight.js` — `acquire(name)` / `release(name)`
- [ ] `dashboard/bridge/routes.js` — `/health`, `/state/positions`, `/state/summary`, `/state/file/:name` (+redaction), `POST /tool` (alur §8.6)
- [ ] `dashboard/bridge/server.js` — `startBridge({port, token})`: validasi token non-kosong, `http.createServer`, `listen(port, "127.0.0.1")`, return `{close}`
- [ ] Blok boot env-gated di `index.js` (§6.2) — satu-satunya edit core
- [ ] `.env.example` root **tidak diubah**; dokumentasikan env baru di `dashboard/README.md` (M1)

**Definisi selesai / verifikasi**:

```bash
# tanpa env → daemon start normal, port 8787 TIDAK terbuka
node index.js

# dengan env (terminal terpisah):
DASHBOARD_ENABLED=true DASHBOARD_TOKEN=test123 DRY_RUN=true node index.js
curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/health           # → { ok: true, … }
curl -s http://127.0.0.1:8787/health                                              # → 401
curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/state/positions  # → positions JSON
curl -s -X POST -H "Authorization: Bearer test123" -H "Content-Type: application/json" \
  -d '{"name":"close_position","args":{"position_address":"x"}}' http://127.0.0.1:8787/tool   # → 403 (tanpa confirm)
curl -s -X POST -H "Authorization: Bearer test123" -H "Content-Type: application/json" \
  -d '{"name":"self_update","args":{},"confirm":true}' http://127.0.0.1:8787/tool             # → 403 (deny)
curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/state/file/user-config | grep -i apikey  # → "[redacted]"
```

### M1 — Read UI

**Scope**: Next.js scaffold + semua halaman read-only inti.

- [ ] Scaffold `dashboard/web` (Next 15 + TS + Tailwind + shadcn/ui + TanStack Query)
- [ ] `lib/bridge.ts`, `lib/files.ts` (+`MERIDIAN_ROOT`), `lib/types.ts`, `lib/query.ts`
- [ ] API routes proxy: `api/tool`, `api/state/[...path]`, `api/files/[name]` (whitelist+redaction sama)
- [ ] Layout + sidebar + `DaemonStatusBanner` (§9.3)
- [ ] Halaman: Overview (AC-OV.*), Positions read-only, Decisions (AC-DT.*), Feed read-only
- [ ] `dashboard/README.md` — cara run kedua proses + daftar env

**Definisi selesai**: semua data terlihat di browser; matikan daemon → banner offline, halaman statis tetap jalan; token tidak pernah muncul di response/network tab browser.

### M2 — Write (MVP selesai di sini)

**Scope**: semua aksi tulis inti.

- [ ] `ConfirmModal` generik (tool, args, dampak, konfirmasi ekstra untuk `clear_lessons`)
- [ ] Positions actions: close / claim / note / swap (AC-PO.1–4)
- [ ] Feed CRUD: lessons + strategy (AC-FT.1–4)
- [ ] Config form dari mirror `CONFIG_MAP` (AC-CF.1–3)
- [ ] Blocklist page (AC-BL.1)
- [ ] Invalidate query pasca-mutasi; tombol disabled saat pending

**Definisi selesai**: seluruh AC modul 10.2, 10.3, 10.4, 10.10 lulus; uji klik-ganda menghasilkan tepat 1 eksekusi; audit JSONL mencatat setiap aksi (AC-LG.1 dicek manual lebih awal).

### M3 — Scan & Deploy

- [ ] Wallet Scanner (AC-WS.1–2)
- [ ] Screening page + deploy manual (AC-SC.1–3)

**Definisi selesai**: deploy dari UI (DRY_RUN dulu, lalu nominal kecil) menghasilkan posisi + decision-log + notifikasi Telegram.

### M4 — Insight

- [ ] Learning/Darwin charts (AC-LD.1)
- [ ] Logs/Audit viewer (AC-LG.1)
- [ ] SSE `/events` di bridge + hook `useLiveEvents` di web (menggantikan polling positions bila aktif)

**Definisi selesai**: chart akurat vs file JSON; SSE tidak menambah RPC call (cek log daemon).

---

## 14. Keputusan Desain (dulu "pertanyaan terbuka" — sudah diputuskan)

| # | Pertanyaan | Keputusan | Alasan |
|---|---|---|---|
| 1 | `editLesson` per-ID? | **Tidak di v1.** Pola delete+add; `editLesson` di backlog | Butuh sentuhan `lessons.js` (core); MVP tidak tergantung itu |
| 2 | SSE vs polling? | **Polling dulu (M1–M3), SSE di M4** | Polling 10 dtk cukup karena cache daemon fresh ≤3 dtk (F5); SSE = optimasi |
| 3 | Web + daemon satu mesin? | **Ya, asumsi tetap.** Fallback `/state/file/*` tersedia bila terpisah | Localhost-only by design |
| 4 | Histori PnL time-series panjang? | **Tidak di v1** — backlog | Butuh store baru; pool-memory sudah punya snapshot 48-titik untuk trend pendek |

---

## 15. Backlog (di luar scope v1)

- `editLesson` / `removeLessonById` granular (sentuh `lessons.js`).
- Store PnL time-series persisten + chart panjang.
- Tombol trigger manual screening/management cycle dari UI (butuh expose fungsi cycle lewat bridge — evaluasi risiko race dengan `_busy` flags dulu).
- Push notification browser saat exit rule terpicu.
- Mode mobile / PWA.

---

## Lampiran A — Perintah run

```bash
# 1. Daemon dengan bridge aktif (terminal 1)
DASHBOARD_ENABLED=true DASHBOARD_PORT=8787 DASHBOARD_TOKEN=<rahasia> node index.js

# 2. Web (terminal 2)
cd dashboard/web
npm install
cp .env.local.example .env.local   # isi BRIDGE_TOKEN=<rahasia yang sama>
npm run dev
# buka http://localhost:3000
```

Testing aman: tambahkan `DRY_RUN=true` pada daemon — semua write tool berjalan tanpa transaksi on-chain.

---

## Lampiran B — Skema argumen tool (diverifikasi dari `tools/definitions.js`, `*` = required)

```
get_top_candidates        limit:number
get_my_positions          (tanpa args)
get_position_pnl          pool_address:string*, position_address:string*
get_wallet_positions      wallet_address:string*
get_recent_decisions      limit:number
get_performance_history   hours:number, limit:number
get_pool_memory           pool_address:string*
list_lessons              role:string, pinned:boolean, tag:string, limit:number
check_smart_wallets_on_pool  pool_address:string*

deploy_position           pool_address:string*, amount_sol:number, strategy:string,
                          bins_below:number, bins_above:number, pool_name:string,
                          base_mint:string, bin_step:number, base_fee:number,
                          volatility:number, fee_tvl_ratio:number, organic_score:number,
                          (amount_x/amount_y/downside_pct/upside_pct/initial_value_usd opsional)
close_position            position_address:string*, skip_swap:boolean, reason:string
claim_fees                position_address:string*
swap_token                input_mint:string*, output_mint:string*, amount:number*
set_position_note         position_address:string*, instruction:string*
add_lesson                rule:string*, tags:array, role:string, pinned:boolean
pin_lesson                id:number*
unpin_lesson              id:number*
clear_lessons             mode:string* ("all"|"keyword"), keyword:string
add_strategy              id:string*, name:string*, author:string, lp_strategy:string,
                          token_criteria:object, entry:object, range:object, exit:object,
                          best_for:string, raw:string
set_active_strategy       id:string*
update_config             changes:object*, reason:string
add_to_blacklist          mint:string*, symbol:string, reason:string*
remove_from_blacklist     mint:string*
add_smart_wallet          name:string*, address:string*, category:string, type:string ("lp"|"holder")
remove_smart_wallet       address:string*
block_deployer            wallet:string*, label:string, reason:string
unblock_deployer          wallet:string*
```

---

## Lampiran C — Referensi kode terverifikasi (per 2026-07-03)

| Apa | Lokasi |
|---|---|
| `executeTool(name, args)` | `tools/executor.js:637` |
| `logAction` dipanggil di dalam executeTool | `tools/executor.js:669` (sukses), `:708` (error) |
| Notifikasi Telegram + auto-swap pasca-close di executor | `tools/executor.js:678-701` |
| `WRITE_TOOLS` / `PROTECTED_TOOLS` | `tools/executor.js:587-596` |
| `ONCE_PER_SESSION` / `NO_RETRY_TOOLS` (per-agentLoop) | `agent.js:180-182` |
| `getMyPositions({force, silent, wallet_address})` + cache 5 menit | `tools/dlmm.js:1140` |
| PnL poller `force:true` tiap `config.pnl.pollIntervalSec` (default 3 dtk) | `index.js:724-732` |
| `getStateSummary()` | `state.js:323` |
| `getWalletBalances()` | `tools/wallet.js:59` |
| `logAction(action)` | `logger.js:61` |
| `startCronJobs()` / startup utama | `index.js:681` / sekitar `index.js:2022` |
| Lazy-load `@meteora-ag/dlmm` | `tools/dlmm.js:33` |
| Flat-key `CONFIG_MAP` untuk `update_config` | `tools/executor.js` (di dalam toolMap `update_config`) |
