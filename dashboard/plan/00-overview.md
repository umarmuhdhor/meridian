# Plan Eksekusi — Meridian Control Dashboard

| Field | Nilai |
|---|---|
| Status | Siap dikerjakan |
| Update | 2026-07-03 |
| Sumber | `dashboard/PRD.md` (v2), `dashboard/Design.md` (v1) |
| Verifikasi kode | Terhadap `tools/executor.js`, `tools/definitions.js`, `index.js`, `state.js`, `tools/dlmm.js`, `tools/wallet.js`, `logger.js` per 2026-07-03 |

> Dokumen ini adalah **peta kerja**. Ia memecah PRD milestone M0→M4 menjadi
> tugas file-per-file yang bisa langsung dieksekusi. Ia **tidak menggantikan**
> PRD/Design — ia menautkannya. Saat ragu soal *apa* → PRD. Soal *tampilan* →
> Design. Soal *fakta kode* → [`reference.md`](reference.md).

---

## Cara pakai dokumen ini

1. Baca `00-overview.md` (ini) → pahami urutan, invariant, testing.
2. Baca [`reference.md`](reference.md) → hafalkan letak fakta kode (nama tool, CONFIG_MAP, shape data). Semua dok milestone merujuk ke sini, tidak mengulang.
3. Kerjakan milestone **berurutan**: [M0](M0-bridge.md) → [M1](M1-read-ui.md) → [M2](M2-write.md) → [M3](M3-scan-deploy.md) → [M4](M4-insight.md). Jangan lompat.
4. Setiap dok milestone punya 6 bagian tetap: **Tujuan & prasyarat · Tugas per file · Code skeleton · Peta AC · Gotchas · Verifikasi**. Milestone dinyatakan selesai hanya bila bagian Verifikasi lulus.

**MVP = M0 + M1 + M2.** M3/M4 adalah pelengkap yang bisa dikerjakan setelah MVP dipakai.

---

## Urutan eksekusi & Definition of Done

| Milestone | Scope singkat | DoD (ringkas) |
|---|---|---|
| **M0 — Bridge** | HTTP bridge zero-dep di dalam daemon + 1 blok boot `index.js` | `curl /health` 200 dengan token, 401 tanpa; `POST /tool` tanpa `confirm` → 403; `self_update` → 403; `user-config` ter-redact. Tanpa env → port tidak terbuka. |
| **M1 — Read UI** | Next.js scaffold + halaman read (Overview/Positions/Decisions/Feed) | Semua data tampil di browser; daemon dimatikan → banner offline, halaman statis tetap jalan; token tidak pernah muncul di network tab. |
| **M2 — Write** | ConfirmModal + aksi Positions/Feed/Config/Blocklist | AC modul 10.2/10.3/10.4/10.10 lulus; klik-ganda = 1 eksekusi; audit JSONL mencatat tiap aksi. **MVP selesai.** |
| **M3 — Scan & Deploy** | Wallet Scanner + Screening + deploy manual | Deploy dari UI (`DRY_RUN` lalu nominal kecil) → posisi + decision-log + notifikasi Telegram. |
| **M4 — Insight** | Learning/Darwin charts + Logs viewer + SSE | Chart akurat vs file JSON; SSE tidak menambah RPC call. |

---

## Invariant (dari PRD §5 — pelanggaran = implementasi salah)

### MUST NOT
1. Tambah dependency apa pun ke `package.json` **root**. Bridge = built-in Node saja (`node:http`, `node:crypto`, `node:fs`, `node:path`, `node:url`).
2. Ubah file core selain **satu** blok env-gated di `index.js`. Semua kode lain di `dashboard/`.
3. `fs.writeFile` file state JSON dari web/bridge. Semua mutasi lewat `executeTool`.
4. Bind bridge selain `127.0.0.1`.
5. Jalankan bridge tanpa `DASHBOARD_TOKEN` non-kosong (bridge menolak start).
6. Kirim `DASHBOARD_TOKEN`/`BRIDGE_TOKEN` ke browser. Token hanya di server.
7. Masukkan `self_update` / tool di luar allowlist ke bridge.
8. Import `@meteora-ag/dlmm` (langsung/tak langsung) di bridge.
9. Endpoint yang membaca `.env`/private key, atau kembalikan secret `user-config.json` tanpa redaction.
10. Kerja sinkron berat di handler bridge (event loop ini juga jalankan trading).

### MUST
11. Default OFF: tanpa `DASHBOARD_ENABLED=true`, nol baris kode dashboard tereksekusi.
12. `confirm: true` wajib untuk semua tool WRITE, tanpa itu → 403.
13. In-flight lock per tool mutating di bridge; panggilan kedua saat pending → 409.
14. Bandingkan token dengan `crypto.timingSafeEqual`.
15. `GET /state/file/:name` dibatasi whitelist eksplisit.

