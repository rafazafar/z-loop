import http from "node:http";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectStatus, definitions, field, runCommand } from "./status.mjs";
import { recordMergedAudit } from "./audit.mjs";
import { applyDispatchPolicy, applyRouteUpdates, installLaunchAgent, launchAgentEnvironment, launchAgentPaths, parseModelList, parseModelMetadata, routeEntries, STANDARD_VARIANTS, updateLaunchAgentSchedule, writeRouting } from "./control-plane.mjs";

const web = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(web);
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4177;
const eventClients = new Set();
let statusCache = null;
let statusCacheAt = 0;
let statusRefresh = null;
let refreshDebounce = null;
let modelCache = null;
let modelCacheAt = 0;
const providerCache = new Map();

function statusFingerprint(status) {
  const { generatedAt, ...stable } = status;
  return JSON.stringify(stable);
}

function writeEvent(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastState(status) {
  for (const response of eventClients) writeEvent(response, "state", status);
}

async function refreshStatus(force = false) {
  if (!force && statusCache && Date.now() - statusCacheAt < 2500) return statusCache;
  if (statusRefresh) return statusRefresh;
  statusRefresh = collectStatus(root).then((next) => {
    const changed = !statusCache || statusFingerprint(statusCache) !== statusFingerprint(next);
    statusCache = next;
    statusCacheAt = Date.now();
    if (changed) broadcastState(next);
    return next;
  }).finally(() => { statusRefresh = null; });
  return statusRefresh;
}

function scheduleRefresh() {
  clearTimeout(refreshDebounce);
  refreshDebounce = setTimeout(() => refreshStatus(true).catch((error) => console.error("status refresh failed", error)), 350);
}

function streamEvents(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  response.write("retry: 2000\n\n");
  eventClients.add(response);
  refreshStatus().then((status) => writeEvent(response, "state", status)).catch((error) => writeEvent(response, "error", { message: error.message }));
  const keepAlive = setInterval(() => response.write(`: heartbeat ${Date.now()}\n\n`), 15000);
  request.on("close", () => {
    clearInterval(keepAlive);
    eventClients.delete(response);
  });
}

function runDetached(file, args = []) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: root, detached: true, stdio: "ignore" });
    child.once("error", (error) => resolve({ ok: false, output: error.message }));
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, output: `Started ${path.basename(file)} ${args.join(" ")}`.trim() });
    });
  });
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 8192) return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Malformed JSON");
    error.statusCode = 400;
    throw error;
  }
}

async function readTail(file, maxBytes = 250000) {
  const info = await stat(file);
  const length = Math.min(info.size, maxBytes);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, info.size - length);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function action(body) {
  if (body?.action === "clear-cooldown") {
    await rm(path.join(root, "state/circuit-breaker.json"), { force: true });
    return { ok: true, output: "Rate limit cooldown cleared" };
  }
  const def = definitions[body?.loop];
  if (!def || !["run", "advance", "collect", "toggle"].includes(body?.action)) return { ok: false, output: "Unsupported action" };
  if (body.action === "collect") {
    return runCommand(path.join(root, "run/collect-results"), [], root, 120000);
  }
  if (body.action === "run" || body.action === "advance") {
    if (!def.runner) return { ok: false, output: def.unavailable };
    const runner = path.join(root, `run/${def.runner}`);
    const args = body.action === "advance" && body.loop === "implement" ? ["--next"] : (def.args || []);
    return def.background ? runDetached(runner, args) : runCommand(runner, args, root, 120000);
  }
  const file = path.join(root, `domains/${body.loop}/README.md`);
  const text = await readFile(file, "utf8");
  const current = field(text, "status");
  const next = current === "active" ? "paused" : "active";
  const temporary = `${file}.dashboard.tmp`;
  await writeFile(temporary, text.replace(/^status:\s*\w+/m, `status: ${next}`));
  await rename(temporary, file);
  return { ok: true, output: `${body.loop} is now ${next}` };
}

function scheduleTarget(body) {
  const def = definitions[body?.loop];
  if (!def) return null;
  if (!body?.task) return { ...def, id: body.loop, title: body.loop, paid: true };
  const task = def.maintenance?.find((item) => item.id === body.task);
  return task ? { ...task, title: `${body.loop} ${task.label}` } : null;
}

