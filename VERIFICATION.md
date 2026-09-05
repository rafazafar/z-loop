# Build verification — 2026-09-06

The single-host implementation passed its local validation on macOS with
Node.js 22.22.3. The runtime and dashboard use the same SQLite state.

| Check | Result | Evidence |
|---|---|---|
| `npm run check` | Exit 0 | [Type check](verification/typecheck.log) |
| `npm test` | Exit 0; 42 passed, 0 failed | [Test output](verification/tests.log) |
| `npm run demo` | Exit 0; one repair, then successful integration | [Demo](verification/demo.log) |
| `node --check web/app.js` and `web/forms.js` | Exit 0 | Browser execution also passed |
| Actual Chrome flows | Settings, automation, work, dependency, evidence, health, backup passed | [Browser record](verification/browser.md) |
| Restarted preview service | Healthy; paused; three completed work items | [State evidence](verification/dashboard.json) |

The tests cover transactional rollback, stale ownership, controller loss,
receipt adoption, absent receipts, command supervision, repair, retry exhaustion,
dependencies, provider budgets, external decisions, delayed refinements,
automation deduplication, publication reconciliation, changed base revisions,
evidence corruption, configuration draining and persistence, backups, and API
authentication. All repository mutations used temporary or disposable fixtures.

The demo deliberately produced answer 41. Verification rejected it. The loop
then produced answer 42, repeated verification and review, integrated the candidate,
and independently observed completion. The failed check remains `rejected` in history.

No paid worker request or live GitHub write was made. The GitHub tests use fake
responses. The CI workflow is included, but has not run on a hosted runner.
A real-model canary remains an adoption step. This build does not certify model
quality, hostile-code containment, host failover, or long-term storage retention.

The paused fixture preview is available at http://127.0.0.1:4198/ while the preview
process runs. Its demonstration token is `fixture-preview`. It is configured only
for a disposable repository. To recreate it, run `npm run demo`, then pass the printed
state path to `node --experimental-strip-types scripts/preview.ts STATE_PATH`.
