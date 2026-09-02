VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/100
BASE_OID: 8e5ffdd6c191dd443d766a8fee5da7a4ad345cc0
HEAD_OID: 1d4beca46cd199b6b88c7a48c4783fd3e39a81c1
expected: Exact accel and qrs topics preserve source samples, 4 ms rPos ticks, labels, independent zero-based family streams, valid/invalid handling, Android/iOS equivalence, safe timestamp and failure behavior, and secure MQTT delivery.
observed: Schemas, codec logic, topic construction, QoS 1, retain false, 10-second expiry, WSS validation, source-value preservation, Android tests, and required CI pass, but iOS consumes telemetry sequence values while MQTT is not connected whereas Android does not.
evidence: /Users/zafar/dev/kokolog-loop/state/39.assurance-r1.patch, /Users/zafar/dev/kokolog-loop/state/39.assurance-r1.json, /Users/zafar/dev/kokolog-loop/state/review-evidence/39-rev-assurance-r1.json, /Users/zafar/dev/kokolog-loop/state/sessions/39-impl-a1.result, /Users/zafar/dev/kokolog-loop/clones/39-a1/packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/CloudMqttConnection.swift, /Users/zafar/dev/kokolog-loop/clones/39-a1/packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/CloudTelemetryCodec.swift, /Users/zafar/dev/kokolog-loop/clones/39-a1/packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/CloudMqttConnection.kt, /Users/zafar/dev/kokolog-loop/clones/39-a1/docs/contracts/mqtt.md
blockers:
- P1 · acceptance/safety/code · packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/CloudMqttConnection.swift:191-200 · `telemetryCodec.convert` increments family sequence before `isConnected` is checked; continuous BLE notifications during MQTT handshake or disconnection are dropped after consuming sequence values, so first later iOS publish can start above zero and create a false forward gap, unlike Android pre-conversion connection guard, violating independent stream behavior and explicit Android/iOS equivalence · Check current-client connected state before conversion, avoid consuming identifiers for dropped notifications, and add a parity regression proving first connected publish is sequence zero after pre-CONNACK notifications.
advisories:
- P2 · acceptance/code · packages/flutter/hrm_runtime/ios · Immutable patch adds Android codec unit tests but no committed iOS codec tests for valid packets, malformed frames, sequence behavior, or day rollover; source parity checks and one reported temporary Swift executable give weaker regression coverage than platform-native tests.
