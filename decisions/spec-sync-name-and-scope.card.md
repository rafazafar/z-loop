---
kind: card
status: decided
domain: spec-sync
parked-by: readiness review
date: 2026-09-05 00:00
---

# What name and scope should the transcript job use?

## Context

The current name does not identify its transcript input or draft PR output.
Activation requires the repairs recorded in the review.

## Option A — Meeting Notes → Draft Spec PR

- What: Use this display name and retain the internal spec-sync ID.
- Better: States the input and the review boundary.
- Worse: The display name differs from the internal ID.

## Option B — Meeting Notes → Draft Doc PR

- What: Emphasize the broader documentation output.
- Better: Includes spec and architecture document changes.
- Worse: Makes the requirements purpose less clear.

## Evidence

- state/reviews/spec-sync-20260905/review.md
- domains/spec-sync/README.md
- agents/distiller.md
- web/view-model.mjs

## Recommendation

A — The name states what the job reads and what it produces.

## Default if unanswered

Keep the current name and paused state pending the owner decision.

## Decision

A — The owner requested implementation of the review recommendations on 2026-09-05.
