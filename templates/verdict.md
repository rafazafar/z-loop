---
kind: verdict
domain: [implement]
ticket: <n>
pr: <url>
round: <r>
reviewer-model: <alias>
date: YYYY-MM-DD HH:MM
---

<!--
STRICT GRAMMAR. The tick parses this file. Nothing outside the grammar.
The invocation prompt supplies the authoritative path and identity values.
The tick archives PASS/FAIL verdicts as
verdicts/<ticket>-<profile>-r<round>-<head12>-verdict.md.
-->

VERDICT: PASS | FAIL
TASK: works | broken | unproven
BENCH: pending | none
PROFILE: code | security | safety | qms
ROUND: <positive integer>
PR: <url>
BASE_OID: <40 lowercase hex>
HEAD_OID: <40 lowercase hex>
expected: <criteria, one line>
observed: <what the diff/evidence actually shows>
evidence: <paths verified, comma-separated>
findings:
- L1|L2|L3 · <file/area> · <defect> · <minimal fix direction>

<!--
Rules baked into the reviewer roles, repeated here because they are the ones
that rot first:
- "Works" requires positive evidence. Absence of failure is not success.
- BENCH: pending only for ticket-scoped bench-hardware criteria that no code
  run can evidence, with everything code-provable positively proven. Omit the
  line when the ticket has no bench-gated criteria.
- Never propose weakening a test to pass.
- Follow-up findings become tickets, never inline scope.
-->
