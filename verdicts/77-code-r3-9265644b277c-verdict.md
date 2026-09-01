VERDICT: FAIL
TASK: broken
PROFILE: code
ROUND: 3
PR: https://github.com/kokoromil/kokolog-monitor/pull/94
BASE_OID: 32264857bc08eec4aa792d1fa4a28977b284fbb9
HEAD_OID: 9265644b277cf0f714c09db0b9a20d87f6ceb986
expected: CMP801 assigns stable test or evidence IDs to current Mobile Monitor requirements, design items, interfaces, applicable ARDs, and risk controls.
observed: The exact-head check rollup is successful, but TC-MON-007 only compares product identifiers with ARD018 while CMP801, generated traceability, baseline data, and focused tests also claim ARD012 deployment-profile coverage.
evidence: /Users/zafar/dev/kokolog-loop/state/77.assurance-r3.json; /Users/zafar/dev/kokolog-loop/state/sessions/77-impl-a3.result; docs/spec/testing/CMP801-test-specification-mobile-monitor.md:33,163; docs/spec/traceability/CMP700-traceability-matrix.md:95; tools/spec-tools/mobile-monitor-verification-baseline.mjs:376; tools/spec-tools/generate-traceability-matrix.test.mjs:71-85; docs/ard/ARD012-supported-deployment-configurations.md:30-78; GitHub check rollup for 9265644b277cf0f714c09db0b9a20d87f6ceb986
findings:
- L1 · TC-MON-007 / ARD012 traceability · Product-identifier verification does not exercise ARD012 deployment profiles, so the baseline overstates applicable ARD coverage and the focused test enforces the defect · Remove ARD012 from TC-MON-007 in the canonical baseline and regenerate CMP801, CMP700, XLSX, and graph outputs; keep ARD012 mapped only to procedures that exercise deployment profiles.
