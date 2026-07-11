# M2 — Write (MVP selesai di sini)

> Semua aksi tulis inti: Positions, Feed CRUD, Config, Blocklist. Lewat
> `ConfirmModal` → `/api/tool` (`confirm:true`) → bridge → `executeTool`.
> Arg-schema: [`reference.md` §9]. CONFIG_MAP: [`reference.md` §5].

## 1. Tujuan & prasyarat

- **Tujuan**: operator bisa close/claim/note/swap posisi, CRUD lessons+strategy, ubah config, kelola blocklist — semua aman (confirm + in-flight lock + safety check daemon).
- **Prasyarat**: [M1](M1-read-ui.md) lulus. `app/api/tool/route.ts` (proxy POST) sudah ada.
- **Invariant**: MUST #12 (confirm), #13 (in-flight → 409). Design §11.6 (ConfirmModal). PRD §9.2 (aturan mutasi).

## 2. Tugas per file

### Infrastruktur mutasi
- [ ] `components/ConfirmModal.tsx` — generik untuk **semua** WRITE. Props: `title`, ringkasan args (label→value), `impactText`, slot opsi khusus (mis. checkbox `skip_swap`), `extraConfirm` (ketik "DELETE" untuk `clear_lessons`), `variant: "danger"|"primary"`. Saat pending: tombol loading + disabled (tak bisa dobel-submit). Hasil `blocked`→tampilkan `result.reason` di modal; `error`→pesan error; sukses→tutup + toast + invalidate.
- [ ] `lib/mutation.ts` — `useToolMutation()` (TanStack `useMutation`) → `POST /api/tool {name,args,confirm:true}`. `onSuccess`: cek `body.ok`, invalidate query terkait; kalau `!ok` lempar ke UI (bukan crash).
- [ ] `components/ui/toast` (shadcn) — success/error/info (Design §11.10). Error persisten inline, bukan toast.

### Positions (10.2)
- [ ] `app/positions/page.tsx` + `PositionRow` — tombol per posisi: **Close** (danger), **Claim** (secondary), **Note** (ghost), **Swap** (ghost). Semua buka `ConfirmModal`.
  - Close → `close_position {position_address*, reason:"manual from dashboard", skip_swap?}` (checkbox "Jangan auto-swap").
  - Claim → `claim_fees {position_address*}`.
  - Note → `set_position_note {position_address*, instruction*}` (≤280 char; sanitasi di core).
  - Swap → `swap_token {input_mint*, output_mint:"SOL", amount*}`.
- [ ] Pasca-sukses: invalidate `positions`+`summary`. Tampilkan info `auto_swapped`/`sol_received` dari result (jangan tawarkan swap kedua — AC-PO.4).

### Feed CRUD (10.3)
- [ ] `components/LessonEditor.tsx` — form `add_lesson {rule*, tags[], role, pinned}`; list dengan filter (role/tag/pinned); pin/unpin per id (`pin_lesson`/`unpin_lesson {id*}`); hapus via `clear_lessons {mode*("all"|"keyword"), keyword?}` + **extraConfirm "DELETE"**.
- [ ] `components/StrategyEditor.tsx` — list `strategy-library.json`; form `add_strategy {id*, name*, lp_strategy, entry, range, exit, best_for, …}`; `set_active_strategy {id*}`; `remove_strategy {id*}`.
- [ ] Catatan scope: **tidak ada** edit teks lesson per-id (core hanya pin/unpin). v1 = delete+add. (`editLesson` = backlog.)

### Config (10.4)
- [ ] `lib/config-map.ts` — **mirror** `CONFIG_MAP` [`reference.md` §5] dengan komentar `// MIRROR tools/executor.js:345–461`. Struktur: `{ key, group, type, secret? }` per 102 key. Tangani kuirk: `binsBelow`(alias `maxBinsBelow`), `takeProfitFeePct`(target `takeProfitPct`), indikator nested `chartIndicators.*`, key 🔒 secret.
- [ ] `components/ConfigForm.tsx` — form dikelompokkan per group (screening/management/…); baca nilai saat ini dari `/api/files/user-config` (redacted); submit **hanya key yang berubah** via `update_config {changes:{...}, reason:"dashboard"}`.
- [ ] Pasca-submit tampilkan `applied[]` & `unknown[]` dari result (AC-CF.2). Field 🔒 tampil `[redacted]`, read-only, **tak dikirim balik** (AC-CF.3).

### Blocklist (10.10)
- [ ] `app/blocklist/page.tsx` — 2 tab: **Token** (`token-blacklist.json`) + **Dev** (`dev-blocklist.json`).
  - Token: `add_to_blacklist {mint*, symbol, reason*}` / `remove_from_blacklist {mint*}`.
  - Dev: `block_deployer {wallet*, label, reason}` / `unblock_deployer {wallet*}`.

## 3. Code skeleton (pola kunci)

### `lib/mutation.ts`
```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
export function useToolMutation(invalidateKeys: string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { name: string; args: unknown }) => {
      const r = await fetch("/api/tool", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, confirm: true }),
      });
      const body = await r.json();               // {status, body:{ok,result}} atau {ok,result}
      const payload = body.body ?? body;
      if (r.status === 409) throw new Error("Aksi masih berjalan, tunggu sebentar.");
      if (r.status >= 400) throw new Error(payload?.error ?? `HTTP ${r.status}`);
      return payload;                            // {ok, result}
    },
    onSuccess: (payload) => {
      if (!payload.ok) {
        const rz = payload.result ?? {};
        throw new Error(rz.blocked ? rz.reason : (rz.error ?? "Aksi gagal"));  // ditangkap di modal
      }
      invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
}
```

