# M5 — Chat

> Chatbot in-dashboard: tanya-jawab ke agent (apa yang dipelajari, posisi, PnL,
> alasan keputusan) + (fase B) memerintah aksi lewat chat. **Otak = `agentLoop`
> GENERAL yang sudah ada** — sama persis dengan chatbot Telegram. Kita cuma
> menambah "mulut & telinga" versi web. Streaming pakai pola SSE existing (§8.7).

---

## 1. Tujuan & prasyarat

- **Tujuan**: halaman `/chat` di dashboard yang memanggil `agentLoop(..., "GENERAL", ...)`
  ([agent/agent.js:157](../../agent/agent.js)), menampilkan jawaban natural +
  jejak tool live (`onToolStart`/`onToolFinish`), persis seperti live message
  Telegram ([index.js:1658](../../index.js)).
- **Prasyarat**: M0–M4 lulus. Bridge + Next proxy + pola SSE (`/api/events`) sudah jalan.
- **Invariant kunci**:
  - **F1 (audit)**: setiap tool tetap lewat `executeTool` → `logAction` otomatis. Bridge **MUST NOT** panggil `logAction` (dobel).
  - **F7/#8 (lazy SDK)**: `import { agentLoop }` di bridge **AMAN** — `agent.js` tidak eager-import `@meteora-ag/dlmm`. Jangan tambah import SDK.
  - **#6 (token)**: token LLM & bridge tidak boleh sampai browser. Streaming di-proxy server-side.
  - **Keamanan write**: fase A **read-only by construction** (lihat §3). Aksi write baru di fase B, tetap lewat confirm-gate M2.
  - **Core touch**: fase A butuh **satu tambahan additive & backward-compatible** di `agent.js` (`options.allowedTools`) — bukan perubahan trading logic. `index.js` **tidak** disentuh.

---

## 2. Arsitektur (reuse otak, tambah mulut-telinga)

```
Browser  /chat  ──POST /api/chat──►  Next route (nodejs)  ──POST /chat──►  Bridge (dalam daemon)
   ▲   (messages + history)          (sisipkan Bearer token)               agentLoop("GENERAL", {onToolStart,onToolFinish})
   │                                                                              │  streaming SSE frames
   └──────────────  stream (tool events + jawaban final)  ◄───────────────────────┘
```

- **Transport**: bridge `POST /chat` balas `text/event-stream` (frame SSE), Next route passthrough `upstream.body` + sisip token (sama seperti [api/events/route.ts](../../dashboard/web/app/api/events/route.ts) tapi POST). Klien baca via `fetch()` + `ReadableStream` reader (bukan `EventSource`, karena butuh POST body).
- **History**: klien simpan messages di React state; kirim ~10 terakhir sebagai `history` (shape OpenAI `{role, content}`, cocok dengan `sessionHistory` di [agent.js:120](../../agent/agent.js)). Bridge **stateless** — tidak menyimpan sesi.
- **Frame SSE** (NDJSON di `data`):
  - `event: tool` `data: {"phase":"start","name":"get_my_positions"}`
  - `event: tool` `data: {"phase":"finish","name":"get_my_positions","success":true}`
  - `event: done` `data: {"content":"<jawaban final, sudah stripThink>"}`
  - `event: error` `data: {"message":"..."}`

---

## 3. Keputusan keamanan (BACA DULU)

`agentLoop` GENERAL memfilter tool via intent-match ([agent.js:70](../../agent/agent.js)) — dan intent seperti `close`/`deploy`/`swap` **mengekspos tool write**. Jadi kalau chat memanggil agentLoop apa adanya, LLM bisa `close_position`/`deploy_position` langsung (setara Telegram), **melewati confirm-gate dashboard** (M2: allowlist + `confirm:true` + in-flight lock).

**Rekomendasi (dipakai plan ini): 2 fase.**

| Fase | Chat bisa apa | Cara jaga write | Core touch |
|---|---|---|---|
| **A (MVP)** | Jawab semua (learned, posisi, PnL, decisions, "kenapa X") — **read-only** | `allowedTools = READ_TOOLS` diteruskan ke agentLoop → LLM **tak punya** tool write | +1 additive di `agent.js` |
| **B (upgrade)** | Merekomendasi aksi → tombol "Confirm" di UI → jalur `/api/tool` M2 | Write tetap lewat **confirm-gate M2** (allowlist + lock) | tidak ada (reuse M2) |

