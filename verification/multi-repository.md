# Multi-repository verification — 2026-09-06

## Scope

The manager runs separate repository controllers and stores on one host. It also
connects to existing services without taking ownership. The implementation adds
repository setup, shared attempt limits, a combined dashboard, scoped controls,
complete work search, and repository activity search.

## Automated evidence

- `npm run check` passes.
- `npm test` passes: 62 tests, no failures.
- After the final transfer and settings-receipt changes, the manager and server
  tests pass: 10 tests, no failures. See `multi-repository-tests.log` and
  `multi-repository-final-tests.log`.
- JavaScript syntax checks and `git diff --check` pass.

The tests use temporary Git repositories and fixture workers. They prove:

1. Connecting a live fixture retains its controller, configuration, and work.
   The fixture continues to completion after the manager stops.
2. Two managed repositories execute at the same time. Shared concurrency stays
   within its configured bound. The shared model allowance stops further model
   work while deterministic checks can finish.
3. Shared usage and limits survive a manager restart. Both fixture branches
   contain the independently checked result after work completes.
4. Lost attempts remain charged to the model allowance. Recovery does not infer
   success from an expired lease.
5. A second manager cannot acquire the same state directory.
6. Repeated operation keys produce one work item or rerun. A lost response from
   a receipt-capable service reconciles to the same write. A lost legacy response
   remains unknown and is not sent again.
7. A connection reset does not permit transfer of a live service. Transfer needs
   a refused connection and an expired controller lease.
8. Replaying an old settings receipt does not overwrite a later settings change.
9. Setup requires authentication, rejects cross-origin writes and duplicate
   repositories, and creates an empty queue without model attempts.
10. History queries retain old open work, paginate older records, and stay within
    the requested repository. Work and activity search include stored history.
11. Backup retries return the same published backup, even after dispatch resumes.

## Browser evidence

Chrome checks used the disposable manager demo. Its repositories were temporary.
The shared dispatcher was paused during setup and UI checks.

- The overview distinguished a managed repository from an external service.
- Combined history showed 132 items. The second page showed items 51–100.
  Searching for the account settings task returned one matching repository item.
- A work link opened its details directly. Run history and existing evidence
  controls remained available.
- New repository setup completed through repository inspection, a check editor,
  and review. The resulting third repository had zero work and zero attempts.
- A shared concurrency draft survived page navigation. Saving it showed the
  stored value of 3.
- Scoped settings links opened Settings directly. The repository selector and
  shared pause reason remained visible.
- Activity search for `work.created` found 66 events. Its second page showed
  events 51–66.
- At a 390 × 844 viewport, the manager document width was 390 pixels. Navigation
  and repository controls remained accessible. The viewport override was reset.
- The checked browser pages reported no console errors.

## Existing session

The manager was started separately on port 4189. Kokolog monitor was connected
as an external service. No work, settings, pause, retry, or transfer command was
sent to that repository.

Before and after connection, its controller owner and stored configuration were
identical. The original process (PID 92411) stayed running on port 4188. The
manager reported its health as true and owned zero attempts. Its existing pause
state was preserved. No paid worker or remote write was started for validation.

## Limits

External services retain independent dispatch limits until explicitly transferred.
A missing managed store blocks new shared dispatch because usage is unknown.
Shared allowances count attempts, not money. Global work pagination merges local
pages in memory; a large installation can need a separate read index.
