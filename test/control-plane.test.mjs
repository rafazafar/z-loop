import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyDispatchPolicy, applyRouteUpdates, installLaunchAgent, launchAgentEnvironment, launchAgentExecutablePath, launchAgentPaths, normalizeLaunchAgentSchedule, parseLaunchAgentSchedule, parseModelList, parseModelMetadata, routeEntries, updateLaunchAgentSchedule } from "../web/control-plane.mjs";

const routing = {
  roles: {
    implementer: { model: "openai/gpt-old", variant: "high" },
    repairer: { model: "openai/gpt-repair", variant: "high" },
    reviewer: { model: "openai/gpt-review", variant: "xhigh" }
  },
  rules: {}
};

test("model list parser keeps only installed provider routes", () => {
  const output = `authorization note\nhttps://example.com/login\nopenai/gpt-5.6-sol\nzai-coding-plan/glm-5.3\nopenai/gpt-5.6-sol\n`;
  assert.deepEqual(parseModelList(output), ["openai/gpt-5.6-sol", "zai-coding-plan/glm-5.3"]);
});

test("model metadata parser extracts provider variants from concatenated JSON", () => {
  const output = `openai/gpt-a\n${JSON.stringify({ id: "gpt-a", providerID: "openai", note: "brace { in text", variants: { low: {}, high: {} } }, null, 2)}\nopenai/gpt-b\n${JSON.stringify({ id: "gpt-b", providerID: "openai", variants: { max: {} } }, null, 2)}`;
  assert.deepEqual(parseModelMetadata(output), { "openai/gpt-a": ["low", "high"], "openai/gpt-b": ["max"] });
});

test("routing entries include independent build and repair routes", () => {
  assert.deepEqual(routeEntries(routing).map((entry) => entry.id), ["role:implementer", "role:repairer", "role:reviewer"]);
});

test("route updates are immutable and reject models that are not installed", () => {
  const next = applyRouteUpdates(routing, [
    { id: "role:implementer", model: "openai/gpt-new", variant: "max" },
    { id: "role:repairer", model: "openai/gpt-repair-new", variant: "xhigh" }
  ], ["openai/gpt-new", "openai/gpt-repair-new"]);
  assert.equal(next.roles.implementer.model, "openai/gpt-new");
  assert.equal(next.roles.repairer.variant, "xhigh");
  assert.equal(routing.roles.implementer.model, "openai/gpt-old");
  assert.throws(() => applyRouteUpdates(routing, [{ id: "role:reviewer", model: "unknown/model", variant: "high" }], ["openai/gpt-new"]), /not installed/);
  assert.throws(() => applyRouteUpdates(routing, [{ id: "role:reviewer", model: "openai/gpt-new", variant: "ultra" }], ["openai/gpt-new"], { "openai/gpt-new": ["high"] }), /not available/);
});

test("paid dispatch policy is bounded and immutable", () => {
  const next = applyDispatchPolicy(routing, 2);
  assert.equal(next.rules.max_new_sessions_per_dispatch, 2);
  assert.equal(routing.rules.max_new_sessions_per_dispatch, undefined);
  assert.throws(() => applyDispatchPolicy(routing, 0), /between 1 and 8/);
  assert.throws(() => applyDispatchPolicy(routing, 9), /between 1 and 8/);
});

test("launch agent installation replaces only the loop root placeholder", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "kokolog-control-"));
  const root = path.join(temporary, "loop root");
  const home = path.join(temporary, "home");
  const label = "dev.kokolog.loop.tick";
  await mkdir(path.join(root, "run", "plists"), { recursive: true });
  await writeFile(path.join(root, "run", "plists", `${label}.plist`), "<string>__LOOP_ROOT__/run/loop-tick --once</string>\n<string>__LAUNCH_PATH__</string>\n");
  const installed = await installLaunchAgent(root, label, home);
  assert.equal(installed, launchAgentPaths(root, label, home).installed);
  assert.equal(await readFile(installed, "utf8"), `<string>${root}/run/loop-tick --once</string>\n<string>${launchAgentExecutablePath(home)}</string>\n`);
  assert.equal(launchAgentEnvironment(home).PATH, launchAgentExecutablePath(home));
  assert.equal(launchAgentEnvironment(home).PATH.split(":")[0], path.dirname(process.execPath));
  assert.match(launchAgentEnvironment(home).PATH, new RegExp(`${home}/\\.opencode/bin`));
});

test("launch agent schedules parse and format interval and daily forms", () => {
  const interval = `<key>StartInterval</key>\n<integer>3600</integer>`;
  assert.deepEqual(parseLaunchAgentSchedule(interval), { kind: "interval", minutes: 60, seconds: 3600, cadence: "Every hour" });
  const daily = `<key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict><dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>30</integer></dict></array>`;
  assert.deepEqual(parseLaunchAgentSchedule(daily), { kind: "daily", times: ["09:00", "17:30"], cadence: "09:00 and 17:30" });
});

test("schedule updates preserve the launch agent and reject unsafe values", () => {
  const plist = `<dict>\n<key>Label</key><string>dev.test</string>\n<key>StartInterval</key><integer>600</integer>\n</dict>\n`;
  const updated = updateLaunchAgentSchedule(plist, { kind: "interval", minutes: 90 });
  assert.match(updated.text, /<integer>5400<\/integer>/);
  assert.match(updated.text, /<string>dev\.test<\/string>/);
  assert.equal(updated.schedule.cadence, "Every 90 minutes");
  assert.throws(() => normalizeLaunchAgentSchedule({ kind: "interval", minutes: 0 }), /between 1 minute and 7 days/);
  assert.throws(() => updateLaunchAgentSchedule(plist, { kind: "daily", times: ["09:00"] }), /uses an interval schedule/);
  assert.throws(() => normalizeLaunchAgentSchedule({ kind: "daily", times: ["25:00"] }), /24-hour times/);
  assert.throws(() => normalizeLaunchAgentSchedule({ kind: "daily", times: ["09:00", "09:00"] }), /unique/);

  const daily = `<dict>\n<key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict></array>\n</dict>`;
  const dailyUpdated = updateLaunchAgentSchedule(daily, { kind: "daily", times: ["08:15", "16:45"] });
  assert.deepEqual(parseLaunchAgentSchedule(dailyUpdated.text), { kind: "daily", times: ["08:15", "16:45"], cadence: "08:15 and 16:45" });
});