Alternatif kalau kamu **menerima setara-Telegram** (LLM eksekusi langsung dari chat, tanpa confirm): lewati `agent.js` change, panggil agentLoop apa adanya, dan set `allowWrites` di `/chat`. **Tidak direkomendasikan** — melanggar postur keamanan dashboard.

> Plan ini menuliskan **Fase A lengkap** (siap eksekusi) + **Fase B sebagai ekstensi** (§6).

---

## 4. Tugas per file (Fase A — read-only ask chat)

### Core (1 tambahan additive, backward-compatible)
- [ ] `agent/agent.js` — `getToolsForRole(agentType, goal, allowedTools = null)`: kalau `allowedTools` diisi (Set nama tool), **intersect** hasil filter role dengan set itu. Default `null` → perilaku lama persis. Baca `options.allowedTools` di `agentLoop` dan teruskan ke pemanggilan [agent.js:210](../../agent/agent.js).

### Bridge
- [ ] `dashboard/bridge/allowlist.js` — export `CHAT_READ_TOOLS` (reuse `READ_TOOLS` + tool baca GENERAL: `get_recent_decisions`, `get_performance_history`, `list_lessons`, `list_strategies`, `list_smart_wallets`, `list_blacklist`, `list_blocked_deployers`, `get_pool_memory`, `search_pools`, `get_token_*`, `discover_pools`). Semua **read-only**.
- [ ] `dashboard/bridge/routes.js` — handler `POST /chat`: baca `{ message, history }`, panggil `agentLoop` GENERAL dengan `allowedTools`, stream frame SSE via `onToolStart`/`onToolFinish`, akhiri `done`. Guard: `message` wajib string non-kosong; batasi `history` ke ~10 entri.
- [ ] `dashboard/bridge/routes.js` — `import { agentLoop } from "../../agent/agent.js"` (aman, non-SDK) + helper `stripThink`.

### Web
- [ ] `dashboard/web/app/api/chat/route.ts` — `POST` proxy: teruskan body ke bridge `/chat`, sisip Bearer, `runtime="nodejs"`, passthrough `upstream.body` sebagai `text/event-stream`.
- [ ] `dashboard/web/lib/useChat.ts` — hook klien: kirim `fetch("/api/chat", {method:"POST", body})`, baca stream, parse frame SSE, expose `{messages, send, streaming, toolTrace}`.
- [ ] `dashboard/web/app/chat/page.tsx` — UI: daftar pesan (user/assistant), composer (textarea + submit, Enter kirim / Shift+Enter newline), panel tool-trace live, empty-state + saran prompt ("Apa yang kamu pelajari?", "Posisi aku gimana?").
- [ ] `dashboard/web/components/ChatMessage.tsx` + `ChatComposer.tsx` (opsional pisah komponen).
- [ ] `dashboard/web/components/nav.ts` — tambah item `{ href:"/chat", label:"Chat", icon: ChatCircle }` (`ChatCircle`/`ChatDots` dari `@phosphor-icons/react`).

### Env
- **Tidak ada var baru.** Reuse `BRIDGE_URL`/`BRIDGE_TOKEN` (web) + `DASHBOARD_*` (daemon) + `LLM_API_KEY`/`OPENROUTER_API_KEY` (sudah dipakai agentLoop).

---

## 5. Code skeleton (pola kunci)

### 5.1 `agent/agent.js` — filter additive (satu-satunya core touch)
```js
// ganti signature + body
function getToolsForRole(agentType, goal = "", allowedTools = null) {
  const clamp = (list) => (allowedTools ? list.filter((t) => allowedTools.has(t.function.name)) : list);

  if (agentType === "MANAGER")  return clamp(tools.filter((t) => MANAGER_TOOLS.has(t.function.name)));
  if (agentType === "SCREENER") return clamp(tools.filter((t) => SCREENER_TOOLS.has(t.function.name)));

  const matched = new Set();
  for (const { intent, re } of INTENT_PATTERNS) if (re.test(goal)) for (const t of INTENT_TOOLS[intent]) matched.add(t);

  if (matched.size === 0) return clamp(tools.filter((t) => !GENERAL_INTENT_ONLY_TOOLS.has(t.function.name)));
  return clamp(tools.filter((t) => matched.has(t.function.name)));
}

// di agentLoop(...) baca opsi:
const { interactive = false, onToolStart = null, onToolFinish = null, allowedTools = null } = options;
// dan di call site (agent.js:210):
tools: getToolsForRole(agentType, goal, allowedTools),
```
> `allowedTools=null` → identik perilaku lama. Aman untuk MANAGER/SCREENER/Telegram.

