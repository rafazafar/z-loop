# z-loop v2

A durable repository automation service for one POSIX host.
It implements work, runs mandatory checks, reviews evidence, repairs failures,
and integrates the reviewed revision. Recurring tasks use the same executor.

This is a new system. It does not use the old loop's state, timers, or scripts.
The runtime has no third-party production dependencies. It requires Node.js
22.18 or later, Git, and a configured worker. Node 22 reports an experimental
warning for its built-in SQLite API.

**Try the complete workflow without a model or remote account**

```sh
npm ci
npm run check
npm test
npm run demo
```

The demo creates a repository under `.loop/`, uses a deterministic fixture
worker, intentionally fails its first implementation, repairs it, verifies it,
and integrates it. It saves `proof.json` and prints commands to inspect its
state in the console. It does not call OpenCode or GitHub.

**Use a repository**

```sh
./bin/z-loop init --repo /absolute/path/to/repository --home /absolute/path/to/loop-state
./bin/z-loop doctor --home /absolute/path/to/loop-state
./bin/z-loop serve --home /absolute/path/to/loop-state
```

Initialization detects declared checks for common Node, Rust, Go, and Flutter
repositories. Open the console Settings page to inspect the checks. For a
monorepo, set each check's working folder to the relative package path. Dependency setup
is an explicit check in the ordered list. A code run cannot pass without checks.
Do not put the state directory inside the target repository.

The default worker uses the locally configured OpenCode model. Set
`worker.model` and `worker.variant` to pin a route. Use a strong model for the
first real run. Review and implementation are separate worker sessions.
OpenCode is invoked with `--pure --auto`; repository commands must be trusted.
There is no automatic switch to an untested model.

The default integration mode is `local`. It fast-forwards the configured base
branch in the target repository. A non-bare target must be clean and checked
out on that branch. Otherwise, integration waits while independent work runs.
Use a dedicated repository checkout rather than an actively edited checkout.

Add bounded work from another terminal:

```sh
./bin/z-loop add --file examples/work.json --home /absolute/path/to/loop-state
./bin/z-loop console --home /absolute/path/to/loop-state
```

Edit the example first. A work item needs its outcome, exact scope, and explicit
acceptance criteria. `dependencies` contains local work IDs. `sourceKey` is
optional for manual input; repeated use of a key returns the existing work.
Specifications are immutable snapshots. Submit a new work item for changed scope.
`retry --work ID` creates a new run of the same specification after a terminal run.

The console provides work creation, search, state filters, dependencies, full
run history, evidence, cancellation, reruns, automation forms, external answers,
runtime settings, disk status, database checks, and backups. It listens only on loopback.
`console` passes the local token through a URL fragment; the page removes that
fragment and keeps the token in session storage. API requests use bearer auth.
The service does not serve the state directory or enable cross-origin access.

**Configuration**

The Settings page edits the worker, mandatory checks, integration, capacity,
and recovery limits. Commands accept quoted arguments. They do not expand shell
operators, variables, or wildcards. Use an explicit shell only when required.

SQLite stores the active configuration and its revision. A saved change blocks
new dispatch, lets active attempts finish, and then takes effect. Conflicting
edits are rejected. A pending change survives a restart and can be cancelled.
Changing checks invalidates old verification. Integration changes require all
open runs to finish or be cancelled. The repository and server address stay
fixed for a state directory.

`config.json` is the initialization input. After initialization, use Settings
or a `configuration.save` command with `config` and the current `revision`.
Editing the initialization file does not replace the database configuration.
A backup exports the current configuration. To start with a full configuration,
pass `init --config path/to/config.json`.

**Durable state**

SQLite is the only execution state store. WAL, full synchronization, foreign
keys, unique constraints, and short write transactions protect transitions.
The controller is the sole execution owner. CLI and console commands go through
one command handler in the service. Offline initialization and backup use the
same store with explicit preconditions.

