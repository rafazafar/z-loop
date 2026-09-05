# Later refinements

These are local issues. They do not gate a repository workflow.

- **OPS-01 — Storage retention.** Add a quota, scheduled backups, and safe pruning of terminal evidence. Keep evidence referenced by active or resumable runs. Prove recovery after pruning before enabling it.
- **OPS-02 — Portable restore.** Store relative candidate paths. Add a restore command with manifest validation and an end-to-end restore drill. Current backups restore to the same absolute state path.
- **UI-01 — Large history.** Add server pagination and search across all historical work and events. The console shows the latest 200 work items and 100 events. Full run history is available per work ID.
- **ADAPTER-01 — GitHub issue lifecycle.** Add qualified dependency import, specification revisions, and publication of local refinement issues. Current source imports are immutable snapshots.
- **ADAPTER-02 — Provider routes.** Add measured fallback routes and token-cost accounting. Current controls bound model attempts and provider retries.
- **VALIDATION-01 — Real worker canary.** Run a bounded task in a disposable repository with the intended model and credentials. Record request, result, cost, and independent acceptance evidence before continuous client use.
