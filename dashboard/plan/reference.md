# Reference — Fakta Kode Terverifikasi

> Sumber kebenaran untuk semua dok milestone. Diverifikasi langsung terhadap
> source per 2026-07-03. **Fakta kode bisa drift** — bila baris bergeser,
> verifikasi ulang sebelum implementasi. Yang ditandai **RE-VERIFY** wajib
> dibaca ulang dari source saat mengerjakannya.

---

## 1. Tabel `file:line` (terkoreksi)

| Apa | Lokasi | Catatan |
|---|---|---|
| `executeTool(name, args)` | `tools/executor.js:637` | Async; tidak pernah throw ke pemanggil. |
| `logAction` internal (sukses) | `tools/executor.js:669` | Bridge jangan panggil lagi (F1). |
| `logAction` internal (error) | `tools/executor.js:708` | |
| notifySwap / notifyDeploy / notifyClose | `tools/executor.js:679 / 681 / 683` | Otomatis saat sukses (F2). |
| Auto-swap base→SOL pasca-close | `tools/executor.js:690–698` | `swapBaseToSolWithRetry`; skip bila `args.skip_swap`. |
| `WRITE_TOOLS` / `PROTECTED_TOOLS` | `tools/executor.js:587–596` | Lihat §4. |
| `runSafetyChecks` return blokir | internal → dibungkus `{ blocked:true, reason }` di `:657–659` | `runSafetyChecks` sendiri return `{ pass:false, reason }`. |
| Unknown tool | `tools/executor.js:648` | `{ error:"Unknown tool: …" }` |
| Exception tool | `tools/executor.js:717–720` | `{ error, tool }` |
| `CONFIG_MAP` (update_config) | `tools/executor.js:345–461` | **102 key** — §5. **RE-VERIFY.** |
| Boot / startup daemon | `index.js:2019–2032` (blok `else if (isMain)`) | Titik sisip §7. **RE-VERIFY** baris. |
| `startCronJobs()` | `index.js:681` | |
| PnL poller (`force:true`, `~3s`) | `index.js:719–765` (interval `:724`, force `:732`) | `config.pnl.pollIntervalSec ?? 3`. |
| `shutdown()` / `stopCronJobs()` | `index.js:849` / `:147` | Bersihkan cron + interval. |
| `log(category, message)` | `logger.js:19` | |
| `logAction(action)` | `logger.js:61` | |
| `getStateSummary()` | `state.js:323` | Shape §6. |
| `getMyPositions({force,silent,wallet_address})` | `tools/dlmm.js:1140` (cache TTL `:909` = 5 mnt) | Shape §6. |
| `getWalletBalances()` | `tools/wallet.js:59` | Shape §6. |
| Semua nama tool | `tools/definitions.js` | 35 nama allowlist ada, nama persis. §3. |
| `self_update` (hard-deny) | `tools/definitions.js:416` | Jangan pernah expose. |
| Repo ESM / Node | `package.json:4` (`"type":"module"`), `:39–40` (`node >=18`) | Bridge MUST ESM. |

---

## 2. Deteksi hasil `executeTool` (F6)

```
ok = result.success !== false && !result.error && !result.blocked
```

| Kondisi | Bentuk result | UI |
|---|---|---|
| Sukses | payload tool (mungkin `{ success:true, … }`) | toast sukses + invalidate query |
| Diblokir safety check | `{ blocked:true, reason }` | tampilkan `reason` inline (bukan error generik) |
| Tool tak dikenal | `{ error:"Unknown tool: …" }` | error (harusnya tak terjadi — allowlist) |
| Exception runtime | `{ error, tool }` | error inline |

---

## 3. Tool allowlist (nama diverifikasi ada di `tools/definitions.js`)

### `READ_TOOLS` (16 — tanpa `confirm`)

```
get_my_positions          get_position_pnl          get_wallet_balance
get_wallet_positions      get_top_candidates        get_pool_detail
get_active_bin            get_pool_memory           get_recent_decisions
get_performance_history   list_lessons              list_strategies
list_smart_wallets        list_blacklist            list_blocked_deployers
check_smart_wallets_on_pool
```

### `WRITE_TOOLS_DASHBOARD` (19 — wajib `confirm:true` + in-flight lock)

```
deploy_position     close_position       claim_fees          swap_token
set_position_note   add_lesson           pin_lesson          unpin_lesson
clear_lessons       add_strategy         remove_strategy     set_active_strategy
update_config       add_to_blacklist     remove_from_blacklist
add_smart_wallet    remove_smart_wallet  block_deployer      unblock_deployer
```

