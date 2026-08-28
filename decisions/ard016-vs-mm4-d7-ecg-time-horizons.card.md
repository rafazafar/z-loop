---
kind: card
status: open
domain: spec-sync
parked-by: runtime verifier (cycle loop-spec-sync-20260828-225624)
date: 2026-08-29 05:22
---

# Does Accepted ARD016 stand, or did it silently decide MM4-D7 for the client?

## Context

The 2026-08-27 meeting transcript shows the client deferring the ECG Time
Horizon choice (13:41-16:14: client "needs time", 4/8/16 only tentatively
suggested). PRD008 correctly keeps the default and final preset set pending
as MM4-D7. But Accepted ARD016 lines 50-55 now mandates exactly 4/8/16
seconds, an 8-second default, session retention, and 16-second history —
requirements the transcript does not support. An Accepted ARD has decided
what was parked for human/client agreement, in a QMS-controlled repo.

## Option A — Ratify ARD016

- What: accept the 4/8/16 set, 8-second default, retention, and 16-second
  history as the decisions of record; spec-sync closes MM4-D7 citing ARD016.
- Better: matches PR 31 (draft) and epic #26 as already written; no ARD churn.
- Worse: ratifies requirements the client never explicitly approved; a QMS
  record would outstate the customer's actual position.

## Option B — Narrow ARD016 to the transcript

- What: amend ARD016 to remove (or mark pending) the 8-second default,
  retention, and 16-second history until the client answers MM4-D7.
- Better: the accepted record matches what the client actually said.
- Worse: ARD churn; PR 31's 8-second default and 16-second retention may
  need re-scoping once the client answers.

## Option C — Partial ratify

- What: accept 4/8/16 (tentatively proposed on the record), keep the default
  and retention targets pending in MM4-D7.
- Better: nothing ratified beyond what the transcript supports; the preset
  set unblocks #30's UI work.
- Worse: PR 31's 8-second default would still need client confirmation.

## Evidence

- /Users/zafar/dev/kokolog-monitor/docs/meeting-transcripts/定例MTG_20260827.txt (13:41-16:14)
- /Users/zafar/dev/kokolog-monitor/docs/apps/graph_ui_demo/PRD008-mobile-monitor-four-patient-display.md lines 52/98/198 (MM4-D7 kept pending)
- /Users/zafar/dev/kokolog-monitor/docs/ard/ARD016-mobile-monitor-waveform-rendering.md lines 50-55 (mandates 4/8/16, 8-second default, retention)
- /Users/zafar/dev/kokolog-loop/state/sessions/loop-spec-sync-20260828-225624-verify.result (verifier finding)

## Recommendation

B unless you know the client ratified these values off-record — an accepted
record must not outstate the customer; downgrade to A if they did.

## Default if unanswered

B — narrow ARD016; MM4-D7 stays pending until the client answers.
