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
-->

VERDICT: PASS | FAIL
TASK: works | broken | unproven
expected: <criteria, one line>
observed: <what the diff/evidence actually shows>
evidence: <paths verified, comma-separated>
findings:
- L1|L2|L3 · <file/area> · <defect> · <minimal fix direction>

<!--
Rules baked into the reviewer role, repeated here because they are the ones
that rot first:
- "Works" requires positive evidence. Absence of failure is not success.
- Never propose weakening a test to pass.
- Follow-up findings become tickets, never inline scope.
-->
