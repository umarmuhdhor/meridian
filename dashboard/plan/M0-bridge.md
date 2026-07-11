# M0 — Bridge (fondasi)

> Bridge HTTP zero-dep di dalam daemon. Read endpoint + `POST /tool`, tanpa UI.
> Referensi fakta: [`reference.md`](reference.md). Kontrak API: PRD §8.

## 1. Tujuan & prasyarat

- **Tujuan**: bridge berjalan di dalam proses daemon, bind `127.0.0.1:8787`, token-auth timing-safe, melayani `/health`, `/state/*`, `POST /tool` (allowlist + confirm + in-flight lock). Default OFF.
- **Prasyarat**: tidak ada (milestone pertama).
- **Output**: `dashboard/bridge/{allowlist,auth,inflight,routes,server}.js` + 1 blok di `index.js`.
- **Invariant kunci**: MUST NOT #1 (zero root dep), #4 (127.0.0.1), #5 (token wajib), #8 (jangan import SDK), #10 (handler ringan). MUST #12/#13/#14/#15.

## 2. Tugas per file

- [ ] `dashboard/bridge/allowlist.js` — export `READ_TOOLS`, `WRITE_TOOLS_DASHBOARD`, `FILE_WHITELIST` persis [`reference.md` §3]. Helper `isReadTool/isWriteTool/resolveFile`.
- [ ] `dashboard/bridge/auth.js` — `isAuthorized(req, token)` timing-safe (`crypto.timingSafeEqual`, guard panjang).
- [ ] `dashboard/bridge/inflight.js` — `acquire(name)→bool`, `release(name)`, `isBusy(name)`. `Map` per nama tool.
- [ ] `dashboard/bridge/redact.js` — `redactSecrets(obj)` rekursif, regex `/key|token|secret|mnemonic/i` (dipakai `/state/file/user-config`).
- [ ] `dashboard/bridge/routes.js` — router `/health`, `/state/positions`, `/state/summary`, `/state/file/:name`, `POST /tool`. Import **hanya**: `executeTool` (`../../tools/executor.js`), `getMyPositions` (`../../tools/dlmm.js`), `getStateSummary` (`../../state.js`), `log` (`../../logger.js`). Baca file JSON via `node:fs/promises`.
- [ ] `dashboard/bridge/server.js` — `startBridge({port, token})`: validasi token non-kosong (kalau kosong → `log` warning + `return null`, **jangan** listen), `http.createServer(handler)`, `listen(port, "127.0.0.1")`, return `{ close() }`.
- [ ] `index.js` — blok boot env-gated [§7 reference], satu-satunya edit core.

**Dipakai-ulang (jangan tulis ulang)**: `executeTool`, `getMyPositions`, `getStateSummary`, `log`. Bridge = lem tipis.

## 3. Code skeleton (siap-tempel, ESM, zero-dep)

### `dashboard/bridge/allowlist.js`
```js
export const READ_TOOLS = new Set([
  "get_my_positions","get_position_pnl","get_wallet_balance","get_wallet_positions",
  "get_top_candidates","get_pool_detail","get_active_bin","get_pool_memory",
  "get_recent_decisions","get_performance_history","list_lessons","list_strategies",
  "list_smart_wallets","list_blacklist","list_blocked_deployers","check_smart_wallets_on_pool",
]);
export const WRITE_TOOLS_DASHBOARD = new Set([
  "deploy_position","close_position","claim_fees","swap_token","set_position_note",
  "add_lesson","pin_lesson","unpin_lesson","clear_lessons","add_strategy","remove_strategy",
  "set_active_strategy","update_config","add_to_blacklist","remove_from_blacklist",
  "add_smart_wallet","remove_smart_wallet","block_deployer","unblock_deployer",
]);
// nama :name → file di root repo
export const FILE_WHITELIST = {
  "lessons": "lessons.json", "decision-log": "decision-log.json",
  "pool-memory": "pool-memory.json", "signal-weights": "signal-weights.json",
  "strategy-library": "strategy-library.json", "smart-wallets": "smart-wallets.json",
  "token-blacklist": "token-blacklist.json", "dev-blocklist": "dev-blocklist.json",
  "state": "state.json", "user-config": "user-config.json",
};
export const isReadTool  = (n) => READ_TOOLS.has(n);
export const isWriteTool = (n) => WRITE_TOOLS_DASHBOARD.has(n);
export const isAllowedTool = (n) => isReadTool(n) || isWriteTool(n);   // self_update & lainnya → false
```

