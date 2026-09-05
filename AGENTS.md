# Project rules

Use short, plain English. Use conventional commit messages.
State transitions belong to the store and controller. Workers return data.
Never infer success from process exit or missing output.
Each external write needs a stable operation key and reconciliation.
Tests must use temporary repositories and fixture workers.
Do not start paid agents or write to a live remote during tests.
Do not weaken checks to make a run pass.
Keep credentials out of config, logs, fixtures, and Git.
