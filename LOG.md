# Work Log

Append-only global feed. Newest at the BOTTOM (append-only avoids merge
conflicts; multi-writer safe). One entry per shipped bulk of work, written
right before the commit or PR that ships it.

Entry grammar (strict — one header line per entry):

    ## YYYY-MM-DD · Short title · #tag1 #tag2
    What: 1-2 lines, outcome first.
    Refs: [doc](path) (new|updated), PR/commit links.

Rules:
- Keep entries SHORT: header + What + Refs, nothing else.
- Reuse tags before inventing new ones. Current set:
  #loop #infra #implement #review #spec #tickets #decision #garden #bench
- Detail goes in the artifact's Timeline, not here.

Query recipes:
- Index, one line per entry:  grep '^## 20' LOG.md
- Last five entries in full:  awk 'BEGIN{RS="## "} END{print "## "$0}' LOG.md
- Entries for a topic:        awk '/^## 20/{p=0} /#loop/{p=1} p' LOG.md
- Entries for a month:        awk '/^## 2026-08/' LOG.md

## 2026-08-26 · loop system v1 skeleton · #loop #infra
What: built ~/.kokolog-loop skeleton — agents, templates, domains, tick engine, launchd plists (not loaded).
Refs: README.md (new), AGENTS.md (new), run/ (new)

## 2026-08-26 · verifier round fixes · #loop #infra
What: 3 verification rounds (2x FAIL fixed, round-3 single defect fixed post-cap with reproduced evidence: decision-batch default-state crash, exit-code trap, stranding paths, honest tier-up docs, spawn guards, dedupe).
Refs: run/decision-batch (fixed), run/spec-sync-trigger (fixed), run/spawn-exec (fixed), run/loop-tick (fixed)
## 2026-08-27 · ticket 13 verified · #implement
What: PASS at review round 1; PR ready for merge.
Refs: /Users/zafar/.kokolog-loop/verdicts/13-verdict.md

## 2026-08-28 · assurance runtime landed · #loop #infra
What: desired-state assurance reconciliation bound to immutable PR OIDs; the classifier selects applicable dimensions for a fresh read-only reviewer; prove-it ran live on ticket 13 and parked correctly on a merged PR.
Refs: run/loop-tick (rewritten), run/assurance-classify (new), agents/reviewer.md, run/doctor, run/common.sh, web/ (updated)

