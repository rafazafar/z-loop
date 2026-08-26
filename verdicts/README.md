# verdicts/

Kind: verdict. One file per review round: `<ticket>-verdict.md` (latest round
wins; keep history, never overwrite — the tick reads the newest by mtime).

Schema is templates/verdict.md. Frontmatter must include domain, ticket, pr,
round. Body grammar is strict; the tick parses VERDICT/TASK lines.

Rules:
- Written ONLY by the reviewer role.
- A verdict with empty or missing evidence paths is invalid — treat as FAIL
  (unproven), never as PASS.
