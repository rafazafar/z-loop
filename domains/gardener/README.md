---
kind: domain
domain: gardener
status: paused
goal: Convert recurring evidence into proposed issues and loop-self improvements; never edit anything directly
cadence: weekly (Sunday 20:00, launchd, not yet loaded)
trigger: Weekly schedule or a manual run
discover: Select one recurring signal or one evidence-backed repo or loop drift finding
act: Stage one proposal card and stop before signal mutation or GitHub publication
verify: A fresh checker confirms every claim has a source, no duplicate exists, and no code or prompt was edited
persist: Promote the verified proposal card and store its operation key, cycle record, and one Timeline entry
exit: Stop after one proposal, when no actionable evidence exists, on ambiguity, or on failed verification
---

# gardener

Consumes: signals/, verdicts/ history, repo drift, loop prompt files.
Produces: verified proposal cards.

The gardener is the top-level domain agent. It proposes changes and never acts
as an implementer.

## Current understanding

The runner is available. The first scheduled sweep waits until the loop has two
weeks of verdicts to mine.

## Backlog

- [ ] First weekly sweep
- [ ] First quarterly context-audit of agents/*.md and AGENTS.md

## Timeline

## Metrics

- sweeps.jsonl: signals created/bumped, issues proposed, cards parked
