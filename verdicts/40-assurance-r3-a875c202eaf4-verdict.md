VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 3
PR: https://github.com/kokoromil/kokolog-monitor/pull/101
BASE_OID: 8e5ffdd6c191dd443d766a8fee5da7a4ad345cc0
HEAD_OID: a875c202eaf4a7ad378746a02b6eeb0b2c82f0dd
expected: Android and iOS publish schema-valid current status after connection and every two seconds while monitoring, immediately after alias changes, with generation-safe LWT behavior and no forbidden topic families; code, safety, and security controls remain sound.
observed: The patch proves status encoders, periodic loops, alias APIs, forbidden-health removal, WSS validation, and focused tests, but the production generation gate cannot reject broker-delivered stale Wills and iOS permanently stops status after a transient MQTT disconnect.
evidence: /Users/zafar/dev/kokolog-loop/clones/40-rev-assurance-r3/.git/kokolog-loop/evidence/patch.diff, /Users/zafar/dev/kokolog-loop/clones/40-rev-assurance-r3/.git/kokolog-loop/evidence/assurance.json, /Users/zafar/dev/kokolog-loop/clones/40-rev-assurance-r3/.git/kokolog-loop/evidence/review-evidence.json, /Users/zafar/dev/kokolog-loop/clones/40-rev-assurance-r3/.git/kokolog-loop/evidence/implementation-result.md
blockers:
- P1 · safety · packages/flutter/hrm_runtime/{android,ios}/StatusPayloadEncoder and CloudMqttConnection · CloudStatusGate is called only on locally generated outbound periodic payloads, while no production subscriber or status store passes broker-delivered Wills through it; additionally Android automatic reconnect reuses the same factory generation, so a delayed pre-reconnect Will can be indistinguishable from current status and replace live state, violating the explicit old-generation acceptance criterion · rotate generation and register its matching Will for each broker connection, enforce generation ordering in the real consumer/store path, and exercise that production path with a delayed prior-generation LWT
- P1 · acceptance · packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/CloudMqttConnection.swift:114,249-260 · CocoaMQTT autoReconnect is false and disconnect stops the timer, clears the client, and provides no retry path; a reachable transient network loss therefore ends all iOS status publication while monitoring, breaking the required two-second current-status behavior · add bounded MQTT reconnection that creates/registers the next generation and restarts publication after CONNACK, while stopping retries for terminal failures
advisories:
- P2 · code · packages/flutter/hrm_runtime/{android,ios}/status alias method handling · A two-alias call mutates and may publish the first alias before validating the second, so an invalid second value returns an error after a partial externally visible update.
- P2 · acceptance · packages/flutter/hrm_runtime/{android,ios}/StatusPayloadEncoder · firmwareVersion is emitted without the schema maximum-length check, so a value longer than 64 Unicode characters creates a schema-invalid status payload.
- P2 · safety · packages/flutter/hrm_runtime/test/cloud_status_publish_contract_test.dart · Most connection and scheduling checks are source-string assertions, and the implementation evidence reports no physical broker/device interruption evidence.