### `dashboard/bridge/auth.js`
```js
import { timingSafeEqual } from "node:crypto";

export function isAuthorized(req, token) {
  if (!token) return false;
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;      // timingSafeEqual butuh panjang sama
  return timingSafeEqual(a, b);
}
```

### `dashboard/bridge/inflight.js`
```js
const busy = new Map();
export const isBusy  = (name) => busy.has(name);
export const acquire = (name) => (busy.has(name) ? false : (busy.set(name, true), true));
export const release = (name) => { busy.delete(name); };
```

### `dashboard/bridge/redact.js`
```js
const SECRET = /key|token|secret|mnemonic/i;
export function redactSecrets(v) {
  if (Array.isArray(v)) return v.map(redactSecrets);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SECRET.test(k) ? "[redacted]" : redactSecrets(val);
    }
    return out;
  }
  return v;
}
```

### `dashboard/bridge/routes.js`
```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executeTool } from "../../tools/executor.js";
import { getMyPositions } from "../../tools/dlmm.js";
import { getStateSummary } from "../../state.js";
import { getWalletBalances } from "../../tools/wallet.js";
import { log } from "../../logger.js";
import { isAllowedTool, isWriteTool, FILE_WHITELIST } from "./allowlist.js";
import { acquire, release, isBusy } from "./inflight.js";
import { redactSecrets } from "./redact.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
// rate-limit force positions: max 1×/10s
let _lastForce = 0;

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);                       // throw → caller → 400
}

export async function handleRequest(req, res, startedAt) {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;

  if (req.method === "GET" && p === "/health") {
    return json(res, 200, { ok: true, uptime_sec: Math.round((Date.now() - startedAt) / 1000), daemon: "running", bridge_version: "1" });
  }

  if (req.method === "GET" && p === "/state/positions") {
    let force = url.searchParams.get("force") === "1";
    if (force && Date.now() - _lastForce < 10_000) force = false;   // throttle
    if (force) _lastForce = Date.now();
    const r = await getMyPositions({ force, silent: true }).catch((e) => ({ error: e.message }));
    return json(res, 200, r);
  }

  if (req.method === "GET" && p === "/state/summary") {
    const [summary, bal] = await Promise.all([
      Promise.resolve(getStateSummary()).catch(() => null),
      getWalletBalances().catch(() => null),
    ]);
    return json(res, 200, { summary, balance: bal });
  }

  if (req.method === "GET" && p.startsWith("/state/file/")) {
    const name = p.slice("/state/file/".length);
    const file = FILE_WHITELIST[name];
    if (!file) return json(res, 400, { error: "invalid file name" });
    try {
      const data = JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
      return json(res, 200, name === "user-config" ? redactSecrets(data) : data);
    } catch (e) {
      return json(res, 404, { error: "not found" });
    }
  }

  if (req.method === "POST" && p === "/tool") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid json" }); }
    const { name, args = {}, confirm = false } = body || {};
    if (!name) return json(res, 400, { error: "missing name" });
    if (!isAllowedTool(name)) return json(res, 403, { error: `tool not allowed: ${name}` });
    const write = isWriteTool(name);
    if (write && confirm !== true) return json(res, 403, { error: "confirm required" });
    if (write && !acquire(name)) return json(res, 409, { error: "in-flight", tool: name });
    try {
      if (write) log("dashboard", `tool=${name}`);           // 1 baris; JANGAN logAction (F1)
      const result = await executeTool(name, args);          // audit + notify internal (F1/F2)
      const ok = result?.success !== false && !result?.error && !result?.blocked;
      return json(res, 200, { ok, result });
    } finally {
      if (write) release(name);
    }
  }

  return json(res, 404, { error: "not found" });
}
```

