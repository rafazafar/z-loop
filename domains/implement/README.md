---
kind: domain
domain: implement
status: paused
goal: Work the ready-ticket frontier to merged PRs with evidence, one fresh session per ticket
cadence: every 60m while Mac awake (launchd, not yet loaded)
---

# implement

Consumes: GitHub issues labeled ready-for-agent whose blockers are all closed.
Produces: PRs with evidence, verdict files, decision cards, metrics.

## Current focus

Earn trust on pure-logic scope. Do not unpause for BLE-touching tickets until
the bench flow has run once for real.

## Backlog

- [ ] First real run on one pure-logic ticket (prove-it gate)

## Timeline
2026-08-26 | tick | pass complete

<!--
One terse dated line per run. Format:
2026-08-26 | tick | 0 ready, 0 spawned, 0 parked
-->

## Metrics (written by collectors in run/, never by agents)

- runs.jsonl: ticks, spawns, verdicts by outcome
- cycle.jsonl: ticket open->PR->verdict durations
