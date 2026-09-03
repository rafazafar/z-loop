# z-loop

`z-loop` is a local control plane for autonomous software development. It turns
bounded GitHub issues into reviewed pull requests while the repository owner
keeps control of merge and release decisions.

The loop is repository-agnostic. A `z-loop` checkout manages one target
repository through `config.json`. The target can use any language or build
system if its test, lint, and optional build commands are configured.

## How it works

```text
ready GitHub issue
        |
        v
isolated implementation clone -> pull request and CI
        |                              |
        +------------------------------+
                       |
                       v
             unified assurance review
                       |
              +--------+--------+
              |                 |
             PASS          P0/P1 blocker
              |                 |
              v                 v
         owner merge       bounded repair
```

The implementation domain uses a deterministic maker-checker workflow:

1. It selects a ready issue whose blockers are closed.
2. It starts an implementer in an isolated clone.
3. It waits for the pull request checks to reach a terminal state.
4. It gives one reviewer an immutable patch and the current issue and CI
   evidence.
5. It sends P0 and P1 findings to a bounded repair loop.
6. It records a passing revision for owner merge.

P2 and P3 findings are advisory. A model cannot merge a pull request or approve
a regulated release.

Operational failures use clean retries from current GitHub state. Failed local
edits are not reused. Session limits, timeouts, clone ownership, and retry
budgets are enforced by the runtime.

## Repository boundary

`z-loop` stays outside the target repository. The configured checkout supplies
the Git remote and project context. Implementation work runs in disposable
clones under `clones/`. Loop state and evidence stay in this repository.

The target repository remains the source of truth for:

- issues and dependency relationships;
- pull requests and revisions;
- CI checks;
- the default integration branch;
- project instructions and product documentation.

`z-loop` keeps local control data in `state/`, `logs/`, `verdicts/`,
`decisions/`, and the domain timelines.

## Requirements

- Node.js 22 or later and npm
- Git
- GitHub CLI (`gh`) with an authenticated account
- `jq`, `tmux`, and `shasum`
- OpenCode with the models selected in `config.json`
- a local checkout of the target GitHub repository with an `origin` remote

The manual workflow uses a Unix-like shell. The included timers and background
services use macOS `launchd`.

## Quick start

Install the JavaScript dependencies:

```bash
git clone https://github.com/rafazafar/z-loop.git
cd z-loop
npm install
```

Configure the loop for a target repository:

```bash
run/init /absolute/path/to/target-repository
```

The initializer detects common Flutter, Node.js, Go, Rust, and Python projects.
It writes `config.json`, proposes test and lint commands, and checks the required
GitHub labels.

Run the preflight checks:

```bash
bin/loop doctor
```

Start the Operator Console:

```bash
bin/loop ui
```

The console opens at `http://127.0.0.1:4177` by default. It shows active work,
ticket states, decisions, history, and system health.

To start implementation work, add the configured frontier label to a bounded
issue. The default label is `ready-for-worker`. Then start the next eligible
issue:

```bash
run/dispatch-work --next
```

Use `run/dispatch-work --current` to advance work that is already tracked. Use
`run/collect-results` to collect completed sessions without starting a model.

## Configuration

`config.json` is the central configuration file. `routing.json` is accepted only
as a compatibility fallback when `config.json` does not exist.

| Section | Purpose |
|---|---|
| `project` | Target name, local checkout, and description |
| `commands` | Test, lint, and optional build commands |
| `assurance` | Review dimensions and sensitive path patterns |
| `domains` | Domain switches and domain-specific paths |
| `roles` | OpenCode model and reasoning variant for each role |
| `rules` | Repair, retry, concurrency, timeout, and diff budgets |
| `github` | Workflow labels, branch prefix, and pull request base |
| `daemon` | Console port and local service identifier |

The configuration schema is in `templates/config.schema.json`.

Model identifiers use the global OpenCode provider configuration. List the
available models and variants before you change a route:

```bash
opencode models
opencode models <provider> --verbose --pure
```

Run `bin/loop doctor` after each configuration change.

## Commands

| Command | Purpose |
|---|---|
| `bin/loop status` | Show SQLite-backed tickets and active sessions |
| `bin/loop tick` | Reconcile completed sessions and merged pull requests |
| `bin/loop doctor` | Validate tools, authentication, configuration, labels, and the target repository |
| `bin/loop ui` | Build and open the Operator Console |
| `run/loop-status` | Show the detailed controller and ticket state |
| `run/collect-results` | Collect finished work without starting a model |
| `run/dispatch-work --current` | Advance tracked paid work within the session limit |
| `run/dispatch-work --next` | Start one new eligible issue |
| `run/controller-heartbeat` | Collect, reconcile, and fill available work slots |
| `run/domain-loop <domain>` | Run one bounded non-implementation domain cycle |
| `run/install-launchd` | Install, but do not load, the macOS service files |

A dispatch command is a gate. It can exit without starting work when no step is
eligible. Sessions run under `tmux`. Use `run/spawn peek <session-name>` to watch
a session, but use result and state files as the durable record.

## Domains

Each domain has an executable contract with seven fields: Goal, Trigger,
Discover, Act, Verify, Persist, and Exit.

- `implement` turns ready issues into assured pull requests.
- `spec-sync` converts new meeting transcripts into staged project updates.
- `ticket-factory` creates bounded tickets from accepted project work.
- `gardener` finds recurring maintenance evidence and prepares follow-up work.
- `decision-desk` assembles questions that require owner judgment.

The implementation domain has a deterministic controller. Each other domain
uses one semantic actor and one fresh verifier. New artifacts remain in
`state/staging/` until verification passes.

Pause a domain by setting `status: paused` in its `domains/<name>/README.md`
frontmatter.

## Project layout

```text
agents/       role instructions for implementers, reviewers, and domain actors
bin/          main command entry point
decisions/    owner decision cards and queues
domains/      domain contracts, timelines, and metrics
logs/         raw session and runtime logs (ignored by Git)
run/          controller, worker, setup, and scheduling scripts
src/          TypeScript configuration, database, state, and engine code
state/        local tickets, sessions, locks, and staged artifacts (ignored by Git)
templates/    schemas and artifact contracts
test/         runtime and control-plane tests
verdicts/     immutable assurance results
web/          Operator Console server and React interface
```

## Scheduling

First run each workflow manually and inspect its output. Then install the
included `launchd` files:

```bash
run/install-launchd
```

This command does not load a service. It prints the exact `launchctl` commands
for the installed files. The controller heartbeat collects completed work,
reconciles GitHub, and fills only the available session slots.

## Development

Run the automated tests and build the console before you submit a runtime
change:

```bash
npm test
npm run ui:build
```

The loop runtime owns session completion sentinels and domain timeline writes.
Agents write bounded result artifacts; they do not declare their own runtime
completion.
