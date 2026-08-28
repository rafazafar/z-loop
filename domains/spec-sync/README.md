---
kind: domain
domain: spec-sync
status: active
goal: Turn each new meeting transcript into a doc/spec/ARD PR with citations checked
cadence: poll every 10m (launchd, not yet loaded)
trigger: A new transcript file or a manual run
discover: Reconcile the transcript directory and select the oldest unseen transcript
act: Run one distiller cycle in an isolated client-repo clone and open at most one draft doc PR
verify: A fresh read-only checker must confirm every citation, repository check, draft state, and operation key
persist: Store the PR or decision cards, the verified cycle record, the transcript hash state, and one Timeline entry
exit: Stop on verified PR, no new transcript, ambiguity requiring a human, timeout, or failed verification
---

# spec-sync

Consumes: new files in docs/meeting-transcripts/ of the client repo.
Produces: doc-only PRs, decision cards for ambiguous readings, ARD drafts.

The distiller is the top-level domain actor. The runtime launches a fresh
verifier and owns isolation, completion validation, and per-hash acknowledgment.

## Current understanding

Prove one full transcript -> PR cycle manually before enabling the timer.
A PASS cycle stages at most one artifact — one decision card when a human
decision is parked. The runtime writes the cycle record; never stage signal
files.

## Backlog

- [x] First manual run over the newest archived transcript (PR 24, merged)
- [ ] One resilience re-run of transcript 定例MTG_20260827.txt under the
  staging-budget contract, then ack its ledger entry

## Timeline
2026-08-28 | cycle loop-spec-sync-20260828-225624 | FAIL: NOOP cannot pass because live source contains a broken transcript citation and an Accepted ARD that silently fixes the still-pending MM4-D7 choice, so discovery is not empty and the citation and human-boundary checks fail although scope, staging, draft-state, and idempotency checks pass.
2026-08-27 | cycle loop-spec-sync-20260827-121644 | FAIL: spec-sync staged too many artifacts

## Metrics

- runs.jsonl: transcripts seen, PRs opened, cards parked
