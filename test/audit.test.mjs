import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordMergedAudit } from "../web/audit.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kokolog-audit-"));
  await mkdir(path.join(root, "state"));
  await writeFile(path.join(root, "state/44.merged-unverified"), "PR merged before assurance completed (0/4 profiles passed)\n");
  await writeFile(path.join(root, "state/44.review.json"), JSON.stringify({ ticket: 44, action: "merged-unverified", pr: "https://github.com/example/repo/pull/92", head_oid: "abc123", completed: [], remaining: ["code", "security", "safety", "qms"] }));
  return root;
}

test("post-merge audit needs explicit acknowledgment", async () => {
  const root = await fixture();
  const result = await recordMergedAudit(root, { ticket: 44, note: "Reviewed all merged evidence", acknowledged: false });
  assert.equal(result.ok, false);
  assert.match(result.output, /Acknowledge/);
});

test("post-merge audit records evidence and clears only the active exception", async () => {
  const root = await fixture();
  const now = new Date("2026-09-01T00:00:00Z");
  const result = await recordMergedAudit(root, { ticket: 44, note: "Reviewed CI and device evidence; residual risk accepted.", acknowledged: true }, now);
  assert.equal(result.ok, true);
  const audit = JSON.parse(await readFile(path.join(root, "state/44.post-merge-audit.json"), "utf8"));
  const review = JSON.parse(await readFile(path.join(root, "state/44.review.json"), "utf8"));
  assert.equal(audit.original_exception, "PR merged before assurance completed (0/4 profiles passed)");
  assert.equal(audit.head_oid, "abc123");
  assert.equal(review.action, "merged-audited");
  assert.match(await readFile(path.join(root, "state/44.merged-audited"), "utf8"), /post-merge-audit.json/);
  await assert.rejects(readFile(path.join(root, "state/44.merged-unverified"), "utf8"), { code: "ENOENT" });
});
