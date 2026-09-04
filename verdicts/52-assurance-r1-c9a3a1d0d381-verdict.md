VERDICT: BLOCK
TASK: broken
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/118
BASE_OID: 82d91fbef1f6a7e43a1195e9521a369475c8d4fd
HEAD_OID: c9a3a1d0d381163420fb9a77d7335b759178072d
expected: All acceptance criteria met and MonorepoCI checks passing on PR head
observed: Required MonorepoCI workflow failed on head c9a3a1d0d381163420fb9a77d7335b759178072d (Detect Changed App Scopes and Monorepo Merge Gate failed)
evidence: /Users/zafar/dev/kokolog-loop/clones/52-rev-assurance-r1-retry2/.git/kokolog-loop/evidence/review-evidence.json
blockers:
- P1 · acceptance · .github/workflows/apps-checks.yml · MonorepoCI failed (Detect Changed App Scopes and Monorepo Merge Gate failed with FAILURE), preventing required CI completion · Fix CI workflow or failure so Monorepo Merge Gate succeeds on PR head
advisories:
- none
