import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parkedResolutionPresentation } from "../web/src/ui-model.js";

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function waitForFile(file) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await stat(file).then(() => true).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${file}`);
}

test("implementation sessions cannot bypass paid dispatch", async () => {
  await assert.rejects(
    exec(path.join(root, "run/spawn"), ["start", "999-impl-a1", "test/model", "low", root, path.join(root, "missing.prompt")], { cwd: root }),
    (error) => error.code === 78 && /must start through paid dispatch/.test(error.stderr)
  );
});

test("the controller has one guarded implementation spawn gateway", async () => {
  const source = await readFile(path.join(root, "run/loop-tick"), "utf8");
  assert.equal((source.match(/run\/spawn\" start/g) || []).length, 1);
  assert.match(source, /KOKOLOG_PAID_DISPATCH=1/);
  assert.match(source, /--collect-only\) mode=collect/);
  assert.match(source, /max_concurrent_sessions/);
  assert.match(source, /rule max_fix_attempts/);
  assert.match(source, /blocking_repairs/);
  assert.doesNotMatch(source, /rule max_verify_rounds/);
  assert.match(source, /route_model repairer/);
  assert.match(source, /repair contract incomplete: PR head did not change/);
  assert.match(source, /rm -f "\$STATE\/\$n\.verified"/);
  assert.match(source, /started="\$SESSIONS\/\$sess\.spawn\.json"/);
  assert.match(source, /immutable review patch/);
  assert.match(source, /review-evidence/);
  assert.match(source, /mark_merged_verified/);
  assert.match(source, /\[ "\$live_head" != "\$stored_head" \]/);
  assert.match(source, /st_set "\$n" merged/);
});

test("the controller lock excludes concurrent owners", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "kokolog-lock-"));
  const runDir = path.join(temporary, "run");
  const common = path.join(runDir, "common.sh");
  const marker = path.join(temporary, "held");
  await mkdir(runDir);
  await writeFile(common, await readFile(path.join(root, "run/common.sh"), "utf8"));
  await writeFile(path.join(temporary, "routing.json"), JSON.stringify({ project: { repo_path: temporary } }));

  const holder = spawn("bash", ["-c", 'source "$1"; acquire_lock || exit 75; touch "$2"; sleep 0.4; release_lock', "_", common, marker]);
  const holderExit = new Promise((resolve, reject) => {
    holder.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`lock holder exited ${code}`)));
    holder.once("error", reject);
  });
  await waitForFile(marker);
  await assert.rejects(
    exec("bash", ["-c", 'source "$1"; acquire_lock || exit 75; release_lock', "_", common]),
    (error) => error.code === 75
  );
  await holderExit;
  await exec("bash", ["-c", 'source "$1"; acquire_lock; release_lock', "_", common]);
});

test("one unified review blocks only on P0 and P1 issues", async () => {
  const review = await readFile(path.join(root, "agents/reviewer.md"), "utf8");
  const classifier = await readFile(path.join(root, "run/assurance-classify"), "utf8");
  const routing = JSON.parse(await readFile(path.join(root, "routing.json"), "utf8"));
  assert.match(review, /Review all listed\s+dimensions in this one pass/);
  assert.match(review, /Return `BLOCK` only for a P0 or P1 defect/);
  assert.match(review, /P2 and P3 observations are advisory/);
  assert.match(review, /changelog entries, style changes, naming, or cleanup\s+cannot exceed P2/);
  assert.match(review, /up to\s+seven/);
  assert.match(review, /Do not use shell commands to inspect or\s+change the checkout/);
  assert.match(review, /printf.*\.tmp.*mv/s);
  assert.doesNotMatch(review, /Stop at the first FAIL/);
  assert.match(classifier, /required_json='\["assurance"\]'/);
  assert.deepEqual(Object.keys(routing.roles).filter((role) => role.endsWith("-reviewer")), []);
  assert.equal(routing.rules.max_verify_rounds, undefined);
  const runtime = await readFile(path.join(root, "run/spawn-exec"), "utf8");
  const readOnlyPolicy = runtime.match(/if \[ -n "\$readonly_output" \]; then([\s\S]*?)\nelse\n  case/)?.[1] || "";
  assert.ok(readOnlyPolicy, "read-only runtime policy was not found");
  assert.doesNotMatch(readOnlyPolicy, /"git diff\*":"allow"/);
  assert.match(readOnlyPolicy, /edit:"deny"/);
  assert.match(readOnlyPolicy, /quoted_write_pattern/);
});

test("same-head review retry is limited to runtime failures without a verdict", async () => {
  const resolution = await readFile(path.join(root, "run/resolve-ticket"), "utf8");
  const server = await readFile(path.join(root, "web/server.mjs"), "utf8");
  assert.match(resolution, /live_head/);
  assert.match(resolution, /old_head/);
  assert.match(resolution, /owner-clean-retry/);
  assert.match(resolution, /if \[ "\$mode" = retry \]/);
  assert.match(resolution, /if \[ "\$mode" != retry \]/);
  assert.match(server, /if \(disposition !== "retry"\)/);
  assert.deepEqual(parkedResolutionPresentation("retry"), {
    submitLabel: "Retry automation",
    evidenceHidden: true
  });
  assert.equal(parkedResolutionPresentation("resume").evidenceHidden, false);
});

test("same-head retry accepts single-digit review rounds", async () => {
  await exec("bash", ["-c", 'ticket=37; round=1; old_sid=37-rev-assurance-r1; [[ "$old_sid" =~ ^${ticket}-rev-assurance-r${round}(-retry[0-9]+)?$ ]]']);
  await exec("bash", ["-c", 'ticket=37; round=1; old_sid=37-rev-assurance-r1-retry2; [[ "$old_sid" =~ ^${ticket}-rev-assurance-r${round}(-retry[0-9]+)?$ ]]']);
  await assert.rejects(exec("bash", ["-c", 'ticket=37; round=1; old_sid=37-rev-assurance-r2; [[ "$old_sid" =~ ^${ticket}-rev-assurance-r${round}(-retry[0-9]+)?$ ]]']));
});

test("successful review exits remain retryable when no result was written", async () => {
  const resolution = await readFile(path.join(root, "run/resolve-ticket"), "utf8");
  assert.doesNotMatch(resolution, /case "\$old_exit" in ''\|0\|\*\[!0-9\]\*\).*review session/);
});

test("timeouts record a transient exit and completed implementation results reconcile", async () => {
  const source = await readFile(path.join(root, "run/loop-tick"), "utf8");
  const common = await readFile(path.join(root, "run/common.sh"), "utf8");
  const runtime = await readFile(path.join(root, "run/spawn-exec"), "utf8");
  const configFile = (await stat(path.join(root, "config.json")).catch(() => null)) ? path.join(root, "config.json") : path.join(root, "routing.json");
  const routing = JSON.parse(await readFile(configFile, "utf8"));
  assert.match(source, /printf '143\\n'.*\$sess\.exit\.tmp/);
  assert.match(source, /harvest_impl/);
  assert.match(source, /retry_sid=/);
  assert.match(source, /terminate_session "\$sess" "\$termination_grace_sec"/);
  assert.match(source, /inactivity watchdog/);
  assert.doesNotMatch(source, /context watchdog/);
  assert.doesNotMatch(source, /convergence watchdog/);
  assert.match(common, /kill -TERM -- "-\$pgid"/);
  assert.match(common, /kill -KILL -- "-\$pgid"/);
  assert.match(common, /process_group_alive/);
  assert.match(runtime, /workdir_lock_path/);
  assert.match(runtime, /OPERATIONAL COLLISION/);
  assert.match(runtime, /OPENCODE_CONFIG_CONTENT='\{"plugin":\[\],"mcp":\{"google-docs":\{"enabled":false\}\}\}'/);
  assert.equal(routing.rules.session_inactivity_timeout_sec, 1800);
  assert.equal(routing.rules.session_max_steps, undefined);
  assert.equal(routing.rules.session_context_hard_limit, undefined);
});

test("runtime failures remain operational and owner retries bypass only the automatic retry count", async () => {
  const controller = await readFile(path.join(root, "run/loop-tick"), "utf8");
  const resolution = await readFile(path.join(root, "run/resolve-ticket"), "utf8");
  const common = await readFile(path.join(root, "run/common.sh"), "utf8");
  assert.match(controller, /record_runtime_failure/);
  assert.match(controller, /dispatch_runtime_retries/);
  assert.match(resolution, /status="retry-ready"/);
  assert.match(resolution, /owner_authorized=true/);
  const stateSetter = common.match(/st_set\(\)[\s\S]*?\n\}/)?.[0] || "";
  assert.match(stateSetter, /if \[ "\$2" = parked \]; then\s+github_mark_need_decision/);
  assert.doesNotMatch(stateSetter, /if \[ "\$2" = runtime-failed \]; then/);
});

test("implementers have a bounded convergence contract", async () => {
  const instructions = await readFile(path.join(root, "agents/implementer.md"), "utf8");
  assert.match(instructions, /one final diff review/);
  assert.match(instructions, /Do not reopen already proven areas/);
  assert.match(instructions, /Do not inspect\s+controller state, prior attempts, session logs/);
  assert.doesNotMatch(instructions, /OPERATIONAL COLLISION/);
});

test("writing sessions use a working OpenCode edit policy", async () => {
  const runtime = await readFile(path.join(root, "run/spawn-exec"), "utf8");
  const writingPolicy = runtime.match(/\*-impl-\*\|loop-spec-sync-\*\)([\s\S]*?)\n      ;;/)?.[1] || "";
  assert.ok(writingPolicy, "writing-session runtime policy was not found");
  assert.match(writingPolicy, /OPENCODE_PERMISSION='\{"edit":"allow","task":"deny","external_directory":"deny"\}'/);
  assert.doesNotMatch(writingPolicy, /edit:\{"\*":"deny"/);
});

test("staged artifact sessions accept quoted atomic output paths", async () => {
  const runtime = await readFile(path.join(root, "run/spawn-exec"), "utf8");
  const stagedPolicy = runtime.match(/loop-ticket-factory-\*\|loop-gardener-\*\|loop-decision-desk-\*\)([\s\S]*?)\n      ;;/)?.[1] || "";
  assert.ok(stagedPolicy, "staged-artifact runtime policy was not found");
  assert.match(stagedPolicy, /edit:"deny"/);
  assert.match(stagedPolicy, /quoted_result_write_pattern/);
  assert.match(stagedPolicy, /quoted_stage_write_pattern/);
});

test("domain verification does not request denied shell evidence", async () => {
  const source = await readFile(path.join(root, "run/domain-loop"), "utf8");
  const verifierPrompt = source.match(/You are a fresh read-only verifier([\s\S]*?)write_cycle verifier-running/)?.[1] || "";
  assert.ok(verifierPrompt, "domain verifier prompt was not found");
  assert.match(verifierPrompt, /Do not use shell commands/);
  assert.doesNotMatch(verifierPrompt, /command exits/);
});

test("maintenance schedule updates install the selected timer during change and rollback", async () => {
  const source = await readFile(path.join(root, "web/server.mjs"), "utf8");
  const scheduleAction = source.match(/async function scheduleAction\(body\) \{([\s\S]*?)\n\}\n\nasync function availableModels/)?.[1] || "";
  assert.ok(scheduleAction, "scheduleAction source was not found");
  assert.equal((scheduleAction.match(/installLaunchAgent\(root, targetDef\.timer\)/g) || []).length, 2);
  assert.doesNotMatch(scheduleAction, /installLaunchAgent\(root, def\.timer\)/);
});

test("the console handles background spawn errors and reads bounded log tails", async () => {
  const source = await readFile(path.join(root, "web/server.mjs"), "utf8");
  assert.match(source, /child\.once\("error"/);
  assert.match(source, /async function readTail/);
  const logHandler = source.match(/if \(url\.pathname === "\/api\/log"\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.ok(logHandler, "log handler was not found");
  assert.match(logHandler, /readTail/);
  assert.doesNotMatch(logHandler, /readFile/);
  assert.match(source, /error\.statusCode \|\| 500/);
});
