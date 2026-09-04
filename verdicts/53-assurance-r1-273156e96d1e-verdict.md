VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/119
BASE_OID: b6d32a5ddf69ead3ec429387471fcc118d9e088d
HEAD_OID: 273156e96d1e47b3bd02fb31a8968f2758b7b078
expected: All required CI checks pass, runtime monitors BLE advertisements to auto-connect up to four registered devices, and tests verify GATT 133 cleanup and 2s recovery.
observed: Monorepo CI checks failed, mobile_monitor does not monitor advertisements to connect registered devices, and tests assert only properties on hand-made mock objects.
evidence: apps/mobile_monitor/lib/main.dart, apps/mobile_monitor/lib/src/models/monitor_app_state.dart, apps/mobile_monitor/lib/src/presentation/monitor_screens.dart, apps/mobile_monitor/lib/src/reducers/monitor_app_reducer.dart, apps/mobile_monitor/test/auto_connect_and_recovery_test.dart, .git/kokolog-loop/evidence/review-evidence.json
blockers:
- P1 · acceptance · .github/workflows/apps-checks.yml · Monorepo Merge Gate and Detect Changed App Scopes failed on HEAD_OID 273156e96d1e47b3bd02fb31a8968f2758b7b078 and skipped mobile_monitor CI · Fix workflow execution so required CI jobs pass.
- P1 · acceptance · apps/mobile_monitor/lib/main.dart · Runtime does not monitor BLE advertisements to auto-connect registered devices, which violates acceptance criterion 1 and SR-MON-004 · Add background advertisement monitoring and auto-connection for registered devices.
- P1 · safety · apps/mobile_monitor/test/auto_connect_and_recovery_test.dart · Criteria 4 and 5 lack test verification because tests only read properties from hand-constructed mock objects without exercising runtime recovery · Write tests that verify GATT 133 cleanup, duplicate connection prevention, and 2-second reconnect timing.
advisories:
- P2 · code · apps/mobile_monitor/test/auto_connect_and_recovery_test.dart · Criterion 2 test uses a local mock handle instead of verifying data reception through SDK and app pipelines.
- P2 · code · apps/mobile_monitor/lib/main.dart · SingleLaneController attaches only to slot 0, so additional active registered devices do not attach to lanes.