| Record | Purpose |
|---|---|
| Work item | Immutable scope, acceptance, source key, priority, dependencies |
| Run | Workflow version and one execution of the work item |
| Step | Next durable action and its typed wait or retry |
| Attempt | Process execution, owner, generation, lease, and outcome |
| Operation | External-write intent and confirmed remote receipt |
| Artifact | Immutable evidence reference and SHA-256 |
| Decision | Applied standard default or confirmed external requirement |
| Automation and trigger receipt | Schedule, input selection, and deduplication |
| Event | Audit trail committed with state changes |

A transaction accepts the attempt result, finishes the step, saves its evidence
reference, queues the next step, and records the event. The event log is an
audit record; normal operation does not replay it to reconstruct current state.

The code workflow is `implement → verify → review → publish → integrate → observe`.
The planning workflow is `plan → check_plan → apply_plan`. Planning creates
bounded local work items and dependency edges after an independent review.
Empty plans finish without creating work.

Retries create attempts, not new work items. Product failures create focused
repair steps and invalidate prior verification. A missing model result preserves
the candidate checkpoint but does not count as successful implementation.
Retries can continue from the saved checkpoint in a new isolated checkout.

Each attempt holds resources under a generation number. Old results cannot
advance a replacement. A separate process wrapper enforces command timeouts
and stops its group when the controller process disappears. On restart, the
controller waits for expired leases, validates saved receipts, and either
accepts proven completion or schedules reconciliation. It never treats a
missing process or missing result as success.

Each candidate has a new checkout per attempt. Reviews use a fresh snapshot.
Checks run in their configured directory under a fresh snapshot. Check logs
preserve stdout and stderr. Verification and review references bind to the
head, base, and check configuration. Changes to these inputs require new proof.

**Automation**

```sh
./bin/z-loop automation --file examples/maintenance.json --home /absolute/path/to/loop-state
./bin/z-loop automation --file examples/spec-files.json --home /absolute/path/to/loop-state
```

Triggers enqueue durable work. They do not start agents directly.
Interval triggers combine missed occurrences and avoid overlapping runs.
File triggers bind inputs to content hashes, wait for files to settle, ignore
symlinks, and accept at most 500 `.md`, `.txt`, or `.json` inputs per scan.
The file trigger directory is relative to the repository.
Unchanged input does not create duplicate work. Source content is included in
the immutable work specification.

Use the Automations page to create or edit a schedule, file source, or ready
label. Scan now requests an early scan; it keeps source deduplication and overlap
checks. It does not force duplicate work. Pause preserves the definition and
its receipts. Each automation has its own enabled state and scan error. An unavailable
source does not stop other automations. Pausing an automation stops future
input selection; it does not cancel work already queued. Global pause stops
new attempts and scans while allowing active attempts to finish.

Dependencies block only affected work. Integration uses one repository resource.
Other steps use a per-run resource. Eligible work gains priority with age.
Deterministic steps continue when the model budget or provider is unavailable.
The rolling daily budget counts model attempts, not check polling.

Operational retries use bounded exponential backoff with jitter. Provider
failures pause model dispatch until the cooldown. After retry or repair
exhaustion, the run fails and creates one high-priority diagnosis task. That
task can propose an evidence-backed repair. Recovery tasks and their children
cannot recursively create more recovery tasks. Terminal failure remains visible
when no automatic repair is justified; it does not fabricate a human decision.
After all proposed repairs pass, the runtime automatically starts a new run of
the original work. This releases its dependants only after the original outcome
is proven. There is at most one automatic diagnosis cycle per work item.

**Human policy**

Workers must finish authorized work without asking whether to proceed.
An external request first goes to a separate resolver worker. It either applies
a reversible standard default and schedules a refinement after the main outcome
passes, or confirms
that external input is essential. A confirmed request must state its category,
the missing input, attempted automation, and why no valid default exists.

Only three categories can reach the external queue: an essential external fact,
external authority, or a physical action unavailable to automation. An answer
resumes only the affected run. Simulation is valid only for criteria it can
actually prove. It never becomes physical evidence by relabeling it.

