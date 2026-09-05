import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("transcript queue and domain behavior in isolated repositories", () => {
  const output = execFileSync("python3", ["test/spec_sync_test.py"], { encoding: "utf8", timeout: 120000 });
  assert.match(output, /SPEC_SYNC_TESTS_OK/);
});
