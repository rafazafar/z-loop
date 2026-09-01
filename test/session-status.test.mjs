import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectSessions, parseAssuranceReport } from "../web/status.mjs";

test("session history uses recorded routing and log activity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kokolog-session-status-"));
  const sessions = path.join(root, "state", "sessions");
  const logs = path.join(root, "logs");
  await mkdir(sessions, { recursive: true });
  await mkdir(logs);

  const id = "998-impl-a2";
  await writeFile(path.join(sessions, `${id}.prompt`), "repair prompt\n");
  await writeFile(path.join(sessions, `${id}.spawn.json`), JSON.stringify({ model: "recorded/model", variant: "high" }));
  await writeFile(path.join(sessions, `${id}.result`), "done\n");
  await writeFile(path.join(sessions, `${id}.done`), "");
  await writeFile(path.join(sessions, `${id}.harvested`), "");
  await writeFile(path.join(logs, `${id}.jsonl`), "latest output\n");

  const old = new Date("2026-09-01T00:00:00Z");
  const recent = new Date("2026-09-01T00:05:00Z");
  for (const suffix of ["prompt", "spawn.json", "result", "done", "harvested"]) {
    await utimes(path.join(sessions, `${id}.${suffix}`), old, old);
  }
  await utimes(path.join(logs, `${id}.jsonl`), recent, recent);

  const result = await collectSessions(root, { roles: { repairer: { model: "current/model", variant: "max" } } });
  assert.equal(result[0].phase, "repair");
  assert.equal(result[0].repair, 1);
  assert.equal(result[0].role, "repairer");
  assert.equal(result[0].route, "recorded/model · high");
  assert.equal(result[0].routeSource, "recorded");
  assert.equal(result[0].lastActivity, recent.toISOString());
});

test("successful assurance history includes the structured report and severity counts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kokolog-assurance-history-"));
  const sessions = path.join(root, "state", "sessions");
  const verdicts = path.join(root, "verdicts");
  await mkdir(sessions, { recursive: true });
  await mkdir(verdicts);

  const failed = "37-rev-assurance-r1";
  const retried = "37-rev-assurance-r1-retry1";
  for (const id of [failed, retried]) await writeFile(path.join(sessions, `${id}.prompt`), "review prompt\n");
  await writeFile(path.join(sessions, `${failed}.result`), "NO RESULT WRITTEN. Exit status: 1.\n");
  await writeFile(path.join(sessions, `${failed}.exit`), "1\n");
  await writeFile(path.join(sessions, `${retried}.result`), "VERDICT: PASS\n");
  const report = `VERDICT: PASS
evidence: /tmp/state/review-evidence/${retried}.json
blockers:
- none
advisories:
- P2 · code · source.swift:10 · Validate this in integration tests.
`;
  await writeFile(path.join(verdicts, "37-assurance-r1-097721b5da1d-verdict.md"), report);

  const result = await collectSessions(root, { roles: { reviewer: { model: "review/model", variant: "high" } } });
  const successful = result.find((session) => session.id === retried);
  const runtimeFailure = result.find((session) => session.id === failed);
  assert.equal(successful.assuranceReport, report);
  assert.equal(successful.blockerCount, 0);
  assert.equal(successful.advisoryCount, 1);
  assert.deepEqual(successful.severities, { P0: 0, P1: 0, P2: 1, P3: 0 });
  assert.equal(runtimeFailure.assuranceReport, undefined);
});

test("assurance report parser separates blocking and advisory findings", () => {
  const parsed = parseAssuranceReport(`VERDICT: BLOCK
blockers:
- P0 · security · auth.ts:1 · Exposes credentials.
- P1 · code · work.ts:2 · Corrupts state.
advisories:
- P2 · qms · docs.md:3 · Clarify the evidence.
- P3 · code · view.ts:4 · Rename this label.
`);
  assert.equal(parsed.verdict, "BLOCK");
  assert.equal(parsed.blockerCount, 2);
  assert.equal(parsed.advisoryCount, 2);
  assert.deepEqual(parsed.severities, { P0: 1, P1: 1, P2: 1, P3: 1 });
});
