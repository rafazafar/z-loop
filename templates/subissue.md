# <NN>: <Ticket title>

<!--
Scope contract. Every field is law for the implementer.
Publish to GitHub with: ready-for-agent label, native sub-issue link to the
parent, blocking references to blocking tickets.
No file paths, no code snippets (exception: prototype-derived decision shapes).
-->

**What to build:** the end-to-end behaviour this ticket makes work, from the
user's perspective. Not a layer-by-layer plan.

**Acceptance criteria:**

- [ ] Criterion 1 — externally observable, testable
- [ ] Criterion 2

**Blocked by:** <ticket numbers/titles, or "None (can start immediately)">

**Bench classification:** pure-logic | sim-drivable | needs-device

**Live-proof steps:** <only if sim-drivable: how to bring the stack up and
exercise this ticket's behaviour; what the reviewer should observe. Otherwise
leave empty.>

**Diff budget hint:** <files / insertions / deletions ceiling for this ticket;
defaults from routing.json if omitted>

**Evidence to attach:** <what proof the PR must carry: commands, screenshots,
device-test protocol reference (needs-device -> templates/device-test-protocol.md)>

**Status:** ready-for-agent
