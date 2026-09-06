# z-loop

z-loop runs development work on a Git repository. It implements changes, runs
checks, reviews the result, and integrates work that passes. It can also inspect
a repository and create a plan before implementation starts.

Use the dashboard to add work, configure recurring tasks, inspect evidence, and
answer questions that require external input. The runtime stores progress so
work can recover after a process restart.

## Start here

You need:

- Node.js **22.18 or later** and Git.
- An existing Git repository with at least one commit and a checked-out branch.
- OpenCode installed and signed in before you run model work.
- The tools required by your repository's checks.

Run these commands from the z-loop checkout:

```sh
npm ci
npm start
```

On the first start, a browser guide opens:

1. **Repository:** choose the folder to work on. The guide detects its branch and checks.
2. **Worker and checks:** choose a model, set the daily attempt limit, and review verification commands.
3. **Review:** create the workspace and open the dashboard.

Setup does not run the detected checks or call a model. The queue starts empty.
If no checks are detected, add one in the guide or start with planning work.

The guide defaults to one concurrent attempt, 24 model attempts per rolling
24 hours, default thinking, and local branch integration. Leave the model blank
to use the installed OpenCode default.

The terminal must stay open while the service runs. Later `npm start` calls use
the saved workspace and skip setup. To reopen its authenticated dashboard:

```sh
./bin/z-loop console
```

The default address is **http://127.0.0.1:4188**. If the browser does not open,
follow the address and access-token instructions in the terminal.

### Use another workspace or port

A workspace is the state directory for one configured repository. The default
is `.loop`, relative to the directory where you start the command.

```sh
npm start -- --home /absolute/path/to/loop-state --port 4190
```

`--port` selects the port during first-run setup. An existing workspace uses
its saved port. Add `--no-open` to open the setup page yourself.

Use the same `--home` for later commands. You can also set `Z_LOOP_HOME`.
The repository path and server address are fixed for each workspace; use a new
state directory to change them.

## Add your first work item

Open **Work queue → New work**. Supply:

- **Outcome:** the change you want.
- **Scope and instructions:** the affected behavior and constraints.
- **Acceptance criteria:** observable conditions that prove the work is complete.

Choose the workflow that fits the task:

| Workflow | Use it when | What happens |
| --- | --- | --- |
| Implementation | The required change is known. | Implement → verify → review → publish → integrate → confirm completion. |
| Planning | The next change needs investigation. | Inspect → plan → review the plan → create bounded work items. |

Keep each work item focused on one outcome. Add dependencies when another item
must finish first.

Select a queue item to see its current result, source issue, recorded PR links,
and run history. Expand a step to inspect attempts, failures, checks, and logs.
Use **Refresh details** to update an open modal.

## Automate recurring work

Open **Automations → Add automation**. Choose a source and define the work it
should create.

| Source | Trigger |
| --- | --- |
| Schedule | A recurring interval. Runs from the same schedule do not overlap. |
| Repository commits | A new commit on the configured base branch. An unchanged commit creates no work. |
| Repository files | A new or changed Markdown, text, or JSON file in the selected folder. |
| GitHub issues | An open issue with the selected label. Blocked issues are filtered by default. |

Use planning for broad maintenance inspection. Use implementation for a known,
bounded change. **Check source now** requests a scan. Pausing an automation stops
new work from that source; it does not cancel work already queued.

GitHub issue intake requires a configured `owner/repository` and an authenticated
GitHub CLI. It can be used with local integration.

## Use the dashboard

| Page | What to do there |
| --- | --- |
| Work queue | Create, search, inspect, cancel, or rerun work. |
| Automations | Manage sources that create recurring work. |
| External input | Answer questions that automation could not resolve. |
| Activity | Inspect recent runtime events and their details. |
| Settings | Change capacity, recovery limits, worker, model, and checks. |
| System | Inspect runtime information, check the database, and create backups. |

Queue search covers the newest 200 work items. Activity shows the latest 100
events. A selected item's details include its full stored run history.

### Checks and integration

Matching verification checks must pass before integration. Path filters can
limit checks to affected areas. Every changed file must have verification
coverage. Dependency setup alone is not verification.

Local integration updates the configured local branch. It does not create a PR.
GitHub integration publishes a work branch and PR, checks the required merge
conditions, and merges eligible work. This requires GitHub CLI access to the
configured repository.

