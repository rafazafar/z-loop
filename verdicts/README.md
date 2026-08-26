# verdicts/

Kind: verdict. One file per ticket: `<ticket>-verdict.md`. Each review round
OVERWRITES it; the tick reads this fixed path and greps anchored `VERDICT:` /
`TASK:` lines. Round history lives in `logs/<ticket>-rev-rN.jsonl` and the PR.

Schema is templates/verdict.md. Frontmatter must include domain, ticket, pr,
round.

Rules:
- Written ONLY by the reviewer role.
- A verdict with empty or missing evidence paths is invalid — treat as FAIL
  (unproven), never as PASS.
