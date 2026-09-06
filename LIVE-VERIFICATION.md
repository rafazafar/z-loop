# Live validation — 2026-09-06

OpenCode 1.18.25 ran the actual worker protocol with `10router/combo-coding`.
No `--variant` or thinking-level override was supplied.

The disposable canary passed implementation, mandatory verification, independent
model review, local integration, and completion observation. A second work item
passed planning, independent plan review, and application. All nine runtime
attempts succeeded. Four attempts called the live model. No repair was needed.
Acceptance was repeated outside the runtime. The check file was unchanged.

Evidence: [live run log](verification/live-canary.log) and
[structured result](verification/live-canary.json). Full private worker logs and
checkouts remain under the state path in that result.

A clean clone of kokolog-monitor was then checked. The initial baseline passed
31 of 33 configured checks. It exposed an SDK CI identifier mismatch and a lab
relay startup message mismatch. The lab also needed dependency setup for its
separate benchmark package. That setup is now part of the profile. Contract
fixture validation passed after installing the repository's declared tools.

The two product defects were queued as separate live repair tasks. The service
runs as a LaunchAgent, with local integration and a one-minute commit watch. Unchanged commits do
not consume model calls.
See OPERATIONS.md for its controls. These are development checks. This run does
not establish hardware behavior, regulatory release approval, or live GitHub
merge behavior.

The first repository request stalled before producing output. A graceful restart
resumed the queued step. The next attempt implemented the SDK repair, and all
33 selected checks passed. A review returned no result artifact; the runtime
rejected it and scheduled a retry. It did not infer approval from process exit.

This exercise added scoped checks with coverage validation, an independent worker
timeout, and preservation of edited work on graceful shutdown. Interrupted
restart attempts are now recorded as cancelled. The regression suite passes
52 tests. Full private logs remain in the installed state directory.

The final canary also passed both workflows after the result-file permission fix.
See [final canary log](verification/live-canary-final.log).
The dashboard and current service state were checked separately.
See [dashboard verification](verification/dashboard-ux.md).
