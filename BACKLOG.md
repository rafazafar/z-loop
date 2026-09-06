# Later refinements

These are local issues. They do not gate a repository workflow.

- **OPS-01 — Storage retention.** Add a quota, scheduled backups, and safe pruning of terminal evidence. Keep evidence referenced by active or resumable runs. Prove recovery after pruning before enabling it.
- **OPS-02 — Portable restore.** Store relative candidate paths. Add a restore command with manifest validation and an end-to-end restore drill. Current backups restore to the same absolute state path.
- **UI-01 — Large history.** Add server pagination and search across all historical work and events. The console shows the latest 200 work items and 100 events. Full run history is available per work ID.
- **ADAPTER-01 — GitHub issue lifecycle.** Add qualified dependency import, specification revisions, and publication of local refinement issues. Current source imports are immutable snapshots.
- **ADAPTER-02 — Provider routes.** Add measured fallback routes and token-cost accounting. Current controls bound model attempts and provider retries.
- **VALIDATION-01 — Complete.** OpenCode 1.18.25 with `10router/combo-coding` and no variant override passed live code and planning workflows. See LIVE-VERIFICATION.md. Remote GitHub integration still needs a separate live canary.
