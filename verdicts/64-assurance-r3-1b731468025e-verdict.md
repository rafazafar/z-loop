VERDICT: PASS
TASK: works
BENCH: none
PROFILE: assurance
ROUND: 3
PR: https://github.com/kokoromil/kokolog-monitor/pull/105
BASE_OID: 99305be0790093c80de9a6177d567ec5d6160491
HEAD_OID: 1b731468025ef05856318fdc9ab8b37d0e7493de
expected: all 5 alias acceptance criteria (empty or 1-16 NFC chars, control chars rejected, sensitive-data warning, display-only scope, immediate status publication) plus mobile_monitor, hrm_runtime, and hrm_sdk CI green
observed: widget tests and green CI prove the screen allows empty alias, enforces 1-16 chars, rejects C0/DEL exactly per status.schema.json pattern, shows the warning, and delegates to setCloudStatusAliases; Android and iOS runtimes NFC-normalize, enforce 1-16 code points, and call publishStatusNow on change; alias appears only as display payload fields, never in identity, auth, or sequence
evidence: .git/kokolog-loop/evidence/patch.diff, .git/kokolog-loop/evidence/assurance.json, .git/kokolog-loop/evidence/review-evidence.json, .git/kokolog-loop/evidence/implementation-result.md, apps/mobile_monitor/lib/main.dart, apps/mobile_monitor/test/widget_test.dart, packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/StatusPayloadEncoder.kt, packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/CloudMqttConnection.kt, packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/StatusPayloadEncoder.swift, docs/contracts/schemas/status.schema.json
blockers:
- none
advisories:
- P2 · acceptance · apps/mobile_monitor/lib/main.dart · MobileMonitorShell is exported and widget-tested but never mounted by MobileMonitorApp navigation (_buildScreenForState has no route to it), so the operator cannot reach the alias screen in the composed app; confirm the parent Settings epic (#63) mounts this shell
- P2 · code · apps/mobile_monitor/lib/main.dart:_applyAlias · UI counts grapheme clusters (characters.length) while native counts code points; input with 16 or fewer graphemes but more than 16 code points passes UI, native rejects with a PlatformException that _applyAlias does not catch, so save fails silently with no user feedback
- P3 · code · apps/mobile_monitor/lib/main.dart · local current-alias display keeps the raw non-NFC input while the published alias is NFC-normalized in the runtime, so local display and cloud status display can differ
