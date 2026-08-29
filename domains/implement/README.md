---
kind: domain
domain: implement
status: active
goal: Turn one ready agent-provable ticket into a conditionally assured PR for human merge or bench validation
cadence: every 60m while Mac awake (launchd, not yet loaded)
trigger: manual or hourly gate
discover: Select the oldest ready-for-agent issue whose native and inline blockers are closed and whose native subissues are complete
act: Give one ticket to a fresh implementer and route review failures back as bounded fix attempts
verify: Fresh read-only code, security, safety, and QMS reviewers must PASS every deterministically required profile
persist: Store ticket state, PR URL, assurance classification, profile verdicts, result files, metrics, and one Timeline entry
exit: Stop on PASS, empty frontier, human decision, diff-budget breach, timeout, or retry exhaustion
---

# implement

Consumes: GitHub issues labeled ready-for-agent whose blockers are all closed.
Produces: PRs ready for human merge, verdict files, decision cards, and metrics.

This domain uses a deterministic queue-drain and maker-checker controller. The
implementer and reviewer are workers. The runtime owns every state transition.

The classifier binds one assurance cycle to immutable base and head OIDs. It
uses a conservative union of ticket declarations, labels, changed paths, and
changed-line signals. Unknown paths require all specialist profiles. Each
profile gets a fresh read-only context against the same head OID. The runtime
invalidates all verdicts if the live PR head changes. Merge and regulated
publication always remain authorized-human gates.

## Current understanding

Earn trust on pure-logic scope. Do not unpause for BLE-touching tickets until
the bench flow has run once for real.

## Backlog

- [ ] First real run on one pure-logic ticket (prove-it gate)
- [x] Reconcile an implementer session killed before its .done sentinel
  (loop-tick re-queues up to max_impl_attempts, then parks with an auto card)

## Timeline
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-29 | tick | pass complete
2026-08-28 | tick | pass complete
2026-08-28 | tick | pass complete
2026-08-28 | tick | pass complete
2026-08-28 | tick | blocked: GitHub frontier unavailable
2026-08-27 | tick | pass complete
2026-08-27 | tick | pass complete
2026-08-27 | ticket 13 | parked: cannot fix assurance finding on PR state MERGED
2026-08-27 | tick | pass complete
2026-08-27 | ticket 13 | code review round 2 spawned
2026-08-27 | tick | pass complete
2026-08-27 | tick | pass complete
2026-08-27 | ticket 13 | PASS round 1 — PR awaits human merge
2026-08-27 | tick | pass complete
2026-08-27 | ticket 13 | review round 1 spawned
2026-08-27 | tick | pass complete
2026-08-27 | ticket 13 | implementer spawned (frontier)
2026-08-27 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete

## Metrics (written by collectors in run/, never by agents)

- runs.jsonl: ticks, spawns, verdicts by outcome
- cycle.jsonl: ticket open->PR->verdict durations
