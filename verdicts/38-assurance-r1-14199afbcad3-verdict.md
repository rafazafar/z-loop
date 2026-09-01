VERDICT: PASS
TASK: works
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/99
BASE_OID: cb7cbf311e15ba7887a9511801b1c3552904c30b
HEAD_OID: 14199afbcad3a19e4f2022789ef3f1a5bce4900c
expected: ECG payloads published to exact device topic with schema-valid structure, correct timestamps, order, channel count, sample rate, bounded size under 16 KiB, no data interpolation/repetition/zero-filling, platform equivalence across Android and iOS, and passing CI checks.
observed: Android and iOS native ECG encoders format incoming notifications into compliant ecg.schema.json payloads on topic kokolog/v1/ward/{wardId}/device/{deviceId}/ecg with QoS 1, retain false, and 10s expiry; raw samples are preserved without interpolation or zero-filling; unformatted or disconnected payloads are dropped without queueing; all relevant package and merge gate CI checks passed.
evidence: /Users/zafar/dev/kokolog-loop/state/38.assurance-r1.patch, /Users/zafar/dev/kokolog-loop/state/38.assurance-r1.json, /Users/zafar/dev/kokolog-loop/state/review-evidence/38-rev-assurance-r1.json, /Users/zafar/dev/kokolog-loop/state/sessions/38-impl-a1.result, packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/AndroidSoakRuntimeService.kt, packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/CloudMqttConnection.kt, packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/EcgPayloadEncoder.kt, packages/flutter/hrm_runtime/android/src/test/kotlin/com/kokolog/hrm_runtime/EcgPayloadEncoderTest.kt, packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/CloudMqttConnection.swift, packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/EcgPayloadEncoder.swift, packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/KokologHrmRuntimePlugin.swift, packages/flutter/hrm_runtime/test/cloud_ecg_publish_contract_test.dart, packages/flutter/hrm_runtime/test/fixtures/cloud_ecg_notifications.json, packages/flutter/hrm_runtime/test/support/main.swift
blockers:
- none
advisories:
- none
