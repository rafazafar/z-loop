# kokolog-loop

Private loop system for the kokolog-monitor project. It lives outside the client
repo on purpose. The client repo stays clean. GitHub is the shared memory. This
directory is the brain.

## Layout

```text
AGENTS.md        operating context every agent session reads first
LOG.md           global work feed (strict grammar, bottom-appended)
routing.json     role -> model+variant alias + policy rules (single source of truth)
agents/          six role prompts (passed per-session via prompt files)
templates/       subissue / spec / decision-card / device-protocol / verdict
domains/         one charter per loop: focus, backlog, timeline, metrics
verdicts/        reviewer verdicts (kind artifact, domain-tagged)
decisions/       decision queue files + answered cards
signals/         gardener evidence with frequency counting
evals/           canned tickets for prompt regression tests
state/           machine state (gitignored): tickets, sessions, sentinels
logs/            run logs incl. raw opencode JSON events (gitignored)
clones/          per-ticket git clones (gitignored)
run/             tick engine, spawner, status, doctor, launchd install
```

Agent prompts need no opencode install or config in this repo: each spawn
composes a per-session prompt file pointing the agent at its role file in
agents/, and `--model` ids resolve against your existing GLOBAL opencode
providers (9router, openai, zai coding plan — whatever routing.json aliases
reference). Each alias also sets the OpenCode reasoning `variant` passed to
`opencode run`. Nothing is written outside this directory and the client repo's
GitHub.

## Model routing

Edit the objects under `aliases` in `routing.json`. `model` is the full
OpenCode provider/model ID. `variant` is the provider-specific reasoning
effort passed with `--variant`. Roles and retry rules refer to the alias name.

List installed models with `opencode models`. Inspect supported variants with
`opencode models <provider> --verbose --pure`. Then run `run/doctor`.

## Run it (manual first — timers stay OFF until each loop proves itself)

```bash
run/doctor                  # preflight: binaries, gh auth, repo, routing
run/loop-tick --once        # one heartbeat: harvest, frontier check, reaping
run/loop-status             # what the machine is doing right now
run/decision-batch          # assemble the human decision queue
run/spec-sync-trigger       # poll for new meeting transcripts (own timer)
```

A tick is a gate, not a heartbeat that always works. No ready tickets, no
transcripts, nothing parked -> it exits in seconds. Every tick is idempotent.
Safe to re-run. Safe to run twice.

Sessions run detached under tmux. Watch one live: `run/spawn peek <name>`.
Truth is never the pane. Truth is the result file plus changed files.

## Inspection surfaces

| Question | Surface |
|---|---|
| What is the loop doing? | `run/loop-status`, `tail -f logs/*.log` |
| What did this run say? | `logs/<ticket>-<role>.jsonl` (raw replayable events) |
| What do you need from me? | `decisions/<date>-queue.md` |
| What shipped? | GitHub PRs, LOG.md, domain Timelines |

## Enable timers (only after a loop passed its prove-it run)

```bash
run/install-launchd         # copies plists to ~/Library/LaunchAgents (no load)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.kokolog.loop.tick.plist
```

Pause one loop without touching launchd: set `status: paused` in that domain's
README frontmatter. The tick respects it.

## Deferred — do NOT pre-build

| Feature | Trigger to build it |
|---|---|
| Webhook triggers via self-hosted runner | polling cadence becomes a bottleneck |
| fswatch instead of 10-min poll for transcripts | poll latency actually hurts |
| Parallel implementer sessions | single-flight proves too slow, AND clones stay collision-free |
| Crabbox/cloud per-agent boxes | parallel sessions collide on broker/ports |
| sqlite/vector index over artifacts | ripgrep gets slow past ~10k artifacts |
| Reconcile daemon for signals | autonomous volume creates real duplicates |
| Eval auto-run on prompt commit | evals exist and prompt churn stabilizes |

## Lineage

Organization conventions adapted from AI-Builder-Club's skills (ARCHITECTURE /
LOG grammar / domains-hold-charters). Ticket flow from the pocock to-spec /
to-tickets skills (tracer bullets, blocking edges, expand-contract). Sentinel
spawn pattern from open-agent-teams. Verdict grammar and evidence-carrying PRs
from verifier-setup. Scheduling and quality layers are ours.
