# kokolog-loop

Private loop system for the kokolog-monitor project. It lives outside the client
repo on purpose. The client repo stays clean. GitHub is the shared memory. This
directory is the brain.

## Layout

```text
AGENTS.md        operating context every agent session reads first
LOG.md           global work feed (strict grammar, bottom-appended)
routing.json     project, model routing, and policy (single source of truth)
agents/          domain-agent and bounded worker prompts
templates/       subissue / spec / decision-card / device-protocol / verdict
domains/         one charter per loop: focus, backlog, timeline, metrics
verdicts/        reviewer verdicts (kind artifact, domain-tagged)
decisions/       decision queue files + answered cards
signals/         gardener evidence with frequency counting
evals/           canned tickets for prompt regression tests
state/           machine state (gitignored): tickets, sessions, sentinels
logs/            run logs incl. raw opencode JSON events (gitignored)
clones/          per-ticket git clones (gitignored)
run/             domain runtime, tick engine, spawner, status, doctor, timers
```

Agent prompts need no opencode install or config in this repo: each spawn
composes a per-session prompt file pointing the agent at its role file in
agents/, and `--model` ids resolve against your existing GLOBAL opencode
providers (9router, openai, zai coding plan — whatever each routing role
references). Each role also sets the OpenCode reasoning `variant` passed to
`opencode run`. Nothing is written outside this directory and the client repo's
GitHub.

## Configuration

All local loop settings live in `routing.json`. Set `project.repo_path` to the
client checkout. The loop derives the GitHub repository from that checkout's
`origin` remote.

`github.base_branch` is the required PR base. The frontier clones that branch
from the client origin for every new ticket, tells the implementer to use it,
and rejects a PR with another base. This keeps later tickets on the current
remote base even when the configured local checkout is stale.

`github.branch_prefix` names implementation branches as
`<prefix>-<issue>/<title-slug>`, for example
`issue-44/create-the-mobile-monitor-product-application`. The issue number is
stable even if the issue title later changes. The slug is lowercase ASCII,
limited to 64 characters, and falls back to `work` for a title without ASCII
letters or digits. If any remote branch already exists under the issue
namespace, the frontier parks instead of creating a duplicate. Other domain
cycles use `<domain>/<timestamp>` branches.

If a PR merges before its required unified assurance review passes, the ticket enters
the terminal `merged-unverified` state. This records that GitHub work is
complete but the loop's pre-merge assurance was bypassed. It is not a parked
decision and does not block the frontier.

The Operator Console can clear this active alert only after an owner records an
post-merge audit note and accepts the exception. The ticket then enters
`merged-audited`. The audit record keeps the PR, immutable head, original
review count, note, owner, and time. This action does not convert the missed
assurance review to PASS.

After unified assurance passes, an owner merge moves the ticket from `done` to
the terminal `merged` state. The controller records the merge only when the
GitHub head matches the assured head. The Operator Console then removes the
ticket from active work and keeps it in resolved history.

When a ticket enters `parked`, `github.decision_label` is added to its GitHub
issue and known PR, and `github.frontier_label` is removed from the issue. The
known PR receives one comment with the parked reason. If no PR exists, the
issue receives the comment. The label is cleared if work resumes. The parked
state remains the source for the decision desk; the GitHub label and comment
are its shared visibility surface.

The Operator Console gives parked PRs two explicit dispositions. **Resume
assurance** normally requires a new open-PR revision, records the owner
intervention, clears the decision label, and starts a safe reconcile on the new
PR revision.
**Mark owner-managed** closes automated control, records the current PR head and
owner note, clears the decision label, and retains prior failures without
converting them to PASS.

An implementation or review process failure does not change the ticket phase
or add a GitHub decision label. The controller records it separately and may
start one automatic clean retry. The retry reads the current GitHub issue and
PR, creates a new checkout at the authoritative remote head, and receives only
the current task or P0/P1 blockers. Failed local edits and prior JSONL are not
reused. The Operator Console can authorize another clean retry after the
automatic allowance is exhausted.

Each writing session owns its checkout through a durable lock. A retry cannot
start until the previous process group is confirmed dead and the checkout has
no live writer. The collector stops a worker after 15 minutes without a model
or tool event, after 80 model steps, or at the final wall-clock limit. Shutdown
sends TERM to the complete process
group, escalates to KILL after the configured grace period, and verifies death
before a retry can start.

Model workers inherit providers, credentials, model limits, and compaction from
the global OpenCode configuration. They disable interactive package plugins and
the unrelated Google Docs MCP for the headless run, so a login prompt or MCP
startup cannot hold the workflow open.

Reviewer runtime failures use the same clean-retry path. The controller creates
a new read-only checkout and copies only the immutable patch, issue snapshot,
terminal CI evidence, and current implementation result into private review
evidence. A runtime retry does not consume a P0/P1 repair round.

Edit the objects under `roles` in `routing.json`. `model` is the full OpenCode
provider/model ID. `variant` is the provider-specific reasoning effort passed
with `--variant`. One reviewer handles the applicable acceptance, code,
security, safety, and QMS dimensions. Build, unified review, and repair have
independent routes. The Operator Console shows these controls in the Build &
Verify cycle.

List installed models with `opencode models`. Inspect supported variants with
`opencode models <provider> --verbose --pure`. Then run `run/doctor`.

## Execution model

Each domain README is an executable seven-field contract: Goal, Trigger,
Discover, Act, Verify, Persist, and Exit. A scheduled run handles one bounded
cycle and then stops. Durable files carry understanding into the next cycle.

