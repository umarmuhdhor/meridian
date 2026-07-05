#!/usr/bin/env node
/**
 * Compare decision-log.json produced by the legacy JS daemon and the new TS daemon
 * during a parallel DRY_RUN.
 *
 * Usage:
 *   node scripts/parallel-run/diff-decisions.mjs \
 *     --js  /tmp/meridian-parallel/js/decision-log.json \
 *     --ts  /tmp/meridian-parallel/ts/decision-log.json \
 *     [--window-min 1440]    # limit comparison to last N minutes
 *     [--json]               # emit machine-readable diff
 *
 * Exit codes:
 *   0 → clean diff (no material discrepancies)
 *   1 → discrepancies found (details printed)
 *   2 → I/O or argument error
 */
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { js: null, ts: null, windowMin: null, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--js":
        args.js = next;
        i += 1;
        break;
      case "--ts":
        args.ts = next;
        i += 1;
        break;
      case "--window-min":
        args.windowMin = Number(next);
        i += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(String.raw`
Usage: diff-decisions.mjs --js <path> --ts <path> [--window-min N] [--json]

Compares the two decision-log.json snapshots produced by the JS and TS daemons
during a parallel DRY_RUN. Exits 0 on clean diff, 1 on discrepancy, 2 on error.
`);
        process.exit(0);
    }
  }
  return args;
}

function loadDecisions(p) {
  const abs = path.resolve(p);
  const raw = fs.readFileSync(abs, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data?.decisions) ? data.decisions : [];
}

function within(entry, cutoffMs) {
  if (cutoffMs == null) return true;
  const ts = Date.parse(entry.ts ?? "");
  return Number.isFinite(ts) && ts >= cutoffMs;
}

function keyFor(entry) {
  return `${entry.type}|${entry.pool ?? "-"}|${entry.actor ?? "-"}`;
}

function countByType(entries) {
  const out = {};
  for (const e of entries) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

function bag(entries) {
  const out = new Map();
  for (const e of entries) {
    const k = keyFor(e);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function symmetricDiff(aBag, bBag) {
  const keys = new Set([...aBag.keys(), ...bBag.keys()]);
  const rows = [];
  for (const k of keys) {
    const a = aBag.get(k) ?? 0;
    const b = bBag.get(k) ?? 0;
    if (a !== b) rows.push({ key: k, js: a, ts: b, delta: b - a });
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return rows;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.js || !args.ts) {
    process.stderr.write("ERROR: --js and --ts required\n");
    process.exit(2);
  }
  let jsEntries, tsEntries;
  try {
    jsEntries = loadDecisions(args.js);
    tsEntries = loadDecisions(args.ts);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(2);
  }
  const cutoffMs = args.windowMin ? Date.now() - args.windowMin * 60_000 : null;
  jsEntries = jsEntries.filter((e) => within(e, cutoffMs));
  tsEntries = tsEntries.filter((e) => within(e, cutoffMs));

  const jsCounts = countByType(jsEntries);
  const tsCounts = countByType(tsEntries);
  const jsBag = bag(jsEntries);
  const tsBag = bag(tsEntries);
  const rows = symmetricDiff(jsBag, tsBag);
  const clean = rows.length === 0 && jsEntries.length === tsEntries.length;

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          clean,
          totals: { js: jsEntries.length, ts: tsEntries.length },
          countsByType: { js: jsCounts, ts: tsCounts },
          discrepancies: rows,
          window_min: args.windowMin,
        },
        null,
        2,
      ),
    );
    process.stdout.write("\n");
    process.exit(clean ? 0 : 1);
  }

  process.stdout.write("── decision-log diff ──────────────────────────────\n");
  process.stdout.write(`totals: JS=${jsEntries.length}  TS=${tsEntries.length}\n`);
  process.stdout.write(`countsByType (JS): ${JSON.stringify(jsCounts)}\n`);
  process.stdout.write(`countsByType (TS): ${JSON.stringify(tsCounts)}\n`);
  if (clean) {
    process.stdout.write("\n✅ clean — TS and JS agree on decisions\n");
    process.exit(0);
  }
  process.stdout.write("\n❌ discrepancies (key=type|pool|actor):\n");
  for (const r of rows) {
    const sign = r.delta > 0 ? "TS excess" : "JS excess";
    process.stdout.write(
      `  ${r.key.padEnd(60)} JS=${r.js}  TS=${r.ts}  Δ=${r.delta} (${sign})\n`,
    );
  }
  process.exit(1);
}

main();
