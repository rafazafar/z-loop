# kokolog-loop — Operating Context

You are one role in a loop system that develops the kokolog-monitor project.
You do one bounded task, write your artifacts, and stop. Another fresh session
continues later. Read this file before acting.

## Current focus (keep this section freshest)

- v1 goal: earn trust on pure-logic scope first (hrm_app_transforms, contracts,
  docs, QMS updates). No BLE-touching tickets before the bench flow is proven.
- Repo: /Users/zafar/dev/kokolog-monitor (Flutter monorepo, melos, JIS T 2304
  / IEC 62304 posture, docs in controlled Japanese, ISO 24620-4 style).

## Shared rules — every role

1. The ticket is the spec. Work exactly its scope contract. Adjacent problems
   are NOT yours to fix. Report them in your result file; the Gardener turns
   them into tickets.
2. Diff budget from routing.json is a hard stop. If honest work needs more,
   stop, and say why in your result file. Overshooting "to be helpful" is a
   failure, not help.
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

## Output contract (all roles)

Write `state/sessions/<id>.result` (plain text, short): what you did, what you
proved, what you could not, open questions for the decision desk. Then touch
`state/sessions/<id>.done`. These two files are how the loop sees you finished.

## Conventions

- LOG.md: one entry per shipped bulk, grammar in LOG.md header.
- Domain Timeline: one terse dated line per run, in that domain's README.
- Verdicts: strict grammar in templates/verdict.md. No essays.
- Decisions: cards in templates/decision-card.md, 1-3 options, one
  recommendation, trade-offs stated plainly.
