import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const web = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(web);
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4177;
const definitions = {
  implement: { runner: "loop-tick", args: ["--once"], cadence: "Every 60m", timer: "dev.kokolog.loop.tick", consumes: "Ready GitHub issues", produces: "PRs and verdicts" },
  "spec-sync": { runner: "spec-sync-trigger", role: "distiller", background: true, cadence: "Every 10m", timer: "dev.kokolog.loop.specsync", consumes: "New transcripts", produces: "Doc PRs and decisions" },
  "ticket-factory": { runner: "domain-loop", role: "ticketer", args: ["ticket-factory"], background: true, cadence: "On demand", consumes: "Approved specs and epics", produces: "Breakdown cards" },
  gardener: { runner: "domain-loop", role: "gardener", args: ["gardener"], background: true, cadence: "Weekly", consumes: "Signals and verdicts", produces: "Signals and proposal cards" },
  "decision-desk": { runner: "decision-batch", role: "decision-desk", background: true, cadence: "09:00 and 17:00", timer: "dev.kokolog.loop.decisions", consumes: "Open cards and parked work", produces: "Human decision queues" }
};
const domainIds = Object.keys(definitions);
const stateNames = new Set(["ready", "in-progress", "review", "fix", "done", "parked", "blocked-decision"]);

async function run(file, args = [], cwd = root, timeout = 10000) {
  try {
    const result = await exec(file, args, { cwd, timeout, maxBuffer: 1024 * 1024 });
    return { ok: true, stdout: result.stdout.trim(), output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return { ok: false, stdout: (error.stdout || "").trim(), output: `${error.stdout || ""}${error.stderr || error.message}`.trim() };
  }
}

function runDetached(file, args = []) {
  try {
    const child = spawn(file, args, { cwd: root, detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, output: `Started ${path.basename(file)} ${args.join(" ")}`.trim() };
  } catch (error) {
    return { ok: false, output: error.message };
  }
}

function field(text, name) {
  return text.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
}

function timeline(text) {
  const body = text.split(/^## Timeline\s*$/m)[1]?.split(/^## /m)[0] || "";
  return body.split("\n").map((line) => line.trim()).filter((line) => /^\d{4}-\d{2}-\d{2}/.test(line)).slice(0, 8);
}

async function isTimerLoaded(label) {
  if (!label) return false;
  return (await run("launchctl", ["print", `gui/${process.getuid()}/${label}`], root, 2000)).ok;
}

async function collectSessions(routing) {
  const dir = path.join(root, "state/sessions");
  const files = await readdir(dir).catch(() => []);
  const liveText = (await run("tmux", ["list-sessions", "-F", "#S"], root, 2000)).output;
  const live = new Set(liveText.split("\n").filter(Boolean).map((id) => id.replace(/^kokoloop-/, "")));
  const ids = [...new Set(files.map((name) => name.replace(/\.(prompt|result|done|harvested)$/, "")))];
  return Promise.all(ids.map(async (id) => {
    const resultPath = path.join(dir, `${id}.result`);
    const result = await readFile(resultPath, "utf8").catch(() => "");
    const loop = domainIds.find((domain) => id.startsWith(`loop-${domain}-`)) || (/^dist-/.test(id) ? "spec-sync" : /^desk-/.test(id) ? "decision-desk" : "implement");
    const role = id.includes("-rev-") || id.endsWith("-verify") ? "reviewer" : loop === "implement" ? "implementer" : definitions[loop]?.role || loop;
    const alias = routing.roles?.[role]?.model;
    return { id, loop, role, route: alias ? `${routing.aliases?.[alias]?.model || alias} · ${routing.aliases?.[alias]?.variant || "default"}` : "", status: live.has(id) ? "running" : files.includes(`${id}.harvested`) ? "harvested" : files.includes(`${id}.done`) ? "awaiting harvest" : "incomplete", result: result.slice(0, 24000), log: `${id}.jsonl` };
  }));
}

async function collect() {
  const routing = JSON.parse(await readFile(path.join(root, "routing.json"), "utf8"));
  const repoPath = routing.project.repo_path;
  const remote = (await run("git", ["remote", "get-url", "origin"], repoPath)).output;
  const ghrepo = remote.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
  const sessions = await collectSessions(routing);
  const loops = await Promise.all(domainIds.map(async (id) => {
    const text = await readFile(path.join(root, `domains/${id}/README.md`), "utf8");
    const def = definitions[id];
    return { id, status: field(text, "status"), goal: field(text, "goal"), cadence: def.cadence, timerLoaded: await isTimerLoaded(def.timer), triggerable: Boolean(def.runner), unavailable: def.unavailable || "", consumes: def.consumes, produces: def.produces, timeline: timeline(text), work: sessions.find((item) => item.loop === id && item.status === "running")?.id || "Idle" };
  }));
  const stateFiles = await readdir(path.join(root, "state")).catch(() => []);
  const ticketFiles = stateFiles.map((name) => ({ name, match: name.match(/^(\d+)\.(.+)$/) })).filter((item) => item.match && stateNames.has(item.match[2]));
  const ticketStats = await Promise.all(ticketFiles.map(async (item) => ({ id: item.match[1], status: item.match[2], mtime: (await stat(path.join(root, "state", item.name))).mtimeMs })));
  const latestTickets = new Map();
  for (const ticket of ticketStats) if (!latestTickets.has(ticket.id) || latestTickets.get(ticket.id).mtime < ticket.mtime) latestTickets.set(ticket.id, ticket);
  const tickets = [...latestTickets.values()].map(({ id, status }) => ({ id, status }));
  const decisionFiles = await readdir(path.join(root, "decisions")).catch(() => []);
  const decisions = (await Promise.all(decisionFiles.filter((name) => name.endsWith(".md")).map(async (name) => ({ name, text: await readFile(path.join(root, "decisions", name), "utf8") })))).filter((item) => /^status:\s*open/m.test(item.text)).map((item) => item.name);
  const logFiles = await readdir(path.join(root, "logs")).catch(() => []);
  const logs = (await Promise.all(logFiles.map(async (name) => ({ name, info: await stat(path.join(root, "logs", name)).catch(() => null) })))).filter((item) => item.info?.isFile()).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, 30).map((item) => ({ name: item.name, size: item.info.size, modified: item.info.mtime.toISOString() }));
  const frontierResult = await run("gh", ["issue", "list", "-R", ghrepo, "--state", "open", "--label", routing.github.frontier_label, "--limit", "50", "--json", "number,title"], root, 5000);
  let frontier = [];
  try { if (frontierResult.ok) frontier = JSON.parse(frontierResult.stdout || "[]"); } catch {}
  return { generatedAt: new Date().toISOString(), repo: { path: repoPath, ghrepo }, loops, sessions: sessions.sort((a, b) => b.id.localeCompare(a.id)), tickets, decisions, logs, frontier, routing };
}

async function action(body) {
  const def = definitions[body.loop];
  if (!def || !["run", "toggle"].includes(body.action)) return { ok: false, output: "Unsupported action" };
  if (body.action === "run") {
    if (!def.runner) return { ok: false, output: def.unavailable };
    const runner = path.join(root, `run/${def.runner}`);
    return def.background ? runDetached(runner, def.args || []) : run(runner, def.args || [], root, 120000);
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
    if (url.pathname === "/api/state") return send(response, 200, await collect());
    if (url.pathname === "/api/log") {
      const name = path.basename(url.searchParams.get("name") || "");
      if (!name) return send(response, 400, { error: "Missing log name" });
      const text = await readFile(path.join(root, "logs", name), "utf8");
      return send(response, 200, text.slice(-250000), "text/plain");
    }
    if (url.pathname === "/api/action" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 4096) return send(response, 413, { error: "Request too large" });
      }
      return send(response, 200, await action(JSON.parse(raw)));
    }
    const file = url.pathname === "/" ? "index.html" : path.basename(url.pathname);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
    try { return send(response, 200, await readFile(path.join(web, file), "utf8"), types[path.extname(file)] || "text/plain"); }
    catch (error) { if (error.code === "ENOENT") return send(response, 404, { error: "Not found" }); throw error; }
  } catch (error) {
    send(response, 500, { error: error.message });
  }
}).listen(port, "127.0.0.1", () => console.log(`Bench: http://127.0.0.1:${port}`));
