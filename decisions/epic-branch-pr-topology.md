---
kind: card
status: open
domain: implement
parked-by: opencode (human session)
date: 2026-08-27 12:00
---

# Should subissue PRs target a per-epic branch that merges to main once?

## Context

Issue #26 has four serial subissues (#27→#28→#29→#30). Today every ticket
gets a branch cut from the client repo's default HEAD and a PR into main
(agents/implementer.md:53 has no --base; run/loop-tick:370 clones default
HEAD). The human asked whether PRs should instead stack on one epic branch
with a single merge to main.

## Option A — Keep PRs straight to main (current)

- What: no change. Serial blocked-by chains plus single-flight frontier mean
  each branch is cut after the prior PR merged, so work composes via main.
- Better: zero new runtime code; every PR diff is against main; reverts are
  one PR each.
- Worse: main carries N sequential merges per epic; no single review gate
  for the whole epic; an unrelated human push to main can conflict mid-epic.

## Option B — Epic branch mode

- What: parent issue carries loop-integration plus an epic base ref (e.g.
  `epic/26`). Frontier cuts subissue branches from that ref and the
  implementer opens PRs with `--base epic/26`. The parent's integration
  ticket (now expressible via loop-integration label) opens the final
  epic→main PR.
- Better: one human merge gate per epic; main only sees the whole feature;
  shielded from unrelated main movement.
- Worse: new runtime paths (ref resolution, --base, assurance diff base);
  epic branch needs rebasing if main moves anyway; longer-lived divergence;
  per-PR assurance verdicts review partial diffs, not main-facing ones.

## Evidence

- run/loop-tick:370-379 (clone default HEAD, branch per ticket)
- agents/implementer.md:53 (PR opened with no base override)
- gh issue view 26: subIssues 27-30 form a serial blocked-by chain

## Recommendation

A — #26's chain is serial and the frontier is single-flight, so epic-branch
stacking buys nothing today; revisit B when an epic with parallel subissues
or a regulated release train appears.

## Default if unanswered

A — current behavior unchanged at next batch.