> Perhatikan (K4): `WRITE_TOOLS_DASHBOARD` (19) ≠ core `WRITE_TOOLS` (4:
> `deploy_position`, `claim_fees`, `close_position`, `swap_token`). Yang 4 itu
> tetap lewat `runSafetyChecks` di `executeTool`; sisanya (lesson/config/blocklist/
> strategy/smart-wallet) tidak — bridge cukup in-flight lock + confirm.

### DENY (hard-coded)

```
self_update  +  apa pun di luar READ_TOOLS ∪ WRITE_TOOLS_DASHBOARD
```

### `FILE_WHITELIST` (10 — untuk `/state/file/:name` dan `web/app/api/files/[name]`)

| `:name` | File root | Redaction |
|---|---|---|
| `lessons` | `lessons.json` | — |
| `decision-log` | `decision-log.json` | — |
| `pool-memory` | `pool-memory.json` | — |
| `signal-weights` | `signal-weights.json` | — |
| `strategy-library` | `strategy-library.json` | — |
| `smart-wallets` | `smart-wallets.json` | — |
| `token-blacklist` | `token-blacklist.json` | — |
| `dev-blocklist` | `dev-blocklist.json` | — |
| `state` | `state.json` | — |
| `user-config` | `user-config.json` | **ya** (§8) |

