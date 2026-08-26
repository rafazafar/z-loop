---
kind: domain
domain: ticket-factory
status: paused
goal: Turn one approved spec into a verified tracer-bullet breakdown card for human approval
cadence: on demand (spec merged, or manual invocation)
trigger: An approved spec, an approved Gardener proposal, or a manual run
discover: Select one approved source that has no open or answered breakdown card
act: Draft one breakdown decision card and stop before GitHub publication
verify: A fresh read-only checker must confirm sizing, vertical slices, blocking edges, and source traceability
persist: Store the verified card, stable operation key, cycle record, and one Timeline entry
exit: Stop after one verified draft, when no source exists, at human approval, or on failed verification
---

# ticket-factory

Consumes: approved spec issues, Gardener proposals approved by human.
Produces: verified breakdown decision cards awaiting human approval.

The ticketer is the top-level domain actor. The runtime verifies the card.
Ticket publication stays manual until a deterministic publisher exists.

## Current understanding

The runner is available, but this domain stays paused until implementation has
earned trust on at least three tickets. Decomposition quality matters more than speed.

## Backlog

- [ ] First breakdown card over one real approved spec

## Timeline

## Metrics

- breakdowns.jsonl: specs decomposed, tickets created, approval edits (a
  proxy for decomposition quality)
