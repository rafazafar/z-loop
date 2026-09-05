---
kind: card
status: open
domain: implement
parked-by: runtime (auto-cardify)
date: 2026-09-05 10:21
---

# PR for ticket 70 needs bench validation before auto-merge — run the bench or waive it?

## Context

A verdict marked BENCH: pending; the loop cannot produce physical-device evidence itself.

## Option A — Retry the cycle

- What: re-run the failed cycle; bounds and attempts permitting.
- Better: the loop completes the work itself.
- Worse: may repeat the same failure.

## Option B — Drop the work unit

- What: acknowledge the failure and skip this work unit.
- Better: no repeated spend on a hopeless item.
- Worse: the work stays undone until raised again.

## Option C — Take over manually

- What: the owner does or repairs the work outside automated control.
- Better: fastest unblock for odd cases.
- Worse: manual record-keeping; the controller gains no reusable evidence.

## Evidence

- pr: https://github.com/kokoromil/kokolog-monitor/pull/125

## Recommendation

A — unless the evidence shows the work unit itself is wrong.

## Default if unanswered

A — retry within bounds at the next batch; the card stays open until answered.
