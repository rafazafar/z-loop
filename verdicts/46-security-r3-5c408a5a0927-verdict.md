VERDICT: FAIL
TASK: broken
BENCH: none
PROFILE: security
ROUND: 3
PR: https://github.com/kokoromil/kokolog-monitor/pull/93
BASE_OID: 32264857bc08eec4aa792d1fa4a28977b284fbb9
HEAD_OID: 5c408a5a092779e865c123b825c81b314ccac0d0
expected: Cloud enrollment, proof, HTTPS/MQTT credential separation, authorization scope, TLS endpoints, secret and health-data handling, dependency controls, and QMS009 / IEC 81001-5-1 evidence are explicit and positively tested.
observed: The records define ES256 installation proof, token separation, publish-only MQTT scope, WSS, credential lifetimes, revocation, secret-free audit logging, patient-field exclusion, and pinned PyCA cryptography 50.0.1 monitoring; however, mqttUrl does not enforce its stated TCP-443 trust boundary. The shell policy blocked the required immutable-range git diff command, so command-level range verification is also incomplete.
evidence: Read docs/contracts/mobile-monitor-cloud.openapi.yaml:453-487, docs/contracts/fixtures/api/manifest.json:19-34, docs/contracts/fixtures/api/valid/mobile-monitor-mqtt-token.json, docs/contracts/fixtures/api/invalid/mobile-monitor-mqtt-broad-scope.json, tools/contracts/validate_contracts.py:208-300, docs/spec/interface/CMP401-interface-specification.md:302-390, docs/compliance/QMS006-soup-inventory.md:30-39, docs/compliance/QMS009-cybersecurity-file-index.md; implementation evidence reports the pinned contract harness passed, but local git diff 32264857bc08eec4aa792d1fa4a28977b284fbb9...5c408a5a092779e865c123b825c81b314ccac0d0 was denied before execution.
findings:
- security · docs/contracts/mobile-monitor-cloud.openapi.yaml:459-463 and MQTT-token fixtures · mqttUrl claims WSS on TCP 443, but ^wss://[^/]+/mqtt$ accepts user-info and arbitrary ports such as wss://user:secret@host:8443/mqtt; this weakens endpoint trust and can expose credentials or route traffic outside the controlled endpoint, while the harness has no negative endpoint case · validate the parsed URI as wss, no user-info/query/fragment, path /mqtt, and absent port or 443; add invalid fixtures and a semantic assertion.
