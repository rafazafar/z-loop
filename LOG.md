# Work Log

Append-only global feed. Newest at the BOTTOM (append-only avoids merge
conflicts; multi-writer safe). One entry per shipped bulk of work, written
right before the commit or PR that ships it.

Entry grammar (strict — one header line per entry):

    ## YYYY-MM-DD · Short title · #tag1 #tag2
    What: 1-2 lines, outcome first.
    Refs: [doc](path) (new|updated), PR/commit links.

Rules:
- Keep entries SHORT: header + What + Refs, nothing else.
- Reuse tags before inventing new ones. Current set:
  #loop #infra #implement #review #spec #tickets #decision #garden #bench
- Detail goes in the artifact's Timeline, not here.

Query recipes:
- Index, one line per entry:  grep '^## 20' LOG.md
- Last five entries in full:  awk 'BEGIN{RS="## "} END{print "## "$0}' LOG.md
- Entries for a topic:        awk '/^## 20/{p=0} /#loop/{p=1} p' LOG.md
- Entries for a month:        awk '/^## 2026-08/' LOG.md

## 2026-08-26 · loop system v1 skeleton · #loop #infra
What: built ~/.kokolog-loop skeleton — agents, templates, domains, tick engine, launchd plists (not loaded).
Refs: README.md (new), AGENTS.md (new), run/ (new)