### 5.2 `dashboard/bridge/routes.js` — `POST /chat` (streaming)
```js
import { agentLoop } from "../../agent/agent.js";       // non-SDK, lazy-load tetap utuh (F7)
import { CHAT_READ_TOOLS } from "./allowlist.js";
import { config } from "../../config.js";

const stripThink = (t = "") => String(t).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// di handleRequest():
if (req.method === "POST" && p === "/chat") {
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid json" }); }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json(res, 400, { error: "missing message" });
  const history = Array.isArray(body?.history)
    ? body.history.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-10)
    : [];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 20_000);
  req.on("close", () => clearInterval(hb));

  try {
    const { content } = await agentLoop(
      message, config.llm.maxSteps, history, "GENERAL", config.llm.generalModel, null,
      {
        allowedTools: CHAT_READ_TOOLS,                       // ← read-only by construction (Fase A)
        onToolStart:  ({ name })            => sse(res, "tool", { phase: "start",  name }),
        onToolFinish: ({ name, success })   => sse(res, "tool", { phase: "finish", name, success }),
      },
    );
    sse(res, "done", { content: stripThink(content) });
  } catch (e) {
    sse(res, "error", { message: e?.message || "chat failed" });
  } finally {
    clearInterval(hb);
    res.end();
  }
  return; // stream sudah di-end
}
```

### 5.3 `dashboard/bridge/allowlist.js` — set read untuk chat
```js
export const CHAT_READ_TOOLS = new Set([
  ...READ_TOOLS,                        // get_my_positions, get_position_pnl, get_wallet_*, get_top_candidates, ...
  "get_recent_decisions", "get_performance_history", "list_lessons", "list_strategies",
  "list_smart_wallets", "list_blacklist", "list_blocked_deployers",
  "get_pool_memory", "search_pools", "discover_pools",
  "get_token_info", "get_token_holders", "get_token_narrative",
  "study_top_lpers", "get_top_lpers",
]);
// CATATAN: jangan masukkan deploy/close/claim/swap/update_config/add_*/remove_* (write).
```

### 5.4 `dashboard/web/app/api/chat/route.ts` — proxy streaming (token server-side)
```ts
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE = process.env.BRIDGE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.BRIDGE_TOKEN ?? "";
const SSE = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" };

export async function POST(req: NextRequest) {
  let payload: unknown;
  try { payload = await req.json(); } catch { return new Response("event: error\ndata: {\"message\":\"invalid json\"}\n\n", { status: 200, headers: SSE }); }
  try {
    const upstream = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: req.signal,           // klien tutup → abort upstream
    });
    if (!upstream.ok || !upstream.body) return new Response(`event: error\ndata: {"message":"bridge ${upstream.status}"}\n\n`, { status: 200, headers: SSE });
    return new Response(upstream.body, { status: 200, headers: SSE });
  } catch (e) {
    return new Response(`event: error\ndata: ${JSON.stringify({ message: (e as Error).message })}\n\n`, { status: 200, headers: SSE });
  }
}
```

