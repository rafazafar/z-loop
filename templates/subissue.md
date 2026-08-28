# <NN>: <Ticket title>

<!--
Scope contract. Every field is law for the implementer.
Publish to GitHub with: ready-for-agent label, native sub-issue link to the
parent, and native GitHub blocked-by relationships. Keep the inline Blocked by
field synchronized as a compatibility record.
No file paths, no code snippets (exception: prototype-derived decision shapes).
-->

**What to build:** the end-to-end behaviour this ticket makes work, from the
user's perspective. Not a layer-by-layer plan.

**Acceptance criteria:**

- [ ] Criterion 1 — externally observable, testable
- [ ] Criterion 2

**Blocked by:** <must match native GitHub dependencies; ticket numbers/titles, or "None (can start immediately)">

**Bench classification:** pure-logic | sim-drivable | needs-device

**Assurance:** baseline | security | safety | qms (one or more; baseline is always applied)

**Live-proof steps:** <only if sim-drivable: how to bring the stack up and
exercise this ticket's behaviour; what the reviewer should observe. Otherwise
leave empty.>

**Diff budget hint:** <files / insertions / deletions ceiling for this ticket;
defaults from routing.json if omitted>

**Evidence to attach:** <what proof the PR must carry: commands, screenshots,
device-test protocol reference (needs-device -> templates/device-test-protocol.md)>

**Status:** ready-for-agent
