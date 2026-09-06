# Single dashboard address — 2026-09-06

The user requested replacement of the standalone dashboard with one manager URL.

- The canonical address is http://127.0.0.1:4188/.
- Port 4189 no longer has a listener.
- `npm start` and `npm run manage` start the manager on port 4188.
- The macOS `dev.z-loop.v2` startup entry now starts the manager. The previous
  entry is retained under the ignored manager state directory for rollback.
- Kokolog monitor was paused with zero running attempts before transfer. Its
  standalone service was stopped normally, and its existing workspace was
  transferred through the manager API with a stable operation key.
- After transfer, the manager reports the repository as managed and healthy.
  Its pause state remains true. No worker was interrupted or started.
- Before-and-after hashes match for all rows in 11 tables: work items, runs,
  steps, attempts, dependencies, operations, decisions, artifacts, automations,
  trigger receipts, and recoveries. The saved runtime configuration also matches.
- Repository CLI status resolves through the manager and reports the expected
  repository ID. Saved repository ports are unchanged; managed API listeners use
  assigned internal ports.
- Type checking passes. All 11 manager/server tests pass on both the development
  Node version and Node 22.22.3 used by the startup service. The new fixture test
  proves that the manager can occupy the saved public port without changing
  repository settings or losing CLI access. See `single-address-tests.log`.

README.md was removed by a concurrent workspace change. That deletion was left
in place; it was not restored or overwritten during this task.
