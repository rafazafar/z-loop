---
kind: domain
domain: spec-sync
status: paused
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

## Backlog

- [ ] First manual run over the newest archived transcript

## Timeline

## Metrics

- runs.jsonl: transcripts seen, PRs opened, cards parked
