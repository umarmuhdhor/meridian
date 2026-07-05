# Parallel-run harness

Runs the legacy JS daemon and the new TS daemon side-by-side in isolated state
directories with `DRY_RUN=true` on both, then diffs their `decision-log.json`
outputs. This is the last gate before Phase 21 (killing `index.js`).

## What it does

1. Creates `/tmp/meridian-parallel/{js,ts}` (override with
   `MERIDIAN_STATE_DIR_BASE`) and copies `user-config.json` (or the example) into
   each.
2. Boots `node index.js` in `js/` with `DRY_RUN=true`.
3. Boots `node dist/entrypoints/daemon.js` in `ts/` with `MERIDIAN_AUTONOMOUS=true`
   and `MERIDIAN_WRITE_UNSAFE` **unset**. No real chain writes are possible from
   either daemon.
4. Runs for the requested duration (default 86_400s = 24h).
5. On exit, kills both daemons and runs `diff-decisions.mjs` which compares
   decision-log entries by `(type, pool, actor)` bucket.

## Usage

```bash
# One-time build so the TS daemon has a fresh dist/
npm run build

# Run for 24h (default)
./scripts/parallel-run/run-parallel.sh

# Or a shorter smoke run (e.g. 30 min)
./scripts/parallel-run/run-parallel.sh 1800

# Just diff two existing decision-log files
node scripts/parallel-run/diff-decisions.mjs \
  --js /tmp/meridian-parallel/js/decision-log.json \
  --ts /tmp/meridian-parallel/ts/decision-log.json
```

Exit codes for the diff:

| Code | Meaning |
|---:|---|
| 0 | Clean — TS and JS agree on decisions in the window |
| 1 | Discrepancies found (details printed) |
| 2 | I/O or arg error |

## What "clean" means for Phase 21

Every counted decision type (`deploy` / `close` / `skip` / `no_deploy`) matches
between JS and TS within the run window. If TS produced strictly more decisions
than JS in a given type, review the logs to confirm they were consistent
observations (e.g. TS ran an extra screening tick because of cron jitter, not a
different action).

## Only after a clean 24h run

Then, and only then, is Phase 21 safe:

- Delete `index.js`, `agent.js`, `tools/`, `state.js`, `cli.js`, `setup.js`,
  `briefing.js`, `envcrypt.js`, `logger.js`, `discord-listener/`, `pnl.js`,
  `pool-memory.js`, `lessons.js`, `decision-log.js`, `signal-*.js`,
  `strategy-library.js`, `smart-wallets.js`, `token-blacklist.js`,
  `dev-blocklist.js`, `hivemind.js`, `telegram.js`, `config.js`, `prompt.js`,
  `repo-root.js`, `utils/`, `test/`, `scripts/patch-anchor.js`.
- Update `package.json`: `"main": "dist/entrypoints/daemon.js"`, drop the
  `postinstall` hook (Meteora SDK CJS load is inside the TS adapter now), remove
  the `test:screen` / `test:agent` legacy scripts.
- Update `README.md` to point at the TS entrypoints.
- Retain a `legacy-js` git tag pinned to the pre-Phase-21 commit so
  `git checkout legacy-js` restores the safety net.

## Rollback

If TS misbehaves in prod after Phase 21:

```bash
git checkout legacy-js
npm ci
npm start                 # legacy JS daemon
```

Restores the exact pre-cutover behavior. Add a rollback checklist to the release
notes.
