# Design System — Meridian Control Dashboard

| Field | Nilai |
|---|---|
| Versi | **v1** |
| Status | Siap dipakai implementasi |
| Update terakhir | 2026-07-03 |
| Pasangan dokumen | `dashboard/PRD.md` (apa yang dibangun) — dokumen ini mengatur **bagaimana tampilannya** |
| Stack target | Next.js 15 + Tailwind CSS v4 + shadcn/ui + TanStack Query + Recharts + Phosphor Icons |
| Mode default | **Dark** (primary). Light mode disediakan penuh sebagai sekunder. |

> **Design read**: dashboard kontrol internal untuk agent trading DLMM otonom.
> Satu operator, localhost, sesi panjang menatap PnL live. Bahasa visual:
> **trading terminal / instrument panel** — presisi, padat-tapi-bernapas, angka
> monospace, warna hanya untuk makna (bukan dekorasi).
>
> Ini **bukan** landing page. Tidak ada hero, marquee, scroll-hijack, atau
> animasi dekoratif. Setiap piksel warna dan setiap animasi harus punya alasan
> fungsional (hierarki, status, feedback, atau perubahan state).

---

## Daftar Isi

1. [Prinsip Desain](#1-prinsip-desain)
2. [Dials (kalibrasi)](#2-dials-kalibrasi)
3. [Design Tokens — Warna](#3-design-tokens--warna)
4. [Semantik Finansial & Status](#4-semantik-finansial--status)
5. [Tipografi](#5-tipografi)
6. [Spacing, Layout & Grid](#6-spacing-layout--grid)
7. [Elevation, Radius, Border, Z-index](#7-elevation-radius-border-z-index)
8. [Motion](#8-motion)
9. [Ikonografi](#9-ikonografi)
10. [Konvensi Tampilan Data](#10-konvensi-tampilan-data)
11. [Komponen](#11-komponen)
12. [State Wajib: Loading / Empty / Error / Offline](#12-state-wajib)
13. [Microcopy & Glosarium Istilah](#13-microcopy--glosarium-istilah)
14. [Aksesibilitas](#14-aksesibilitas)
15. [Anti-Slop — Do & Don't](#15-anti-slop--do--dont)
16. [Implementasi (globals.css, font, Recharts)](#16-implementasi)
17. [Checklist per Komponen](#17-checklist-per-komponen)

---

## 1. Prinsip Desain

Lima aturan yang menang atas selera saat ada konflik.

1. **Angka adalah produknya.** PnL, SOL, %, alamat — semua angka finansial pakai
   font monospace tabular, rata kanan di tabel, dan tanda (`+`/`-`) selalu
   terlihat. Angka tidak pernah bergeser lebar saat berubah (tabular figures).
2. **Warna = makna, bukan hiasan.** Hijau = profit, merah = loss, amber =
   peringatan, azure = interaktif/brand, netral = segalanya. Kalau sebuah warna
   tidak menyampaikan status, ia harus netral (grafit). Tidak ada gradient
   dekoratif, tidak ada glow.
3. **Aksi merusak harus terasa berat.** `close`, `deploy`, `swap`, `clear_lessons`
   itu ireversibel dan menyentuh dana on-chain. Semua lewat `ConfirmModal`,
   tombolnya varian `danger`, dan menampilkan nominal/alamat yang terdampak.
4. **Kepadatan yang bernapas.** Ini cockpit, bukan galeri seni — tapi juga bukan
   spreadsheet. Kelompokkan dengan garis hairline dan whitespace, bukan kartu
   di dalam kartu. Grouping default = `divide-y` + `border`, bukan box bertumpuk.
5. **Kejujuran state.** Setiap panel live punya empat wajah: loading (skeleton),
   berisi, kosong (empty state informatif), dan basi/offline (banner + timestamp
   "last updated"). Tidak boleh hanya membangun happy-path.

---

## 2. Dials (kalibrasi)

Nilai global yang menyetir semua keputusan di bawah. Diturunkan dari design read,
bukan baseline landing-page.

| Dial | Nilai | Arti untuk dashboard ini |
|---|---:|---|
| `DESIGN_VARIANCE` | **3** | Layout rapi, grid teratur, dapat diprediksi. Operator butuh muscle-memory, bukan kejutan komposisi. |
| `MOTION_INTENSITY` | **2** | Hanya motion fungsional: tick-flash nilai, pulse "live/pending", skeleton shimmer, transisi hover 150ms. Nol animasi dekoratif. |
| `VISUAL_DENSITY` | **6** | Padat-nyaman. Tabel rapat tapi terbaca, KPI card ringkas, `font-mono` untuk semua angka. |

---

## 3. Design Tokens — Warna

**Sumber kebenaran = HEX.** Tailwind v4 / shadcn memakai OKLCH di `@theme`; konversi
1:1 dari HEX ini aman. Semua kombinasi teks/latar di bawah sudah dicek ≥ WCAG AA
(4.5:1 body, 3:1 large/UI). **Jangan** pakai `#000000` atau `#ffffff` murni.

### 3.1 Netral — Dark (default)

Skala grafit dingin (cool, sedikit biru). Elevasi dinaikkan lewat *lightness
permukaan*, bukan shadow (di dark, shadow nyaris tak terlihat).

| Token | HEX | Pemakaian |
|---|---|---|
| `--bg` | `#0A0C10` | Background aplikasi (paling dalam) |
| `--surface-1` | `#101319` | Card, panel, sidebar |
| `--surface-2` | `#161A22` | Input, row hover, elevated tile |
| `--surface-3` | `#1C212B` | Popover, dropdown, modal, tooltip |
| `--border` | `#232935` | Hairline divider default |
| `--border-strong` | `#2E3644` | Border input, batas seksi tegas |
| `--text-primary` | `#E6E9EF` | Heading, angka utama, nilai penting |
| `--text-secondary` | `#A5ADBD` | Body, label sekunder |
| `--text-tertiary` | `#6B7385` | Caption, hint, label kolom, metadata |
| `--text-disabled` | `#4A5163` | Teks/ikon disabled |

### 3.2 Netral — Light (sekunder)

| Token | HEX | Pemakaian |
|---|---|---|
| `--bg` | `#F6F7F9` | Background aplikasi |
| `--surface-1` | `#FFFFFF` | Card, panel, sidebar |
| `--surface-2` | `#EFF1F5` | Input, row hover |
| `--surface-3` | `#FFFFFF` | Popover/modal (dengan shadow) |
| `--border` | `#E3E7ED` | Hairline |
| `--border-strong` | `#CDD3DD` | Border input |
| `--text-primary` | `#12151C` | Heading, angka utama |
| `--text-secondary` | `#535B6B` | Body |
| `--text-tertiary` | `#828A99` | Caption/label |
| `--text-disabled` | `#AEB4C0` | Disabled |

### 3.3 Accent — "Meridian Azure" (SATU accent, dikunci)

Azure dingin condong-cyan → terbaca sebagai layar instrumen, bukan tombol bootstrap.
Dipakai untuk: interaktif primer, focus ring, nav aktif, link, garis chart utama,
status pending/info. **Tidak dipakai** untuk profit/loss (itu punya warna sendiri).

| Token | HEX (dark) | HEX (light) | Pemakaian |
|---|---|---|---|
| `--accent` | `#2F8FE6` | `#1A6FC9` | Fill tombol primer (teks putih, AA) |
| `--accent-hover` | `#4098EE` | `#155FAF` | Hover fill |
| `--accent-bright` | `#4FA9FF` | `#1A6FC9` | Focus ring, nav aktif, link, garis chart |
| `--accent-fg` | `#FFFFFF` | `#FFFFFF` | Teks/ikon di atas fill accent |
| `--accent-tint` | `rgba(47,143,230,.12)` | `rgba(26,111,201,.10)` | Latar row aktif, badge info, area chart |

> **Kunci accent (mandatory).** Satu accent untuk seluruh app. Tidak ada tombol
> ungu di satu halaman lalu teal di halaman lain. Kalau perlu ganti brand color,
> ganti **hanya** `--accent*` di satu tempat.

### 3.4 Ringkasan hue

Total hanya **5 hue** yang membawa makna: grafit (netral) + azure (interaktif) +
emerald (profit) + rose (loss) + amber (warning). Semua warna lain di UI harus
turunan salah satu dari ini. Detail semantik di §4.

---

## 4. Semantik Finansial & Status

Ini jantung dashboard trading. Setiap token punya versi **text** (terbaca di atas
surface gelap/terang, AA) dan **fill** (untuk tombol/badge solid, teks putih AA)
dan **tint** (latar lembut untuk row/area chart).

### 4.1 Profit / Loss / Warning / Danger

| Makna | `--x` text (dark) | text (light) | `--x-fill` | `--x-tint` |
|---|---|---|---|---|
| **Profit / positif** | `#33D69F` | `#0E9F6A` | `#12A66E` | `rgba(51,214,159,.12)` |
| **Loss / negatif** | `#FF6B6B` | `#D93A48` | `#E23D4C` | `rgba(255,107,107,.12)` |
| **Warning** (low-yield, menua, dekat threshold) | `#F5B942` | `#9A6100` | `#E19B15` | `rgba(245,185,66,.12)` |
| **Danger** (aksi merusak: close/deploy/swap) | `#FF6B6B` | `#D93A48` | `#E23D4C` | `rgba(226,61,76,.14)` |
| **Info / accent** | `#4FA9FF` | `#1A6FC9` | `#2F8FE6` | `rgba(47,143,230,.12)` |
| **Neutral / flat** (nilai nol/tak berubah) | `#6B7385` | `#828A99` | `#3A414F` | `transparent` |

Aturan pemakaian PnL:
- `pnl > 0` → warna profit, prefix `+`.
- `pnl < 0` → warna loss, prefix `-`.
- `pnl === 0` atau tak diketahui → warna neutral (tertiary grey), **tanpa** hijau/merah.
- **Jangan** warnai seluruh baris hijau/merah — hanya angka + panah/ikon tren.
  Latar tint hanya untuk highlight sesaat (tick-flash) atau baris terpilih.

### 4.2 Status posisi & agent

Dipetakan ke hue yang sudah ada — **tidak menambah hue baru**.

| Status | Warna | Ikon (Phosphor) | Bentuk UI |
|---|---|---|---|
| `in_range` | profit `#33D69F` | `Target` | dot + label "In range" |
| `out_of_range` | warning `#F5B942` | `ArrowsOutSimple` | dot + label "Out of range" + menit OOR |
| `cooldown` | `--text-tertiary` + ring `--accent-tint` | `Hourglass` | badge netral "Cooldown · 3h" |
| `pending` / `in_flight` | accent `#4FA9FF` | `CircleNotch` (spin) | badge azure, **pulse** |
| `closed` | neutral `#6B7385` | `CheckCircle` | badge abu, redup |
| `blocked` (safety check) | danger `#FF6B6B` | `ShieldWarning` | badge merah + `reason` |
| `low_yield` | warning `#F5B942` | `TrendDown` | badge amber |

> Catatan: untuk `cooldown` pakai badge **netral** (grafit) dengan ring
> `--accent-tint`, bukan hue baru. "Istirahat" = tenang, jangan berteriak.

### 4.3 Daemon health (dipakai `DaemonStatusBanner`)

| State | Warna dot | Teks banner |
|---|---|---|
| `online` | profit `#33D69F` (**pulse** 2s) | tersembunyi / "Daemon live · uptime 4h 12m" (subtle) |
| `degraded` (health gagal 1×) | warning `#F5B942` | "Daemon lambat merespons" |
| `offline` (health gagal ≥2×) | loss `#FF6B6B` | **"Daemon offline — mode read-only"** (banner penuh, aksi disabled) |

### 4.4 Palet chart (Recharts)

Chart **boleh** pakai lebih banyak warna (kategorikal butuh itu). Untuk PnL/tren,
warnai by-value pakai profit/loss. Untuk seri kategorikal (bobot signal, dsb.)
pakai ramp terkontrol ini:

```
chart-1  #2F8FE6  azure
chart-2  #33D69F  emerald
chart-3  #F5B942  amber
chart-4  #FF6B6B  rose
chart-5  #9B8CFF  periwinkle
chart-6  #4EC8C4  teal
grid     var(--border)          garis grid (jangan lebih terang dari border)
axis     var(--text-tertiary)   label sumbu & tick
```

Aturan chart: grid tipis 1px `--border`, tanpa gridline vertikal kalau tidak perlu,
tooltip pakai `--surface-3` + `--border`, angka di tooltip **monospace**.

---

## 5. Tipografi

Dua family. Keduanya self-host via `next/font` (paket `geist`). **Bukan Inter.**

| Peran | Font | Kenapa |
|---|---|---|
| UI / teks | **Geist Sans** | Netral-modern, grotesk presisi, cocok instrumen. |
| Angka / alamat / kode / metrik | **Geist Mono** | Tabular figures wajib untuk kolom angka yang tidak "melompat". |

Aktifkan tabular figures di mana pun angka bisa berubah:
`font-variant-numeric: tabular-nums;`

### 5.1 Skala tipe

Dashboard = hierarki dikontrol lewat **weight + warna**, bukan ukuran raksasa.
Tidak ada `text-7xl`. Ukuran terbesar yang wajar = angka KPI hero (`text-3xl`).

| Token | Size / line-height | Weight | Pemakaian |
|---|---|---|---|
| `display` | 30px / 36px | 600 | Angka KPI besar (net PnL di Overview) — **Geist Mono** |
| `h1` | 22px / 28px | 600 | Judul halaman |
| `h2` | 18px / 26px | 600 | Judul seksi / card |
| `h3` | 15px / 22px | 600 | Sub-judul, header tabel grup |
| `body` | 14px / 21px | 400 | Teks utama |
| `body-sm` | 13px / 20px | 400 | Body sekunder, isi tabel |
| `label` | 12px / 16px | 500 | Label kolom, form label, metadata |
| `caption` | 11px / 15px | 500 | Hint, timestamp, footnote |
| `mono-data` | 13px / 20px | 450 | Angka in-table (Geist Mono, tabular) |
| `mono-lg` | 20px / 28px | 500 | Angka menonjol (PnL card) (Geist Mono, tabular) |

Aturan:
- Label kolom & form: `--text-tertiary`, boleh `uppercase tracking-wide` **hemat**
  (label tabel & form saja, bukan di setiap heading — hindari "eyebrow di
  mana-mana").
- Body panjang maks `65ch`. Tapi tabel/log boleh full-width.
- **Nol em-dash (`—`) di teks yang tampil.** Pakai hyphen `-`, koma, titik, atau
  titik dua. (Berlaku ke semua microcopy, label, tooltip, empty state.)

---

## 6. Spacing, Layout & Grid

### 6.1 Skala spacing (basis 4px)

`0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Pakai token Tailwind (`p-1`=4px …).
Density 6 → padding komponen sedang-rapat:

| Elemen | Padding |
|---|---|
| Card / panel | `p-4` (16) sampai `p-5` (20) |
| Row tabel | `py-2.5 px-3` (10 / 12) |
| Input / button (md) | `h-9`, `px-3` |
| Gap antar KPI card | `gap-4` (16) |
| Gap antar seksi halaman | `gap-6` (24) sampai `gap-8` (32) |
| Padding konten halaman | `px-6 py-6` desktop, `px-4 py-4` mobile |

### 6.2 App shell

```
┌───────────────────────────────────────────────────────────────┐
│  DaemonStatusBanner (48px, sticky, hanya tampil bila ≠ online)  │
├──────────┬────────────────────────────────────────────────────┤
│ Sidebar  │  Top bar (56px): judul halaman · saldo SOL · refresh │
│ 240px    ├────────────────────────────────────────────────────┤
│ (rail    │                                                     │
│  64px    │   Konten halaman  (max-w-[1440px], mx-auto, px-6)   │
│  saat    │                                                     │
│  collapse│                                                     │
└──────────┴────────────────────────────────────────────────────┘
```

- **Sidebar**: `--surface-1`, lebar 240px, item nav 40px tinggi, ikon Phosphor 20px
  + label. Item aktif: latar `--accent-tint`, teks `--text-primary`, indikator
  garis kiri 2px `--accent-bright`. Bisa collapse ke rail 64px (ikon saja).
- **Top bar**: judul halaman (`h1`), di kanan: saldo SOL live (mono) + tombol
  "Refresh now" (throttle 10s) + toggle tema.
- **Konten**: `max-w-[1440px] mx-auto`. Dashboard full-width tapi dibatasi agar
  tabel tidak melar tak terbaca di monitor lebar.

### 6.3 Grid & breakpoints

Breakpoint standar: `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`.

- **Selalu CSS Grid**, bukan flex-percentage-math.
- Overview KPI: `grid grid-cols-2 lg:grid-cols-4 gap-4`.
- Positions/decisions: 1 kolom penuh (tabel/timeline).
- **Mobile collapse eksplisit per seksi**: `< 768px` → semua grid jadi
  `grid-cols-1`, sidebar jadi drawer (hamburger). Nyatakan di tiap komponen,
  jangan berasumsi "Tailwind menangani".

---

## 7. Elevation, Radius, Border, Z-index

### 7.1 Radius (SATU skala, dikunci)

Instrumen presisi → radius kecil. Konsisten di mana pun.

| Token | Nilai | Pemakaian |
|---|---|---|
| `--radius-sm` | 4px | Badge, pill, tag, checkbox |
| `--radius-md` | 6px | Input, button, dropdown item |
| `--radius-lg` | 8px | Card, panel, tabel container |
| `--radius-xl` | 12px | Modal, popover besar |
| `--radius-full` | 9999px | Dot status, avatar |

> **Shape lock**: jangan campur tombol pill-penuh dengan card kotak. Skala di atas
> berlaku menyeluruh.

### 7.2 Border & elevation

- Elevasi di **dark** = naikkan lightness surface (`bg → surface-1 → -2 → -3`) +
  border 1px `--border`. Shadow hampir tak dipakai.
- Elevasi di **light** = shadow halus bernuansa (bukan hitam murni):
  - `--shadow-sm`: `0 1px 2px rgba(16,20,30,.06)`
  - `--shadow-md`: `0 4px 12px rgba(16,20,30,.08)`
  - `--shadow-lg`: `0 12px 32px rgba(16,20,30,.12)` (modal/popover)
- **Grouping default pakai garis, bukan kartu**: daftar → `divide-y divide-[--border]`.
  Kartu hanya saat elevasi benar-benar menyampaikan hierarki.

### 7.3 Z-index (skala terdokumentasi, jangan spam `z-50`)

| Layer | z |
|---|---|
| Konten dasar | 0 |
| Sticky (top bar, header tabel) | 10 |
| Sidebar / drawer | 20 |
| Dropdown / popover / tooltip | 30 |
| DaemonStatusBanner | 40 |
| Modal + overlay | 50 |
| Toast | 60 |

---

## 8. Motion

`MOTION_INTENSITY: 2`. Motion hanya untuk: **feedback, status, perubahan nilai,
transisi state**. Semuanya hormati `prefers-reduced-motion` (wajib di atas level 3;
di sini kita di bawahnya, tapi tetap sediakan fallback untuk pulse/flash/skeleton).

### 8.1 Durasi & easing

| Token | Nilai |
|---|---|
| `--dur-instant` | 100ms |
| `--dur-fast` | 150ms (hover, focus, tombol) |
| `--dur-base` | 200ms (dropdown, modal masuk) |
| `--dur-flash` | 600ms (tick-flash nilai) |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |

Animasikan **hanya** `transform` & `opacity` (+ `background-color` untuk tick-flash).
Jangan animasikan `width/height/top/left`.

### 8.2 Pola motion yang diizinkan

1. **Tick-flash** (nilai live berubah): saat angka naik → latar sel flash
   `--profit-tint` lalu fade 600ms; turun → `--loss-tint`. Cara paling jelas
   menunjukkan "ini baru berubah" tanpa animasi berisik.
2. **Live/pending pulse**: dot daemon-online & badge pending → opacity 1↔0.45,
   2s `ease-in-out` infinite. Reduced-motion → statis (opacity 1).
3. **Skeleton shimmer**: sweep gradient halus melintang, 1.5s. Reduced-motion →
   surface statis `--surface-2` tanpa sweep.
4. **Hover/active**: hover 150ms ease-out (surface/border). `:active` tombol →
   `scale-[0.98]` atau `translate-y-[1px]` (tactile).
5. **Modal/popover masuk**: fade + `scale-[0.98]→1` 200ms. Keluar 150ms.
6. **Row enter (opsional)**: entri decision/log baru → fade-in 200ms, **sekali**,
   `viewport once`. Tidak ada stagger dramatis.

**Dilarang**: marquee, parallax, scroll-hijack, magnetic hover, custom cursor,
angka count-up dramatis, konfeti. Ini alat kontrol, bukan pertunjukan.

`window.addEventListener('scroll', …)` **dilarang** — pakai IntersectionObserver /
CSS bila perlu (jarang perlu di dashboard).

---

## 9. Ikonografi

- **Library tunggal: `@phosphor-icons/react`.** Jangan campur family. Jangan
  hand-roll SVG path.
- Weight standar: **`regular`** untuk ikon UI; **`bold`** untuk state aktif/penting
  (mis. nav aktif, tombol primer). Konsisten global.
- Ukuran: `16` (inline/tabel), `20` (nav, tombol, label), `24` (header/empty state).
- Ikon status memakai warna semantik §4.2 (bukan warna asal-asalan).

Peta ikon → makna (pakai konsisten):

| Konsep | Ikon |
|---|---|
| Overview / dashboard | `SquaresFour` |
| Positions | `ChartLineUp` |
| Feed / teach | `GraduationCap` / `Brain` |
| Decisions | `GitBranch` / `ListChecks` |
| Config | `SlidersHorizontal` |
| Blocklist | `Prohibit` |
| Wallet scanner | `Wallet` |
| Screening / deploy | `Radar` / `Crosshair` |
| Learning / Darwin | `TrendUp` |
| Logs / audit | `Scroll` / `Terminal` |
| Profit | `ArrowUpRight` · Loss `ArrowDownRight` |
| Warning | `Warning` · Danger `ShieldWarning` |
| Pending/loading | `CircleNotch` (spin) |
| Copy | `Copy` · Buka di explorer `ArrowSquareOut` |
| Refresh | `ArrowsClockwise` |

---

## 10. Konvensi Tampilan Data

Konsistensi format angka **lebih penting** dari apa pun di dashboard finansial.
Buat helper terpusat (`lib/format.ts`) — jangan format ad-hoc per komponen.

| Jenis | Format | Contoh | Catatan |
|---|---|---|---|
| SOL | `X.XXX SOL` | `12.480 SOL` | mono, tabular, 3 desimal default |
| USD | `$X,XXX.XX` | `$1,284.30` | mono, ribuan pakai koma |
| PnL % | tanda + 2 desimal + `%` | `+4.12%` / `-1.80%` | warna by-sign, `+` selalu ada |
| PnL USD | tanda + `$` | `+$84.20` / `-$12.05` | warna by-sign |
| Angka besar | compact | `1.2M`, `48.3k` | untuk TVL, volume, mcap |
| Ratio | 4 signifikan | `0.0184` | fee/TVL dsb., mono |
| Alamat | `Xxxx…xxxx` (4+4) | `7Ge3…kR9a` | mono, klik = copy, ikon `ArrowSquareOut` ke explorer |
| Waktu | relatif + absolut on hover | `3m ago` (title: `2026-07-03 14:22 UTC`) | jangan tampilkan epoch mentah |
| Durasi/umur | ringkas | `4h 12m`, `3d 2h` | umur posisi, uptime |
| Bin range | `[low, high]` | `[-35, +12]` | konteks active bin |
| Kosong/unknown | `—`* atau `n/a` | | *hyphen tunggal sebagai placeholder, bukan em-dash |

Aturan:
- **Angka selalu rata kanan** di kolom tabel (biar titik desimal sejajar).
- **Jangan pernah** pakai warna hijau/merah untuk angka yang bukan PnL/tren
  (mis. TVL bukan "profit", jadi netral).
- Alamat panjang **selalu** truncate + copyable. Jangan tampilkan 44 char mentah.
- Angka fake-presisi dilarang. Kalau sumbernya belum ada, tandai `mock` /
  gunakan skeleton, jangan mengarang `92.4%`.

---

## 11. Komponen

Spesifikasi komponen inti (yang disebut PRD §6.1). Semua mewarisi token shadcn/ui
yang sudah dipetakan (§16), lalu diperluas dengan token domain.

### 11.1 Button

Varian & pemakaian:

| Varian | Fill | Teks | Kapan |
|---|---|---|---|
| `primary` | `--accent` | `--accent-fg` | Aksi utama non-merusak (Save config, Scan, Add lesson) |
| `secondary` | `--surface-2` | `--text-primary` | Aksi sekunder, border `--border-strong` |
| `ghost` | transparan | `--text-secondary` | Aksi tersier, ikon-only di toolbar |
| `danger` | `--danger-fill` | `#FFFFFF` | Close, Deploy, Swap, Clear — aksi ireversibel |
| `danger-ghost` | transparan | `--loss` (text) | Aksi merusak tersier (mis. remove item di list) |

- Tinggi: `sm 32px · md 36px · lg 40px`. Radius `--radius-md`.
- State wajib: default / hover / active(`scale-.98`) / focus(ring `--accent-bright`
  2px offset 2px) / **disabled** / **loading** (ikon `CircleNotch` spin +
  label, tombol disabled selama mutation pending — §PRD 9.2).
- **Label 1 baris**, maks 3 kata untuk primer. Kontras teks/fill wajib AA.

### 11.2 KPI / Stat Card (Overview)

```
┌─────────────────────────┐
│ NET PNL          ▲       │  ← label (tertiary, uppercase) + ikon tren
│ +$284.10                 │  ← angka display, mono-lg, warna by-sign
│ +4.12% · 3 posisi        │  ← subteks (secondary/mono)
└─────────────────────────┘
```

- Surface `--surface-1`, border `--border`, radius `--radius-lg`, `p-4`.
- Angka utama `mono-lg`/`display`, warna semantik. Tanpa gradient, tanpa glow.
- Tren opsional pakai sparkline mini (Recharts) garis `--accent-bright`.

### 11.3 Position Card / Row

Menampilkan: pool name, strategy, bin range, PnL% (+peak), fee earned, umur,
status in/out-range, instruction aktif.

- Layout row (tabel) untuk `/positions`; card untuk 3 teratas di Overview.
- PnL menonjol (mono, by-sign). Status = badge §4.2. Peak PnL sebagai caption
  (`peak +8.4%`).
- Aksi per-row: `Close` (danger), `Claim` (secondary), `Note` (ghost),
  `Swap` (ghost) → semua buka `ConfirmModal`.
- Baris out-of-range: badge amber + hitung menit OOR; **jangan** warnai seluruh
  baris amber, cukup badge + ikon.

### 11.4 Data Table (dense)

- Header sticky (`z-10`), `--surface-1`, label kolom `label`/tertiary/uppercase.
- Row `py-2.5`, hover `--surface-2`, `divide-y --border`. Angka rata kanan mono.
- Zebra **tidak** dipakai (garis hairline sudah cukup; zebra menambah noise).
- Baris terpilih: latar `--accent-tint`, border-kiri 2px `--accent-bright`.
- Long list > 5 → sediakan filter/sort, bukan sekadar `<ul>` panjang.

### 11.5 Badge / Status Pill

- Radius `--radius-sm`, `px-2 py-0.5`, `label` size, mono untuk angka.
- Bentuk: `dot + teks` untuk status ringan; solid-fill hanya untuk penekanan
  (mis. `BLOCKED`). Warna dari §4.2. Dot 6px `--radius-full`.

### 11.6 ConfirmModal (kritis — dipakai SEMUA aksi write)

Wajib untuk setiap tool WRITE (§PRD 8.8). Isi:

```
┌───────────────────────────────────────────────┐
│  ⚠  Close position?                            │  ← ikon danger + judul
│                                                │
│  Pool     SOL-WIF · bid_ask                    │  ← ringkasan args penting
│  PnL      +4.12%  ($84.10)                      │
│  Amount   12.480 SOL                            │
│                                                │
│  [ ] Jangan auto-swap base → SOL (skip_swap)   │  ← opsi khusus tool
│                                                │
│  Dampak: posisi ditutup on-chain, fee di-claim,│  ← 1 kalimat dampak
│  base otomatis di-swap ke SOL.                 │
│                                                │
│              [ Batal ]   [ Close position ]    │  ← danger button kanan
└───────────────────────────────────────────────┘
```

- Judul menyebut aksi + objek. Tampilkan **nominal/alamat** yang terdampak.
- Tombol konfirmasi = varian sesuai aksi (`danger` untuk close/deploy/swap).
- **Konfirmasi ekstra** untuk `clear_lessons`: user harus ketik `DELETE`.
- Saat pending: tombol → loading, disabled, tidak bisa dobel-submit.
- Hasil `blocked` → tampilkan `result.reason` di modal (bukan crash, bukan error
  generik). Hasil `error` → tampilkan pesan error. Sukses → tutup + toast + invalidate.

### 11.7 Form controls (Config, Feed, Blocklist)

- **Label di ATAS input** (`label` size, tertiary). Helper text opsional di markup.
  Error text di BAWAH input, warna loss. `gap-2` per blok input.
- **Tidak ada placeholder-as-label.** Placeholder hanya contoh/hint.
- Input: `h-9`, `--surface-2`, border `--border-strong`, radius `--radius-md`,
  focus ring `--accent-bright`. Mono untuk field angka/alamat.
- Select/toggle/checkbox ikut shadcn, ditema token ini.
- Field secret (`apiKey` dll.) tampil `[redacted]`, read-only, **tidak** dikirim
  balik saat submit (§PRD 8.5 / AC-CF.3).
- Config form di-generate dari mirror `CONFIG_MAP`; setelah submit tampilkan
  `applied[]` & `unknown[]` dari result (AC-CF.2).

### 11.8 DecisionTimeline

- Vertikal, node per entri: ikon per tipe (`deploy`/`close`/`skip`/`no_deploy`),
  actor badge (SCREENER/MANAGER/GENERAL), summary, waktu relatif.
- Expand → detail: `reason`, `risks[]`, `metrics{}`, `rejected[]` (untuk
  `no_deploy`, list kandidat + alasan reject).
- Filter per tipe/actor/pool di atas timeline.

### 11.9 DaemonStatusBanner

- Sticky top, `z-40`. Hanya muncul saat state ≠ `online` (online = diam,
  tampil ringkas di top bar sebagai dot pulse hijau).
- Offline → banner penuh warna loss-tint, teks "Daemon offline — mode read-only",
  semua tombol aksi disabled, query live backoff.

### 11.10 Toast

- Posisi kanan-bawah, `z-60`, `--surface-3`, border `--border`, radius `--radius-lg`.
- Varian: success (ikon `CheckCircle` profit), error (`XCircle` loss),
  info (`Info` accent). Auto-dismiss 4s, kecuali error (manual dismiss).
- Toast hanya untuk **transient feedback** (aksi selesai). Error persisten/blokir
  ditampilkan inline (di modal/form), bukan toast.

---

## 12. State Wajib

Setiap panel yang menampilkan data harus mengimplementasikan keempatnya. Membangun
hanya happy-path = pekerjaan belum selesai.

| State | Pola |
|---|---|
| **Loading** | Skeleton yang **meniru bentuk final** (baris tabel, KPI card). Bukan spinner tengah layar. Shimmer 1.5s (reduced-motion → statis). |
| **Empty** | Komposisi rapi + ikon 24px + 1 kalimat + arah aksi. Contoh: "Belum ada posisi terbuka. Jalankan screening dari halaman Screen." Bukan error, bukan blank. |
| **Error** | Inline, kontekstual. Pesan spesifik + tombol retry. Untuk fetch gagal: "Gagal memuat positions. Coba lagi." |
| **Offline/stale** | Banner (§11.9) + timestamp "last updated Xs ago" di tiap kartu live + tombol aksi disabled. Operator harus tahu datanya basi. |

---

## 13. Microcopy & Glosarium Istilah

Nada: **fungsional, ringkas, satu register**. Bukan marketing, bukan puitis.

Aturan:
- **Nol em-dash** di teks tampil. Hyphen/koma/titik/titik-dua.
- Tanda angka selalu eksplisit (`+`/`-`).
- Satu label per aksi (jangan "Close" di satu tempat, "Tutup posisi" di tempat
  lain). Kunci istilah di glosarium ini.
- Verba konkret. Hindari "Elevate/Seamless/Unleash/Optimize".
- Tanpa nama/angka fiktif "Jane Doe / 99.99%". Kalau data belum ada → skeleton/mock-label.

Glosarium (dikunci — pakai konsisten di seluruh UI):

| Istilah UI | Makna | Jangan tulis |
|---|---|---|
| **Position** | posisi DLMM terbuka | LP, liquidity |
| **Deploy** | buka posisi baru | open, create |
| **Close** | tutup posisi | exit, remove |
| **Claim** | klaim fee | harvest |
| **In range / Out of range** | status bin aktif | active/inactive |
| **PnL** | profit and loss | gain/return |
| **Fee earned** | fee terkumpul | rewards |
| **Cooldown** | pool/token istirahat | ban, timeout |
| **Lesson** | pengetahuan yang di-feed ke agent | rule, note |
| **Strategy** | strategi LP tersimpan | preset |
| **Screening** | siklus cari kandidat pool | scan (kecuali label tombol "Scan") |
| **Daemon** | proses bot inti | server, backend |

---

## 14. Aksesibilitas

- **Kontras**: semua teks ≥ WCAG AA (4.5:1 body, 3:1 large/UI). Warna semantik di
  §4 sudah dipilih agar profit/loss/warning terbaca di surface gelap **dan** terang.
- **Warna bukan satu-satunya sinyal**: status selalu punya ikon + teks, bukan hanya
  dot berwarna (buta warna merah-hijau harus tetap bisa bedakan profit/loss lewat
  tanda `+/-` dan panah).
- **Focus terlihat**: ring `--accent-bright` 2px + offset 2px pada semua elemen
  interaktif. Jangan hapus outline tanpa ganti.
- **Keyboard**: modal trap focus, `Esc` menutup, tab order logis. Tabel/aksi bisa
  dioperasikan tanpa mouse.
- **Reduced motion**: pulse/flash/skeleton punya fallback statis di
  `prefers-reduced-motion: reduce`.
- **Target sentuh** ≥ 40px pada mobile.
- **`aria-label`** pada tombol ikon-only (copy, refresh, dsb.).

---

## 15. Anti-Slop — Do & Don't

Diadaptasi dari disiplin anti-slop untuk konteks **dashboard** (bukan landing).

**Don't (dilarang):**
- Pure `#000`/`#fff`, AI-purple glow, gradient dekoratif, neon outer-glow.
- Inter sebagai default (pakai Geist).
- Angka finansial pakai font proporsional (harus mono tabular).
- Warnai seluruh baris hijau/merah (hanya angka + ikon tren).
- Kartu-di-dalam-kartu-di-dalam-kartu. Grouping utama = hairline + whitespace.
- Emoji di UI (pakai Phosphor). Kecuali diminta eksplisit.
- Hand-rolled SVG icon. Satu family (Phosphor) saja.
- Em-dash di teks tampil.
- Eyebrow uppercase di atas SETIAP heading (label kolom/form saja).
- Animasi tanpa alasan fungsional. Nol marquee/parallax/scroll-hijack.
- Section membalik tema (dark→light) di tengah. Satu tema per halaman, dikunci.
- Placeholder-as-label. Label selalu di atas input.
- Alamat 44-char mentah tanpa truncate+copy.

**Do (lakukan):**
- Satu accent azure dikunci, lima hue semantik, sisanya netral grafit.
- Geist + Geist Mono, tabular figures untuk semua angka live.
- Skeleton yang meniru bentuk final; empty state informatif; banner offline.
- ConfirmModal untuk semua aksi write, tombol danger, nominal ditampilkan.
- Radius kecil konsisten (4/6/8/12). Border hairline sebagai grouping.
- Tick-flash untuk perubahan nilai live; pulse untuk live/pending.
- Warna semantik selalu berpasangan dengan ikon + tanda (a11y).

---

## 16. Implementasi

### 16.1 Font (`next/font` + paket `geist`)

```bash
npm install geist @phosphor-icons/react
```

```tsx
// app/layout.tsx
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${GeistSans.variable} ${GeistMono.variable} dark`}>
      <body className="bg-[--bg] text-[--text-primary] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

### 16.2 `globals.css` — token → variabel shadcn + domain

Memetakan token dokumen ini ke kontrak variabel shadcn/ui (agar komponen shadcn
mewarisi sistem) lalu menambah token domain. Nilai `.dark` = default.

```css
@import "tailwindcss";

@layer base {
  :root {
    /* ── neutral (light) ─────────────────────────────── */
    --bg: #F6F7F9;
    --surface-1: #FFFFFF;
    --surface-2: #EFF1F5;
    --surface-3: #FFFFFF;
    --border: #E3E7ED;
    --border-strong: #CDD3DD;
    --text-primary: #12151C;
    --text-secondary: #535B6B;
    --text-tertiary: #828A99;
    --text-disabled: #AEB4C0;

    /* ── accent (light) ──────────────────────────────── */
    --accent: #1A6FC9;
    --accent-hover: #155FAF;
    --accent-bright: #1A6FC9;
    --accent-fg: #FFFFFF;
    --accent-tint: rgba(26,111,201,.10);

    /* ── semantic (light) ────────────────────────────── */
    --profit: #0E9F6A;  --profit-fill: #12A66E;  --profit-tint: rgba(18,166,110,.12);
    --loss:   #D93A48;  --loss-fill:   #E23D4C;  --loss-tint:   rgba(217,58,72,.12);
    --warning:#9A6100;  --warning-fill:#E19B15;  --warning-tint:rgba(225,155,21,.12);
    --danger: #D93A48;  --danger-fill: #E23D4C;  --danger-tint: rgba(226,61,76,.14);

    /* ── radius ──────────────────────────────────────── */
    --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;

    /* ── shadcn contract (light) ─────────────────────── */
    --background: var(--bg);
    --foreground: var(--text-primary);
    --card: var(--surface-1);
    --card-foreground: var(--text-primary);
    --popover: var(--surface-3);
    --popover-foreground: var(--text-primary);
    --primary: var(--accent);
    --primary-foreground: var(--accent-fg);
    --secondary: var(--surface-2);
    --secondary-foreground: var(--text-primary);
    --muted: var(--surface-2);
    --muted-foreground: var(--text-tertiary);
    --accent: var(--accent);
    --accent-foreground: var(--accent-fg);
    --destructive: var(--danger-fill);
    --destructive-foreground: #FFFFFF;
    --border: var(--border);
    --input: var(--border-strong);
    --ring: var(--accent-bright);
    --radius: var(--radius-lg);

    /* ── chart ───────────────────────────────────────── */
    --chart-1: #2F8FE6; --chart-2: #33D69F; --chart-3: #F5B942;
    --chart-4: #FF6B6B; --chart-5: #9B8CFF; --chart-6: #4EC8C4;
  }

  .dark {
    /* ── neutral (dark, default) ─────────────────────── */
    --bg: #0A0C10;
    --surface-1: #101319;
    --surface-2: #161A22;
    --surface-3: #1C212B;
    --border: #232935;
    --border-strong: #2E3644;
    --text-primary: #E6E9EF;
    --text-secondary: #A5ADBD;
    --text-tertiary: #6B7385;
    --text-disabled: #4A5163;

    /* ── accent (dark) ───────────────────────────────── */
    --accent: #2F8FE6;
    --accent-hover: #4098EE;
    --accent-bright: #4FA9FF;
    --accent-fg: #FFFFFF;
    --accent-tint: rgba(47,143,230,.12);

    /* ── semantic (dark) ─────────────────────────────── */
    --profit: #33D69F;  --profit-fill: #12A66E;  --profit-tint: rgba(51,214,159,.12);
    --loss:   #FF6B6B;  --loss-fill:   #E23D4C;  --loss-tint:   rgba(255,107,107,.12);
    --warning:#F5B942;  --warning-fill:#E19B15;  --warning-tint:rgba(245,185,66,.12);
    --danger: #FF6B6B;  --danger-fill: #E23D4C;  --danger-tint: rgba(226,61,76,.14);
  }
}

/* angka tabular di mana pun class .tnum dipakai */
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
```

> shadcn/ui saat scaffold akan menulis blok variabelnya sendiri. **Ganti** isinya
> dengan blok di atas (nilai HEX/OKLCH ekuivalen) agar tidak ada dua sumber warna.
> Kalau memakai Tailwind v4 `@theme`, ekspos token sebagai `--color-*` supaya bisa
> dipakai sebagai utility (`bg-surface-1`, `text-profit`, dst.).

### 16.3 Recharts theming

```tsx
// pakai CSS var, jangan hardcode hex di komponen chart
<Line dataKey="pnl" stroke="var(--accent-bright)" strokeWidth={1.5} dot={false} />
<CartesianGrid stroke="var(--border)" vertical={false} />
<XAxis tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
<Tooltip
  contentStyle={{
    background: "var(--surface-3)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    fontFamily: "var(--font-geist-mono)",
  }}
/>
```

### 16.4 Utilities kecil yang wajib ada

- `lib/format.ts` — `formatSol`, `formatUsd`, `formatPnlPct`, `formatPnlUsd`,
  `truncateAddress`, `relativeTime`, `compact`. Satu-satunya tempat format angka.
- `lib/pnl-color.ts` — `pnlColorClass(value)` → mengembalikan class profit/loss/neutral.
- `components/ui/*` — komponen shadcn yang sudah ditema (jangan pakai default state).

---

## 17. Checklist per Komponen

Jalankan sebelum menganggap sebuah komponen selesai.

- [ ] Semua angka finansial pakai Geist Mono + `.tnum` (tabular), rata kanan di tabel.
- [ ] PnL: tanda `+/-` selalu tampil, warna by-sign, netral saat nol/unknown.
- [ ] Alamat truncate `Xxxx…xxxx` + copyable + link explorer.
- [ ] Satu accent azure, lima hue semantik, sisanya netral. Nol warna liar.
- [ ] Radius dari skala terkunci (4/6/8/12). Tidak campur pill + kotak.
- [ ] Aksi write → `ConfirmModal`, tombol `danger`, nominal ditampilkan, disabled saat pending.
- [ ] Empat state ada: loading (skeleton), berisi, empty (informatif), error/offline.
- [ ] Status = ikon + teks + warna (bukan hanya dot; lolos buta warna).
- [ ] Focus ring `--accent-bright` terlihat di semua elemen interaktif.
- [ ] Motion hanya fungsional; reduced-motion punya fallback statis.
- [ ] Nol em-dash di teks tampil; label istilah sesuai glosarium §13.
- [ ] Kontras AA di dark **dan** light. Tidak ada `#000`/`#fff` murni.
- [ ] Mobile collapse eksplisit (`< 768px` → 1 kolom, sidebar drawer).
- [ ] Ikon dari Phosphor saja, weight & ukuran standar.
- [ ] Tema halaman terkunci (tidak ada seksi yang membalik dark/light).

---

*Design system ini mengunci "bagaimana". Untuk "apa" dan "kenapa", lihat
`dashboard/PRD.md`. Kalau accent/brand color perlu diganti, ubah hanya token
`--accent*` di `globals.css` — seluruh app ikut.*
