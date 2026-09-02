import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("dashboard launch agent starts at login and restarts after exit", async () => {
  const plist = await readFile(path.join(root, "run/plists/dev.kokolog.loop.dashboard.plist"), "utf8");
  assert.match(plist, /<string>dev\.kokolog\.loop\.dashboard<\/string>/);
  assert.match(plist, /<string>__LOOP_ROOT__\/run\/dashboard --no-open<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KOKOLOG_DASHBOARD_PORT<\/key>\s*<string>4177<\/string>/);
  assert.match(plist, /launchd-dashboard\.err/);
});
