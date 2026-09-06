# First-run and modal verification — 2026-09-06

`npm start -- --home .loop/onboarding-preview --port 4197 --no-open`
started the browser guide with no config or database.
Chrome completed all three steps against a disposable Git repository.
The guide showed the missing-check state, accepted a custom acceptance check,
and reviewed OpenCode with `10router/combo-coding` at default thinking.
Create workspace opened the authenticated dashboard automatically.
The queue and attempt count were both zero. No model was called.

After stopping that test process, the same start command used the saved config.
It opened the runtime on the saved port, without the setup guide.
The health endpoint returned `healthy: true` and `running: 0`.

A separate unfinished setup on port 4196 detected npm dependency, test, and
check commands. Browser review and Back navigation worked.
All three guide pages fit a 390-pixel viewport without horizontal overflow.
The viewport override was reset. Temporary setup services were stopped.

Automated tests cover unauthorized access, foreign origins and Host headers,
invalid repository paths, invalid settings, discovery without execution,
configuration and token persistence, default thinking, an empty queue,
refusal to replace an initialized workspace, unfinished setup restart,
and planning in a repository with no detected checks.

`npm run check` exited 0. `npm test` exited 0: 54 passed, zero failed.
JavaScript syntax checks and `git diff --check` exited 0.
See `tests.log` and `typecheck.log`.

The work modal removes the tall metadata sidebar. It uses inline metadata,
a short ID disclosure, smaller tabs, a scope preview, and step buttons that
open the matching evidence in Run history. Running attempts show their start
time when recorded. The completed fixture measured 878 × 564 pixels on desktop.
The phone modal had equal content and client widths. Issue and PR links remained
available. No runtime setting was changed by the modal work.

The existing live service on port 4188 remained healthy with one active attempt.
