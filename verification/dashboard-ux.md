# Dashboard verification — 2026-09-06

All six pages were checked in Chrome against the disposable fixture service on port 4198.
The fixture uses a command worker. These UI tests did not start paid model work.

- Settings: capacity appears first. The other four sections start closed.
- A fixture with 35 checks stays compact. Search for `area-17` shows one check.
- A capacity draft survives navigation. Saving changes the stored revision.
- External input: an answer remains present across multiple three-second refreshes. Submission clears the decision and makes its run active.
- Automations: GitHub source shows the blocker filter. Commit source hides irrelevant fields. Editing and saving succeeds.
- Queue: creation, queued filtering, keyboard detail opening, and cancellation succeed.
- Historical evidence: the successful verification shows one recorded check although the current configuration has 35. Its log contains `Acceptance passed: answer is 42`.
- Activity: events appear with expandable details. Expansion state is retained by event ID.
- System: the database check returns `ok`. Backup succeeds in the paused fixture.
- Phone viewport: all six pages have document width 390 at viewport width 390. Navigation shows all six destinations. The viewport override was reset.
- Chrome reported no console errors during the page checks.

Commands: `npm run check` exited 0. `npm test` exited 0 (52 passed).
`node --check web/app.js`, `node --check web/forms.js`, and `git diff --check` exited 0.
See `typecheck.log` and `tests.log` in this directory.

The live service on port 4188 returned `healthy: true` and `running: 0`.
Its current settings differ from the initial setup. The worker is now
`10router/glm/glm-5.3-flash`, variant `max`. GitHub issue intake is enabled.
Commit maintenance watch is paused. Those concurrent settings were preserved.
Two current work items succeeded. Two stopped after implementation timeouts.
The earlier authorized canaries used `10router/combo-coding` at default thinking.
The final canary log reports both workflows passed independent acceptance.

Limits: queue search covers the newest 200 items. Activity shows the latest 100 events.
Work details show the complete stored history for a selected item.
No live GitHub merge or physical device behavior was tested here.

## Work details update

The modal now has Overview and Run history tabs.
Issue links use the repository stored in the source key.
Planned work can follow its stored parent work IDs to the source issue.
PR links use recorded run URLs and show the run number.
Only HTTPS GitHub issue and PR URLs are rendered.
No remote lookup is needed to open the modal.
Completed steps and older runs start closed. Logs remain available on demand.
Refresh retains the selected tab and open steps.

Chrome checks used the paused, disposable fixture on port 4198.
Recorded fixture links rendered as `/octocat/Hello-World/issues/7` and
`/octocat/Hello-World/pull/42`. These are test references, not live PR claims.
The successful verification step still loaded its recorded acceptance result.
A cancelled work item showed the correct next action and the no-links message.
The 390 × 844 layout kept the title, close control, links, tabs, and footer usable.
JavaScript syntax and diff checks exited 0. No runtime code changed.
The parent-work fixture also rendered its original issue link.
After refresh, Run history remained selected and its open step remained open.
The phone modal had equal content and client widths (350 px), with no horizontal overflow.
Chrome reported no console errors. The viewport override was reset.

The later polish removes the metadata sidebar and uses a compact metadata row.
Scope has a short preview. Step buttons open their evidence in Run history.
See [first-run and polish checks](onboarding.md) for the final verification.
