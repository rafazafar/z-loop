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