Saved settings take effect after active attempts finish. Use the dashboard to
change them: the database stores the active configuration. Editing the initial
`config.json` does not replace settings already stored in the database.

### Pause, recover, and back up

**Pause new work** stops dispatch. Active attempts can finish. **Resume work**
allows dispatch again.

The runtime retries eligible failures within configured limits. Failed checks
or reviews can start repair rounds. Some failures remain stopped when recovery
limits are reached. Inspect the recorded reason before starting a new run.
Routine choices can use a default and create refinement work. Questions that
still need an external fact, authority, or physical action appear in
**External input**.

To create a backup, pause dispatch and wait for active attempts to finish.
Then use **System → Create backup**. Backups include state, evidence, saved
workspaces, and configuration. They exclude access credentials and are intended
for restoration at the original state path.

## Command-line use

Run these commands from the z-loop checkout. Add `--home PATH` when using a
non-default workspace.

| Task | Command |
| --- | --- |
| Start the service | `npm start` |
| Open the dashboard | `./bin/z-loop console` |
| Inspect state | `./bin/z-loop status` |
| Check prerequisites and database | `./bin/z-loop doctor` |
| Pause / resume dispatch | `./bin/z-loop pause` / `./bin/z-loop resume` |
| Add work from JSON | `./bin/z-loop add --file work.json` |
| Add or update an automation | `./bin/z-loop automation --file automation.json` |
| Cancel a run | `./bin/z-loop cancel --run RUN_ID` |
| Start a new run for an item | `./bin/z-loop retry --work WORK_ID` |
| Answer an external question | `./bin/z-loop answer --decision DECISION_ID --text "Your answer"` |
| Create a backup | `./bin/z-loop backup` |
| Show command help | `./bin/z-loop help` |

Queue and control commands require the running service. `doctor` and `backup`
can run offline. A backup still requires paused dispatch and no active attempts.

For setup without the browser guide:

```sh
./bin/z-loop init --repo /absolute/path/to/repository --home /absolute/path/to/loop-state
./bin/z-loop serve --home /absolute/path/to/loop-state
```

`init` also accepts `--config PATH` for an explicit configuration. Review that
configuration before starting the service.

JSON examples: [work](examples/work.json), [scheduled maintenance](examples/maintenance.json),
[file intake](examples/spec-files.json), and [GitHub issue intake](examples/github-issues.json).
Edit the examples for your repository before submitting them.

## When something stops

| Symptom | First action |
| --- | --- |
| The dashboard cannot connect | Check that the service is running and that the address matches the workspace. Reopen it with `console`. |
| The port is already in use | Check for an existing service. Use another port when creating a separate workspace. |
| Work stays queued | Check pause state, dependencies, capacity, and the rolling model-attempt budget. |
| A step keeps failing | Open its attempt details and logs. Check worker access and repository tools with `doctor`. |
| Settings have not applied | Wait for active attempts to finish. Check for a pending change in Settings. |
| Backup is unavailable | Pause dispatch and wait for the active attempt count to reach zero. |

State is stored in SQLite. Worker logs and evidence are stored under the workspace
state directory. Do not delete that directory to clear an error; it contains the
history and saved work needed for recovery.

## Develop and test

```sh
npm run check
npm test
npm run demo
```

The tests use temporary repositories and fixture workers. They do not call paid
models or write to a live remote. The demo runs a complete repair-and-integration
workflow with a fixture worker and prints the location of its evidence.

The runtime uses Node.js built-in modules and SQLite. It is designed for a single
host. Git workspace isolation is not a security sandbox: workers execute local
commands with the service user's permissions.

| Code | Responsibility |
| --- | --- |
| `src/store.ts` | Durable state and transitions. |
| `src/controller.ts` | Dispatch, ownership, retries, and recovery. |
| `src/repository.ts` | Repository workflow and integration checks. |
| `src/agent.ts` | Worker execution and result validation. |
| `src/automations.ts` | Source discovery and work intake. |
| `src/onboarding.ts` | First-run setup. |
| `src/server.ts`, `web/` | Local API and dashboard. |
| `test/` | Automated verification. |

Read [DESIGN.md](DESIGN.md) for the architecture and [AGENTS.md](AGENTS.md) for
contribution rules. See [VERIFICATION.md](VERIFICATION.md) and
[verification/onboarding.md](verification/onboarding.md) for validation evidence.
Open work is tracked in [BACKLOG.md](BACKLOG.md).
