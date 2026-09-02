VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/102
BASE_OID: 8e5ffdd6c191dd443d766a8fee5da7a4ad345cc0
HEAD_OID: 8a55363ec6b617998b3160e0825b8422290aa813
expected: All six issue acceptance criteria hold across Android and iOS, with correct retry timing, terminal latching and recovery, typed redacted events, safe TLS classification, controlled lifecycle evidence, and passing relevant CI.
observed: Dart policy tests and listed CI pass, but immutable patch proves Android cannot compile and multiple reachable native lifecycle paths bypass or defeat required classification, retry, and credential-revision behavior.
evidence: /Users/zafar/dev/kokolog-loop/state/42.assurance-r1.patch, /Users/zafar/dev/kokolog-loop/state/42.assurance-r1.json, /Users/zafar/dev/kokolog-loop/state/review-evidence/42-rev-assurance-r1.json, /Users/zafar/dev/kokolog-loop/state/sessions/42-impl-a1.result
blockers:
- P1 · code · packages/flutter/hrm_runtime/android/src/main/kotlin/com/kokolog/hrm_runtime/CloudMqttConnection.kt:254-256 · CloudMqttInvalidEndpointException extends CloudMqttConfigurationException, but Kotlin classes are final by default, so Android native source does not compile and primary Android behavior cannot ship · make the base exception open or remove the subclass inheritance, then compile the Android target
- P1 · acceptance · native CloudMqttConnection disconnect callbacks and CloudTransportSupervisor · after a successful connect, the one-shot settlement callback is consumed; later broker or network disconnects only release the registry and never reach the supervisor, so no transient event or retry occurs and live telemetry remains stopped · add a post-connect disconnect outcome path into the current supervisor revision and test transient recovery after an established connection drops on both platforms
- P1 · security · packages/flutter/hrm_runtime/ios/hrm_runtime/Sources/hrm_runtime/CloudMqttConnection.swift:270-288 · WSS uses mqtt5UrlSession, but that callback always requests default handling and never records failed trust; certificate rejection is therefore reported by disconnect as networkUnavailable and fast-retried instead of terminal certificateFailure · evaluate and record trust in the URLSession challenge path, return the matching disposition, and test certificate rejection through that callback
- P1 · acceptance · native client registries and configureCloudRuntimeV1 replacement paths · credential or configuration update while connected acquires the same client ID before closing the prior connection, so registry rejection becomes terminal contractViolation, old credentials remain active, and a relevant credential change cannot resume the required revision · implement safe same-slot ownership transfer or another replacement handoff that preserves rollback and prove connected credential rotation on both platforms
- P1 · security · packages/flutter/hrm_sdk/lib/src/cloud_transport_supervisor.dart:803-828 and native configureCloudRuntimeV1 · beginRevision invalidates only the Dart result, not an in-flight native retry; a credential change can collide with that old attempt, then the stale attempt can still install an old-credential connection while the new revision reports terminal failure · serialize or cancel native attempts by revision and prevent stale completions from installing a connection, with a race test
advisories:
- P2 · qms · packages/flutter/hrm_runtime/test/cloud_mqtt_connection_contract_test.dart · native assurance relies on source-substring checks rather than compiling or executing Android and iOS connection paths, which allowed the final-class compile defect and callback lifecycle gaps through a green merge gate
