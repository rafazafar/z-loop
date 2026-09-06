# z-loop

Durable repository automation for one host.

z-loop turns a Git repository into a supervised work loop. It plans work,
implements changes, runs checks, reviews results, and integrates what passes.
A local dashboard shows state, evidence, and history. All progress is stored
in SQLite, so work survives a restart. A crash cancels an attempt. It never
erases the work item or fakes a pass.

```text
plan   inspect ─▶ plan ─▶ plan review ─▶ bounded work items

code   implement ─▶ verify ─▶ model review ─▶ integrate ─▶ confirm
```

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [The manager](#the-manager)
- [Work and workflows](#work-and-workflows)
- [Automations](#automations)
- [Dashboard](#dashboard)
- [Command line](#command-line)
- [State and code layout](#state-and-code-layout)
- [Safety rules](#safety-rules)
- [Operations](#operations)
- [Development](#development)
- [Documents](#documents)
- [Limits](#limits)

## Requirements

| Need | Why |
| --- | --- |
| Node.js 22.18+ | The runtime uses Node built-in modules and SQLite. |
| Git | One repository per state directory. Integration is local. |
| OpenCode | The default model worker. Install and sign in before model work. |
| GitHub CLI | Only for GitHub issue intake or GitHub integration. |
| Check tools | The commands your repository's verification checks call. |

## Quick start

```sh
npm ci
npm start
```

1. The manager opens the browser on its own. To open it again later, run `./bin/z-loop console --manager` (the token is in `.loop-manager/token`).
2. Use **Add repository**. The manager inspects the folder: branch and checks.
3. Walk the setup guide: repository, worker and checks, review.
4. Add your first work item in the queue.

Setup never runs checks and never calls a model. The queue starts empty.
If no checks are detected, add one before code work. A code workflow without
configured checks is rejected.

## The manager

`npm start` runs the manager. It is one process with one dashboard on port
4188. It keeps one state store, controller, and worker loop per repository.

| Part | Job |
| --- | --- |
| Manager | One dashboard address. One dispatch lease. Shared limits. |
| Managed repository | Own SQLite store, controller, worker, and integration lock. |
| External endpoint | An existing service, attached through its own authenticated API. |

Shared limits span all managed repositories. They are: concurrent attempts and
a daily model-attempt budget. Lost attempts still count. When a store cannot
be read, new work waits until usage is known again.

Existing services stay independent. The manager reads their state and sends
commands through their API. It never writes to their store a second time.
Attach works on a running service. Transfer to managed execution needs a
stopped listener and an expired lease. Identity and state paths stay fixed.

Repository CLI commands accept `--manager-home PATH`, or `Z_LOOP_MANAGER_HOME`.
The default manager state directory is `.loop-manager`.

## Work and workflows

Each work item states one outcome. It needs:

- **Outcome:** the change you want.
- **Scope and instructions:** affected behavior and constraints.
- **Acceptance criteria:** observable proof of completion.

| Workflow | Use when | Steps |
| --- | --- | --- |
| `code` | The change is known. | Implement → verify → review → integrate → confirm. |
| `plan` | The next change needs study. | Inspect → plan → plan review → bounded work items. |

Keep items small. Add dependencies when one item must finish first. A failed
check or review becomes separate repair work. Assertions are never weakened.

## Automations

Automations create recurring work from a source. Pause stops new work. It does
not cancel queued work.

| Source | Trigger |
| --- | --- |
| Schedule | An interval. Runs from one schedule do not overlap. |
| Commits | A new commit on the base branch. No change, no work. |
| Files | A new or changed Markdown, text, or JSON file in a folder. |
| GitHub issues | An open issue with a chosen label. Blocked issues are filtered. |

Use `plan` for broad inspection. Use `code` for a known, bounded change.
Unchanged input consumes no model calls.

## Dashboard

| Page | Use |
| --- | --- |
| Work queue | Create, search, inspect, cancel, or rerun work. |
| Automations | Manage sources that create recurring work. |
| External input | Answer questions that need a human fact or decision. |
| Activity | Inspect runtime events and their details. |
| Settings | Capacity, limits, worker, model, and checks. |
| System | Runtime information, database check, and backups. |

The manager view adds all repositories, shared limits, and combined work
search. Each repository also has its own dashboard, with activity search.

## Command line

The CLI is `./bin/z-loop`. Run it from the checkout. All commands accept
`--home PATH`.

| Task | Command |
| --- | --- |
| Start the manager | `npm start` |
| Open a repository dashboard | `./bin/z-loop console` |
| Open the manager dashboard | `./bin/z-loop console --manager` |
| Set up without a browser | `./bin/z-loop init --repo PATH` then `serve` |
| Show status | `./bin/z-loop status` |
| Check prerequisites and database | `./bin/z-loop doctor` |
| Add work | `./bin/z-loop add --file work.json` |
| Add an automation | `./bin/z-loop automation --file automation.json` |
| Send a manager command | `./bin/z-loop command --file command.json` |
| Pause / resume dispatch | `./bin/z-loop pause` / `resume` |
| Cancel a run | `./bin/z-loop cancel --run RUN_ID` |
| Start a new run | `./bin/z-loop retry --work WORK_ID` |
| Answer a question | `./bin/z-loop answer --decision ID --text TEXT` |
| Create a backup | `./bin/z-loop backup` |
| Show help | `./bin/z-loop help` |

Queue and control commands need the running service. `init`, `doctor`, and
`backup` can run offline. A backup needs paused dispatch and zero active
attempts. Every write carries an operation key, so a lost response can be
replayed safely. JSON examples for work and automations are in
[`examples/`](examples/).

## State and code layout

| Path | Content |
| --- | --- |
| `.loop-manager/` | Manager database, token, and per-repository state. |
| `.loop/` | One repository: `config.json`, token, `state.db`, evidence, logs. |

Never delete a state directory to clear an error. It holds the history and
saved work needed for recovery.

| Code | Responsibility |
| --- | --- |
| `src/store.ts` | Durable state and transitions. |
| `src/controller.ts` | Dispatch, ownership, retries, recovery. |
| `src/repository.ts` | The `code` and `plan` workflows. Integration. |
| `src/agent.ts` | Worker request and result contract. |
| `src/manager.ts` | Multi-repository manager. |
| `src/automations.ts` | Source discovery and intake. |
| `src/server.ts`, `web/` | Repository API and dashboard. |
| `src/manager-server.ts` | Manager API and combined dashboard. |
| `test/` | Automated tests. |

## Safety rules

- A missing or invalid result is never success.
- Each external write has a stable operation key and reconciliation.
- Code work needs configured checks. Every changed file needs coverage.
- Integration is local by default. No push, no release, no messages.
- Integration needs matching base, checks, review, and evidence hashes.
- Recovery is bounded. A run can create one diagnosis cycle, not more.
- Credentials stay out of config, logs, fixtures, and Git.
- A workspace is process isolation. It is not a security sandbox.

## Operations

```sh
./bin/z-loop pause    # stop new work. Active attempts can finish.
./bin/z-loop resume   # allow dispatch again.
./bin/z-loop doctor   # check Git, worker, checks, and database.
```

The installed service runs as the LaunchAgent `dev.z-loop.v2`. It starts at
login and restarts after failure. Its logs are under the state directory, in
`service-logs/`. Settings live in SQLite. Change them in the dashboard.
Editing the initial `config.json` does not replace them. See
[OPERATIONS.md](OPERATIONS.md) for the full runbook.

## Development

| Command | Job |
| --- | --- |
| `npm run check` | Type check. |
| `npm test` | Full test suite. |
| `npm run demo` | One repair-and-integration loop with a fixture worker. |
| `npm run demo:manager` | Multi-repository demo. |

Tests use temporary repositories and fixture workers. They do not call paid
models and do not write to a live remote. Live canaries need explicit user
authorization. See [AGENTS.md](AGENTS.md) for contribution rules.

## Documents

| Document | Content |
| --- | --- |
| [DESIGN.md](DESIGN.md) | Architecture and invariants. |
| [OPERATIONS.md](OPERATIONS.md) | Live service controls and runbook. |
| [VERIFICATION.md](VERIFICATION.md) | Verification approach and evidence. |
| [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md) | Live canary results. |
| [BACKLOG.md](BACKLOG.md) | Open work. |
| [examples/](examples/) | JSON for work and automations. |

## Limits

- One trusted POSIX host. Local, reliable storage for state and repository.
- One repository per state directory.
- No exactly-once promise for arbitrary commands. Bounded retries and
  reconciliation cover supported publication operations.
- GitHub support is small and tested with contract fixtures.