---

## Fakta kode kritis (PRD §4.4 — F1–F8)

Ringkasan; detail `file:line` di [`reference.md`](reference.md).

| # | Fakta | Konsekuensi |
|---|---|---|
| F1 | `executeTool` sudah panggil `logAction` internal (sukses + error). | Bridge **jangan** panggil `logAction` untuk hasil tool (dobel audit). Boleh 1 baris `log("dashboard", …)` per request write. |
| F2 | `executeTool` sukses otomatis notifikasi Telegram + auto-swap base→SOL (kecuali `skip_swap`). | Aksi dashboard tetap memicu notifikasi + auto-swap. Jangan bypass, jangan duplikasi di UI. |
| F3 | Lock `ONCE_PER_SESSION`/`NO_RETRY_TOOLS` ada di `agent.js`, **bukan** executor. Jalur bridge melewatinya. | Bridge WAJIB in-flight lock sendiri (§8.6). |
| F4 | `PROTECTED_TOOLS` tetap lewat `runSafetyChecks` di dalam `executeTool`. Blokir = `{ blocked:true, reason }`. | Safety check tidak direplikasi di bridge. UI cukup tampilkan `reason`. |
| F5 | `getMyPositions` cache 5 menit, tapi PnL poller refresh `force:true` tiap ~3 dtk saat ada posisi. | `GET /state/positions` tanpa `force` sudah fresh. `?force=1` = tombol manual, rate-limit. |
| F6 | Deteksi sukses: `ok = result.success !== false && !result.error && !result.blocked`. Tidak pernah throw. | Bridge teruskan `result` apa adanya. |
| F7 | Repo Node ESM (`"type":"module"`); SDK Meteora lazy-load. | Bridge MUST ESM, jangan import SDK. |
| F8 | `.claude/settings.json` melarang `run_in_background: true` di sesi Claude Code repo ini. | Saat verifikasi, operator jalankan daemon/web di terminal terpisah (foreground bergantian). |

---

## Environment variables

| Var | Proses | Wajib | Default | Fungsi |
|---|---|---|---|---|
| `DASHBOARD_ENABLED` | daemon | — | (unset=off) | Gate seluruh fitur; hanya `"true"` yang aktif. |
| `DASHBOARD_PORT` | daemon | — | `8787` | Port bridge (localhost). |
| `DASHBOARD_TOKEN` | daemon | ya (saat enabled) | — | Bearer token; kosong → bridge tidak start. |
| `BRIDGE_URL` | web | — | `http://127.0.0.1:8787` | Alamat bridge untuk proxy Next. |
| `BRIDGE_TOKEN` | web | ya | — | Sama dengan `DASHBOARD_TOKEN`; server-side only. |
| `MERIDIAN_ROOT` | web | — | resolve `../..` dari `dashboard/web` | Path root repo untuk baca JSON via fs. |

`.env.example` root **tidak diubah**. Env baru didokumentasikan di `dashboard/README.md` (dibuat di M1).

---

## Strategi testing

- **Tanpa dana**: jalankan daemon `DRY_RUN=true` → write tool tidak kirim tx on-chain, tapi tetap lewat `executeTool` (audit + notify + safety check jalan).
- **Terminal terpisah** (F8): daemon di terminal 1, `npm run dev` web di terminal 2.
- **Verifikasi per milestone** ada di dok masing-masing; jangan tandai milestone selesai sebelum lulus.

Perintah run lengkap: PRD Lampiran A.

---

## Peta tool → milestone (ringkas)

| Milestone | Tool yang dipakai |
|---|---|
| M0 | (semua, lewat bridge — allowlist) |
| M1 read | `get_my_positions`, `getStateSummary` (via `/state/summary`), file JSON statis |
| M2 | `close_position`, `claim_fees`, `set_position_note`, `swap_token`, `add_lesson`, `pin_lesson`, `unpin_lesson`, `clear_lessons`, `add_strategy`, `remove_strategy`, `set_active_strategy`, `update_config`, `add_to_blacklist`, `remove_from_blacklist`, `block_deployer`, `unblock_deployer` |
| M3 | `get_wallet_balance`, `get_wallet_positions`, `add_smart_wallet`, `remove_smart_wallet`, `check_smart_wallets_on_pool`, `get_top_candidates`, `get_pool_detail`, `deploy_position` |
| M4 | (read: `signal-weights.json`, `lessons.json` performance, `pool-memory.json`, `logs/actions-*.jsonl`) + SSE |

Daftar allowlist lengkap + arg-schema: [`reference.md`](reference.md).
