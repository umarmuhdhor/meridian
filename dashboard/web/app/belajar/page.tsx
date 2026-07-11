"use client";

import { BookOpen, CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface Item {
  key: string;
  title: string;
  defaultValue?: string;
  summary: string;
  detail: ReactNode;
}

interface Section {
  key: string;
  title: string;
  intro: string;
  items: Item[];
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[var(--radius-sm)] border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-text-primary">
      {children}
    </code>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-text-secondary">{children}</p>;
}

function H({ children }: { children: ReactNode }) {
  return <p className="mt-3 mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{children}</p>;
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-text-secondary">{children}</ul>;
}

const SECTIONS: Section[] = [
  {
    key: "screening",
    title: "A. Screening Filters — Nyaring Pool",
    intro:
      "Filter keras yang jalan sebelum LLM lihat kandidat. Pool yang gak lolos sini gak akan pernah muncul di depan agent.",
    items: [
      {
        key: "minTvl",
        title: "minTvl / maxTvl",
        defaultValue: "10.000 / 150.000 USD",
        summary: "Range TVL pool. Terlalu kecil = rug risk, terlalu besar = fee/TVL kecil.",
        detail: (
          <>
            <H>Apa itu</H>
            <P>TVL = total nilai USD semua likuiditas di pool tersebut.</P>
            <H>Kenapa penting</H>
            <List>
              <li><b>TVL kecil (&lt; 10k)</b>: pool baru/mati. High risk, tapi kalau ada volume → fee/TVL bisa gila-gilaan (&gt;50%/hari).</li>
              <li><b>TVL besar (&gt; 500k)</b>: pool established, banyak LPer. Volume tinggi tapi fee dibagi banyak orang → yield per LPer kecil.</li>
              <li><b>Sweet spot LP</b>: TVL cukup aman (&gt;10k) tapi masih ada ruang fee kompetitif (&lt;200k).</li>
            </List>
            <H>Cara tuning</H>
            <List>
              <li>Modal kecil (2-5 SOL) → <Kbd>maxTvl</Kbd> rendah (100-200k) supaya deposit signifikan relatif ke pool.</li>
              <li>Rasio ideal: <Kbd>deployAmountSol × SOL_price / activeTvl</Kbd> ≈ 0.5-5%.</li>
              <li>Degen → <Kbd>minTvl: 5000</Kbd>. Safe → <Kbd>minTvl: 50000</Kbd>.</li>
            </List>
          </>
        ),
      },
      {
        key: "minVolume",
        title: "minVolume",
        defaultValue: "500 USD (di window timeframe)",
        summary: "Volume swap total dalam periode. No volume = no fee.",
        detail: (
          <>
            <H>Apa itu</H>
            <P>Total USD swap di pool dalam periode <Kbd>timeframe</Kbd> (default 5 menit).</P>
            <H>Kenapa penting</H>
            <P>Fee = volume × fee_rate. Ini indikator dasar &quot;pool masih hidup&quot;.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>minVolume: 500</Kbd> di window 5m ≈ $6k/jam ≈ $144k/hari.</li>
              <li>Rasio penting: <b>volume/TVL</b>. Volume 500 di TVL 15k → rasio 0.033 (bagus). Volume 500 di TVL 100k → rasio 0.005 (payah).</li>
              <li><Kbd>minFeeActiveTvlRatio</Kbd> lebih powerful — pakai itu sebagai gate utama, <Kbd>minVolume</Kbd> cuma buang pool mati.</li>
            </List>
          </>
        ),
      },
      {
        key: "minFeeActiveTvlRatio",
        title: "minFeeActiveTvlRatio ⭐ KPI utama",
        defaultValue: "0.05",
        summary: "Rasio fee vs active TVL. Estimasi langsung APR harian LP.",
        detail: (
          <>
            <H>Apa itu</H>
            <P><Kbd>fee_earned_in_timeframe / active_tvl</Kbd>. Active TVL = likuiditas di bin aktif (dekat harga), bukan total pool.</P>
            <H>Kenapa ini KPI utama</H>
            <List>
              <li>Estimasi langsung <b>yield APR harian</b> LP.</li>
              <li><Kbd>0.05</Kbd> = 5% dari active TVL diclaim sebagai fee dalam 1 window. Kalau konsisten → APR gila.</li>
              <li>Beda sama volume/TVL biasa karena pakai <b>active</b> TVL — yang beneran generate fee.</li>
            </List>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>0.05</Kbd> (default) = moderate. ~10-20% kandidat lolos.</li>
              <li><Kbd>0.08+</Kbd> = strict, hanya pool &quot;hot&quot; saat itu.</li>
              <li><Kbd>0.15+</Kbd> = degen, cuma pool trending. 1-3 deploy/hari max.</li>
              <li><Kbd>0.02</Kbd> = loose, banyak false positive.</li>
            </List>
            <H>Insight</H>
            <P>Ini rasio paling <b>volatile</b> — pool bisa 0.20 selama 15 menit lalu drop ke 0.01. Timing matters.</P>
          </>
        ),
      },
      {
        key: "organic",
        title: "minOrganic / minQuoteOrganic",
        defaultValue: "60 / 60 (skala 0-100)",
        summary: "Skor kualitas trading organik dari Jupiter. Anti wash-trading.",
        detail: (
          <>
            <H>Apa itu</H>
            <P>Jupiter Datapi menghitung &quot;kualitas organik&quot; trading vs bot/wash-trading. <Kbd>minOrganic</Kbd> untuk token base, <Kbd>minQuoteOrganic</Kbd> untuk token quote (biasanya SOL, hampir selalu tinggi).</P>
            <H>Kenapa penting</H>
            <List>
              <li>Organic tinggi = trader beneran beli/jual → fee sustainable.</li>
              <li>Organic rendah (&lt;40) = kemungkinan besar wash trading. Begitu wash berhenti, pool mati, lo stuck OOR.</li>
            </List>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>60</Kbd> (default) = filter dasar. Buang yang jelas wash.</li>
              <li><Kbd>70-80</Kbd> = strict, cocok safe profile.</li>
              <li><Kbd>40-50</Kbd> = degen. Terima risk wash demi pool baru fee tinggi.</li>
            </List>
          </>
        ),
      },
      {
        key: "minHolders",
        title: "minHolders",
        defaultValue: "500",
        summary: "Jumlah unique holder token base. Proxy untuk distribusi & likuiditas exit.",
        detail: (
          <>
            <H>Apa itu</H>
            <P>Jumlah wallet yang holding token.</P>
            <H>Kenapa penting</H>
            <P>Token dengan 50 holder = kalau 5 whale jual, harga -50% → IL brutal.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>500</Kbd> (default) = threshold minimum yang disaranin untuk pemula.</li>
              <li><Kbd>&lt;200</Kbd> = certified degen. Sering rug/dump risk tinggi.</li>
              <li><Kbd>&gt;2000</Kbd> = established token.</li>
            </List>
          </>
        ),
      },
      {
        key: "mcap",
        title: "minMcap / maxMcap",
        defaultValue: "150.000 / 10.000.000 USD",
        summary: "Batas market cap. Filter rug (kecil) & filter boring (besar).",
        detail: (
          <>
            <H>Apa itu</H>
            <P><Kbd>circulating_supply × price</Kbd>.</P>
            <H>Kenapa penting</H>
            <List>
              <li><b>Mcap kecil (&lt; 300k)</b>: high volatility. LP yield tinggi tapi IL brutal.</li>
              <li><b>Mcap besar (&gt; 10M)</b>: lebih stabil, LP yield turun.</li>
            </List>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>minMcap</Kbd> = filter rug (rug baru sering mcap &lt;100k).</li>
              <li><Kbd>maxMcap</Kbd> = filter &quot;boring&quot;. Token 100M+ mcap harga jarang gerak → fee kecil.</li>
              <li>Default (150k / 10M) = mid-cap zone, sweet spot momentum LP.</li>
            </List>
          </>
        ),
      },
      {
        key: "binStep",
        title: "minBinStep / maxBinStep",
        defaultValue: "80 / 125 (bps)",
        summary: "Lebar tiap bin dalam basis points. Bin step 100 = 1% price range per bin.",
        detail: (
          <>
            <H>Apa itu</H>
            <P>&quot;Lebar&quot; tiap bin dalam basis points. Ini fundamental Meteora yang sering di-skip.</P>
            <H>Kenapa penting</H>
            <List>
              <li><b>Bin step kecil (10-25)</b>: bin sempit. Fee kecil per swap tapi active bin lebih sering hit likuiditas lo. Cocok pool stabil (SOL/USDC).</li>
              <li><b>Bin step besar (100-250)</b>: bin lebar. Fee besar per swap. Cocok pool volatile karena harga tetap sering di dalam bin.</li>
            </List>
            <H>Cara tuning</H>
            <List>
              <li>Default (<Kbd>80-125</Kbd>) = optimize volatile meme pools.</li>
              <li>Safe/stablecoin LP: <Kbd>10-25</Kbd>.</li>
              <li>Ultra-degen: <Kbd>125-250</Kbd>.</li>
            </List>
            <H>Insight</H>
            <P>Meteora <Kbd>fee_rate × bin_step</Kbd> ≈ fee per swap. Pool bin_step 100 dengan base_fee 2% = 2% actual fee tiap swap yang melewati bin lo. Ini yang bikin LP di volatile pool bisa gila-gilaan.</P>
          </>
        ),
      },
      {
        key: "timeframe",
        title: "timeframe",
        defaultValue: "5m",
        summary: "Window agregasi Meteora API: 5m / 1h / 6h / 24h.",
        detail: (
          <>
            <H>Kenapa penting</H>
            <P>Semua threshold (<Kbd>minVolume</Kbd>, <Kbd>minFeeActiveTvlRatio</Kbd>) dihitung dalam window ini.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>5m</Kbd> (default) = capture momentum. Rentan noise tapi react cepat.</li>
              <li><Kbd>1h</Kbd> = balance. Filter noise, tetep react cepat.</li>
              <li><Kbd>24h</Kbd> = yield farming safe. Buang momentum pool.</li>
            </List>
            <P>Bot auto-scale threshold via <Kbd>screening-scales.js</Kbd> saat ganti timeframe, jadi gak perlu manual rescale semua threshold.</P>
          </>
        ),
      },
      {
        key: "minTokenFeesSol",
        title: "minTokenFeesSol",
        defaultValue: "30 SOL",
        summary: "Anti-bundled-scam filter paling powerful. Total priority + Jito tips.",
        detail: (
          <>
            <H>Apa itu</H>
            <P>Total SOL yang dibayar sebagai priority + Jito tips oleh trader token (data dari GMGN).</P>
            <H>Kenapa penting</H>
            <List>
              <li>Token real dengan trader real → bayar priority fees buat masuk cepat.</li>
              <li>Token bundled/scam → cuma dev bot, priority fees kecil.</li>
              <li><Kbd>&gt;30 SOL</Kbd> = ada demand real.</li>
            </List>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>30</Kbd> (default) = tight. Buang mayoritas rug baru.</li>
              <li><Kbd>100+</Kbd> = ultra-safe. Token sudah rame trading.</li>
              <li><Kbd>5-10</Kbd> = ketemu pool sangat baru. Risk rug tinggi.</li>
            </List>
          </>
        ),
      },
      {
        key: "holderConcentration",
        title: "maxBotHoldersPct / maxTop10Pct",
        defaultValue: "30% / 60%",
        summary: "Konsentrasi holder. Proxy risk dump-kill-LP.",
        detail: (
          <>
            <H>Apa itu</H>
            <List>
              <li><Kbd>maxBotHoldersPct</Kbd>: max % holder yang di-flag bot (Jupiter audit).</li>
              <li><Kbd>maxTop10Pct</Kbd>: max % supply dipegang 10 wallet teratas.</li>
            </List>
            <H>Kenapa penting</H>
            <P>Kalau 1 whale pegang 40% supply → dia jual → -50% → active bin lo hilang, IL max.</P>
            <H>Cara tuning</H>
            <List>
              <li>Default (30% / 60%) = balance.</li>
              <li>Safe: <Kbd>20% / 40%</Kbd>.</li>
              <li>Degen: <Kbd>40% / 70%</Kbd>.</li>
            </List>
          </>
        ),
      },
      {
        key: "tokenAge",
        title: "minTokenAgeHours / maxTokenAgeHours",
        defaultValue: "null / null",
        summary: "Filter umur token dari deploy.",
        detail: (
          <>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>minTokenAgeHours: 24</Kbd> = skip token launch &lt;24 jam. Hindari rug pull awal.</li>
              <li><Kbd>maxTokenAgeHours: 72</Kbd> = degen mode, hanya token muda yang lagi trending.</li>
              <li><Kbd>null / null</Kbd> = terima segala umur.</li>
            </List>
          </>
        ),
      },
      {
        key: "launchpads",
        title: "allowedLaunchpads / blockedLaunchpads",
        defaultValue: "[] / []",
        summary: "Filter platform launch (pump.fun, letsbonk.fun, moonshot, dll).",
        detail: (
          <>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>allowedLaunchpads: [&quot;raydium&quot;]</Kbd> = hanya token graduated ke Raydium (established).</li>
              <li><Kbd>blockedLaunchpads: [&quot;pump.fun&quot;]</Kbd> = block semua pump.fun token.</li>
              <li>Keduanya kosong = terima semua.</li>
            </List>
          </>
        ),
      },
      {
        key: "pvp",
        title: "avoidPvpSymbols / blockPvpSymbols",
        defaultValue: "true / false",
        summary: "PVP = 2+ token dengan simbol identik ($WIF asli vs copycat).",
        detail: (
          <>
            <H>Kenapa penting</H>
            <P>Kalau LP di copycat, holder sering keliru trading di token asli → volume ke pool lo drop tiba-tiba.</P>
            <H>Perbedaan</H>
            <List>
              <li><Kbd>avoidPvpSymbols: true</Kbd> = warning ke agent, tapi bisa deploy kalau kandidat lain gak ada.</li>
              <li><Kbd>blockPvpSymbols: true</Kbd> = hard filter, jangan pernah deploy.</li>
            </List>
          </>
        ),
      },
      {
        key: "discord",
        title: "useDiscordSignals / discordSignalMode",
        defaultValue: "false / merge",
        summary: "Pakai sinyal dari Discord listener (Metlex Pool Bot).",
        detail: (
          <>
            <H>Mode</H>
            <List>
              <li><Kbd>useDiscordSignals: false</Kbd> = ignore Discord, cuma pakai Meteora API.</li>
              <li><Kbd>true</Kbd> + <Kbd>mode: &quot;merge&quot;</Kbd> = tambahin sinyal Discord ke kandidat regular.</li>
              <li><Kbd>mode: &quot;only&quot;</Kbd> = HANYA deploy pool yang muncul di Discord signal.</li>
            </List>
            <P>Butuh setup Discord listener terpisah (<Kbd>discord-listener/</Kbd>).</P>
          </>
        ),
      },
    ],
  },
  {
    key: "management",
    title: "B. Position Management — Kapan Close",
    intro:
      "Yang nentuin PnL akhir. Meridian pakai 5 rule deterministik sebelum LLM dilibatkan.",
    items: [
      {
        key: "stopLossPct",
        title: "stopLossPct",
        defaultValue: "-50%",
        summary: "Cut loss keras. PnL % ≤ threshold → close.",
        detail: (
          <>
            <H>Kenapa penting</H>
            <P>IL brutal di DLMM. Tanpa stop loss, satu posisi bisa habisin modal.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>-50%</Kbd> = degen, kasih ruang volatile normal.</li>
              <li><Kbd>-30%</Kbd> = moderate, potong lebih cepat.</li>
              <li><Kbd>-20%</Kbd> = safe, tapi sering premature exit di wick normal.</li>
            </List>
          </>
        ),
      },
      {
        key: "takeProfitPct",
        title: "takeProfitPct",
        defaultValue: "5%",
        summary: "Target profit. PnL % ≥ threshold → close (atau trigger trailing).",
        detail: (
          <>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>5%</Kbd> (default) = quick harvest, sesuai philosophy DLMM (fee constant accrual).</li>
              <li>Kalau <Kbd>trailingTakeProfit</Kbd> enabled, <Kbd>takeProfitPct</Kbd> jadi trigger activate trailing — bukan close langsung.</li>
            </List>
          </>
        ),
      },
      {
        key: "trailing",
        title: "trailingTakeProfit + trailingTriggerPct + trailingDropPct ⭐",
        defaultValue: "true / 3% / 1.5%",
        summary: "Trailing stop untuk lock profit. Ini gem-nya Meridian.",
        detail: (
          <>
            <H>Apa itu</H>
            <List>
              <li><Kbd>trailingTriggerPct: 3</Kbd> = mulai track peak saat PnL sampai +3%.</li>
              <li><Kbd>trailingDropPct: 1.5</Kbd> = close kalau PnL drop 1.5% dari peak.</li>
            </List>
            <H>Kenapa gem</H>
            <P>Fee di DLMM akrual continuous. Kalau posisi naik ke +8% lalu drop ke +6.5%, trailing exit fire → lock 6.5% profit. Tanpa trailing, mungkin drop terus ke +2% baru kepikir close.</P>
            <H>Cara tuning</H>
            <List>
              <li><b>Agresif</b> (<Kbd>trigger: 2</Kbd>, <Kbd>drop: 1</Kbd>) = lock profit cepat, jarang biarin winner run.</li>
              <li><b>Loose</b> (<Kbd>trigger: 5</Kbd>, <Kbd>drop: 3</Kbd>) = biar winner run lebih jauh, terima kadang give back gain.</li>
            </List>
            <H>Mechanics</H>
            <P>PnL poller (tiap 3s) yang deteksi. <Kbd>pnlConfirmTicks: 2</Kbd> = butuh 2 tick konsisten (biar gak fire di wick).</P>
          </>
        ),
      },
      {
        key: "oor",
        title: "outOfRangeWaitMinutes",
        defaultValue: "30 menit",
        summary: "Kalau active bin di luar range lo selama N menit → close.",
        detail: (
          <>
            <H>Kenapa penting</H>
            <P>OOR = fee = 0. Tiap menit OOR = opportunity cost. Tapi harga bisa balik → jangan panic close terlalu cepat.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>30</Kbd> (default) = balance.</li>
              <li><Kbd>15</Kbd> (degen) = potong cepat, redeploy elsewhere.</li>
              <li><Kbd>60+</Kbd> (safe) = kasih ruang mean reversion.</li>
            </List>
          </>
        ),
      },
      {
        key: "lowYield",
        title: "minFeePerTvl24h + minAgeBeforeYieldCheck",
        defaultValue: "7 / 60 menit",
        summary: "Auto-close posisi yang sudah lewat masa nurture tapi yield-nya jelek.",
        detail: (
          <>
            <H>Apa itu</H>
            <List>
              <li><Kbd>minAgeBeforeYieldCheck: 60</Kbd> = 60 menit pertama posisi gak dicek yield (kasih waktu accrual).</li>
              <li><Kbd>minFeePerTvl24h: 7</Kbd> = setelah 60m, kalau projected 24h fee yield &lt;7% → close (low yield).</li>
            </List>
            <H>Kenapa penting</H>
            <P>Fee bagus di menit awal, tapi bisa mati begitu volume drop. Bot deteksi ini dan redeploy modal ke pool baru.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>7</Kbd> (default) = moderate — 7% harian ~ 2500% APR compound. Reasonable target.</li>
              <li><Kbd>12</Kbd> (degen) = ketat, cari yang beneran hot.</li>
              <li><Kbd>3</Kbd> (safe) = terima yield rendah asal in-range.</li>
            </List>
          </>
        ),
      },
      {
        key: "claim",
        title: "minClaimAmount + autoSwapAfterClaim",
        defaultValue: "5 USD / false",
        summary: "Threshold klaim fee & auto-swap base → SOL setelah claim.",
        detail: (
          <>
            <H>minClaimAmount</H>
            <P>Kalau unclaimed fees &lt; threshold, skip klaim (gas &gt; fee).</P>
            <List>
              <li>Deploy kecil (0.5 SOL) → gas per claim ~$0.1, <Kbd>5</Kbd> masih boros. Turunin ke <Kbd>2</Kbd>.</li>
              <li>Deploy besar (&gt;5 SOL) → <Kbd>10</Kbd> OK biar gak spam claim.</li>
            </List>
            <H>autoSwapAfterClaim</H>
            <List>
              <li><Kbd>true</Kbd> = auto lock profit ke SOL. Hilangin exposure token base.</li>
              <li><Kbd>false</Kbd> = hold token base, mungkin lo mau redeploy ke pool lain.</li>
            </List>
            <P>Terpisah dari <b>auto-swap on close</b> — yang ini selalu jalan kalau <Kbd>result.base_mint</Kbd> ada.</P>
          </>
        ),
      },
      {
        key: "cooldown",
        title: "Cooldown system (OOR & repeat-deploy)",
        defaultValue: "3 trigger / 12h",
        summary: "Proteksi anti-nyangkut di pool yang lagi crashing atau tidak profitable.",
        detail: (
          <>
            <H>OOR cooldown</H>
            <List>
              <li><Kbd>oorCooldownTriggerCount: 3</Kbd> + <Kbd>oorCooldownHours: 12</Kbd></li>
              <li>3× close berturut karena OOR di pool sama → cooldown 12 jam di pool + token base.</li>
              <li>Tujuan: hindari re-deploy di pool yang trending downside (misal $BOME lagi crash).</li>
            </List>
            <H>Repeat-deploy cooldown</H>
            <List>
              <li><Kbd>repeatDeployCooldownEnabled: true</Kbd></li>
              <li>Deploy 3x di pool sama tanpa cukup fee earned → cooldown 12 jam.</li>
              <li><Kbd>scope</Kbd>: <b>token</b> (default) / <b>pool</b> / <b>both</b>.</li>
              <li><Kbd>repeatDeployCooldownMinFeeEarnedPct</Kbd> = threshold fee earned untuk skip cooldown (kalau deploy lalu profit).</li>
            </List>
          </>
        ),
      },
    ],
  },
  {
    key: "sizing",
    title: "C. Sizing & Wallet Management",
    intro: "Berapa SOL per deploy, compounding otomatis, dan buffer gas.",
    items: [
      {
        key: "sizingFormula",
        title: "deployAmountSol + positionSizePct + gasReserve",
        defaultValue: "0.5 SOL / 0.35 / 0.2 SOL",
        summary: "Formula compounding: naik otomatis saat wallet growth.",
        detail: (
          <>
            <H>Formula</H>
            <P><Kbd>deploy = clamp((wallet - gasReserve) × positionSizePct, floor=deployAmountSol, ceil=maxDeployAmount)</Kbd></P>
            <H>Contoh (wallet 3 SOL)</H>
            <List>
              <li>deployable = 3 - 0.2 = 2.8 SOL</li>
              <li>dynamic = 2.8 × 0.35 = 0.98 SOL</li>
              <li>Final: 0.98 SOL per deploy (di atas floor 0.5)</li>
            </List>
            <H>Kenapa positionSizePct?</H>
            <P>Compounding otomatis. Kalau wallet growth ke 5 SOL, deploy naik ke 1.68 SOL tanpa edit config.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>positionSizePct: 0.35</Kbd> (default) = konservatif. Buat 3 posisi max = 105% wallet.</li>
              <li><Kbd>0.5</Kbd> = agresif. Untuk <Kbd>maxPositions: 2</Kbd>.</li>
              <li><Kbd>0.25</Kbd> = super konservatif. Untuk <Kbd>maxPositions: 3-4</Kbd>.</li>
            </List>
            <H>Aturan main</H>
            <P><Kbd>positionSizePct × maxPositions ≤ 0.8</Kbd> biar tetap ada buffer gas + slippage.</P>
          </>
        ),
      },
      {
        key: "minSolToOpen",
        title: "minSolToOpen",
        defaultValue: "0.55 SOL",
        summary: "Hard gate: jangan deploy kalau wallet di bawah threshold.",
        detail: (
          <>
            <P>Alasan: 0.5 SOL deploy + 0.05 SOL buffer untuk gas + retry.</P>
          </>
        ),
      },
      {
        key: "maxPositions",
        title: "risk.maxPositions + maxDeployAmount",
        defaultValue: "3 / 50 SOL",
        summary: "Max slot paralel dan plafon absolut per deploy.",
        detail: (
          <>
            <List>
              <li><Kbd>maxPositions: 3</Kbd> — Screener skip kalau sudah penuh.</li>
              <li><Kbd>maxDeployAmount: 50</Kbd> — Plafon absolut per deploy (ceiling formula sizing).</li>
            </List>
          </>
        ),
      },
    ],
  },
  {
    key: "strategy",
    title: "D. Strategy Shape — Bentuk Range Likuiditas",
    intro: "Bagaimana likuiditas lo didistribusi di bin-bin range.",
    items: [
      {
        key: "strategyKind",
        title: "strategy (spot / curve / bid_ask)",
        defaultValue: "bid_ask",
        summary: "Distribusi likuiditas: rata / konsentrasi tengah / konsentrasi ujung.",
        detail: (
          <>
            <List>
              <li><b>spot</b>: rata di semua bin. Range efficiency terbaik. Fee per bin kecil. Cocok pool stabil.</li>
              <li><b>curve</b>: konsentrasi di tengah. Range efficiency medium. Fee per bin lebih tinggi di sekitar active. Cocok pool ranging.</li>
              <li><b>bid_ask</b>: konsentrasi di ujung (U-shape). Range efficiency terburuk kalau salah arah, tapi kalau benar → fee explosion. Cocok breakout/pump play.</li>
            </List>
            <H>Insight</H>
            <P><Kbd>bid_ask</Kbd> sering dipakai buat <b>single-sided reseed</b> — deploy full base token di ujung bawah range, kalau OOR downside redeploy di harga lebih rendah lagi (accumulate cheap).</P>
          </>
        ),
      },
      {
        key: "binsBelow",
        title: "minBinsBelow / maxBinsBelow / defaultBinsBelow",
        defaultValue: "35 / 69 / 69",
        summary: "Jarak bin dari active ke ujung range bawah. Total range ~ binsBelow × 2.",
        detail: (
          <>
            <H>Kenapa 35 minimum?</H>
            <P>Meteora rent untuk init bin array, plus safety supaya close bukan cuma karena wick. <Kbd>MIN_SAFE_BINS_BELOW = 35</Kbd> hard-coded.</P>
            <H>Kenapa 69 maximum?</H>
            <P>Di atas 69 bin, butuh multi-tx path (<Kbd>createExtendedEmptyPosition</Kbd>) — lebih mahal gas.</P>
            <H>Trade-off</H>
            <List>
              <li>Range lebar (69 bin) = OOR jarang, tapi likuiditas terspread → fee per swap kecil.</li>
              <li>Range sempit (35 bin) = fee per swap besar (likuiditas konsen), tapi sering OOR.</li>
            </List>
            <P>Screener auto-pilih di antara <Kbd>min</Kbd> dan <Kbd>max</Kbd> berdasar volatility pool.</P>
          </>
        ),
      },
    ],
  },
  {
    key: "schedule",
    title: "E. Scheduling — Cadence Cron",
    intro: "Seberapa sering bot cek posisi dan cari pool baru.",
    items: [
      {
        key: "cronIntervals",
        title: "managementIntervalMin / screeningIntervalMin / healthCheckIntervalMin",
        defaultValue: "10 / 30 / 60 menit",
        summary: "Cadence cycle utama. Plus PnL poller tiap 3 detik.",
        detail: (
          <>
            <List>
              <li><Kbd>managementIntervalMin: 10</Kbd> — cek posisi tiap 10 menit.</li>
              <li><Kbd>screeningIntervalMin: 30</Kbd> — cari pool baru tiap 30 menit.</li>
              <li><Kbd>healthCheckIntervalMin: 60</Kbd> — health check tiap jam.</li>
              <li><b>Plus:</b> PnL poller tiap 3 detik untuk trailing TP detection.</li>
            </List>
            <H>Cara tuning</H>
            <List>
              <li>Turunin ke <Kbd>5</Kbd> = react cepat, tapi lebih banyak RPC calls.</li>
              <li>Naikin ke <Kbd>15-30</Kbd> = safe, biarin posisi breathe.</li>
              <li><Kbd>screeningIntervalMin: 30</Kbd> = 48 pass per hari, cukup.</li>
            </List>
          </>
        ),
      },
    ],
  },
  {
    key: "opportunity",
    title: "F. Opportunity Poller — Hidden Gem",
    intro: "Poller tiap 45 detik yang nangkap pool tiba-tiba booming di antara screening cycle.",
    items: [
      {
        key: "opportunityMinScore",
        title: "minScore + Degen Score",
        defaultValue: "40 (0-100)",
        summary: "Threshold Degen Score untuk trigger deploy.",
        detail: (
          <>
            <H>Degen Score = 4 sub-score (total 0-100)</H>
            <List>
              <li>Volume sub-score — <Kbd>targetVolRatio: 20</Kbd> (volume/active_tvl untuk full score)</li>
              <li>LP activity sub-score — <Kbd>targetLpCount: 40</Kbd> (unique LPers)</li>
              <li>Fee sub-score — <Kbd>targetFeeRatio: 0.20</Kbd> (fee/active_tvl)</li>
              <li>Liquidity sub-score — <Kbd>targetLiquidity: 20000</Kbd> (active TVL USD)</li>
            </List>
            <P>Semua dinormalisasi ke window 30 menit → timeframe-independent.</P>
            <H>Cara tuning</H>
            <List>
              <li><Kbd>40</Kbd> (default) = kandidat harus &quot;borderline hot&quot; untuk trigger.</li>
              <li><Kbd>50-60</Kbd> = ketat, cuma pool sangat hot.</li>
              <li><Kbd>30</Kbd> = loose, sering fire opportunity.</li>
            </List>
          </>
        ),
      },
      {
        key: "smartWalletBonus",
        title: "smartWalletScoreBonus",
        defaultValue: "20",
        summary: "Diskon minScore kalau ada smart wallet LP di pool.",
        detail: (
          <>
            <P>Kalau smart wallet (dari HiveMind) sedang LP di pool, threshold <Kbd>minScore</Kbd> diturunkan sebesar bonus ini.</P>
            <P>Contoh: <Kbd>minScore=40</Kbd> + smart wallet ada → effective threshold jadi <b>20</b>. &quot;Kalau alpha LP di sini, gua ikut.&quot;</P>
          </>
        ),
      },
    ],
  },
  {
    key: "llm",
    title: "G. LLM Settings",
    intro: "Model & behavior untuk agent role SCREENER, MANAGER, GENERAL.",
    items: [
      {
        key: "llmParams",
        title: "temperature + maxTokens + maxSteps",
        defaultValue: "0.373 / 4096 / 20",
        summary: "Kreativitas rendah + limit ReAct step untuk stabilitas.",
        detail: (
          <>
            <List>
              <li><Kbd>temperature: 0.373</Kbd> — sengaja rendah. LLM harus follow rule prompt, bukan improvise.</li>
              <li><Kbd>maxTokens: 4096</Kbd> — cukup untuk output tool_calls + reasoning.</li>
              <li><Kbd>maxSteps: 20</Kbd> — max ReAct step per cycle. Agent bisa candidates → narrative → wallets → deploy dalam 4 step. 20 = plenty of headroom.</li>
            </List>
          </>
        ),
      },
      {
        key: "roleModels",
        title: "managementModel / screeningModel / generalModel",
        defaultValue: "healer-alpha / hunter-alpha / healer-alpha",
        summary: "Model berbeda per role. Screener butuh reasoning, manager butuh rule-follow.",
        detail: (
          <>
            <P>Bisa pakai model berbeda per role.</P>
            <List>
              <li><b>Screener</b> — butuh reasoning kompleks (<Kbd>hunter-alpha</Kbd>).</li>
              <li><b>Manager</b> — butuh rule-follow strict (<Kbd>healer-alpha</Kbd>).</li>
              <li><b>General</b> — REPL/Telegram chat (<Kbd>healer-alpha</Kbd>).</li>
            </List>
          </>
        ),
      },
    ],
  },
  {
    key: "darwin",
    title: "H. Darwinian Signal Weights — Auto-Learning",
    intro: "Sistem yang auto-belajar signal mana yang paling ngasih PnL untuk gaya market saat ini.",
    items: [
      {
        key: "darwinCore",
        title: "darwin.enabled + recalcEvery + boost/decay",
        defaultValue: "true / 5 closes / 1.05 / 0.95",
        summary: "Bot personalized ke market condition seiring waktu.",
        detail: (
          <>
            <H>How it works</H>
            <List>
              <li>Setiap deploy, snapshot signal values (<Kbd>organic_score: 72</Kbd>, <Kbd>fee_tvl_ratio: 0.08</Kbd>, <Kbd>smart_wallets_count: 3</Kbd>, dll).</li>
              <li>Setiap 5 close (<Kbd>recalcEvery</Kbd>), bot lihat signal mana yang correlate ke winner.</li>
              <li>Signal top quartile winners × <Kbd>boostFactor: 1.05</Kbd>. Bottom quartile × <Kbd>decayFactor: 0.95</Kbd>.</li>
              <li>Weight di-clamp <Kbd>[weightFloor: 0.3, weightCeiling: 2.5]</Kbd>.</li>
            </List>
            <H>Kenapa penting</H>
            <P>Bot lo makin lama makin <b>personalized</b>. Kalau <Kbd>smart_wallets_count</Kbd> mulai gak korelasi lagi (hype fade), weight-nya turun otomatis.</P>
            <P><b>Aktifin selalu.</b> Ini yang bikin Meridian beda dari bot statis.</P>
          </>
        ),
      },
    ],
  },
  {
    key: "pnl",
    title: "I. PnL Poller",
    intro: "Poller high-frequency untuk detect trailing TP di antara management cycle.",
    items: [
      {
        key: "pnlPoller",
        title: "pollIntervalSec + confirmTicks + rpcUrl",
        defaultValue: "3s / 2 tick / public helius",
        summary: "3s polling + 2 tick konfirmasi untuk anti-wick.",
        detail: (
          <>
            <List>
              <li><Kbd>pnl.rpcUrl</Kbd> = RPC terpisah buat poller (default public Helius). Biar RPC utama gak overload.</li>
              <li><Kbd>pnl.pollIntervalSec: 3</Kbd> — poll PnL tiap 3 detik. Detect trailing TP fire cepat.</li>
              <li><Kbd>pnl.confirmTicks: 2</Kbd> — butuh 2 tick berturut konfirmasi drop sebelum fire exit. Anti wick.</li>
              <li><Kbd>pnl.depositCacheTtlSec: 300</Kbd> — cache deposit info 5 menit. Kurangi duplicate RPC calls.</li>
            </List>
          </>
        ),
      },
    ],
  },
  {
    key: "indicators",
    title: "J. Indicators (Opsional, default off)",
    intro: "Konfirmasi teknikal (Supertrend, RSI, Bollinger, Fibonacci) sebelum deploy.",
    items: [
      {
        key: "indicatorsCore",
        title: "enabled + entryPreset / exitPreset",
        defaultValue: "false / supertrend_break",
        summary: "8 preset teknikal untuk filter entry & trigger exit.",
        detail: (
          <>
            <H>Preset yang tersedia</H>
            <List>
              <li><Kbd>supertrend_break</Kbd> — deploy saat Supertrend flip bullish.</li>
              <li><Kbd>rsi_reversal</Kbd> — RSI oversold reversal.</li>
              <li><Kbd>bollinger_reversion</Kbd> — harga touch lower band.</li>
              <li><Kbd>fibo_reclaim</Kbd> — reclaim key fib level.</li>
              <li>(+ kombinasi: <Kbd>rsi_plus_supertrend</Kbd>, <Kbd>supertrend_or_rsi</Kbd>, <Kbd>bb_plus_rsi</Kbd>, <Kbd>fibo_reject</Kbd>)</li>
            </List>
            <H>Setting pendukung</H>
            <List>
              <li><Kbd>intervals: [&quot;5_MINUTE&quot;]</Kbd> — timeframe candle.</li>
              <li><Kbd>candles: 298</Kbd> — jumlah candle history yang di-fetch.</li>
              <li><Kbd>rsiLength: 2</Kbd>, <Kbd>rsiOversold: 30</Kbd>, <Kbd>rsiOverbought: 80</Kbd>.</li>
              <li><Kbd>requireAllIntervals: false</Kbd> — kalau true + multi-interval, semua wajib konfirmasi (sangat ketat).</li>
            </List>
            <H>Kapan aktifin</H>
            <P>Setelah 2-4 minggu run bot, kalau lo mulai bisa baca chart dan mau tambah filter teknikal. Awal-awal mendingan off — biarin fundamental (fee/TVL, organic) yang decide.</P>
          </>
        ),
      },
    ],
  },
];

function ItemBlock({ item }: { item: Item }) {
  return (
    <details className="group rounded-[var(--radius-md)] border border-border bg-surface-2 open:bg-surface-1 transition-colors">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-3 hover:bg-surface-1 rounded-[var(--radius-md)] transition-colors">
        <CaretRight
          size={16}
          className="mt-0.5 shrink-0 text-text-tertiary transition-transform group-open:rotate-90"
          weight="bold"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold text-text-primary">{item.title}</span>
            {item.defaultValue && (
              <span className="rounded-[var(--radius-sm)] border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-text-tertiary">
                default: {item.defaultValue}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-text-secondary">{item.summary}</p>
        </div>
      </summary>
      <div className="border-t border-border p-4">{item.detail}</div>
    </details>
  );
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <details className="rounded-[var(--radius-lg)] border border-border bg-surface-1" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-surface-2 rounded-[var(--radius-lg)] transition-colors">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-text-primary">{section.title}</h2>
          <p className="mt-0.5 text-[12.5px] text-text-tertiary">{section.intro}</p>
        </div>
        <span className="shrink-0 text-[11px] text-text-tertiary">
          {section.items.length} topik
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        {section.items.map((item) => (
          <ItemBlock key={item.key} item={item} />
        ))}
      </div>
    </details>
  );
}

export default function BelajarPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <BookOpen size={20} className="text-accent-bright" />
        <div>
          <h1 className="text-[15px] font-semibold text-text-primary">Belajar</h1>
          <p className="text-[12px] text-text-tertiary">
            Panduan lengkap semua config Meridian. Klik tiap topik untuk detail.
          </p>
        </div>
      </div>

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
        <h2 className="text-[14px] font-semibold text-text-primary">Mental Model — Cara Meridian bikin uang</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          Di DLMM, ada 3 sumber PnL:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-text-secondary">
          <li><b>Fee income</b> — swap fee dari trader. Ini yang lo MAKSIMALIN.</li>
          <li><b>Impermanent loss (IL)</b> — token base naik/turun relatif SOL. Ini yang lo MINIMALIN.</li>
          <li><b>Range efficiency</b> — % waktu active bin ada di dalam range lo. OOR = fee 0.</li>
        </ol>
        <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
          Persamaan sederhana:{" "}
          <Kbd>PnL = fees_earned − IL − gas</Kbd>. Semua config berikut pada dasarnya nge-optimize salah satu dari tiga ini.
        </p>
      </section>

      <div className="flex flex-col gap-3">
        {SECTIONS.map((section) => (
          <SectionBlock key={section.key} section={section} />
        ))}
      </div>
    </div>
  );
}
