VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 3
PR: https://github.com/kokoromil/kokolog-monitor/pull/104
BASE_OID: 99305be0790093c80de9a6177d567ec5d6160491
HEAD_OID: 7504afe4ed5b7247b1c14d043f2fa4c9d7ad5e06
expected: all 5 acceptance criteria (operational-only log categories, clearly operational history, retention 90-1000 days default 180, automatic purge plus bounded capacity, PHI and credential exclusion) with relevant mobile_monitor CI green
observed: code and tests implement the criteria and local analyze and test pass, but required CI on the changed scope failed - mobile_monitor Android CI FAILURE at 2026-09-02T17:57:11Z and Monorepo Merge Gate FAILURE at 2026-09-02T17:57:19Z, while the iOS build passed
evidence: .git/kokolog-loop/evidence/patch.diff, .git/kokolog-loop/evidence/review-evidence.json, .git/kokolog-loop/evidence/assurance.json, .git/kokolog-loop/evidence/implementation-result.md
blockers:
- P1 · acceptance · CI: mobile_monitor Android CI plus Monorepo Merge Gate · the required analyze+test+build job for the changed app scope concluded FAILURE and the merge gate then failed, so this change cannot be released under merge_policy human with a red gate · diagnose and fix the mobile_monitor Android CI failure and re-run until the Monorepo Merge Gate passes
advisories:
- P2 · safety · apps/mobile_monitor/lib/main.dart _openOperationalLogs · default log store writes under Directory.systemTemp, which mobile OSes may purge at will, silently losing logs the retention setting promises to keep · use an app documents or support directory
- P2 · security · apps/mobile_monitor/lib/src/logs/operational_log_entry.dart · sanitization is a metadata-key blocklist only; the free-text message and values under allowed keys are unfiltered, so a future caller can log PHI or credentials · prefer an allowlist plus value scanning
- P2 · code · apps/mobile_monitor/lib/src/logs/operational_log_service.dart · OperationalLogService.log has no production call sites; operational history stays empty in real use · wire application, BLE, MQTT, lifecycle, and error events
- P2 · code · apps/mobile_monitor/lib/src/logs/operational_log_store.dart · appendEntry and getHistory re-stat and fully re-read every day file on each call, O(n) IO per log write up to the 50MB ceiling · cache day summaries or maintain a manifest
- P3 · qms · apps/mobile_monitor/pubspec.yaml · path ^1.9.0 is declared but never imported anywhere in mobile_monitor; unused SOUP dependency · remove it
- P3 · safety · apps/mobile_monitor/lib/src/logs/retention_settings.dart · 90..1000 enforcement is assert-only and is stripped from release builds; runtime clamping exists only in fromJson · add non-assert validation
- P3 · code · .gitignore · logs/ was narrowed to /logs/, un-ignoring nested logs directories that runtime log stores could create · confirm intent or scope the ignore rule
