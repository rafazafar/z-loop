import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectStatus } from "../web/status.mjs";
import { writeConfig } from "../web/control-plane.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("central config.json contains valid project, commands, and roles structure", async () => {
  const text = await readFile(path.join(root, "config.json"), "utf8");
  const config = JSON.parse(text);

  assert.ok(config.project?.name, "project.name must exist");
  assert.ok(config.project?.repo_path, "project.repo_path must exist");
  assert.ok(config.roles?.implementer?.model, "roles.implementer.model must exist");
  assert.ok(config.roles?.reviewer?.model, "roles.reviewer.model must exist");
  assert.ok(config.commands?.test, "commands.test must exist");
  assert.ok(config.commands?.lint, "commands.lint must exist");
  assert.ok(Array.isArray(config.assurance?.enabled_dimensions), "enabled_dimensions must be an array");
});

test("collectStatus reports project metadata and dynamic timer labels", async () => {
  const status = await collectStatus(root);
  assert.ok(status.project?.name, "status must include project.name");
  assert.equal(status.project.name, "kokolog-monitor");

  const implementLoop = status.loops.find((l) => l.id === "implement");
  assert.ok(implementLoop, "implement loop must exist");
  assert.match(implementLoop.timerLabel, /tick$/, "timer label must end with tick");
});
