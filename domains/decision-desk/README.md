---
kind: domain
domain: decision-desk
status: active
goal: Every owner decision arrives as a formatted 1-3 option card, twice a day, logged and traceable to an ARD
cadence: 09:00 and 17:00 (launchd, not yet loaded; manual until proven)
trigger: Twice-daily batch or a manual run
discover: Collect open cards and parked tickets that are not already in an open queue
act: Assemble one queue of at most seven cards and never decide or apply an answer
verify: A fresh checker confirms every option and recommendation comes only from cited source evidence
persist: Store the verified queue, stable operation key, cycle record, and one Timeline entry
exit: Stop after one verified queue, when inputs are empty, or when source information is unclear
---

# decision-desk

Consumes: parked cards and .parked tickets.
Produces: dated queue files, decisions-log.md entries, unblocked tickets,
ARD drafts (via distiller).

The Decision Desk is the top-level domain actor. The runtime verifies its queue.
Applying human answers stays manual until a strict deterministic command exists.

## Current understanding

Manual mode: run `run/decision-batch` when cards exist. Timer only after the
first queue file has been answered end-to-end.

## Backlog

- [ ] First queue file assembled and answered

## Timeline
2026-09-02 | batch | nothing to decide
2026-09-01 | cycle loop-decision-desk-20260901-170003 | FAIL: NOOP is invalid because live discovery contains parked ticket 36 and no open queue contains it.
2026-09-01 | auto card parked: decisions/auto-decision-desk-none.card.md
2026-09-01 | batch | nothing to decide
2026-08-26 | batch | nothing to decide
2026-08-26 | batch | nothing to decide

## Metrics

- batches.jsonl: cards in, answered, defaulted