`implement` is a deterministic queue-drain and maker-checker workflow. One
controller heartbeat collects completed work, reconciles GitHub, and fills only
the available paid-session slots. It obeys `rules.max_concurrent_sessions`.
The other domains run one top-level
OpenCode actor that owns semantic discovery. The runtime then launches a fresh
verifier session. New loop artifacts stay under `state/staging/` until that
verifier passes. Runtime scripts own a single-flight domain lock, clone
isolation, timeouts, strict result validation, durable cycle records, artifact
promotion, and Timeline recording. There is no global LLM conductor; domains
coordinate through GitHub and the shared artifact folders.

Before it starts a PR reviewer, paid dispatch samples the check
rollup for the current PR head. Missing, pending, or unavailable checks defer
review without consuming a repair. Terminal checks start review whether they
passed or failed; the reviewer diagnoses failures and still checks the ticket.
The controller supplies each reviewer with an immutable patch plus issue and
terminal-CI snapshots, so read-only review does not depend on shell permissions.
The classifier selects applicable dimensions, not separate gates. One reviewer
returns one severity-calibrated verdict for the whole revision. Only P0 and P1
issues block and schedule a repair. P2 and P3 observations remain advisory and
do not consume the repair budget. The initial build does not consume that
budget. `rules.max_fix_attempts` limits only P0/P1-triggered repairs; PR revision
history has no separate blocking ceiling. Existing CI remains unchanged.

Writing sessions use OpenCode's scalar edit permission inside disposable
checkouts. The installed runtime does not apply specific allow paths after a
wildcard edit denial. Checkout isolation and deterministic harvest validation
enforce the repository boundary.

## Run it (manual first — timers stay OFF until each loop proves itself)

```bash
run/doctor                  # preflight: binaries, gh auth, repo, routing
run/dashboard               # local web overview and loop controls
run/collect-results         # collect completed results; never start a model session
run/sync-repository         # refresh PR and queue state; never start a model session
run/dispatch-work --current # start bounded paid work for a tracked ticket
run/dispatch-work --next    # start one new issue only when tracked paid work is clear
run/dispatch-work           # scheduled policy: tracked work first, then frontier
run/domain-loop <domain>    # one blocking non-implementation domain cycle
run/domain-loop decision-desk --dry-run  # inspect resolved routing without a model call
run/loop-status             # what the machine is doing right now
run/decision-batch          # assemble the human decision queue
run/spec-sync-trigger       # poll for new meeting transcripts (own timer)
```

A run is a gate, not a promise to produce work. Empty queues exit without a
model call where deterministic discovery is available. One domain-runtime lock
serializes non-implementation actors in v1 without blocking implementation
harvesting. Every cycle selects at most one work unit and writes one terminal
Timeline entry.

`run/dashboard` opens the Operator Console at `http://127.0.0.1:4177`. It binds
to localhost only. Set `KOKOLOG_DASHBOARD_PORT` to use another port. The console
and `run/loop-status` use the same status reducer. The console receives live
state events and separates current work, tickets, decisions, history, and
system health. Its current-work view shows each ticket as a state machine with
completed, running, awaiting-harvest, blocked, and future steps. `enabled`
means that the domain configuration is active. `armed` means that its launchd
timer is loaded. These states are separate.

For an always-available console during the current macOS login session, install
and load `dev.kokolog.loop.dashboard.plist`. It starts at login and launchd
restarts it after an unexpected exit. The persistent service uses port 4177 and
writes `logs/launchd-dashboard.out` and `logs/launchd-dashboard.err`.

The Control Center is the normal operator surface. From it, you can:

- collect completed results without starting a model session;
- advance tracked work within the configured paid session limit;
- start the next ready issue explicitly;
- pause or resume each workflow;
- install and start, or stop, each configured launchd schedule;
- change interval or daily schedule timing; an active schedule restarts safely and rolls back if reload fails;
- change each cycle's model and provider-supported reasoning variant beside the
  controls that use it. Unified assurance and repair appear as independent
  Build & Verify steps.

One controller heartbeat runs every minute. It collects completed work,
reconciles GitHub, and fills only the free paid-session slots. There is no
separate repository snapshot timer. Every state-changing control has a
confirmation step.
Model changes apply to new workers only. Running sessions keep the route that
they had when they started.

Installed schedules use an explicit executable path that includes the active
Node.js runtime, OpenCode, and Homebrew tools. Starting or changing a schedule
runs preflight with that exact environment. The Control Center reports a
skipped scheduled run as degraded.

Use **Collect results** freely; it cannot start a model session. Use **Advance
current work** to authorize paid work for a tracked ticket. Use **Start next
issue** only when the queue has no tracked paid step.

Sessions run detached under tmux. Watch one live: `run/spawn peek <name>`.
Truth is never the pane. Truth is the result file plus changed files.

## Inspection surfaces

| Question | Surface |
|---|---|
| What is the loop doing, and what needs action? | `run/loop-status` or Bench |
| What work can start now? | Bench `ELIGIBLE` count or the `frontier` section in `run/loop-status` |
| What is each PR still missing? | Bench `Tickets and assurance` or the matching CLI section |
| What did this run say? | `logs/<ticket>-<role>.jsonl` (raw replayable events) |
| What do you need from me? | `decisions/<date>-queue.md` |
| What shipped? | GitHub PRs, LOG.md, domain Timelines |

## Enable timers (only after a loop passed its prove-it run)

```bash
run/install-launchd         # copies plists to ~/Library/LaunchAgents (no load)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.kokolog.loop.dashboard.plist
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
| Global LLM conductor | a real event cannot be routed to one domain deterministically |
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
