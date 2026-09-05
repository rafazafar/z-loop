---
kind: domain
domain: spec-sync
status: active
goal: Turn each new meeting transcript into a doc/spec/ARD PR with citations checked
cadence: poll every 10m (launchd, not yet loaded)
trigger: A new or changed transcript in the local meeting-transcripts folder or an explicit manual run
discover: Snapshot stable local transcripts and select the oldest pending transcript; fetch the configured base revision for document edits
act: Run one distiller cycle in an isolated client-repo clone and open at most one draft doc PR
verify: Runtime checks bind the source hash, document-only PR diff, base, draft state, and head; a fresh verifier checks citations in an isolated evidence directory
persist: Store the PR or decision cards, the verified cycle record, the transcript hash state, and one Timeline entry
exit: Stop on verified PR, no new transcript, ambiguity requiring a human, timeout, or failed verification
---

# Meeting Notes → Draft Spec PR

Consumes: local UTF-8 .txt or .md files in docs/meeting-transcripts/.
The file does not need a Git commit.
The draft PR includes the selected transcript so citations remain available.
Produces: one draft PR with the source transcript and required document additions, changes, or deletions.
The PR can include specs, CMPs, ARDs, and PRDs.
Unclear decisions produce a combined decision card and remain visible in the draft PR.

The distiller is the top-level domain actor. The runtime launches a fresh
verifier and owns isolation, completion validation, and per-hash acknowledgment.

## Current understanding

The display name identifies the input and draft PR output.
The internal domain ID remains spec-sync.
The domain remains paused until one real draft PR cycle and its repeat pass.

Run `run/spec-sync-trigger --manual` for one cycle while paused.
The enabled flag still applies.
This command never loads a timer.
Only regular, nonempty UTF-8 transcript files are eligible.
The runtime waits until a file has not changed for at least 10 seconds.
It snapshots the file and verifies its hash in the isolated clone.
Document edits start from the current configured remote base branch.
Temporary files are ignored.
A YYYYMMDD date in the filename sets processing order.
For other names, the file modification date sets processing order.
An invalid date, empty file, or link stops discovery with an error.
A new ledger processes existing transcripts unless they have explicit legacy acknowledgments.

The trigger lock covers selection, execution, and acknowledgment.
A terminal cycle can repair a missing ledger acknowledgment after a crash.
A BLOCKED cycle stages one combined decision card.
A PASS or NOOP cycle stages nothing.
Attempts and prior PR evidence remain available after retries.

After a card is decided, queue a retry with:
`run/spec-sync-trigger --retry <SHA256> --card decisions/<name>.card.md`
The card must cite the exact `spec-sync:<SHA256>` operation key.
The retry command records the explicit retry request; it does not start an actor.
Use `--manual` for the subsequent run while the domain is paused.
The default retry allowance is three failed attempts per authorized round.
Set `domains.spec_sync.max_attempts` to change that allowance.

Evidence stays in `state/evidence/<cycle>/` after clone cleanup.
The runtime records exact-head CI status, including absent or pending checks.
Draft verification does not grant permission to merge.

## Backlog

- [x] First manual run over the newest archived transcript (PR 24, merged)
- [x] Reconcile transcript 定例MTG_20260827.txt after PR 91 and acknowledge
  its completed ledger entry

## Timeline
2026-08-31 | reconciliation | RESOLVED: PR 91 corrected the PRD008 transcript citation and recorded the qualified ECG time-horizon decision in PRD008 and ARD016. The transcript hash is completed in state/specsync.ledger, and both verifier decision cards are decided. The 2026-08-28 failed cycle remains historical evidence.
2026-08-28 | cycle loop-spec-sync-20260828-225624 | FAIL: NOOP cannot pass because live source contains a broken transcript citation and an Accepted ARD that silently fixes the still-pending MM4-D7 choice, so discovery is not empty and the citation and human-boundary checks fail although scope, staging, draft-state, and idempotency checks pass.
2026-08-27 | cycle loop-spec-sync-20260827-121644 | FAIL: spec-sync staged too many artifacts

## Metrics

- runs.jsonl: transcripts seen, PRs opened, cards parked
