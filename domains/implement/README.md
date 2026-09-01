---
kind: domain
domain: implement
status: active
goal: Turn one ready bounded ticket into a conditionally assured PR for owner merge or bench validation
cadence: collect every 1m, sync every 5m, paid dispatch every 15m while Mac is awake
trigger: independent collection, repository sync, or bounded paid dispatch
discover: Select the oldest ready-for-worker issue whose native and inline blockers are closed and whose native subissues are complete
act: Collect and sync without model calls; paid dispatch starts bounded implementation, unified review, or P0/P1 repair work
verify: One fresh read-only reviewer must PASS the selected acceptance, code, security, safety, and QMS dimensions; only P0/P1 issues block
persist: Store ticket state, PR URL, assurance classification, unified verdicts, result files, metrics, and one Timeline entry
exit: Stop on PASS, empty frontier, owner decision, diff-budget breach, timeout, or retry exhaustion
---

# implement

Consumes: GitHub issues labeled ready-for-worker whose blockers are all closed.
Produces: PRs ready for owner merge, verdict files, decision cards, and metrics.

This domain uses a deterministic queue-drain and maker-checker controller. The
runtime owns every state transition. Only paid dispatch can start a model session.

The classifier binds one assurance review to immutable base and head OIDs. It
uses a conservative union of ticket declarations, labels, changed paths, and
changed-line signals. Unknown paths select all dimensions. One fresh reviewer
checks every selected dimension against the same head OID. The runtime
invalidates the verdict if the live PR head changes. Merge and regulated
publication always remain authorized-owner gates.

The controller records an immutable patch and a terminal CI/issue evidence
snapshot for each review. Review sessions do not depend on shell access.

The reviewer reports one bounded, severity-calibrated result. Only P0 and P1
issues block and schedule a repair. P2 and P3 observations remain advisory and
do not consume the repair budget. The initial build does not consume the three
P0/P1-repair budget. Repairs use their own model route. PR revisions remain
durable history and do not have a separate ceiling.

## Current understanding

Earn trust on pure-logic scope. Do not unpause for BLE-touching tickets until
the bench flow has run once for real.

## Backlog

- [ ] First real run on one pure-logic ticket (prove-it gate)
- [x] Reconcile an implementer session killed before its .done sentinel
  (loop-tick re-queues up to max_impl_attempts, then parks with an auto card)

