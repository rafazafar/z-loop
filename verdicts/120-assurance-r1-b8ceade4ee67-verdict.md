VERDICT: PASS
TASK: works
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/126
BASE_OID: 3d100dea6cdf0d95742b2a525807f2faa037e430
HEAD_OID: b8ceade4ee6762f4575d205cca11d740e2712b06
expected: AC1 start/stop supervision for registered devices via SDK public API; AC2 per-device connected/connecting/disconnected display (SR-MON-205); AC3 distinct operator guidance for bluetooth-off, scan-restricted, permission, terminal states (SR-MON-106); AC4 no BLE scan/connect/reconnect/backoff logic in app layer (ARD018); dimensions: acceptance, code, safety, security.
observed: Patch wires _syncSupervision through startSupervision/stopSupervision on the SDK facade at init, snapshot events, lifecycle resume, pause/resume, and dispose; SDK close() itself also stops supervision so teardown is safe; DeviceConnectionState mapping renders the three states as lane/context badges, device-info row, and ConnectingScreen list, covered by 11 new widget tests; SR-MON-106 guidance pre-exists in monitor_app_reducer.dart and ActionRequiredScreen and is untouched; sdk_public_boundary_test.dart enforces ARD018 imports; recorded local objective checks: flutter analyze exit 0 and flutter test 146/146 at head b8ceade; CI gate waived by owner for billing outage, identical failure set on base.
evidence: .git/kokolog-loop/evidence/patch.diff, .git/kokolog-loop/evidence/assurance.json, .git/kokolog-loop/evidence/review-evidence.json, .git/kokolog-loop/evidence/implementation-result.md, apps/mobile_monitor/lib/main.dart, apps/mobile_monitor/lib/src/presentation/single_lane_controller.dart, apps/mobile_monitor/lib/src/presentation/single_lane_ecg_card.dart, apps/mobile_monitor/lib/src/presentation/phone_context_lane_card.dart, apps/mobile_monitor/lib/src/presentation/monitor_screens.dart, apps/mobile_monitor/lib/src/reducers/monitor_app_reducer.dart, apps/mobile_monitor/test/sdk_supervision_wiring_test.dart, apps/mobile_monitor/test/architecture/sdk_public_boundary_test.dart, packages/flutter/hrm_sdk/lib/src/kokolog_hrm_sdk_v1.dart
blockers:
- none
advisories:
- P2 · safety · apps/mobile_monitor/lib/main.dart (_pauseMonitoring) · With two or more registered devices, each sequential slot pause emits a snapshot in which the other slots are still non-paused, so _syncSupervision in the snapshot listener transiently calls startSupervision again before the final snapshot stops it; the end state converges (all paused, supervision stopped) but causes a brief undesired supervision restart during operator pause. Batch the desired-state change or suppress supervision sync while a pause is in flight.
- P2 · code · apps/mobile_monitor/lib/main.dart (_pauseMonitoring/_resumeMonitoring) · Slot pause/resume failures are swallowed by catch (_) {} with no operator feedback or retry, so a failed pause or resume is silent; DegradedScreen.onRetry remains an empty closure as well (noted in implementation-result.md adjacent findings).
- P3 · code · apps/mobile_monitor/lib/src/presentation/single_lane_controller.dart (deviceConnectionStateLabel) · The disconnected label 切断中 reads as disconnecting in progress; 未接続 is the conventional label for the disconnected state, and the wording now coexists with the stream-health 接続中 label flagged in the implementation notes.
- P3 · code · apps/mobile_monitor/lib/main.dart (_syncSupervision) · Reads sdk.snapshot inside the snapshots listener instead of the delivered next state; equivalent today given SDK emit ordering, but fragile if the SDK changes snapshot publication order.
