# M3 — Scan & Deploy

> Wallet Scanner + Screening + deploy manual. Panggilan berat (recon berantai)
> → on-demand, bukan auto-poll. Arg-schema: [`reference.md` §9].

## 1. Tujuan & prasyarat

- **Tujuan**: operator bisa cek saldo & posisi wallet mana pun, kelola smart-wallet watchlist, scan kandidat pool, dan deploy manual dengan safety check daemon.
- **Prasyarat**: [M2](M2-write.md) lulus (`ConfirmModal`, `useToolMutation`, in-flight lock terbukti).
- **Invariant**: deploy lewat `runSafetyChecks` daemon apa adanya (F4). In-flight lock = pengganti `NO_RETRY_TOOLS` untuk jalur bridge (F3).

## 2. Tugas per file

### Wallet Scanner (10.6)
- [ ] `app/wallet/page.tsx` — 3 seksi:
  - **Saldo sendiri**: `get_wallet_balance` → SOL + token + USD. (read tool via `POST /api/tool` tanpa confirm, atau endpoint read khusus.)
  - **Scan wallet lain**: input address → `get_wallet_positions {wallet_address*}` → posisi DLMM wallet itu. Address invalid → pesan error jelas (AC-WS.1), bukan crash.
  - **Smart-wallet watchlist**: list `smart-wallets.json`; add `add_smart_wallet {name*, address*, category, type:"lp"|"holder"}`; remove `remove_smart_wallet {address*}`.
- [ ] `components/SmartWalletList.tsx` + form add/remove (pakai `ConfirmModal` untuk add/remove — write).
- [ ] Cek smart wallet pada pool: `check_smart_wallets_on_pool {pool_address*}` → sinyal confidence (dipakai juga di Screening).

### Screening & Deploy (10.7)
- [ ] `app/screen/page.tsx` — tombol **"Scan"** → `get_top_candidates {limit:10}` (on-demand, spinner; panggilan lambat). Tampilkan kandidat: skor, TVL, fee/TVL, organic, holders + alasan reject untuk yang gugur.
- [ ] `components/CandidateCard.tsx` — detail kandidat + tombol **Deploy**.
- [ ] `components/DeployForm.tsx` (dalam `ConfirmModal`, variant danger) — pre-filled dari kandidat: `pool_address`, `pool_name`, `base_mint`, `bin_step`, `base_fee`, `volatility`, `fee_tvl_ratio`, `organic_score`; input operator: `amount_sol`, `strategy` (spot/curve/bid_ask), `bins_below`. Submit `deploy_position {…}`.
- [ ] Hasil `blocked` (threshold turun, dsb.) → tampilkan `reason` (AC-SC.2). In-flight lock cegah 2 posisi dari klik-ganda (AC-SC.3).

## 3. Code skeleton (pola kunci)

### Scan on-demand (bukan auto-poll)
```tsx
"use client";
import { useMutation } from "@tanstack/react-query";
function useScan() {
  return useMutation({
    mutationFn: () => fetch("/api/tool", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "get_top_candidates", args: { limit: 10 } }),  // read → tanpa confirm
    }).then(r => r.json()),
  });
}
// tombol "Scan" → mutate(); tampilkan spinner selama pending (recon berantai lambat).
```

### DeployForm submit
```ts
mutation.mutate({
  name: "deploy_position",
  args: {
    pool_address: c.pool_address, pool_name: c.pool_name, base_mint: c.base_mint,
    bin_step: c.bin_step, base_fee: c.base_fee, volatility: c.volatility,
    fee_tvl_ratio: c.fee_tvl_ratio, organic_score: c.organic_score,
    amount_sol: Number(amountSol), strategy, bins_below: Number(binsBelow),
  },
});
// confirm:true otomatis dari useToolMutation. Hasil blocked → reason di modal.
```

## 4. Peta AC

| AC | Dipenuhi oleh |
|---|---|
| AC-WS.1 address valid→tampil, invalid→error jelas | `get_wallet_positions` + guard error |
| AC-WS.2 add/remove wallet tercermin + dipakai cycle | `add_smart_wallet`/`remove_smart_wallet` → `smart-wallets.json` |
| AC-SC.1 deploy sukses → posisi + decision-log + Telegram | `deploy_position` (decision-log + notify otomatis, F2) |
| AC-SC.2 deploy langgar threshold → ditolak `reason` | `runSafetyChecks` (F4) → `{blocked,reason}` di modal |
| AC-SC.3 klik-ganda Deploy → 1 posisi | in-flight lock bridge (pengganti `NO_RETRY_TOOLS`) + tombol disabled |

## 5. Gotchas

- **F5**: Scan itu MAHAL (recon berantai + throttle 150ms/kandidat di core). **Jangan** taruh di `refetchInterval`. Hanya tombol manual + spinner + hasil di-cache client sampai Scan lagi.
- **F4**: deploy tetap divalidasi ulang (pool detail fresh, TVL/fee-TVL/volatility/bin_step, bin-array rent). UI tak boleh menganggap kandidat lolos = pasti deploy sukses; selalu siap `blocked`.
- **F3**: `NO_RETRY_TOOLS`/`ONCE_PER_SESSION` tidak berlaku di bridge — in-flight lock `deploy_position` adalah satu-satunya pencegah dobel-deploy dari klik cepat. Uji di DRY_RUN.
- `get_wallet_balance`/`get_wallet_positions`/`get_top_candidates`/`check_smart_wallets_on_pool` = READ tool (tanpa confirm). Add/remove smart-wallet = WRITE (confirm + lock).
- Address input divalidasi bentuk (base58, 32-44 char) sebelum kirim; error dari tool ditampilkan, bukan di-swallow.

## 6. Verifikasi (DoD)

Daemon `DRY_RUN=true` dulu, lalu (opsional, hati-hati) nominal kecil live.

1. **Wallet**: saldo sendiri tampil (SOL+token+USD). Scan address wallet lain valid → posisinya tampil; address ngawur → pesan error, tak crash.
2. **Watchlist**: add smart wallet → ada di `smart-wallets.json`; remove menghapusnya. (Efek ke screening dicek di cycle berikutnya.)
3. **Screening**: klik Scan → spinner → daftar kandidat + skor + alasan reject.
4. **Deploy (DRY_RUN)**: pilih kandidat → DeployForm → confirm → hasil (sukses palsu DRY_RUN atau `blocked` dengan reason). Cek entri `decision-log` dibuat.
5. **Klik-ganda Deploy**: spam confirm → tepat 1 `deploy_position` tereksekusi (409 untuk sisanya).
6. **Live kecil** (opsional): matikan DRY_RUN, deploy nominal kecil → posisi muncul di `/positions` + notifikasi Telegram diterima (F2).
