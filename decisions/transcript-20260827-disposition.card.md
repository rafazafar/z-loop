---
kind: card
status: open
domain: spec-sync
parked-by: runtime verifier (cycle loop-spec-sync-20260828-225624)
date: 2026-08-29 05:22
---

# What should happen to the 定例MTG_20260827.txt transcript still pending in spec-sync?

## Context

The transcript was processed once (PR 24, merged), but its ledger entry was
never acked because the cycle failed the old staging contract. The resilience
re-run self-reported NOOP; the verifier failed it (attempt 1 of 3) because
discovery is not empty: a broken PRD008 transcript citation and the ARD016/
MM4-D7 conflict (see the companion card). With no timer loaded, nothing
retries until a human runs the trigger.

## Option A — Mark completed; work the findings as tickets

- What: ack the hash in state/specsync.ledger; fix the PRD008 citation path
  and the ARD reconciliation as explicit follow-ups from the companion card.
- Better: no more model spend on an already-distilled transcript; the
  remaining work is decision-driven editing, not transcript distillation.
- Worse: the spec-sync pipeline does not get the retry-on-findings exercise.

## Option B — One more trigger cycle

- What: run run/spec-sync-trigger again; the distiller now has the FAIL
  timeline signal and should end BLOCKED with its own card or draft the
  citation-fix PR.
- Better: live-proves the fixed staging contract against a fail signal; the
  domain does its own work.
- Worse: one distiller+verifier run; outcome may repeat if the distiller
  still reads the work as consumed.

## Option C — Leave pending

- What: do nothing; attempts 2 and 3 burn on future manual triggers, then the
  transcript is marked failed.
- Better: zero action now.
- Worse: guaranteed wasted cycles for a known outcome.

## Evidence

- /Users/zafar/dev/kokolog-loop/state/specsync-attempts/479ee8380458276fde28d515a92500685ecc62f57bc3894956de3d34d8368562 (attempt 1)
- /Users/zafar/dev/kokolog-loop/state/sessions/loop-spec-sync-20260828-225624-verify.result (why it failed)
- https://github.com/kokoromil/kokolog-monitor/pull/24 (original work, merged)

## Recommendation

A — the transcript's content is already merged in PR 24; what remains is
decision-driven editing that the companion card's answer should drive.

## Default if unanswered

A — ack as completed at the next spec-sync batch; findings become tickets.