async function timerAction(body) {
  const def = definitions[body?.loop];
  const targetDef = scheduleTarget(body);
  const timerActionName = body?.timerAction;
  if (!def || !targetDef?.timer || !["arm", "disarm"].includes(timerActionName)) return { ok: false, output: "Unsupported timer action" };
  const domainFile = path.join(root, `domains/${body.loop}/README.md`);
  const domain = await readFile(domainFile, "utf8");
  if (timerActionName === "arm" && targetDef.paid !== false && field(domain, "status") !== "active") return { ok: false, output: "Resume the workflow before you start its paid schedule" };
  const target = launchAgentPaths(root, targetDef.timer).installed;
  const service = `gui/${process.getuid()}/${targetDef.timer}`;
  const loaded = (await runCommand("launchctl", ["print", service], root, 3000)).ok;
  if (timerActionName === "arm") {
    if (loaded) return { ok: true, output: `${body.loop} schedule is already on` };
    await installLaunchAgent(root, targetDef.timer);
    const preflightArgs = targetDef.paid === false ? ["--no-model-runtime"] : [];
    const preflight = await runCommand(path.join(root, "run/doctor"), preflightArgs, root, 30000, launchAgentEnvironment());
    if (!preflight.ok) return { ok: false, output: `The scheduled environment is not ready:\n${preflight.output}` };
    const result = await runCommand("launchctl", ["bootstrap", `gui/${process.getuid()}`, target], root, 10000);
    if (!result.ok) return { ok: false, output: result.output || `Could not start ${body.loop} schedule` };
    return { ok: true, output: `${targetDef.title} schedule is on · ${targetDef.cadence}` };
  }
  if (!loaded) return { ok: true, output: `${targetDef.title} schedule is already off` };
  const result = await runCommand("launchctl", ["bootout", service], root, 10000);
  return result.ok ? { ok: true, output: `${targetDef.title} schedule is off` } : { ok: false, output: result.output || `Could not stop ${targetDef.title} schedule` };
}

async function writeLaunchAgentSource(file, text) {
  const temporary = `${file}.dashboard.tmp`;
  await writeFile(temporary, text, { mode: 0o644 });
  await rename(temporary, file);
}

async function scheduleAction(body) {
  const targetDef = scheduleTarget(body);
  if (!targetDef?.timer) return { ok: false, output: "This workflow has no automatic schedule" };
  if (body?.acknowledged !== true) return { ok: false, output: "Confirm the schedule change first" };
  const files = launchAgentPaths(root, targetDef.timer);
  const previous = await readFile(files.source, "utf8");
  let updated;
  try {
    updated = updateLaunchAgentSchedule(previous, body?.schedule);
  } catch (error) {
    return { ok: false, output: error.message };
  }

  const service = `gui/${process.getuid()}/${targetDef.timer}`;
  const loaded = (await runCommand("launchctl", ["print", service], root, 3000)).ok;
  const installed = await stat(files.installed).then(() => true).catch(() => false);
  let stopped = false;
  try {
    if (loaded) {
      const result = await runCommand("launchctl", ["bootout", service], root, 10000);
      if (!result.ok) throw new Error(result.output || "Could not stop the current schedule");
      stopped = true;
    }
    await writeLaunchAgentSource(files.source, updated.text);
    if (installed || loaded) await installLaunchAgent(root, targetDef.timer);
    const preflightArgs = targetDef.paid === false ? ["--no-model-runtime"] : [];
    const preflight = await runCommand(path.join(root, "run/doctor"), preflightArgs, root, 30000, launchAgentEnvironment());
    if (!preflight.ok) throw new Error(`The scheduled environment is not ready:\n${preflight.output}`);
    if (loaded) {
      const result = await runCommand("launchctl", ["bootstrap", `gui/${process.getuid()}`, files.installed], root, 10000);
      if (!result.ok) throw new Error(result.output || "Could not restart the updated schedule");
    }
    return { ok: true, output: `${targetDef.title} schedule saved · ${updated.schedule.cadence}${loaded ? " · schedule restarted" : ""}` };
  } catch (error) {
    const rollbackErrors = [];
    try {
      await writeLaunchAgentSource(files.source, previous);
      if (installed || loaded) await installLaunchAgent(root, targetDef.timer);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError.message);
    }
    if (loaded && stopped) {
      const result = await runCommand("launchctl", ["bootstrap", `gui/${process.getuid()}`, files.installed], root, 10000);
      if (!result.ok) rollbackErrors.push(result.output || "Could not restart the previous schedule");
    }
    return { ok: false, output: `Schedule change failed and was rolled back: ${error.message}${rollbackErrors.length ? `\nRollback warning: ${rollbackErrors.join("; ")}` : ""}` };
  }
}

async function availableModels(force = false) {
  if (!force && modelCache && Date.now() - modelCacheAt < 60000) return modelCache;
  const result = await runCommand("opencode", ["models"], root, 20000);
  const models = parseModelList(result.stdout || result.output);
  if (!models.length) throw new Error(result.output || "No installed models were found");
  modelCache = models;
  modelCacheAt = Date.now();
  return models;
}

