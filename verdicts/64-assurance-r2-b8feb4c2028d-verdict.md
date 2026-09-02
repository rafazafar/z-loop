VERDICT: PASS
TASK: works
BENCH: none
PROFILE: assurance
ROUND: 2
PR: https://github.com/kokoromil/kokolog-monitor/pull/105
BASE_OID: b545461e9f184cb71e5e68dd14439821306bed39
HEAD_OID: b8feb4c2028d17cfa1ecde7b248fc9aeea6055b2
expected: Issue 64 - alias set and clear with empty allowed, 1-16 NFC Unicode characters, control characters rejected, sensitive-data warning, display-only alias, immediate status republication; dimensions acceptance, code, security, safety, qms.
observed: App calls real KokologHrmSdk.setCloudStatusAliases via KokologHrmSdk.open; native StatusPayloadEncoder NFC-normalizes, enforces 1-16 code points, rejects control characters, and calls publishStatusNow on change; widget tests cover warning, empty save, set, clear, 16/17 chars, control chars; mobile_monitor Android CI, iOS build, kokolog_hrm_sdk CI, hrm_runtime CI, and Monorepo Merge Gate all SUCCESS.
evidence: .git/kokolog-loop/evidence/patch.diff, .git/kokolog-loop/evidence/assurance.json, .git/kokolog-loop/evidence/review-evidence.json, .git/kokolog-loop/evidence/implementation-result.md, apps/mobile_monitor/lib/main.dart, apps/mobile_monitor/test/widget_test.dart, packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/StatusPayloadEncoder.kt, packages/flutter/hrm_sdk/lib/src/kokolog_hrm_sdk_v1.dart
blockers:
- none
advisories:
- P2 · code · apps/mobile_monitor/lib/main.dart · _applyAlias and _clearAlias do not catch setCloudStatusAliases errors; native NFC or code-point re-validation of input with 16 graphemes but more than 16 code points raises an unhandled PlatformException with no UI feedback.
- P2 · acceptance · apps/mobile_monitor/lib/main.dart · when KokologHrmSdk.open fails, Save and Clear update only local state, so the Current Operational Alias line can show a value never sent to the runtime.
- P3 · code · apps/mobile_monitor/lib/main.dart · Dart validation counts grapheme clusters while native counts code points; align the counts for consistent validation results.
