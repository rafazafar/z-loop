VERDICT: FAIL
TASK: broken
PROFILE: code
ROUND: 2
PR: https://github.com/kokoromil/kokolog-monitor/pull/94
BASE_OID: 32264857bc08eec4aa792d1fa4a28977b284fbb9
HEAD_OID: 2337a59c0551aa88a1b9d11ae96140e84d5ffd9b
expected: CMP800 defines governance and gates; CMP801 assigns valid stable test or evidence IDs across current Mobile Monitor sources; states remain distinct; no planned or reference work is reported passed; evidence ownership is assigned to #78 through #82; existing evidence links require identifiable provenance and approval.
observed: The governance, state, ownership, and provenance structures are present, but TC-MON-007 only tests ARD018 product identifiers while its canonical sourceIds also claim coverage of ARD012 and regulatory requirements SR-MON-201, SR-MON-202, and SR-MON-203; the regression test asserts this false mapping.
evidence: /Users/zafar/dev/kokolog-loop/state/77.assurance-r2.json; /Users/zafar/dev/kokolog-loop/state/sessions/77-impl-a2.result; pinned HEAD worktree files under /Users/zafar/dev/kokolog-loop/clones/77-a1; GitHub PR check rollup for 2337a59c0551aa88a1b9d11ae96140e84d5ffd9b
findings:
- L1 · tools/spec-tools/mobile-monitor-verification-baseline.mjs:252-254,319,438-455 · TC-MON-007 verifies package, display, application, bundle, and target identifiers from ARD018, but the generated traceability also credits it with deployment-profile and IEC/Japanese regulatory compliance requirements that its procedure and acceptance result cannot verify · restrict TC-MON-007 to ARD018 and assign SR-MON-201 through SR-MON-203 to a separate applicable planned test or evidence ID; remove ARD012 from this test and map that decision only to procedures that exercise its deployment profiles.
