---
kind: verdict
domain: [implement]
ticket: <n>
pr: <url>
round: <r>
reviewer-model: <provider/model>
date: YYYY-MM-DD HH:MM
---

<!--
STRICT GRAMMAR. The controller archives verdicts as
verdicts/<ticket>-assurance-r<round>-<head12>-verdict.md.
-->

VERDICT: PASS | BLOCK
TASK: works | broken | unproven
BENCH: pending | none
PROFILE: assurance
ROUND: <positive integer>
PR: <url>
BASE_OID: <40 lowercase hex>
HEAD_OID: <40 lowercase hex>
expected: <acceptance and selected dimensions, one line>
observed: <what the immutable evidence proves, one line>
evidence: <verified paths, comma-separated>
blockers:
- P0|P1 · <dimension> · <file/area> · <failure and impact> · <minimal fix>
advisories:
- P2|P3 · <dimension> · <file/area> · <observation>

<!--
Use "- none" for an empty section. Only P0 and P1 block. P2 and P3 are
advisory and never start a repair or consume the blocking repair budget.
-->