## 2026-08-28 · bench labels + bench-pending verdict · #loop #implement
What: two-fact label semantics (ready-for-worker vs needs-device) keep pure bench tickets out of the frontier while mixed tickets run; reviewers may land BENCH: pending (done awaits human bench validation); frontier jq quoting bug fixed by live tick; spec-sync staging budget made explicit and failed staging preserved.
Refs: run/loop-tick, run/domain-loop, run/spawn-exec, agents/reviewer.md, agents/ticketer.md, templates/subissue.md, templates/verdict.md, domains/*/README.md (updated)

## 2026-08-29 · auto-cardify + crash recovery · #loop #infra
What: verifier FAILs and exhausted transcript attempts now park OPEN decision cards automatically (deduped, dashboard-answerable); a frontier implementer lost without its done sentinel re-queues up to max_impl_attempts, then parks with an auto card.
Refs: run/common.sh (park_auto_card), run/domain-loop, run/spec-sync-trigger, run/loop-tick (updated)

## 2026-08-30 · manual frontier hardening + lean ticket contracts · #loop #implement
What: coherent outcome replaced raw file-count stops; fresh explicit main bases and closing issue references are enforced; issues #44, #77, and #78 now have distinct executable scopes and correct blockers.
Refs: agents/implementer.md, agents/ticketer.md, templates/subissue.md, run/loop-tick, run/doctor, routing.json, kokoromil/kokolog-monitor#44, #77, #78

## 2026-08-31 · ECG horizon decision settled · #spec-sync #decision
What: current product values are 4/8/16 seconds with an 8-second default and future configurability; the client has not finalized those exact values; the processed 2026-08-27 transcript is acknowledged.
Refs: decisions/ard016-vs-mm4-d7-ecg-time-horizons.card.md, decisions/transcript-20260827-disposition.card.md, kokoromil/kokolog-monitor#91

## 2026-08-31 · terminal CI review gate · #loop #review
What: manual ticks defer reviewer spawn while PR checks are pending; implementers and reviewers require exact-head CI proof.
Refs: run/loop-tick, agents/implementer.md, agents/reviewer.md, kokoromil/kokolog-monitor#92

## 2026-08-31 · worker readiness label · #loop #tickets
What: renamed the implementation frontier to ready-for-worker and removed mandatory PR screenshots until stable image hosting is available.
Refs: routing.json, agents/ (updated), templates/subissue.md (updated), domains/implement/README.md (updated), installed to-spec and to-tickets skills (updated), kokoromil/kokolog-monitor labels

## 2026-08-31 · issue branch names · #loop #infra
What: implementation PR branches now use stable issue-number and title slugs; existing remote issue branches park the frontier instead of creating duplicates.
Refs: routing.json, run/common.sh, run/loop-tick, run/domain-loop, run/doctor, README.md (updated)

## 2026-08-31 · direct role routing · #loop #infra
What: roles and retry escalation now declare provider models and variants directly; the runtime and dashboard no longer resolve model aliases.
Refs: routing.json, run/common.sh, run/loop-tick, run/doctor, web/, README.md (updated)

## 2026-08-31 · merged-unverified state · #loop #review
What: PRs merged before assurance finishes now enter a distinct terminal state with a visible reason; completed assurance remains done after merge.
Refs: run/common.sh, run/loop-tick, run/loop-status, web/server.mjs, README.md (updated)

## 2026-08-31 · parked decision label · #loop #decision
What: parked work now carries the neutral need-decision label on its issue and known PR; ready-for-worker is removed until work resumes.
Refs: routing.json, run/common.sh, run/doctor, README.md, kokoromil/kokolog-monitor labels (updated)

## 2026-09-01 · cycle-local model controls · #loop #infra
What: model and variant controls now sit inside the cycle that uses them, with task-specific names and synchronized shared verification routes.
Refs: web/app.js, web/index.html, web/styles.css, README.md (updated)

## 2026-08-31 · parked reason and transient retry · #loop #review
What: a parked PR now receives one reason comment, and implementation or review exit 143 receives one automatic retry before parking.
Refs: routing.json, run/common.sh, run/spawn, run/loop-tick, run/loop-status, README.md (updated)

## 2026-08-31 · operator status and safe reconcile · #loop #bench
What: Bench and loop-status now share one status reducer with attention, eligible frontier count, current sessions, PR assurance progress, and next actions; routine reconciliation no longer starts new frontier work.
Refs: web/status.mjs (new), web/ (updated), run/loop-status, run/loop-tick, domains/spec-sync/README.md, README.md (updated)

## 2026-09-01 · live operator console · #loop #bench
What: rebuilt Bench around one honest system mode, recommended safe action, ticket state machines, live activity, explicit attention owners, and separate ticket, decision, history, and health views; server-sent events replace blind refresh polling.
Refs: web/index.html, web/app.js, web/styles.css, web/server.mjs, web/status.mjs, web/view-model.mjs, test/ (updated)

## 2026-09-01 · post-merge audit resolution · #loop #review
What: added a guarded Operator Console action that records a human post-merge audit and clears a merged-unverified alert without converting missed assurance profiles to PASS.
Refs: web/audit.mjs, web/, run/common.sh, run/loop-tick, test/ (updated)

## 2026-09-01 · parked work dispositions · #loop #review
What: added guarded Resume assurance and Mark human-owned actions for parked PRs, with current-head checks, durable human notes, GitHub decision-label cleanup, and retained failed-verdict history.
Refs: run/resolve-ticket, web/, run/common.sh, run/loop-tick, test/ (updated)

## 2026-09-01 · profile-specific assurance routing · #loop #review
What: code, security, safety, and QMS verification now use independent model and variant routes shown in the Build & Verify cycle.
Refs: routing.json, run/loop-tick, run/doctor, web/, README.md (updated)

## 2026-09-01 · deterministic schedule environment · #loop #infra
What: installed schedules now receive explicit executable paths, reschedule validates the same environment before restart, and skipped preflight runs appear as degraded.
Refs: run/plists/, run/loop-tick, web/, test/, README.md (updated)

## 2026-09-01 · cost-bounded controller phases · #loop #infra
What: result collection and repository sync now run independently without model access; paid dispatch is the only implementation-session gateway and enforces a configurable global start limit.
Refs: routing.json, run/collect-results, run/sync-repository, run/dispatch-work, run/loop-tick, run/spawn, run/plists/, web/, test/, README.md (updated)

## 2026-09-01 · bounded review and independent repair · #review
What: reviewers now return one bounded set of blocking findings, QMS-only checks stay with QMS verification, and three independent repairs have a separate four-cycle review budget.
Refs: agents/, routing.json, run/loop-tick, run/doctor, web/, test/, README.md (updated)

## 2026-09-01 · controller audit and truthful session history · #review
What: history now separates revision cycles, per-gate runs, builds, and repairs; recorded routes remain historical; writing permissions work with the installed OpenCode runtime; reviews use immutable evidence; controller locks and recovery are deterministic; and the console handles large logs and failed background starts safely.
Refs: run/, agents/, web/, test/, README.md, domains/implement/README.md (updated)

## 2026-09-01 · unified severity-calibrated assurance · #loop #review
What: replaced separate code, security, safety, and QMS model gates with one unified review; only validated P0/P1 blockers schedule repairs or consume the repair budget, while P2/P3 observations remain advisory and PR revisions have no blocking ceiling.
Refs: agents/, templates/verdict.md, routing.json, run/assurance-classify, run/loop-tick, run/doctor, run/loop-status, web/, test/, README.md, domains/implement/README.md (updated)

## 2026-09-02 · assured merge reconciliation · #loop #review
What: a GitHub PR merged after unified assurance PASS now becomes a terminal local merged record only when its head matches the assured head; the Operator Console removes it from active work and shows it in resolved history.
Refs: run/common.sh, run/loop-tick, web/, test/, README.md (updated)

## 2026-09-02 · same-head assurance runtime retry · #loop #review
What: the Operator Console can requeue a reviewer runtime failure on the same immutable PR head when no verdict was written; it uses the current reviewer route, consumes no P0/P1 repair, and requires no owner note or risk acknowledgment.
Refs: run/resolve-ticket, web/, test/, README.md (updated)
## 2026-09-01 · ticket 36 verified · #implement
What: Unified assurance passed for e50024fad194a29cc0fa76499baeefff9132fcad; PR awaits owner merge.
Refs: /Users/zafar/dev/kokolog-loop/state/36.assurance-r4.json
## 2026-09-02 · ticket 37 verified · #implement
What: Unified assurance passed for 097721b5da1d914adc411c3537f973b4438ece62; PR awaits owner merge.
Refs: /Users/zafar/dev/kokolog-loop/state/37.assurance-r1.json
## 2026-09-02 · ticket 38 verified · #implement
What: Unified assurance passed for 14199afbcad3a19e4f2022789ef3f1a5bce4900c; PR awaits owner merge.
Refs: /Users/zafar/dev/kokolog-loop/state/38.assurance-r1.json
## 2026-09-02 · ticket 39 verified · #implement
What: Unified assurance passed for 1871875565170ff2bb5b1cadd3828c3a5086b022; PR awaits owner merge and bench validation.
Refs: /Users/zafar/dev/kokolog-loop/state/39.assurance-r3.json
