# M4 — Insight

> Learning/Darwin charts + Logs/Audit viewer + SSE live tick. Optimasi, bukan
> jalur kritis. Chart theming: Design §4.4/§16.3. SSE kontrak: PRD §8.7.

## 1. Tujuan & prasyarat

- **Tujuan**: visualisasi pembelajaran (bobot signal, performance, pool trend), audit log yang bisa di-tail, dan live tick via SSE (menggantikan polling positions saat aktif).
- **Prasyarat**: [M3](M3-scan-deploy.md) lulus. Semua data read sudah tersedia via file JSON + `/state/*`.
- **Invariant kunci**: SSE **MUST NOT** menambah poller/RPC call baru — hanya menumpang PnL poller yang sudah ada (F5, risiko #8). Log tail **MUST NOT** load seluruh file ke memori (#10).

## 2. Tugas per file

### Learning / Darwin (10.8)
- [ ] `app/learning/page.tsx` — 3 panel:
  - **Bobot signal**: bar chart dari `signal-weights.json` (`weights` + `history[]` recalc). Recharts, palet Design §4.4.
  - **Performance**: PnL per close + win-rate trend dari `lessons.json` `performance[]`.
  - **Pool-memory trend**: pilih pool → chart 48-titik snapshot dari `pool-memory.json` (`snapshots[]`).
- [ ] `components/SignalWeightChart.tsx`, `components/PerformanceChart.tsx`, `components/PoolTrendChart.tsx` — semua pakai CSS var untuk warna (jangan hardcode hex), tooltip mono (Design §16.3).

### Logs / Audit (10.9)
- [ ] `app/api/logs/route.ts` — server-side tail `logs/actions-YYYY-MM-DD.jsonl`: baca **N baris terakhir** (streaming/`fs` dari belakang), **MUST NOT** `readFile` seluruh file. Filter query: `tool`, `success`, `minDuration`.
- [ ] `app/logs/page.tsx` — tabel audit: waktu, tool, sukses/gagal, durasi, args ringkas. Filter per tool / sukses-gagal / durasi.

### SSE (8.7)
- [ ] `dashboard/bridge/routes.js` (+`sse.js`) — `GET /events`: `Content-Type: text/event-stream`, heartbeat comment tiap 30s. Event `pnl_tick` (positions+pnl ringkas) + `decision` (entri decision-log baru). Sumber = hasil PnL poller existing (subscribe, bukan poll baru).
- [ ] `index.js` PnL poller — expose hook ringan (emitter) yang bridge bisa subscribe. **Tidak** menambah RPC call; hanya menyiarkan data yang sudah di-fetch poller (`index.js:719–765`).
- [ ] `web/lib/useLiveEvents.ts` — `EventSource('/api/events')` (proxy SSE); saat aktif, matikan `refetchInterval` positions (pakai push). Fallback ke polling bila SSE gagal.
- [ ] `app/api/events/route.ts` — proxy stream ke bridge `/events` (server-side, token disisipkan).

## 3. Code skeleton (pola kunci)

### Tail N baris JSONL (server-side, tanpa load penuh)
```ts
import { open, stat } from "node:fs/promises";
export async function tailLines(file: string, n = 200): Promise<string[]> {
  const { size } = await stat(file);
  const chunk = Math.min(size, 64 * 1024 * Math.ceil(n / 200));  // baca dari ekor
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(chunk);
    await fh.read(buf, 0, chunk, Math.max(0, size - chunk));
    return buf.toString("utf8").split("\n").filter(Boolean).slice(-n);
  } finally { await fh.close(); }
}
// parse tiap baris JSON.parse dengan try/catch; abaikan baris rusak.
```

### SSE bridge (menumpang poller, bukan poll baru)
```js
// routes.js — GET /events
res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
const hb = setInterval(() => res.write(": ping\n\n"), 30_000);
const onTick = (data) => res.write(`event: pnl_tick\ndata: ${JSON.stringify(data)}\n\n`);
pnlEmitter.on("tick", onTick);                         // emitter di-set index.js poller
req.on("close", () => { clearInterval(hb); pnlEmitter.off("tick", onTick); });
```

### `web/lib/useLiveEvents.ts`
```ts
"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function useLiveEvents(enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/events");
    es.addEventListener("pnl_tick", (e) => qc.setQueryData(["positions"], JSON.parse((e as MessageEvent).data)));
    es.addEventListener("decision", () => qc.invalidateQueries({ queryKey: ["decision-log"] }));
    es.onerror = () => es.close();                     // fallback: polling tetap jalan bila SSE mati
    return () => es.close();
  }, [enabled, qc]);
}
```

## 4. Peta AC

| AC | Dipenuhi oleh |
|---|---|
| AC-LD.1 bobot tampil identik `signal-weights.json` | `SignalWeightChart` baca file langsung, tanpa transform yang mengubah nilai |
| AC-LG.1 aksi dashboard muncul di audit | `app/logs/page.tsx` tail `actions-*.jsonl` (bukti F1) |

## 5. Gotchas

- **#8 (SSE RPC)**: `/events` HANYA menyiarkan data PnL poller yang sudah ada. Jangan panggil `getMyPositions`/RPC di handler SSE. Uji: aktifkan SSE, pantau log daemon — jumlah RPC call tidak naik.
- **#10 (log memori)**: tail dari ekor file, batasi N baris. Jangan `readFile` file harian penuh (bisa besar). Satu file per hari (`actions-YYYY-MM-DD.jsonl`).
- **Chart**: warna dari CSS var (`--chart-*`, `--profit`, `--loss`), grid 1px `--border`, tooltip `--surface-3` + mono. PnL/tren warnai by-value; kategorikal pakai ramp §4.4. Jangan angka fake-presisi — kalau data kosong → empty state.
- **SSE fallback**: bila `EventSource` gagal, polling M1 (10s) tetap jalan. SSE = optimasi, bukan pengganti wajib.
- **Emitter di poller**: perubahan `index.js` untuk emitter harus tetap di dalam gate `DASHBOARD_ENABLED` atau no-op saat bridge mati — jangan bebani poller saat dashboard off.

## 6. Verifikasi (DoD)

1. **Learning**: bar chart bobot = isi `signal-weights.json` (banding manual, AC-LD.1). Performance & pool-trend chart tampil; empty state saat data kosong.
2. **Logs**: aksi yang baru dilakukan dari dashboard muncul di tabel audit (AC-LG.1). Filter tool/sukses/durasi bekerja. File besar tidak bikin halaman lambat (tail, bukan full-load).
3. **SSE**: aktifkan → positions update via push (bukan polling); cek log daemon RPC call **tidak** bertambah dibanding tanpa SSE. Matikan bridge/SSE → fallback polling tetap jalan.