```sh
./bin/z-loop answer --decision ID --text 'Required external answer' --home /absolute/path/to/loop-state
```

**GitHub mode**

Set `integration` to `github` and `githubRepository` to `owner/repository` in
Settings. The target checkout must have the correct `origin` remote.
Authenticate the GitHub CLI outside the repository. Do not store credentials
in loop config. Then enable `examples/github-issues.json` if desired.

The runtime pushes a stable work branch with an expected-head precondition,
reuses a matching PR after uncertain publication, checks required GitHub checks,
and merges with `--match-head-commit`. It never uses an administrator bypass.
GitHub must enforce the repository's branch protections. Require an up-to-date
branch or a merge queue if the tested merge base must remain current at merge.
The merge method currently uses merge commits; configure the repository to
permit them. A denied gate waits and becomes a diagnosis task after its deadline.

The GitHub issue scan is deliberately small: one page of at most 100 open
issues under a ready label. The label must mean scope and dependencies are
already qualified. Native GitHub dependency synchronization and issue-spec
updates are not implemented. Local dependency graphs are supported.
Planning and refinement publish to the durable local queue, not GitHub Issues.
The GitHub path has contract tests with fake responses; no live remote merge
is part of the default verification suite.

**Operations**

```sh
./bin/z-loop status --home /absolute/path/to/loop-state
./bin/z-loop pause --home /absolute/path/to/loop-state
./bin/z-loop resume --home /absolute/path/to/loop-state
./bin/z-loop cancel --run ID --home /absolute/path/to/loop-state
./bin/z-loop retry --work ID --home /absolute/path/to/loop-state
```

Keep the service alive on macOS:

```sh
node --experimental-strip-types scripts/install-service.ts /absolute/path/to/loop-state
```

This writes one LaunchAgent and prints its start and stop commands. It does not
load the service. Launchd keeps the runtime alive; the runtime owns all task
schedules. Do not install multiple controllers against different copies of
the same state while both can write to the same repository.

For backup, pause dispatch and let attempts finish, then run:

```sh
./bin/z-loop backup --home /absolute/path/to/loop-state
```

The System page provides the same backup operation. A renewable maintenance
lock blocks dispatch and conflicting commands while the copy is made. Restored
backups have no controller lease. The backup includes SQLite, evidence, checkpoints, workspaces, and config. It
excludes the controller access token. Treat it as private repository data.
Copy backups to separate storage for protection from disk loss. To restore,
stop the service, preserve the current state separately, and restore the backup
contents to the original absolute state path. Generate a new access token or
restore the separately protected token before starting. Candidate paths are
absolute; moving a restored state directory is not supported in this version.
The repository itself needs its own backup. Keep source changes in Git.

State and evidence are retained for diagnosis. There is no automatic deletion
of old evidence. Monitor disk space before a long deployment. Retention and automatic backup
scheduling are tracked in `BACKLOG.md`. A full disk fails transitions rather than treating work as complete.

**Execution boundary**

This version is for trusted repositories and trusted local workers. Checkouts,
role restrictions, and result fencing provide workflow isolation. They are not
an OS security sandbox. A configured command can access the host as the service
user. Use a dedicated user or a container/VM for repositories or code you do
not trust. Worker credentials and shell access require the same care as a CI
runner. Logs redact common token patterns but are not a complete secret filter.

The system targets one host with a few workers. It does not provide host failover,
remote worker placement, a distributed queue, or regulated release approval.
These boundaries keep the state and execution core small enough to test.

**Development and acceptance**

```sh
npm run check
npm test
npm run demo
```

Tests cover state transactions, lease fencing, result recovery, dependency waits,
retry budgets, automated planning, external decisions, source deduplication,
authentication, evidence integrity, base drift, lost integration responses,
and end-to-end local repair. Fixtures use temporary repositories and a command
worker. Run a bounded real-model canary on a disposable repository before
arming continuous work on a client repository.

See `VERIFICATION.md` for the validation performed on this build.