### `dashboard/bridge/server.js`
```js
import http from "node:http";
import { log } from "../../logger.js";
import { isAuthorized } from "./auth.js";
import { handleRequest } from "./routes.js";

export function startBridge({ port = 8787, token } = {}) {
  if (!token) { log("dashboard_warn", "DASHBOARD_TOKEN empty — bridge not started"); return null; }
  const startedAt = Date.now();
  const server = http.createServer(async (req, res) => {
    try {
      if (!isAuthorized(req, token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      await handleRequest(req, res, startedAt);
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); }
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  server.listen(port, "127.0.0.1", () => log("dashboard", `bridge on 127.0.0.1:${port}`));
  return { close: () => new Promise((r) => server.close(r)) };
}
```

### `index.js` — blok boot
Lihat [`reference.md` §7]. Pasang sekali dalam `if (isMain)` sebelum split TTY/non-TTY. `import()` dinamis → tanpa env, file bridge tak pernah di-load. Kegagalan bridge tak menghentikan daemon.

## 4. Peta AC

M0 tidak punya AC bernomor di PRD (fondasi). Kriteria = Definisi selesai PRD §13-M0 (§6 di bawah). AC hilir (AC-PO/FT/…) bergantung pada M0 benar.

## 5. Gotchas

- **F1**: `executeTool` sudah `logAction`. Bridge hanya `log("dashboard", …)` sekali per write — **jangan** `logAction`.
- **F2**: notifikasi Telegram + auto-swap otomatis. Jangan bypass/duplikasi.
- **F3**: lock `agent.js` tak berlaku di bridge → `inflight.js` wajib (409).
- **F4**: `deploy/close/claim/swap` tetap lewat `runSafetyChecks`; blokir = `{ blocked, reason }` diteruskan apa adanya.
- **F6**: jangan interpretasi `{blocked}`/`{error}` sebagai HTTP error — tetap 200 (hasil valid executor). HTTP 4xx hanya untuk kegagalan bridge (auth/allowlist/confirm/inflight/json).
- **F7/#8**: jangan `import "@meteora-ag/dlmm"`. Import `getMyPositions` dari `dlmm.js` aman (lazy-load internal tetap terjaga).
- **#10**: handler async, tidak ada loop sinkron berat. `readFile` file JSON boleh (kecil); jangan parse `logs/*.jsonl` besar di M0.

## 6. Verifikasi (DoD)

Jalankan daemon di terminal terpisah (F8). Perintah (Git Bash / curl):

```bash
# Tanpa env → daemon normal, port 8787 TIDAK terbuka
node index.js
# (di shell lain) curl http://127.0.0.1:8787/health  → connection refused

# Dengan env (DRY_RUN aman)
DASHBOARD_ENABLED=true DASHBOARD_TOKEN=test123 DRY_RUN=true node index.js

curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/health
#   → { "ok": true, "uptime_sec": …, "daemon": "running", "bridge_version": "1" }
curl -s http://127.0.0.1:8787/health
#   → 401 { "error": "unauthorized" }
curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/state/positions
#   → array positions (atau {error} bila RPC gagal — tetap 200)
curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/state/summary
#   → { summary:{…}, balance:{…} }
curl -s -X POST -H "Authorization: Bearer test123" -H "Content-Type: application/json" \
  -d '{"name":"close_position","args":{"position_address":"x"}}' http://127.0.0.1:8787/tool
#   → 403 { "error": "confirm required" }
curl -s -X POST -H "Authorization: Bearer test123" -H "Content-Type: application/json" \
  -d '{"name":"self_update","args":{},"confirm":true}' http://127.0.0.1:8787/tool
#   → 403 { "error": "tool not allowed: self_update" }
curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/state/file/user-config | grep -i apikey
#   → "[redacted]"
curl -s -H "Authorization: Bearer test123" http://127.0.0.1:8787/state/file/../.env
#   → 400 { "error": "invalid file name" }
```

**Selesai bila** semua di atas sesuai + daemon log menampilkan `bridge on 127.0.0.1:8787` + mematikan token (`DASHBOARD_TOKEN=`) → daemon jalan tapi log `bridge not started`.