### `ConfirmModal` — alur submit (ringkas)
```tsx
// pending → tombol disabled + spinner (cegah dobel; di atas in-flight lock bridge)
// mutation.mutate({ name, args })
//   sukses (ok) → toast success + close + invalidate
//   ok=false blocked → set modalError = result.reason (tampil di modal, JANGAN tutup)
//   ok=false error   → set modalError = result.error
//   throw 409        → set modalError = "Aksi masih berjalan…"
```

### ConfigForm — submit hanya yang berubah
```ts
const changes: Record<string, unknown> = {};
for (const f of fields) if (!f.secret && dirty[f.key]) changes[f.key] = coerce(f, values[f.key]);
mutation.mutate({ name: "update_config", args: { changes, reason: "dashboard" } });
// tampilkan result.applied / result.unknown setelah sukses
```

## 4. Peta AC

| AC | Dipenuhi oleh |
|---|---|
| AC-PO.1 close/claim tercermin ≤1 interval | invalidate `positions`+`summary` onSuccess |
| AC-PO.2 klik-ganda tak dobel | tombol disabled saat pending + bridge 409 |
| AC-PO.3 close diblokir → `reason` | `ConfirmModal` render `result.reason` |
| AC-PO.4 auto-swap info, tak tawarkan swap kedua | baca `auto_swapped`/`sol_received` dari result |
| AC-FT.1 lesson baru terbawa cycle berikut | `add_lesson` (prompt dibangun ulang tiap cycle — no restart) |
| AC-FT.2 pin/unpin langsung terlihat | `pin_lesson`/`unpin_lesson` + invalidate `lessons` |
| AC-FT.3 `clear_lessons` butuh konfirmasi ekstra | `extraConfirm:"DELETE"` di modal |
| AC-FT.4 `set_active_strategy` ubah ACTIVE | invalidate `strategy-library` |
| AC-CF.1 ubah `managementIntervalMin` → cron restart | `update_config` (efek gratis di core) — cek log daemon |
| AC-CF.2 key tak dikenal → tampil `unknown[]` | render `result.unknown` |
| AC-CF.3 secret `[redacted]`, tak terkirim balik | field 🔒 read-only, di-skip saat build `changes` |
| AC-BL.1 mint diblacklist tak lolos screening | `add_to_blacklist` (hard-filter `getTopCandidates`) |
| AC-LG.1 (cek awal) aksi masuk audit JSONL | `logAction` internal `executeTool` (F1) |

## 5. Gotchas

- **F1/F2**: aksi dashboard otomatis teraudit + notifikasi Telegram + auto-swap. UI **jangan** duplikasi (tak ada swap kedua, tak ada log manual).
- **F3/#13**: klik-ganda ditangkap 2 lapis — UI disable saat pending + bridge 409. Uji: spam tombol Deploy/Close, harus tepat 1 eksekusi.
- **F4**: close/deploy/swap/claim bisa `{ blocked, reason }` (safety check). Tampilkan `reason`, bukan crash/error generik.
- **Config secret**: build `changes` **skip** field 🔒 (`hiveMindApiKey`/`gmgnApiKey`/`publicApiKey`). Kalau operator perlu set secret → di luar dashboard (env/CLI). Redaction sudah di `/api/files/user-config`.
- **`update_config` skip unknown**: selalu render `applied[]`/`unknown[]` (risiko #6 drift key). Mirror CONFIG_MAP dari source, jangan mengarang key.
- **`clear_lessons` mode "all"** menghapus semua lesson non-pinned — WAJIB `extraConfirm`. Jangan sediakan tombol "clear all" tanpa gate.

## 6. Verifikasi (DoD) — **MVP selesai**

Daemon `DRY_RUN=true` (write tools tanpa tx on-chain, tetap lewat executor).

1. **Positions**: Close sebuah posisi (DRY_RUN) → modal tampil pool/PnL/amount → confirm → toast sukses → posisi hilang dari list ≤1 interval. Claim/Note/Swap serupa.
2. **Klik-ganda**: spam tombol Close → tepat 1 request tereksekusi (sisanya 409/disabled).
3. **Blokir**: paksa kondisi safety-fail (mis. address invalid) → modal tampilkan `reason`, tidak crash.
4. **Feed**: tambah lesson → muncul di list + di `lessons.json`. Pin/unpin bekerja. `clear_lessons` minta ketik "DELETE".
5. **Config**: ubah `managementIntervalMin` → sukses; cek log daemon menunjukkan cron restart (AC-CF.1). Kirim key ngawur → `unknown[]` tampil. Field apiKey tampil `[redacted]` & tak terkirim.
6. **Blocklist**: tambah mint → ada di `token-blacklist.json`.
7. **Audit** (AC-LG.1): `logs/actions-YYYY-MM-DD.jsonl` mencatat setiap aksi dashboard (bukti F1). Tidak ada baris `logAction` dobel.
