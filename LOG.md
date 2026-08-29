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
What: desired-state assurance reconciliation bound to immutable PR OIDs; profile classifier with per-profile read-only reviewers; prove-it ran live on ticket 13 and parked correctly on a merged PR.
Refs: run/loop-tick (rewritten), run/assurance-classify (new), agents/assurance-reviewer.md (new), run/doctor, run/common.sh, web/ (updated)

## 2026-08-28 · bench labels + bench-pending verdict · #loop #implement
What: two-fact label semantics (ready-for-agent vs needs-device) keep pure bench tickets out of the frontier while mixed tickets run; reviewers may land BENCH: pending (done awaits human bench validation); frontier jq quoting bug fixed by live tick; spec-sync staging budget made explicit and failed staging preserved.
Refs: run/loop-tick, run/domain-loop, run/spawn-exec, agents/reviewer.md, agents/assurance-reviewer.md, agents/ticketer.md, templates/subissue.md, templates/verdict.md, domains/*/README.md (updated)

## 2026-08-29 · auto-cardify + crash recovery · #loop #infra
What: verifier FAILs and exhausted transcript attempts now park OPEN decision cards automatically (deduped, dashboard-answerable); a frontier implementer lost without its done sentinel re-queues up to max_impl_attempts, then parks with an auto card.
Refs: run/common.sh (park_auto_card), run/domain-loop, run/spec-sync-trigger, run/loop-tick (updated)
