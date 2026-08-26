---
kind: domain
domain: spec-sync
status: paused
goal: Turn each new meeting transcript into a doc/spec/ARD PR with citations checked
cadence: poll every 10m (launchd, not yet loaded)
---

# spec-sync

Consumes: new files in docs/meeting-transcripts/ of the client repo.
Produces: doc-only PRs, decision cards for ambiguous readings, ARD drafts.

## Current focus

Prove one full transcript -> PR cycle manually before enabling the timer.

## Backlog

- [ ] First manual run over the newest archived transcript

## Timeline

## Metrics

- runs.jsonl: transcripts seen, PRs opened, cards parked
