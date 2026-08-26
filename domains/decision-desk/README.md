---
kind: domain
domain: decision-desk
status: active
goal: Every human decision arrives as a formatted 1-3 option card, twice a day, logged and traceable to an ARD
cadence: 09:00 and 17:00 (launchd, not yet loaded; manual until proven)
---

# decision-desk

Consumes: parked cards, .parked tickets, open questions from result files.
Produces: dated queue files, decisions-log.md entries, unblocked tickets,
ARD drafts (via distiller).

## Current focus

Manual mode: run `run/decision-batch` when cards exist. Timer only after the
first queue file has been answered end-to-end.

## Backlog

- [ ] First queue file assembled and answered

## Timeline
2026-08-26 | batch | nothing to decide

## Metrics

- batches.jsonl: cards in, answered, defaulted