Nama lain / path traversal (`..`, `/`, `\`) → 400. **Jangan** konkat nama ke path tanpa lookup di map ini.

---

## 4. `WRITE_TOOLS` / `PROTECTED_TOOLS` core (executor.js:587–596)

```js
const WRITE_TOOLS = new Set(["deploy_position","claim_fees","close_position","swap_token"]);
const PROTECTED_TOOLS = new Set([...WRITE_TOOLS, "self_update"]);
```

Konsekuensi: hanya 4 tool + `self_update` yang lewat `runSafetyChecks`. Bridge tidak mereplikasi safety check — cukup teruskan hasil.

---

## 5. `CONFIG_MAP` — 102 flat key (executor.js:345–461)

> **Koreksi**: PRD menyebut "±50 key", capture awal menyebut "83". Hitungan
> sebenarnya dari source = **102**. Form Config (M2) mirror daftar ini.
> **RE-VERIFY** dari `executor.js:345–461` saat membangun form — ini code fact.

**Nilai map = `[section, key]` atau `[section, key, altReadPath]`.** Yang penting untuk form:
- **Write** selalu pakai flat-key (kolom "Key" di bawah) via `update_config { changes: { key: value } }`.
- **Read** nilai saat ini dari `user-config.json`: kebanyakan flat, TAPI beberapa punya read-path berbeda (kolom "Baca dari").

### Kuirk yang WAJIB ditangani form

| Key | Kuirk |
|---|---|
| `binsBelow` | menulis ke `strategy.maxBinsBelow` (alias). Jangan bikin field terpisah yang bentrok dengan `maxBinsBelow`. |
| `takeProfitFeePct` | menulis ke `management.takeProfitPct` — **target sama** dengan `takeProfitPct` (kuirk source). Tampilkan satu field saja atau beri catatan; jangan bingung saat submit keduanya. |
| `chartIndicators*` (9 key indikator) | disimpan nested di `user-config.chartIndicators.*` → read-path beda dari write-key. |
| `pnlSource/pnlRpcUrl/pnlPollIntervalSec/pnlDepositCacheTtlSec` | read-path `pnl.*` juga bisa dari flat `pnlSource` dll. |
| `gmgnFeeSource/gmgnApiKey` | section `gmgn`. |
| Key rahasia | `hiveMindApiKey`, `gmgnApiKey`, `publicApiKey` → cocok regex redaction (§8) → tampil `[redacted]`, read-only, jangan kirim balik. |

### Daftar per grup (untuk layout form)

**screening (27)** — `minFeeActiveTvlRatio · excludeHighSupplyConcentration · minTvl · maxTvl · minVolume · minOrganic · minQuoteOrganic · minHolders · minMcap · maxMcap · minBinStep · maxBinStep · timeframe · category · minTokenFeesSol · useDiscordSignals · discordSignalMode · avoidPvpSymbols · blockPvpSymbols · maxBotHoldersPct · maxTop10Pct · allowedLaunchpads · blockedLaunchpads · minTokenAgeHours · maxTokenAgeHours · minFeePerTvl24h · loneCandidateMinDegen`

**management (28)** — `minClaimAmount · autoSwapAfterClaim · autoSwapRetryAttempts · autoSwapRetryDelayMs · outOfRangeBinsToClose · outOfRangeWaitMinutes · oorCooldownTriggerCount · oorCooldownHours · repeatDeployCooldownEnabled · repeatDeployCooldownTriggerCount · repeatDeployCooldownHours · repeatDeployCooldownScope · repeatDeployCooldownMinFeeEarnedPct · minVolumeToRebalance · stopLossPct · takeProfitPct · takeProfitFeePct · trailingTakeProfit · trailingTriggerPct · trailingDropPct · pnlSanityMaxDiffPct · solMode · minSolToOpen · deployAmountSol · gasReserve · positionSizePct · minAgeBeforeYieldCheck · minVolumeToRebalance`

> (`minVolumeToRebalance` muncul sekali; tabel di atas satu contoh grup — sumber pasti = source.)

**pnl-poller (1)** — `pnlConfirmTicks`

**opportunity + degen (9)** — `opportunityPollEnabled · opportunityPollIntervalSec · opportunityPollLimit · opportunityMinScore · opportunitySmartWalletBonus · degenTargetVolRatio · degenTargetLpCount · degenTargetFeeRatio · degenTargetLiquidity`

**risk (2)** — `maxPositions · maxDeployAmount`

**schedule (3)** — `managementIntervalMin · screeningIntervalMin · healthCheckIntervalMin` *(ubah 2 pertama → cron restart otomatis)*

**llm (6)** — `managementModel · screeningModel · generalModel · temperature · maxTokens · maxSteps`

**strategy (5)** — `strategy · binsBelow · minBinsBelow · maxBinsBelow · defaultBinsBelow` *(clamp `binsBelow* ≥ 35`)*

**hiveMind (4)** — `hiveMindUrl · hiveMindApiKey🔒 · agentId · hiveMindPullMode`

**api (3)** — `publicApiKey🔒 · agentMeridianApiUrl · lpAgentRelayEnabled`

**pnl (4)** — `pnlSource · pnlRpcUrl · pnlPollIntervalSec · pnlDepositCacheTtlSec`

**gmgn (2)** — `gmgnFeeSource · gmgnApiKey🔒`

**indicators (9, nested chartIndicators)** — `chartIndicatorsEnabled · indicatorEntryPreset · indicatorExitPreset · rsiLength · indicatorIntervals · indicatorCandles · rsiOversold · rsiOverbought · requireAllIntervals`

🔒 = redacted/write-only.

> **Cara membangun daftar form dengan benar**: parse langsung `CONFIG_MAP` dari
> `executor.js` (atau salin object literal ke `web/lib/config-map.ts` di M2 +
> tinggalkan komentar "MIRROR executor.js:345–461"). `update_config` melewati
> (skip) key yang tidak dikenal → selalu tampilkan `applied[]` & `unknown[]` dari
> result (AC-CF.2).

---

## 6. Shape data (untuk `web/lib/types.ts`)

### `getMyPositions()` → `positions[]` (dlmm.js, satu elemen)

```ts
{
  position: string; pool: string; pair: string; base_mint: string;
  lower_bin: number|null; upper_bin: number|null; active_bin: number|null;
  in_range: boolean;
  unclaimed_fees_usd: number; total_value_usd: number; total_value_true_usd: number;
  collected_fees_usd: number; collected_fees_true_usd: number;
  pnl_usd: number; pnl_true_usd: number;
  pnl_pct: number; pnl_pct_derived: number; pnl_pct_diff: number; pnl_pct_suspicious: boolean;
  unclaimed_fees_true_usd: number;
  fee_per_tvl_24h: number; age_minutes: number; minutes_out_of_range: number;
  instruction: string|null;
}
```

### `getStateSummary()` (state.js:323)

```ts
{
  open_positions: number; closed_positions: number; total_fees_claimed_usd: number;
  positions: Array<{
    position: string; pool: string; strategy: string; deployed_at: string;
    out_of_range_since: string|null; minutes_out_of_range: number;
    total_fees_claimed_usd: number; initial_fee_tvl_24h: number;
    rebalance_count: number; instruction: string|null;
  }>;
  last_updated: string; recent_events: Array<{ts,action,position,pool_name,reason}>;
}
```

### `getWalletBalances()` (wallet.js:59)

```ts
{
  wallet: string; sol: number; sol_price: number; sol_usd: number; usdc: number;
  tokens: Array<{ mint: string; symbol: string; balance: number; usd: number|null }>;
  total_usd: number; error?: string;
}
```

> `pnl_pct_suspicious` (F: pnlSanityMaxDiffPct) → tandai tick tak terpercaya di UI (badge "check"); jangan sembunyikan, jangan pakai untuk keputusan.

---

## 7. Titik sisip `index.js` (satu-satunya sentuhan core)

Konteks `index.js:2019–2032`:

```js
} else if (isMain) {
  log("startup", "Non-TTY mode — starting cron cycles immediately.");
  startCronJobs();
  maybeRunMissedBriefing().catch(() => { });
  startPolling(telegramHandler);
  // ← sisip blok dashboard di sini (atau lebih aman: sebelum split TTY/non-TTY, dalam if(isMain))
  (async () => { try { await runScreeningCycle({ silent: false }); } catch (e) { log("startup_error", e.message); } })();
}
```

**Keputusan (K2)**: pasang blok env-gated **sekali** di dalam `if (isMain)` **sebelum** percabangan TTY/non-TTY, supaya bridge hidup di mode REPL **dan** daemon. Bridge tidak butuh cron sudah jalan. Bila lebih mudah menaruh di cabang non-TTY saja, itu cukup untuk deployment daemon — tapi REPL tidak akan punya bridge.

Blok (RE-VERIFY baris):
```js
if (process.env.DASHBOARD_ENABLED === "true") {
  import("./dashboard/bridge/server.js")
    .then(({ startBridge }) => startBridge({
      port: Number(process.env.DASHBOARD_PORT ?? 8787),
      token: process.env.DASHBOARD_TOKEN,
    }))
    .catch((e) => log("dashboard_warn", `Bridge failed to start: ${e.message}`));
}
```

SHOULD: panggil handle `{ close() }` di `shutdown()` (`index.js:849`) bila mudah; MAY dilewatkan.

---

## 8. Redaction (MUST — dua tempat: bridge `routes.js` + web `api/files/[name]`)

Regex: `/key|token|secret|mnemonic/i` pada **nama key** (rekursif, dalam-dalam). Cocok → nilai diganti `"[redacted]"`.

Config keys yang kena: `hiveMindApiKey`, `gmgnApiKey`, `publicApiKey` (dan bila ada di file: `jupiter.apiKey`, `api.publicApiKey`, dll.). Terapkan **sebelum** JSON dikirim. Fungsi redaction dipakai identik di kedua jalur (bridge & web) — pertimbangkan satu implementasi kecil disalin ke dua sisi (bridge = JS, web = TS).

---

## 9. Arg-schema tool (dari `tools/definitions.js`, `*` = required)

```
READ
  get_top_candidates        limit
  get_my_positions          (—)
  get_position_pnl          pool_address*, position_address*
  get_wallet_balance        (—)
  get_wallet_positions      wallet_address*
  get_pool_detail           pool_address*
  get_active_bin            pool_address*
  get_pool_memory           pool_address*
  get_recent_decisions      limit
  get_performance_history   hours, limit
  list_lessons              role, pinned, tag, limit
  list_strategies           (—)
  list_smart_wallets        (—)
  list_blacklist            (—)
  list_blocked_deployers    (—)
  check_smart_wallets_on_pool  pool_address*

