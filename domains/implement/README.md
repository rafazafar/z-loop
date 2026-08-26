---
kind: domain
domain: implement
status: active
goal: Turn one ready pure-logic ticket into an independently verified PR for human merge
cadence: every 60m while Mac awake (launchd, not yet loaded)
trigger: manual or hourly gate
discover: Select the oldest ready-for-agent issue whose blockers are closed
act: Give one ticket to a fresh implementer and route review failures back as bounded fix attempts
verify: A fresh read-only reviewer must issue PASS against the issue criteria and evidence
persist: Store ticket state, PR URL, verdict, result files, metrics, and one Timeline entry
exit: Stop on PASS, empty frontier, human decision, diff-budget breach, timeout, or retry exhaustion
---

# implement

Consumes: GitHub issues labeled ready-for-agent whose blockers are all closed.
Produces: PRs ready for human merge, verdict files, decision cards, and metrics.

This domain uses a deterministic queue-drain and maker-checker controller. The
implementer and reviewer are workers. The runtime owns every state transition.

## Current understanding

Earn trust on pure-logic scope. Do not unpause for BLE-touching tickets until
the bench flow has run once for real.

## Backlog

- [ ] First real run on one pure-logic ticket (prove-it gate)

## Timeline
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete
2026-08-26 | tick | pass complete

## Metrics (written by collectors in run/, never by agents)

- runs.jsonl: ticks, spawns, verdicts by outcome
- cycle.jsonl: ticket open->PR->verdict durations