### 5.5 `dashboard/web/lib/useChat.ts` — baca stream, parse frame SSE
```ts
"use client";
import { useCallback, useRef, useState } from "react";

export interface ChatMsg { role: "user" | "assistant"; content: string }
export interface ToolEvt { name: string; done: boolean; success?: boolean }

export function useChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [toolTrace, setToolTrace] = useState<ToolEvt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || streaming) return;
    setError(null); setToolTrace([]);
    const history = messages.slice(-10);
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setStreaming(true);
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history }),
        signal: abort.current.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n"); buf = frames.pop() ?? "";
        for (const f of frames) {
          const ev = /^event:\s*(.+)$/m.exec(f)?.[1];
          const dm = /^data:\s*(.+)$/m.exec(f)?.[1];
          if (!ev || !dm) continue;                          // lewati komentar ": ping"
          const data = JSON.parse(dm);
          if (ev === "tool") {
            setToolTrace((t) =>
              data.phase === "start"
                ? [...t, { name: data.name, done: false }]
                : t.map((x) => (x.name === data.name && !x.done ? { ...x, done: true, success: data.success } : x)),
            );
          } else if (ev === "done") {
            setMessages((m) => [...m, { role: "assistant", content: data.content || "(kosong)" }]);
          } else if (ev === "error") {
            setError(data.message || "chat error");
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setStreaming(false); abort.current = null;
    }
  }, [messages, streaming]);

  const stop = useCallback(() => abort.current?.abort(), []);
  return { messages, send, stop, streaming, toolTrace, error };
}
```