WRITE
  deploy_position     pool_address*, amount_sol, strategy, bins_below, bins_above,
                      pool_name, base_mint, bin_step, base_fee, volatility,
                      fee_tvl_ratio, organic_score,
                      (amount_x/amount_y/downside_pct/upside_pct/initial_value_usd opsional)
  close_position      position_address*, skip_swap, reason
  claim_fees          position_address*
  swap_token          input_mint*, output_mint*, amount*
  set_position_note   position_address*, instruction*
  add_lesson          rule*, tags, role, pinned
  pin_lesson          id*
  unpin_lesson        id*
  clear_lessons       mode* ("all"|"keyword"), keyword (wajib bila mode=keyword)
  add_strategy        id*, name*, author, lp_strategy, token_criteria, entry,
                      range, exit, best_for, raw
  remove_strategy     id*
  set_active_strategy id*
  update_config       changes*, reason
  add_to_blacklist    mint*, reason*, symbol
  remove_from_blacklist  mint*
  add_smart_wallet    name*, address*, category, type ("lp"|"holder")
  remove_smart_wallet address*
  block_deployer      wallet*, label, reason
  unblock_deployer    wallet*
```

> `output_mint: "SOL"` diterima — `normalizeMint` (`tools/wallet.js`) mengkolaps "SOL"/native/So1-prefixed ke wrapped-SOL.
