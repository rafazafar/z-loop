# Browser checks

Checked with the actual Chrome dashboard on the disposable fixture service.

- The work queue rendered on the desktop viewport and at 390 × 844 pixels.
- Settings saved concurrency 3. Reload showed configuration revision 2.
- The automation form created an enabled daily planning task.
- The work form created a code task with a dependency on completed work.
- Resume completed the code task and the scheduled planning task.
- Work details showed the rejected check, repair, repeated verification, and success.
- The check log opened and showed `Acceptance passed: answer is 42`.
- Database check returned `ok`.
- Create backup returned a saved path and added the backup to the list.
- The browser error log was empty after these flows.
- The preview was paused after all three work items succeeded.

The fixture worker is deterministic. These checks do not measure a model's
coding quality. Final API evidence is saved in dashboard.json.
