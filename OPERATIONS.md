# kokolog-monitor service

Current state checked on 2026-09-06: dispatch is enabled. GitHub issue intake is
enabled. Commit maintenance watch is paused. The worker is now
`10router/glm/glm-5.3-flash` with variant `max` and a 30-minute call timeout.
These settings changed after initial setup. They were preserved during the UX work.
The setup values below describe the original validated profile.
Use the dashboard Settings page to inspect the active values.

The installed service targets `~/dev/kokolog-monitor`, branch `main`.
Its state is in `~/dev/z-loop-v2/.loop/kokolog-monitor`.
The dashboard is at http://127.0.0.1:4188/.

Open the manager dashboard without typing the token:

```sh
cd ~/dev/z-loop-v2
./bin/z-loop console --manager
```

Open an authenticated repository dashboard:

```sh
cd ~/dev/z-loop-v2
./bin/z-loop console --home .loop/kokolog-monitor
```

The worker is OpenCode with `10router/combo-coding`. No variant is supplied.
One attempt runs at a time. Each model call has a five-minute timeout.
The full step deadline is 20 minutes so verification can finish. The rolling daily limit is 24 model attempts.
The maintenance automation checks local `main` every minute. A new commit
creates one inspection. An unchanged commit starts no model work.
It creates at most one supported, bounded proposal per cycle. Planning and
plan review receive the current work queue to avoid duplicate work.

The service performs local integration. It does not push to either configured
remote, publish releases, or send messages. A dirty checkout, changed base, failed
check, or missing review prevents integration. The old tick, spec-sync, and decision execution LaunchAgents are disabled. Its separate dashboard is independent of this service.

Mandatory checks cover the Flutter/Dart workspace, Node lab and tooling, release
documents, and contract fixtures. Path filters follow repository areas. Setup
checks always run. Every changed file must match a verification check. Existing
failures are queued as separate repair work. Assertions are not weakened.

The LaunchAgent is `dev.z-loop.v2`. It starts at login and restarts after failure.
It runs while the user session and host are available. Its stdout and stderr are
under the state directory's `service-logs/` folder.

```sh
# Pause only new work. Active attempts can finish.
./bin/z-loop pause --home .loop/kokolog-monitor
./bin/z-loop resume --home .loop/kokolog-monitor

# Inspect the process and runtime.
launchctl print gui/$(id -u)/dev.z-loop.v2
./bin/z-loop status --home .loop/kokolog-monitor
./bin/z-loop doctor --home .loop/kokolog-monitor

# Stop the service.
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/dev.z-loop.v2.plist

# Start it again.
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.z-loop.v2.plist
```

Change the worker, limits, checks, or automation in the dashboard. SQLite stores
live settings. Editing the bootstrap config file does not replace them.
The contract tools use a private virtual environment under the state directory,
with the versions declared in the repository's contract workflow.