## Timeline
2026-09-02 | collect | 1 completed result(s) updated; no model sessions started
2026-09-02 | ticket 39 | revision 1 classified for unified assurance at 1d4beca46cd1
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | ticket 38 | merged after unified assurance PASS at 14199afbcad3
2026-09-02 | dispatch | scheduled work: 1/2 model sessions started
2026-09-02 | ticket 39 | implementer spawned (frontier)
2026-09-02 | ticket 38 | unified assurance PASS on revision 1 — PR awaits owner merge
2026-09-02 | collect | 1 completed result(s) updated; no model sessions started
2026-09-02 | dispatch | scheduled work: 1/2 model sessions started
2026-09-02 | ticket 38 | unified assurance review for revision 1 spawned
2026-09-02 | collect | 1 completed result(s) updated; no model sessions started
2026-09-02 | ticket 38 | revision 1 classified for unified assurance at 14199afbcad3
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 1/2 model sessions started
2026-09-02 | ticket 38 | implementer spawned (frontier)
2026-09-02 | ticket 37 | merged after unified assurance PASS at 097721b5da1d
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | ticket 37 | unified assurance PASS on revision 1 — PR awaits owner merge
2026-09-02 | collect | 1 completed result(s) updated; no model sessions started
2026-09-02 | dispatch | current work: 1/2 model sessions started
2026-09-02 | ticket 37 | unified assurance review for revision 1 spawned
2026-09-02 | ticket 37 | same-head assurance runtime retry 1 queued at 097721b5da1d
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | scheduled work: 0/2 model sessions started
2026-09-02 | dispatch | current work: 0/2 model sessions started
2026-09-02 | ticket 36 | merged after unified assurance PASS at e50024fad194
2026-09-02 | collect | 1 completed result(s) updated; no model sessions started
2026-09-02 | ticket 37 | parked: reviewer runtime exited with status 1
2026-09-02 | dispatch | scheduled work: 1/2 model sessions started
2026-09-02 | ticket 37 | unified assurance review for revision 1 spawned
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | ticket 37 | revision 1 classified for unified assurance at 097721b5da1d
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 1/2 model sessions started
2026-09-01 | ticket 37 | implementer spawned (frontier)
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | current work: 0/2 model sessions started
2026-09-01 | ticket 36 | unified assurance PASS on revision 4 — PR awaits owner merge
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | ticket 36 | assurance-v2 replaced the legacy profile plan at e50024fad194; unified review pending with P0/P1 repair 0/3
2026-09-01 | dispatch | scheduled work: 1/2 model sessions started
2026-09-01 | ticket 36 | unified assurance review for revision 4 spawned
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | ticket 36 | parked: 4 revision cycles exhausted
2026-09-01 | dispatch | scheduled work: 0/2 model sessions started
2026-09-01 | dispatch | current work: 1/1 model sessions started
2026-09-01 | ticket 36 | code review for revision cycle 4 spawned
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | ticket 36 | revision cycle 4 classified at e50024fad194
2026-09-01 | dispatch | scheduled work: 1/1 model sessions started
2026-09-01 | ticket 36 | FAIL security -> repair 3 spawned
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 1/1 model sessions started
2026-09-01 | ticket 36 | security review round 3 spawned
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | dispatch | scheduled work: 1/1 model sessions started
2026-09-01 | ticket 36 | code review round 3 spawned
2026-09-01 | dispatch | current work: 0/1 model sessions started
2026-09-01 | ticket 36 | assurance round 3 classified at 5bd1473150c7
2026-09-01 | ticket 36 | human intervention recorded; assurance resumes on 5bd1473150c7
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | ticket 36 | parked: implementer runtime exited with status 1
2026-09-01 | session 36-impl-a3 | reaped: timeout 3637s
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 0/1 model sessions started
2026-09-01 | dispatch | scheduled work: 1/1 model sessions started
2026-09-01 | ticket 36 | FAIL code -> fix attempt 3 spawned
2026-09-01 | collect | 1 completed result(s) updated; no model sessions started
2026-09-01 | dispatch | scheduled work: 1/1 model sessions started
2026-09-01 | ticket 36 | code review round 2 spawned
2026-09-01 | tick | current work and issue queue updated
2026-09-01 | tick | current work and issue queue updated
2026-09-01 | tick | current work and issue queue updated
2026-09-01 | ticket 36 | assurance round 2 classified at ea8968d5a4b8
2026-09-01 | tick | current work updated (new issue selection skipped)
2026-09-01 | ticket 36 | FAIL code -> fix attempt 2 spawned
2026-09-01 | tick | current work and issue queue updated
2026-09-01 | tick | current work updated (new issue selection skipped)
2026-09-01 | ticket 36 | code review round 1 spawned
2026-09-01 | ticket 36 | assurance round 1 classified at eab843399e20
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | skipped: missing binary (run run/doctor)
2026-09-01 | tick | current work and issue queue updated
2026-09-01 | ticket 36 | implementer spawned (frontier)
2026-09-01 | ticket 77 | human-owned at 9265644b277c: manual take over
2026-09-01 | tick | reconcile complete (frontier unchanged)
2026-09-01 | ticket 77 | parked: 3 assurance rounds exhausted
2026-09-01 | tick | reconcile complete (frontier unchanged)
2026-09-01 | ticket 77 | code review round 3 spawned
2026-09-01 | tick | reconcile complete (frontier unchanged)
2026-09-01 | ticket 77 | assurance round 3 classified at 9265644b277c
2026-09-01 | ticket 77 | human intervention recorded; assurance resumes on 9265644b277c
2026-09-01 | tick | reconcile complete (frontier unchanged)
2026-09-01 | ticket 77 | parked: implementer runtime exited with status 1
2026-09-01 | ticket 46 | human-owned at 7bcff003ae71: PR 93 was handled manually by the human operator. Automated assurance is stopped; the retained review verdicts remain historical evidence.
2026-09-01 | tick | reconcile complete (frontier unchanged)
2026-09-01 | ticket 77 | FAIL code -> fix attempt 3 spawned
2026-09-01 | ticket 46 | parked: 3 assurance rounds exhausted
2026-08-31 | tick | reconcile complete (frontier unchanged)
2026-08-31 | ticket 77 | code review round 2 spawned
2026-08-31 | ticket 46 | security review round 3 spawned
2026-08-31 | ticket 77 | assurance round 2 classified at 2337a59c0551
2026-08-31 | session 77-impl-a2 | pre-policy runtime exit 143; recovery retry 1/1 spawned
2026-08-31 | tick | pass complete
2026-08-31 | ticket 46 | code review round 3 spawned
2026-08-31 | ticket 77 | parked: implementer runtime exit 143
2026-08-31 | ticket 46 | assurance round 3 classified at 5c408a5a0927
2026-08-31 | tick | pass complete
2026-08-31 | tick | pass complete
2026-08-31 | ticket 77 | FAIL code -> fix attempt 2 spawned
2026-08-31 | ticket 46 | FAIL code -> fix attempt 3 spawned
2026-08-31 | tick | pass complete
2026-08-31 | ticket 77 | code review round 1 spawned
2026-08-31 | ticket 46 | code review round 2 spawned
2026-08-31 | ticket 77 | assurance round 1 classified at 02c4470ee41e
2026-08-31 | ticket 46 | assurance round 2 classified at 21e8cc52ad82
2026-08-31 | tick | pass complete
2026-08-31 | ticket 46 | FAIL code -> fix attempt 2 spawned
2026-08-31 | tick | pass complete
2026-08-31 | ticket 77 | implementer spawned (frontier)
2026-08-31 | ticket 46 | code review round 1 spawned
2026-08-31 | ticket 46 | assurance round 1 classified at 793c56731d86
2026-08-31 | ticket 44 | merged-unverified: PR merged before assurance completed (0/4 profiles passed)
2026-08-31 | tick | pass complete
2026-08-31 | ticket 46 | implementer spawned (frontier)
2026-08-31 | ticket 44 | parked: cannot continue assurance on PR state MERGED
2026-08-31 | ticket 44 | assurance round 1 classified at 85ad214f15c0
2026-08-31 | tick | pass complete
2026-08-31 | ticket 44 | implementer spawned (frontier)
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