### 5.6 `dashboard/web/app/chat/page.tsx` — UI (ringkas)
```tsx
"use client";
import { useChat } from "@/lib/useChat";
import { useState } from "react";

const SUGGEST = ["Apa yang sudah kamu pelajari?", "Posisi aku sekarang gimana?", "Kenapa kamu nggak deploy tadi?", "Ringkas performa 24 jam terakhir"];

export default function ChatPage() {
  const { messages, send, streaming, toolTrace, error } = useChat();
  const [input, setInput] = useState("");
  const submit = () => { send(input); setInput(""); };

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-9rem)]">
      <div className="flex-1 overflow-y-auto flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGEST.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-fg">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "self-end max-w-[80%]" : "self-start max-w-[85%]"}>
            <div className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-accent/15 text-fg" : "bg-surface-2 text-fg"}`}>{m.content}</div>
          </div>
        ))}
        {streaming && (
          <div className="self-start text-xs text-muted font-mono">
            {toolTrace.length === 0 ? "berpikir…" : toolTrace.map((t) => `${t.done ? (t.success ? "✅" : "❌") : "⏳"} ${t.name}`).join("  ")}
          </div>
        )}
        {error && <div className="self-start text-sm text-loss">⚠️ {error}</div>}
      </div>
      <div className="flex gap-2 border-t border-border pt-3">
        <textarea
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Tanya apa saja… (Enter kirim, Shift+Enter baris baru)"
          rows={1} disabled={streaming}
          className="flex-1 resize-none rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button onClick={submit} disabled={streaming || !input.trim()} className="rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50">Kirim</button>
      </div>
    </div>
  );
}
```
> Sesuaikan nama util warna (`bg-surface-2`, `text-muted`, `text-loss`, `border-border`, `bg-accent`) ke token yang ada di Design.md/`globals.css` proyek.

---

## 6. Fase B (opsional) — memerintah aksi lewat chat, tetap aman

Tujuan: user bisa bilang "tutup posisi #2" dan chat **mengeksekusi** — tapi lewat confirm-gate M2, bukan bypass.

**Pola "propose → confirm" (direkomendasikan, zero extra core risk):**
1. Chat tetap read-only (Fase A). Prompt sistem/UI diarahkan agar saat user minta aksi, LLM **mengembalikan usulan terstruktur** di akhir jawaban, mis. blok:
   `ACTION: {"tool":"close_position","args":{"position":"<addr>"},"label":"Tutup SOL/BONK #2"}`.
2. `useChat` parse blok `ACTION` dari `done.content` → render **tombol** di bawah pesan.
3. Klik tombol → buka `ConfirmModal` (komponen M2) → `POST /api/tool { name, args, confirm:true }` (jalur write M2: allowlist + in-flight lock + audit). **Tidak** menyentuh `/chat`.

> Ini memenuhi "user bisa memerintah lewat chat" **tanpa** melemahkan keamanan: eksekusi write tetap 100% lewat pipa M2 yang sudah di-QA.

**Alternatif "armed chat" (setara Telegram, lebih berisiko):** tambah `CHAT_WRITE_TOOLS` + flag `allowWrites` pada `/chat`; saat ON, `allowedTools = CHAT_READ ∪ CHAT_WRITE` dan wajib in-flight lock (`acquire("chat")`/`release`) agar tidak bentrok dengan cron. Confirm-gate hilang. Pakai hanya jika kamu sadar trade-off-nya.

---

## 7. Gotchas

- **F1 (audit dobel)**: `/chat` **jangan** panggil `logAction`. `executeTool` di dalam agentLoop sudah menulis audit. Bridge cukup 1 baris `log("dashboard", "chat")` bila mau.
- **F7/#8 (SDK)**: `import { agentLoop }` OK. Jangan `import` `@meteora-ag/dlmm` atau apa pun yang meng-eager-load-nya. `agent.js` → `dlmm.js` `getMyPositions` tetap lazy.
- **Read-only Fase A**: kalau `agent.js` change tidak dipasang, `allowedTools` diabaikan → LLM bisa dapat tool write. **Wajib** pasang §5.1 sebelum menganggap chat read-only.
- **Concurrency**: Fase A read-only aman jalan barengan cron (baca + cache). Fase B (write) **wajib** in-flight lock ([bridge/inflight.js](../../dashboard/bridge/inflight.js)) supaya tak bentrok dengan management/screening yang menulis `state.json`.
- **Streaming timeout**: heartbeat `: ping` tiap 20s cegah idle-timeout proxy. Next `runtime="nodejs"` (bukan edge) supaya stream Node lewat. `agentLoop` bisa lama (multi-step) — jangan set timeout pendek di `/api/chat`.
- **stripThink**: model bisa keluarkan `<think>…</think>`. Strip di bridge sebelum `done` (skeleton sudah). Jangan tampilkan mentah.
- **History besar**: batasi 10 entri (`slice(-10)`) sebelum kirim — cocok dengan `MAX_HISTORY=20` di daemon, cegah prompt membengkak.
- **Klien tutup tab**: `req.signal` di `/api/chat` + `req.on("close")` di bridge → hentikan stream. agentLoop yang sudah jalan tak bisa dibatalkan tengah jalan, tapi frame berikutnya berhenti ditulis.
- **Build sandbox**: sandbox dev tak bisa `next build`/`tsc` (cap ~400MB). Verifikasi pakai static-check; build final di environment kamu.

---

## 8. Verifikasi (DoD)

**Fase A:**
1. Jalankan daemon `DASHBOARD_ENABLED=true DASHBOARD_TOKEN=… node index.js` + web `npm run dev`. Buka `/chat`.
2. Tanya "posisi aku gimana?" → muncul jejak `⏳ get_my_positions → ✅`, lalu jawaban natural. Sama untuk "apa yang kamu pelajari?" (`list_lessons`), "kenapa nggak deploy?" (`get_recent_decisions`).
3. **Uji keamanan**: minta "tutup semua posisi" → LLM **tidak** mengeksekusi (tak punya `close_position`); jawaban menjelaskan/menolak atau menyarankan lewat halaman Positions. Cek `logs/actions-*.jsonl` → **tidak** ada `close_position` dari sesi chat.
4. Matikan daemon → `/chat` tampilkan error rapi (bukan crash), halaman lain (static) tetap jalan.
5. Regресi: `agentLoop` MANAGER/SCREENER + chatbot Telegram **tetap** jalan normal (bukti `allowedTools=null` tak mengubah apa pun).

**Fase B (bila dikerjakan):**
6. "tutup posisi #2" → chat tampilkan tombol usulan → klik → ConfirmModal → eksekusi lewat `/api/tool` → posisi tertutup, muncul di audit + notifikasi Telegram (bukti jalur M2 utuh).

---

## 9. Checklist eksekusi (urутan)

1. [ ] `agent/agent.js` — pasang `allowedTools` (§5.1). Uji cepat: Telegram/REPL masih normal.
2. [ ] `dashboard/bridge/allowlist.js` — `CHAT_READ_TOOLS` (§5.3).
3. [ ] `dashboard/bridge/routes.js` — `POST /chat` + import agentLoop + stripThink (§5.2).
4. [ ] `dashboard/web/app/api/chat/route.ts` — proxy (§5.4).
5. [ ] `dashboard/web/lib/useChat.ts` — hook (§5.5).
6. [ ] `dashboard/web/app/chat/page.tsx` (+ komponen bila mau) — UI (§5.6).
7. [ ] `dashboard/web/components/nav.ts` — item "Chat".
8. [ ] Static-check + jalankan → DoD §8 (Fase A).
9. [ ] (Opsional) Fase B: parse `ACTION` + tombol confirm (§6).
