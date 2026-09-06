# Design decisions

## Replace the execution core

Use one runtime and one durable state store. Keep model work behind a strict
request and result contract. Models can propose actions and produce evidence.
Only runtime code can claim work, accept results, advance steps, or integrate.

The main change is the separation of work, runs, steps, and attempts. A process
crash changes an attempt. It does not erase the work specification or imply
that the step passed. Retry, repair, external waits, and cancellation are distinct
transitions. The dashboard reads these same records.

## Required invariants

1. One controller lease owns dispatch for a state directory.
2. Each result must match the current attempt owner, lease, and generation.
3. A transaction accepts the result and creates the next durable step together.
4. A missing or invalid result cannot produce success.
5. Integration requires matching candidate, base, checks, review, and evidence hashes.
6. External writes use stable operation keys and inspect the actual destination on retry.
7. A wait blocks only affected work. Retry and model budgets have finite bounds.
8. An exhausted run can create one diagnosis cycle. Recovery cannot recurse without limit.
9. Routine defaults continue automatically. Their refinement tasks follow successful delivery.
10. External input requires an independent resolver and an explicit decision record.
11. Live configuration changes drain attempts before replacing shared settings.
12. Backup locks prevent dispatch while state and candidate files are copied.

## Execution assumptions

This implementation targets one trusted POSIX host and one repository per state
directory. SQLite and the repository must be on reliable local storage. Use a
dedicated checkout. Git compare-and-swap and expected-head checks protect
integration, but an external administrator can still change repository policy.

The system does not promise exactly-once execution of arbitrary commands. It
provides bounded retries, saved candidates, and reconciliation for its supported
publication operations. Checks can run again after interruption. Configure them
to be repeatable. Local checkouts are workflow isolation, not a security sandbox.

## Adoption

Start with a fresh state directory. Do not copy old session sentinels or timelines.
Import only work with a clear specification and acceptance criteria. Run a bounded
canary on a disposable repository. Then enable one recurring planning automation
and inspect its evidence before expanding the source set. The same runtime can
then execute continuously without per-step confirmation.

Platform adapters remain separate from the state core. Current GitHub support is
small and tested with contract fixtures. The local repository workflow is tested
end to end. Later work is recorded in BACKLOG.md.

## Repository manager

The optional `manage` command keeps one Store, Controller, and RepositoryWorkflow
per managed repository. Each retains its own SQLite state and integration lock.
One manager lease owns shared dispatch. A shared tick renews all controller
leases and offers one claim per repository in turn. Admission reads the durable
attempt records across managed stores before each claim. Claims are synchronous
in one process, so another claim cannot race a capacity check. Expired and lost
model attempts still count toward the rolling budget. Missing managed stores
block new admission until their usage can be read.

Existing services attach as external endpoints. The manager reads their local
state for complete history and uses their authenticated API for commands. It
never changes their state through a second Store. Transfer to managed execution
requires both an absent listener and an expired controller lease. Existing
repository identity and state paths remain fixed.

Manager control requests retain an operation key, exact input, and result.
New runtime command receipts commit with state transitions in the same SQLite
transaction. Lost responses can replay that key. Legacy responses that cannot
be reconciled stay unknown and are not replayed automatically. Backup keys bind
to an atomically published backup directory and manifest. Repository worker
publication still uses the existing destination reconciliation rules.

Management authentication is local and separate from repository tokens. The
browser receives only the manager token. The server resolves repository targets
from its registry; it does not accept arbitrary destination URLs. Search reads
use read-only SQLite connections. No schema migration or runtime restart is
required to attach an existing session.

## Single dashboard address

The manager now defaults to port 4188. `npm start` starts the manager. Managed
repository APIs bind operating-system-assigned loopback ports, so their saved
server settings do not conflict with the public dashboard address.

The manager records its public port in its own database. Repository CLI commands
use a repository-scoped route through that address while the manager lease is
active. A custom manager state path can be selected with `--manager-home` or
`Z_LOOP_MANAGER_HOME` for repository commands.