async function providerModels(provider, force = false) {
  const cached = providerCache.get(provider);
  if (!force && cached && Date.now() - cached.at < 300000) return cached.models;
  const result = await runCommand("opencode", ["models", provider, "--verbose", "--pure"], root, 20000);
  const models = parseModelMetadata(result.stdout || result.output);
  if (!Object.keys(models).length) throw new Error(result.output || `No model metadata was returned for ${provider}`);
  providerCache.set(provider, { at: Date.now(), models });
  return models;
}

async function variantsForModels(models, force = false) {
  const providers = [...new Set(models.map((model) => model.split("/")[0]))];
  const metadata = await Promise.all(providers.map((provider) => providerModels(provider, force)));
  return Object.assign({}, ...metadata);
}

async function variantsForModel(model, force = false) {
  const installed = await availableModels();
  if (!installed.includes(model)) throw new Error(`Model is not installed: ${model}`);
  const variants = (await providerModels(model.split("/")[0], force))[model];
  if (!variants?.length) throw new Error(`No variants were reported for ${model}`);
  return variants;
}

async function modelCatalog(force = false) {
  const routing = JSON.parse(await readFile(path.join(root, "routing.json"), "utf8"));
  const routes = routeEntries(routing);
  const routeModels = [...new Set(routes.map((route) => route.model))];
  return { models: await availableModels(force), variants: STANDARD_VARIANTS, variantsByModel: await variantsForModels(routeModels, force), routes };
}

async function routingAction(body) {
  if (body?.acknowledged !== true) return { ok: false, output: "Confirm the routing change first" };
  const file = path.join(root, "routing.json");
  const previousText = await readFile(file, "utf8");
  const previous = JSON.parse(previousText);
  const updates = body?.updates;
  const models = Array.isArray(updates) ? [...new Set(updates.map((update) => String(update?.model || "")))] : [];
  const next = applyRouteUpdates(previous, updates, await availableModels(), await variantsForModels(models));
  await writeRouting(root, next);
  const check = await runCommand(path.join(root, "run/doctor"), [], root, 30000);
  if (!check.ok) {
    await writeFile(`${file}.dashboard.tmp`, previousText, { mode: 0o644 });
    await rename(`${file}.dashboard.tmp`, file);
    return { ok: false, output: `Routing validation failed and was rolled back.\n${check.output}` };
  }
  await rm(path.join(root, "state/circuit-breaker.json"), { force: true });
  return { ok: true, output: "Model routing saved. New model sessions will use these routes." };
}

async function dispatchPolicyAction(body) {
  if (body?.acknowledged !== true) return { ok: false, output: "Confirm the paid dispatch limit first" };
  const file = path.join(root, "routing.json");
  const previousText = await readFile(file, "utf8");
  const next = applyDispatchPolicy(JSON.parse(previousText), body?.maxStarts);
  await writeRouting(root, next);
  const check = await runCommand(path.join(root, "run/doctor"), [], root, 30000);
  if (!check.ok) {
    await writeFile(`${file}.dashboard.tmp`, previousText, { mode: 0o644 });
    await rename(`${file}.dashboard.tmp`, file);
    return { ok: false, output: `Paid dispatch policy validation failed and was rolled back.\n${check.output}` };
  }
  return { ok: true, output: `Concurrency limit saved · ${next.rules.max_concurrent_sessions} model session(s) maximum` };
}

