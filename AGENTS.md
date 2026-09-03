# Autonomous Loop — Operating Context

You are one role in a loop system that develops the client project configured
in `config.json`. You do one bounded task, write your artifacts, and stop. Another
fresh session continues later. Read this file before acting.

## Operating model

- Execution model: one top-level OpenCode agent runs each non-implementation
  domain cycle. The implementation domain keeps its deterministic maker-checker.
- Every domain declares Goal, Trigger, Discover, Act, Verify, Persist, and Exit.
  Runtime code owns locks, isolation, timeouts, and result validation.

## Shared rules — every role

1. The ticket is the spec. Work exactly its scope contract. Adjacent problems
   are NOT yours to fix. Report them in your result file; the Gardener turns
   them into tickets.
2. Diff budget from config.json is a planning threshold, not a raw file-count
   gate. Stop when the ticket has more than one independently mergeable outcome
   or requires unrelated design decisions. Generated scaffolding, lockfiles,
   and mechanical output may exceed the threshold when the semantic change is
   still one reviewable outcome; explain the excess in the result file.
3. Never weaken a test, assertion, or lint to go green. If a test is stale,
   say so and stop. The human decides.
4. Proof, not claims. Cite commands you ran and their exit status. Reference
   evidence files you produced. A claim without a path is not evidence.
5. Do not write secrets, tokens, or account names into any file here.
6. Keep every artifact short and plain. One sentence, one meaning.
7. State lives in files (state/, verdicts/, decisions/, domains/*/Timeline),
   never in your memory. Next session knows only what files say.
8. For the client repo: follow its AGENTS.md, its ARD decisions, and its
   controlled-Japanese doc rules. Never commit loop internals there.
9. Runtime code is the sole owner of session `.done` files and domain Timeline
   entries. Agents write complete result artifacts atomically and never signal
   their own completion.
10. A question that requires human judgment must become a decision card. Do not
    leave a human gate only as prose in a result file.

## Output contract (all roles)

Write `state/sessions/<id>.result` atomically (plain text, short): what you did,
what you proved, what you could not, and open questions for the decision desk.
`run/spawn-exec` writes the `.done` sentinel only after OpenCode exits.

## Conventions

- LOG.md: one entry per shipped bulk, grammar in LOG.md header.
- Domain Timeline: one terse dated line per run, in that domain's README.
- Verdicts: strict grammar in templates/verdict.md. No essays.
- Decisions: cards in templates/decision-card.md, 1-3 options, one
  recommendation, trade-offs stated plainly.
