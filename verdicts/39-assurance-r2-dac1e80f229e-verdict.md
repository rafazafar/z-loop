VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 2
PR: https://github.com/kokoromil/kokolog-monitor/pull/100
BASE_OID: 8e5ffdd6c191dd443d766a8fee5da7a4ad345cc0
HEAD_OID: dac1e80f229ef9017298c77a9f706ad256d708d3
expected: Exact accel and qrs publishing with preserved source samples and 4 ms ticks, no invented events, independent stream identity and sequence, valid and invalid fixture behavior, Android/iOS parity, connected-only delivery, safe source discontinuity handling, and secure MQTT transport.
observed: Pinned patch and successful current-head CI prove core codecs, topics, guards, and transport settings, but iOS has an unlocked stale connection-state write and both platforms retain accel/qrs stream identity across BLE source discontinuity.
evidence: /Users/zafar/dev/kokolog-loop/state/39.assurance-r2.patch, /Users/zafar/dev/kokolog-loop/state/39.assurance-r2.json, /Users/zafar/dev/kokolog-loop/state/review-evidence/39-rev-assurance-r2-retry1.json, /Users/zafar/dev/kokolog-loop/state/sessions/39-impl-a2.result
blockers:
- P1 · safety · packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/CloudMqttConnection.swift didConnectAck/connect · didConnectAck writes isConnected=true again outside stateLock after checking current client; concurrent close can restore stale true, and a subsequent connect assigns a pre-CONNACK client without first clearing that state, allowing notifications to consume sequence IDs and attempt publish before connection approval · Remove unlocked write, keep all connection state transitions under stateLock, clear state at connect start, and add race regression coverage.
- P1 · safety · accel/qrs codec lifecycle on Android and iOS · Each CloudTelemetryCodec is created once per MQTT connection and no BLE disconnect/reconnect path resets it, so a kokologMD source discontinuity continues old streamId and sequence; consumers can merge recovered QRS/signal state with pre-disconnect state instead of recognizing a new source stream · Reset both family stream IDs and zero their sequences on BLE source discontinuity/restart, with Android/iOS reconnect tests.
advisories:
- P2 · acceptance · packages/flutter/hrm_runtime native codec tests · Current CI runs Flutter tests but does not execute added Kotlin codec tests, and no native Swift codec fixture suite proves value-level Android/iOS parity; source-token assertions leave regression risk.
