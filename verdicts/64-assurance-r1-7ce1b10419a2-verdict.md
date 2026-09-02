VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/105
BASE_OID: b545461e9f184cb71e5e68dd14439821306bed39
HEAD_OID: 7ce1b10419a224aace29f201052f5515f670c559
expected: Issue 64 AC1-AC5: set/clear alias with empty or 1-16 NFC characters, control characters rejected, sensitive-data warning, display-only semantics, immediate status publication on change; required mobile_monitor CI green (acceptance, code, qms, safety, security).
observed: Screen validates length and C0+DEL control chars and delegates to an injected KokologHrmSdk, but production main() constructs MobileMonitorApp with sdk null, so Save and Clear are silent no-ops that still display a saved alias and never publish status; native runtime enforces NFC, 16 code points, control chars and publishStatusNow yet is never invoked by the app; mobile_monitor Android CI and Monorepo Merge Gate FAILED at HEAD.
evidence: .git/kokolog-loop/evidence/patch.diff, .git/kokolog-loop/evidence/assurance.json, .git/kokolog-loop/evidence/review-evidence.json, .git/kokolog-loop/evidence/implementation-result.md, apps/mobile_monitor/lib/main.dart, apps/mobile_monitor/pubspec.yaml, apps/mobile_monitor/test/widget_test.dart, pubspec.yaml, apps/hrm_soak_tester/lib/main.dart, packages/flutter/hrm_sdk/lib/src/kokolog_hrm_sdk_v1.dart, packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/StatusPayloadEncoder.kt, packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/StatusPayloadEncoder.swift
blockers:
- P1 · acceptance · apps/mobile_monitor/lib/main.dart (main, _applyAlias, _clearAlias) · Production entrypoint runs MobileMonitorApp with sdk null, so Save/Clear never call KokologHrmSdk.setCloudStatusAliases; an alias change causes no status publication (AC5 unmet) while the UI shows Current Operational Alias as saved and loses it on restart; only mock-injected widget tests exercise the SDK path · Wire a real SDK instance via KokologHrmSdk.open as apps/hrm_soak_tester/lib/main.dart does, or disable Save and show a runtime-unavailable state instead of a fake saved confirmation
- P1 · qms · CI mobile_monitor Android CI and Monorepo Merge Gate · Required checks for the changed app FAILED at HEAD 7ce1b10419a224aace29f201052f5515f670c559 (review-evidence.json, workflow run 33652158859, jobs 100321676184 and 100323909988), so the release gate is red despite implementer-local green tests · Diagnose and fix the mobile_monitor Android CI (analyze + test + build) failure at this HEAD, or document an environmental flake with a green re-run at the same HEAD
advisories:
- P2 · code · apps/mobile_monitor/lib/main.dart (_validateAlias, _applyAlias) · UI counts grapheme clusters while the native schema counts code points, so an alias of 16 graphemes spanning more than 16 code points passes the UI check and then the native require throws an unhandled exception with no user feedback and no state update; align the UI check to NFC code-point count and catch SDK errors in _applyAlias and _clearAlias
- P2 · security · apps/mobile_monitor/lib/main.dart and packages/flutter/hrm_runtime StatusPayloadEncoder.kt/.swift · Control-character rejection covers only C0 plus DEL; C1 controls U+0080-U+009F and Cf format characters such as U+202E are accepted into the display-only alias on both platforms
- P3 · code · apps/mobile_monitor/lib/main.dart (_savedAlias) · Current-alias display is a local echo with no read-back of the runtime alias, so it shows unset after app restart