async function decide(body) {
  const name = path.basename(String(body?.card || ""));
  if (!name.endsWith(".md") || name === "README.md") return { ok: false, output: "Invalid card" };
  const file = path.join(root, "decisions", name);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return { ok: false, output: "Card not found" };
  // status/date edits are anchored to the frontmatter slice, never body prose
  const split = text.indexOf("\n---", 4);
  const head = split === -1 ? text : text.slice(0, split);
  const rest = split === -1 ? "" : text.slice(split);
  if (!/^status: open$/m.test(head)) return { ok: false, output: "Card is not open" };
  const option = [...text.matchAll(/^## Option ([A-Z]) — (.+)$/gm)].find((match) => match[1] === body.option);
  if (!option) return { ok: false, output: "Unknown option for this card" };
  const note = String(body?.note || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  const now = new Date();
  const decided = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const updatedHead = head
    .replace(/^status: open$/m, "status: decided")
    .replace(/^(date: .+)$/m, `$1\ndecided-by: owner (operator console)\ndecided: ${decided}`);
  const answer = `## Decision\n\nOption ${option[1]} — ${option[2].trim()}.${note ? ` Note: ${note}` : ""}\n`;
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${(updatedHead + rest).trimEnd()}\n\n${answer}`);
  await rename(temporary, file);
  return { ok: true, output: `${name} · recorded: Option ${option[1]}` };
}

async function resolveParked(body) {
  const ticket = Number(body?.ticket);
  const disposition = ["resume", "retry", "manual"].includes(body?.disposition) ? body.disposition : "";
  const note = String(body?.note || "").replace(/\r\n/g, "\n").trim();
  if (!Number.isSafeInteger(ticket) || ticket < 1 || !disposition) return { ok: false, output: "Invalid parked-ticket disposition" };
  if (disposition !== "retry") {
    if (body?.acknowledged !== true) return { ok: false, output: "Acknowledge the disposition first" };
    if (note.length < 12) return { ok: false, output: "Add a specific note of at least 12 characters" };
    if (note.length > 4000) return { ok: false, output: "Note is too long" };
  }
  const result = await runCommand(path.join(root, "run/resolve-ticket"), [String(ticket), disposition, note], root, 30000);
  if (!result.ok) return { ok: false, output: result.output };
  if (["resume", "retry"].includes(disposition)) {
    const reconcile = await runCommand(path.join(root, "run/loop-tick"), ["--reconcile-only"], root, 120000);
    return { ok: reconcile.ok, output: [result.output, reconcile.output].filter(Boolean).join("\n") };
  }
  return { ok: true, output: result.output };
}

function send(response, status, data, type = "application/json") {
  response.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  response.end(type === "application/json" ? JSON.stringify(data) : data);
}

http.createServer(async (request, response) => {
  try {
    const host = (request.headers.host || "").toLowerCase();
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(response, 403, { error: "Invalid host" });
    if (request.method === "POST" && request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) return send(response, 403, { error: "Invalid origin" });
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/state") return send(response, 200, await refreshStatus());
    if (url.pathname === "/api/events") return streamEvents(request, response);
    if (url.pathname === "/api/models") return send(response, 200, await modelCatalog(url.searchParams.get("refresh") === "1"));
    if (url.pathname === "/api/model-variants") {
      const model = url.searchParams.get("model") || "";
      return send(response, 200, { model, variants: await variantsForModel(model, url.searchParams.get("refresh") === "1") });
    }
    if (url.pathname === "/api/log") {
      const name = path.basename(url.searchParams.get("name") || "");
      if (!name) return send(response, 400, { error: "Missing log name" });
      return send(response, 200, await readTail(path.join(root, "logs", name)), "text/plain");
    }
    if (url.pathname === "/api/action" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await action(body);
      await refreshStatus(true);
      return send(response, 200, result);
    }
    if (url.pathname === "/api/timer" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await timerAction(body);
      await refreshStatus(true);
      return send(response, result.ok ? 200 : 409, result);
    }
    if (url.pathname === "/api/schedule" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await scheduleAction(body);
      await refreshStatus(true);
      return send(response, result.ok ? 200 : 409, result);
    }
    if (url.pathname === "/api/routing" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await routingAction(body);
      await refreshStatus(true);
      return send(response, result.ok ? 200 : 409, result);
    }
    if (url.pathname === "/api/dispatch-policy" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await dispatchPolicyAction(body);
      await refreshStatus(true);
      return send(response, result.ok ? 200 : 409, result);
    }
    if (url.pathname === "/api/decide" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await decide(body);
      await refreshStatus(true);
      return send(response, 200, result);
    }
    if (url.pathname === "/api/merged-audit" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await recordMergedAudit(root, body);
      await refreshStatus(true);
      return send(response, result.ok ? 200 : 409, result);
    }
    if (url.pathname === "/api/parked-resolution" && request.method === "POST") {
      const body = await readBody(request);
      if (body === null) return send(response, 413, { error: "Request too large" });
      const result = await resolveParked(body);
      await refreshStatus(true);
      return send(response, result.ok ? 200 : 409, result);
    }
    const file = url.pathname === "/" ? "index.html" : path.basename(url.pathname);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript" };
    try { return send(response, 200, await readFile(path.join(web, file), "utf8"), types[path.extname(file)] || "text/plain"); }
    catch (error) { if (error.code === "ENOENT") return send(response, 404, { error: "Not found" }); throw error; }
  } catch (error) {
    send(response, error.statusCode || 500, { error: error.message });
  }
}).listen(port, "127.0.0.1", () => console.log(`Bench: http://127.0.0.1:${port}`));

for (const target of [path.join(root, "state"), path.join(root, "domains"), path.join(root, "decisions"), path.join(root, "routing.json")]) {
  try {
    const watcher = watch(target, { recursive: true }, scheduleRefresh);
    watcher.unref();
  } catch (error) {
    console.error(`cannot watch ${target}`, error.message);
  }
}

const statusTimer = setInterval(() => refreshStatus(true).catch((error) => console.error("status poll failed", error)), 8000);
statusTimer.unref();
