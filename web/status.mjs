import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readLaunchAgentSchedule } from "./control-plane.mjs";

const exec = promisify(execFile);
const webDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRoot = path.dirname(webDir);

export const definitions = {
  implement: {
    runner: "controller-heartbeat", scheduledCommand: "controller-heartbeat", cadence: "Every minute", timerSuffix: "tick", timer: "dev.kokolog.loop.tick",
    consumes: "Ready GitHub issues", produces: "PRs and verdicts", maintenance: []
  },
  "spec-sync": { runner: "spec-sync-trigger", role: "distiller", background: true, scheduledCommand: "spec-sync-trigger", cadence: "Every 10m", timerSuffix: "specsync", timer: "dev.kokolog.loop.specsync", consumes: "New transcripts", produces: "Doc PRs and decisions" },
  "ticket-factory": { runner: "domain-loop", role: "ticketer", args: ["ticket-factory"], background: true, cadence: "On demand", consumes: "Approved specs and epics", produces: "Breakdown cards" },
  gardener: { runner: "domain-loop", role: "gardener", args: ["gardener"], background: true, cadence: "Weekly", consumes: "Signals and verdicts", produces: "Signals and proposal cards" },
  "decision-desk": { runner: "decision-batch", role: "decision-desk", background: true, scheduledCommand: "decision-batch", cadence: "09:00 and 17:00", timerSuffix: "decisions", timer: "dev.kokolog.loop.decisions", consumes: "Explicit human decision cards", produces: "Owner decision queues" }
};

const domainIds = Object.keys(definitions);
const stateNames = new Set(["ready", "in-progress", "review", "fix", "done", "parked", "merged", "merged-unverified", "merged-audited", "manual-takeover", "blocked-decision"]);
const prCache = new Map();
let frontierCache = null;
let frontierCacheAt = 0;

export async function runCommand(file, args = [], cwd = defaultRoot, timeout = 10000, environment = null) {
  try {
    const result = await exec(file, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, ...(environment ? { env: environment } : {}) });
    return { ok: true, stdout: result.stdout.trim(), output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return { ok: false, stdout: (error.stdout || "").trim(), output: `${error.stdout || ""}${error.stderr || error.message}`.trim() };
  }
}

export function field(text, name) {
  return text.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
}

function timeline(text) {
  const body = text.split(/^## Timeline\s*$/m)[1]?.split(/^## /m)[0] || "";
  return body.split("\n").map((line) => line.trim()).filter((line) => /^\d{4}-\d{2}-\d{2}/.test(line)).slice(0, 8);
}

async function fileStat(file) {
  return stat(file).catch(() => null);
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function isTimerLoaded(label, root) {
  if (!label) return false;
  return (await runCommand("launchctl", ["print", `gui/${process.getuid()}/${label}`], root, 2000)).ok;
}

async function isTimerInstalled(label) {
  if (!label) return false;
  return Boolean(await fileStat(path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`)));
}

export function sessionIdentity(id) {
  let match = id.match(/^(\d+)-impl-a(\d+)(?:-retry(\d+))?$/);
  if (match) {
    const attempt = Number(match[2]);
    return {
      ticket: Number(match[1]), attempt, kind: "implementation",
      phase: attempt === 1 ? "build" : "repair", repair: Math.max(0, attempt - 1),
      ...(match[3] ? { runtimeRetry: Number(match[3]) } : {})
    };
  }
  match = id.match(/^(\d+)-rev-assurance-r(\d+)(?:-retry(\d+))?$/);
  if (match) return {
    ticket: Number(match[1]), profile: "assurance", round: Number(match[2]), kind: "review",
    ...(match[3] ? { runtimeRetry: Number(match[3]) } : {})
  };
  return {};
}

export function annotateReviewRuns(sessions) {
  const runs = new Map();
  const ordered = sessions.filter((session) => session.kind === "review")
    .slice().sort((a, b) => a.ticket - b.ticket || a.profile.localeCompare(b.profile) || a.round - b.round);
  for (const session of ordered) {
    const key = `${session.ticket}:${session.profile}`;
    const run = (runs.get(key) || 0) + 1;
    runs.set(key, run);
    session.profileRun = run;
  }
  return sessions;
}

export function parseAssuranceReport(text) {
  const section = (name, next) => text.split(new RegExp(`^${name}:\\s*$`, "m"))[1]?.split(new RegExp(`^${next}:\\s*$`, "m"))[0] || "";
  const findings = (body) => [...body.matchAll(/^- (P[0-3])\s*·/gm)].map((match) => match[1]);
  const blockers = findings(section("blockers", "advisories"));
  const advisories = findings(text.split(/^advisories:\s*$/m)[1] || "");
  const severities = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const severity of [...blockers, ...advisories]) severities[severity] += 1;
  return {
    verdict: text.match(/^VERDICT:\s*(PASS|BLOCK)$/m)?.[1] || "",
    blockerCount: blockers.length,
    advisoryCount: advisories.length,
    severities
  };
}

async function collectAssuranceReports(root) {
  const dir = path.join(root, "verdicts");
  const files = await readdir(dir).catch(() => []);
  const reports = new Map();
  await Promise.all(files.map(async (name) => {
    const match = name.match(/^(\d+)-assurance-r(\d+)-[a-f0-9]+-verdict\.md$/);
    if (!match) return;
    const text = await readFile(path.join(dir, name), "utf8").catch(() => "");
    if (!text) return;
    const key = `${match[1]}:${match[2]}`;
    if (!reports.has(key)) reports.set(key, []);
    reports.get(key).push({ file: name, text, ...parseAssuranceReport(text) });
  }));
  return reports;
}

export async function collectSessions(root, routing) {
  const dir = path.join(root, "state/sessions");
  const [files, assuranceReports] = await Promise.all([
    readdir(dir).catch(() => []),
    collectAssuranceReports(root)
  ]);
  const liveText = (await runCommand("tmux", ["list-sessions", "-F", "#S"], root, 2000)).output;
  const tmuxPrefix = routing?.daemon?.service_identifier?.replace(/[^a-zA-Z0-9_-]/g, "-") || "kokoloop";
  const prefixRegex = new RegExp(`^(?:${tmuxPrefix}|kokoloop)-`);
  const live = new Set(liveText.split("\n").filter(Boolean).map((id) => id.replace(prefixRegex, "")));
  const ids = files.filter((name) => name.endsWith(".prompt")).map((name) => name.replace(/\.prompt$/, ""));
  const sessions = await Promise.all(ids.map(async (id) => {
    const identity = sessionIdentity(id);
    const resultPath = path.join(dir, `${id}.result`);
    const [result, exitText, spawnMetadata, promptInfo, spawnInfo, resultInfo, doneInfo, harvestedInfo, logInfo, stderrInfo, termReasonText] = await Promise.all([
      readFile(resultPath, "utf8").catch(() => ""),
      readFile(path.join(dir, `${id}.exit`), "utf8").catch(() => ""),
      readJson(path.join(dir, `${id}.spawn.json`)),
      fileStat(path.join(dir, `${id}.prompt`)),
      fileStat(path.join(dir, `${id}.spawn.json`)),
      fileStat(resultPath),
      fileStat(path.join(dir, `${id}.done`)),
      fileStat(path.join(dir, `${id}.harvested`)),
      fileStat(path.join(root, "logs", `${id}.jsonl`)),
      fileStat(path.join(root, "logs", `${id}.stderr`)),
      readFile(path.join(dir, `${id}.termination-reason`), "utf8").catch(() => "")
    ]);
    const loop = domainIds.find((domain) => id.startsWith(`loop-${domain}-`)) || (/^dist-/.test(id) ? "spec-sync" : /^desk-/.test(id) ? "decision-desk" : "implement");
    const role = identity.profile
      ? "reviewer"
      : id.endsWith("-verify")
        ? "reviewer"
        : loop === "implement"
          ? identity.phase === "repair" ? "repairer" : "implementer"
          : definitions[loop]?.role || loop;
    const configuredRoute = routing.roles?.[role];
    const actualRoute = spawnMetadata?.model ? spawnMetadata : configuredRoute;
    const status = live.has(id) ? "running" : harvestedInfo ? "harvested" : doneInfo ? "awaiting harvest" : "incomplete";
    const activity = [promptInfo, spawnInfo, resultInfo, doneInfo, harvestedInfo, logInfo, stderrInfo].filter(Boolean).reduce((latest, info) => Math.max(latest, info.mtimeMs), 0);
    const end = doneInfo?.mtimeMs || harvestedInfo?.mtimeMs || (live.has(id) ? Date.now() : activity);
    const started = spawnInfo?.mtimeMs || promptInfo?.birthtimeMs || 0;
    const verdict = result.match(/^VERDICT:\s*(PASS|BLOCK)$/m)?.[1] || "";
    const reportCandidates = identity.kind === "review" && verdict
      ? assuranceReports.get(`${identity.ticket}:${identity.round}`) || []
      : [];
    const assuranceReport = reportCandidates.find((report) => report.text.includes(`/review-evidence/${id}.json`))
      || (reportCandidates.length === 1 ? reportCandidates[0] : null);
    const verifiedReport = assuranceReport?.verdict === verdict ? assuranceReport : null;
    const exitCode = /^\d+$/.test(exitText.trim()) ? Number(exitText.trim()) : null;
    const terminationReason = termReasonText.trim();
    const resultSummary = terminationReason || (result.split("\n").map((line) => line.trim()).find(Boolean) || "");
    return {
      id, loop, role, route: actualRoute?.model ? `${actualRoute.model} · ${actualRoute.variant || "default"}` : "", status,
      routeSource: spawnMetadata?.model ? "recorded" : "configured fallback",
      result: result.slice(0, 24000), log: `${id}.jsonl`, lastActivity: activity ? new Date(activity).toISOString() : null,
      durationSeconds: started && end ? Math.max(0, Math.floor((end - started) / 1000)) : null,
      startedAt: started ? new Date(started).toISOString() : null,
      finishedAt: doneInfo ? doneInfo.mtime.toISOString() : null,
      verdict, exitCode, resultSummary, terminationReason,
      ...(verifiedReport ? {
        assuranceReport: verifiedReport.text.slice(0, 100000),
        assuranceReportFile: verifiedReport.file,
        blockerCount: verifiedReport.blockerCount,
        advisoryCount: verifiedReport.advisoryCount,
        severities: verifiedReport.severities
      } : {}),
      ...identity
    };
  }));
  return annotateReviewRuns(sessions).sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
}

export function ticketNextAction(ticket, session) {
  if (ticket.status === "merged-unverified") return "Owner: audit the merged PR and record assurance evidence";
  if (ticket.status === "merged") return "No action: PR merged after unified assurance passed";
  if (ticket.status === "merged-audited") return "No action: post-merge audit is recorded";
  if (ticket.status === "manual-takeover") return "No controller action: the PR is owner-managed";
  if (ticket.conflicted) return "PR has merge conflicts with main · rebase & conflict resolution required";
  if (ticket.status === "parked" && ticket.retryableReviewFailure) return "Owner: retry the same assurance review";
  if (["parked", "blocked-decision"].includes(ticket.status)) return "Owner: resolve the recorded reason";
  if (ticket.operationalFailure?.status === "needs-retry") return "Owner: start a clean retry from GitHub state";
  if (ticket.operationalFailure?.status === "retry-ready") return "Clean retry is ready for the next controller heartbeat";
  if (session?.status === "awaiting harvest") return "Collect results · no model session";
  if (session?.status === "running") return `Wait for ${session.id}`;
  if (session?.status === "incomplete") return "Advance current work · restarts the missing session";
  if (ticket.status === "review") return "Advance current work · starts at most one review session";
  if (ticket.status === "fix") return "Advance current work · starts at most one repair session";
  if (ticket.status === "in-progress") return "Advance current work · starts at most one implementation session";
  if (ticket.status === "done") return "Owner: merge the conditionally assured PR";
  return "No action";
}

async function fetchPrMetadata(pr, ghrepo, root, force = false) {
  const cacheKey = `${ghrepo}:${pr}`;
  const cached = prCache.get(cacheKey);
  const now = Date.now();
  if (cached?.data?.prState === "MERGED" || cached?.data?.prState === "CLOSED") {
    return cached.data;
  }
  if (!force && cached && now - cached.at < 60000) {
    return cached.data;
  }
  let prState = cached?.data?.prState || "";
  let liveHead = cached?.data?.liveHead || "";
  let title = cached?.data?.title || "";
  let mergeable = cached?.data?.mergeable || "";
  let mergeStateStatus = cached?.data?.mergeStateStatus || "";

  let result = await runCommand("gh", ["pr", "view", pr, "-R", ghrepo, "--json", "state,headRefOid,title,mergeable,mergeStateStatus"], root, 5000);
  if (!result.ok) {
    const prNumber = pr.match(/\/pull\/(\d+)/)?.[1];
    if (prNumber) {
      result = await runCommand("gh", ["api", `repos/${ghrepo}/pulls/${prNumber}`], root, 5000);
      if (result.ok) {
        try {
          const metadata = JSON.parse(result.stdout);
          prState = (metadata.state || "").toUpperCase();
          liveHead = metadata.head?.sha || "";
          title = metadata.title || "";
          mergeable = metadata.mergeable === null ? "UNKNOWN" : metadata.mergeable ? "MERGEABLE" : "CONFLICTING";
          mergeStateStatus = (metadata.mergeable_state || "UNKNOWN").toUpperCase();
        } catch {}
      }
    }
  } else {
    try {
      const metadata = JSON.parse(result.stdout);
      prState = metadata.state || "";
      liveHead = metadata.headRefOid || "";
      title = metadata.title || "";
      mergeable = metadata.mergeable || "";
      mergeStateStatus = metadata.mergeStateStatus || "";
    } catch {}
  }

  const data = { prState, liveHead, title, mergeable, mergeStateStatus };
  prCache.set(cacheKey, { at: now, data });
  return data;
}

async function collectTickets(root, sessions, ghrepo, routing, force = false) {
  const stateDir = path.join(root, "state");
  const files = await readdir(stateDir).catch(() => []);
  const candidates = files.map((name) => ({ name, match: name.match(/^(\d+)\.(.+)$/) })).filter((item) => item.match && stateNames.has(item.match[2]));
  const states = await Promise.all(candidates.map(async (item) => {
    const file = path.join(stateDir, item.name);
    const info = await fileStat(file);
    let reason = "";
    if (["parked", "merged-unverified"].includes(item.match[2])) {
      reason = (await readFile(file, "utf8").catch(() => "")).trim();
    }
    return { id: Number(item.match[1]), status: item.match[2], mtime: info ? info.mtimeMs : 0, reason };
  }));
  const deduped = [...new Map(states.map((item) => [item.id, item])).values()];
  return Promise.all(deduped.map(async (item) => {
    const reviewFile = path.join(stateDir, `${item.id}.review.json`);
    const runtimeFile = path.join(stateDir, `${item.id}.runtime.json`);
    const prFile = path.join(stateDir, `${item.id}.pr`);
    const auditFile = path.join(root, "verdicts", `${item.id}-post-merge-audit.json`);
    const [review, reviewInfo, runtime, prText, postMergeAudit, manualIntervention] = await Promise.all([
      readJson(reviewFile),
      fileStat(reviewFile),
      readJson(runtimeFile),
      readFile(prFile, "utf8").catch(() => ""),
      readJson(auditFile),
      readJson(path.join(stateDir, `${item.id}.manual-intervention.json`))
    ]);
    const ticketSessions = sessions.filter((session) => session.ticket === item.id);
    const desiredSession = review?.session_id ? sessions.find((session) => session.id === review.session_id) : null;
    const currentSession = desiredSession && desiredSession.status !== "harvested" ? desiredSession : ticketSessions.find((session) => ["running", "awaiting harvest", "incomplete"].includes(session.status));
    const attempts = ticketSessions.reduce((max, session) => Math.max(max, session.attempt || 0), 0);
    const completed = review?.completed || [];
    const remaining = review?.remaining || [];
    const repairs = Number(review?.blocking_repairs ?? Math.max(Number(review?.fix_attempt || 0), attempts - 1, 0));
    const canContinue = ["review", "fix", "in-progress"].includes(item.status);
    const profiles = [...completed.map((name) => ({ name, status: "passed" })), ...remaining.map((name, index) => ({ name, status: canContinue && index === 0 ? "current" : "pending" }))];
    const lastMs = Math.max(item.mtime, reviewInfo?.mtimeMs || 0, ...ticketSessions.map((session) => Date.parse(session.lastActivity || 0) || 0));
    const pr = review?.pr || prText.trim();
    let prState = "";
    let liveHead = "";
    let title = "";
    let mergeable = "";
    let mergeStateStatus = "";
    if (pr && ghrepo) {
      const meta = await fetchPrMetadata(pr, ghrepo, root, force);
      prState = meta.prState;
      liveHead = meta.liveHead;
      title = meta.title;
      mergeable = meta.mergeable;
      mergeStateStatus = meta.mergeStateStatus;
    }
    const conflicted = Boolean(prState === "OPEN" && (mergeable === "CONFLICTING" || mergeStateStatus === "DIRTY"));
    const ticket = {
      id: item.id, title, status: item.status,
      reason: runtime?.status === "needs-retry" ? runtime.reason : item.reason === item.status || ["merged", "merged-audited", "manual-takeover"].includes(item.status) ? "" : item.reason,
      pr, prNumber: Number(pr.match(/\/pull\/(\d+)/)?.[1] || 0) || null, prState,
      head: review?.head_oid || "", headShort: review?.head_oid?.slice(0, 12) || "",
      round: review?.round || 0,
      attempt: attempts, repair: repairs, repairLimit: Number(routing.rules?.max_fix_attempts || 0), action: review?.action || item.status,
      assurance: { passed: completed.length, total: completed.length + remaining.length, profiles },
      postMergeAudit, manualIntervention, operationalFailure: runtime || null, mergedAt: review?.merged_at || null, liveHead, liveHeadShort: liveHead.slice(0, 12), revisionChanged: Boolean(liveHead && review?.head_oid && liveHead !== review.head_oid),
      conflicted, mergeable, mergeStateStatus,
      session: currentSession ? {
        id: currentSession.id, status: currentSession.status, durationSeconds: currentSession.durationSeconds,
        kind: currentSession.kind || "", profile: currentSession.profile || "", verdict: currentSession.verdict || "",
        exitCode: currentSession.exitCode, startedAt: currentSession.startedAt, finishedAt: currentSession.finishedAt
      } : null,
      lastActivity: lastMs ? new Date(lastMs).toISOString() : null,
      ageSeconds: lastMs ? Math.max(0, Math.floor((Date.now() - lastMs) / 1000)) : null
    };
    ticket.retryableReviewFailure = false;
    ticket.retryableRuntimeFailure = runtime?.status === "needs-retry";
    ticket.nextAction = ticketNextAction(ticket, currentSession);
    return ticket;
  }));
}

async function collectFrontier(root, routing, ghrepo, tickets, force = false) {
  const known = new Set(tickets.map((ticket) => ticket.id));
  const integration = routing.github.integration_label;
  const frontierLabel = routing.github.frontier_label;
  const now = Date.now();
  if (!force && frontierCache && (now - frontierCacheAt < 90000)) {
    return summarizeFrontier(frontierCache.allIssues, frontierLabel, known, integration, true);
  }
  const fields = "number,title,createdAt,body,labels,blockedBy,blocking,subIssues,parent,url,assignees";
  let result = await runCommand("gh", ["issue", "list", "-R", ghrepo, "--state", "open", "--limit", "1000", "--json", fields], root, 10000);
  if (!result.ok && ghrepo) {
    result = await runCommand("gh", ["api", `repos/${ghrepo}/issues?state=open&per_page=100`], root, 8000);
  }
  let allIssues = [];
  try { if (result.ok) allIssues = JSON.parse(result.stdout || "[]").filter((issue) => !issue.pull_request); } catch {}
  if (!result.ok && frontierCache) {
    allIssues = frontierCache.allIssues;
  } else if (result.ok) {
    frontierCache = { allIssues };
    frontierCacheAt = now;
  }
  return summarizeFrontier(allIssues, frontierLabel, known, integration, result.ok || Boolean(frontierCache));
}

function fieldNodes(value) {
  if (Array.isArray(value)) return value;
  return value?.nodes || [];
}

function labelNames(issue) {
  return (issue.labels || []).map((label) => typeof label === "string" ? label : label.name).filter(Boolean);
}

function inlineBlockerNumbers(issue, open) {
  const section = issue.body?.match(/##?\s*Blocked by\s*([\s\S]*?)(?=\n##?\s|$)/i)?.[1] || "";
  return [...new Set([...section.matchAll(/#(\d+)/g)].map((match) => Number(match[1])).filter((number) => open.has(number)))];
}

function openDependencyNumbers(issue, open, issueMap) {
  const native = fieldNodes(issue.blockedBy)
    .filter((blocker) => blocker.state !== "CLOSED" && blocker.state !== "MERGED" && open.has(blocker.number))
    .map((blocker) => blocker.number);
  const blockers = issue.blockedBy == null ? inlineBlockerNumbers(issue, open) : native;
  const openChildren = fieldNodes(issue.subIssues)
    .filter((child) => child.state !== "CLOSED" && child.state !== "MERGED" && open.has(child.number))
    .map((child) => child.number);
  return [...new Set([...blockers, ...openChildren])].filter((number) => issueMap.has(number));
}

function frontKind(issue, frontierLabel) {
  const labels = labelNames(issue);
  if (labels.includes("deps")) return { key: "external", label: "External dependency", status: "External owner can act" };
  if (labels.includes("docs") || labels.includes("need-evidence")) return { key: "quality", label: "Quality gate", status: "Evidence work can start" };
  if (labels.includes("need-decision")) return { key: "decision", label: "Owner decision", status: "Decision can be made now" };
  if (labels.includes(frontierLabel)) return { key: "worker", label: "Agent work", status: "Worker can start" };
  return { key: "unblocker", label: "Unblocking work", status: "Work can start" };
}

function issueSummary(issue) {
  return { number: issue.number, title: issue.title, url: issue.url || issue.html_url || "" };
}

export function buildParallelFronts(allIssues, frontierIssues, frontierLabel = "ready-for-worker") {
  const issueMap = new Map(allIssues.map((issue) => [issue.number, issue]));
  const open = new Set(issueMap.keys());
  const dependencies = new Map(allIssues.map((issue) => [issue.number, openDependencyNumbers(issue, open, issueMap)]));
  const dependents = new Map(allIssues.map((issue) => [issue.number, []]));
  for (const [number, blockers] of dependencies) {
    for (const blocker of blockers) {
      if (!dependents.has(blocker)) dependents.set(blocker, []);
      dependents.get(blocker).push(number);
    }
  }

  const frontierNumbers = new Set(frontierIssues.map((issue) => issue.number));
  const relevant = new Set();
  const visitDependencies = (number) => {
    if (relevant.has(number) || !issueMap.has(number)) return;
    relevant.add(number);
    for (const blocker of dependencies.get(number) || []) visitDependencies(blocker);
  };
  for (const number of frontierNumbers) visitDependencies(number);

  const roots = [...relevant].filter((number) => (dependencies.get(number) || []).length === 0);
  const fronts = roots.map((rootNumber) => {
    const affected = new Set();
    const distances = new Map([[rootNumber, 0]]);
    const queue = [rootNumber];
    while (queue.length) {
      const number = queue.shift();
      for (const dependent of dependents.get(number) || []) {
        if (!relevant.has(dependent)) continue;
        const distance = (distances.get(number) || 0) + 1;
        if (!distances.has(dependent) || distance < distances.get(dependent)) distances.set(dependent, distance);
        if (affected.has(dependent)) continue;
        affected.add(dependent);
        queue.push(dependent);
      }
    }

    const resolved = new Set([rootNumber]);
    const waves = [];
    while (true) {
      const wave = [...affected]
        .filter((number) => !resolved.has(number) && (dependencies.get(number) || []).every((blocker) => resolved.has(blocker)))
        .sort((a, b) => (issueMap.get(a)?.createdAt || "").localeCompare(issueMap.get(b)?.createdAt || "") || a - b);
      if (!wave.length) break;
      waves.push(wave);
      for (const number of wave) resolved.add(number);
    }

    const stalled = [...affected].filter((number) => {
      if (resolved.has(number)) return false;
      const blockers = dependencies.get(number) || [];
      return blockers.some((blocker) => resolved.has(blocker));
    });
    const firstStalled = stalled.find((number) => !stalled.some((other) => other !== number && reaches(other, number, dependents)))
      || stalled.sort((a, b) => (distances.get(a) || 999) - (distances.get(b) || 999) || a - b)[0];
    const stalledAt = firstStalled ? {
      ...issueSummary(issueMap.get(firstStalled)),
      remainingBlockers: (dependencies.get(firstStalled) || []).filter((number) => !resolved.has(number)).map((number) => issueSummary(issueMap.get(number)))
    } : null;
    const immediateUnlocks = (waves[0] || []).map((number) => issueSummary(issueMap.get(number)));
    const availableSequence = waves.flat().map((number) => issueSummary(issueMap.get(number)));
    const downstream = [...affected].filter((number) => frontierNumbers.has(number)).map((number) => issueSummary(issueMap.get(number)));
    const issue = issueMap.get(rootNumber);
    return {
      ...issueSummary(issue),
      ...frontKind(issue, frontierLabel),
      labels: labelNames(issue),
      immediateUnlocks,
      availableSequence,
      downstreamCount: downstream.length,
      totalAffected: affected.size,
      stalledAt
    };
  }).sort((a, b) => b.downstreamCount - a.downstreamCount || b.availableSequence.length - a.availableSequence.length || a.number - b.number);

  return fronts.map((front, index) => ({
    ...front,
    priority: index === 0 ? "Largest downstream impact" : front.availableSequence.length ? "Can advance in parallel" : "Can clear a future gate"
  }));
}

function reaches(start, target, dependents) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const number = queue.shift();
    for (const dependent of dependents.get(number) || []) {
      if (dependent === target) return true;
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      queue.push(dependent);
    }
  }
  return false;
}

function summarizeFrontier(allIssues, frontierLabel, known, integration, available) {
  const issues = allIssues.filter((issue) => labelNames(issue).includes(frontierLabel));
  const open = new Set(allIssues.map((issue) => issue.number));
  const classified = issues.map((issue) => classifyFrontierIssue(issue, open, known, integration));
  return {
    available,
    labeled: classified.length,
    eligible: available ? classified.filter((issue) => issue.eligible).length : 0,
    deferred: classified.filter((issue) => !issue.eligible).length,
    next: classified.find((issue) => issue.eligible) || null,
    issues: classified,
    fronts: buildParallelFronts(allIssues, issues, frontierLabel)
  };
}

export function classifyFrontierIssue(issue, open, known, integration) {
  const labels = labelNames(issue);
  const parent = (issue.subIssues?.totalCount || 0) > 0;
  const nativeBlockers = fieldNodes(issue.blockedBy).filter((blocker) => blocker.state !== "CLOSED" && blocker.state !== "MERGED").length;
  const openSubissues = fieldNodes(issue.subIssues).filter((child) => child.state !== "CLOSED").length;
  const blockedSection = issue.body?.match(/[Bb]locked by[\s\S]*?(?=\n[A-Z*#]|$)/)?.[0] || "";
  const inlineBlocked = [...blockedSection.matchAll(/#(\d+)/g)].some((match) => open.has(Number(match[1])));
  let reason = "";
  if (known.has(issue.number)) reason = "already tracked";
  else if (parent && !labels.includes(integration)) reason = "parent container";
  else if (nativeBlockers) reason = `${nativeBlockers} open blocker(s)`;
  else if (openSubissues) reason = `${openSubissues} open subissue(s)`;
  else if (inlineBlocked) reason = "open inline blocker";
  return { number: issue.number, title: issue.title, createdAt: issue.createdAt, eligible: !reason, reason };
}

function buildAttention(loops, sessions, tickets, cards, circuitBreaker = null) {
  const attention = [];
  if (circuitBreaker?.active) {
    const mins = Math.floor(circuitBreaker.remainingSeconds / 60);
    const secs = circuitBreaker.remainingSeconds % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    attention.push({
      severity: "warning",
      kind: "rate-limit",
      title: "API Rate Limit Cooldown Active",
      detail: `${circuitBreaker.model || "Provider"} reached quota limit. Model dispatches are paused.`,
      action: `Auto-resumes in ${timeStr} (or switch model in Control Center)`
    });
  }
  for (const session of sessions.filter((item) => item.status === "awaiting harvest")) {
    attention.push({ severity: "action", kind: "harvest", title: `${session.id} is complete`, detail: "Its result is ready, but the ticket has not been updated.", action: "Collect results · no model session" });
  }
  for (const session of sessions.filter((item) => item.status === "incomplete")) {
    attention.push({ severity: "warning", kind: "session", title: `${session.id} has no completion record`, detail: "The model process is not running and did not produce a completion sentinel.", action: "Inspect the session and restart its workflow" });
  }
  for (const ticket of tickets) {
    if (ticket.status === "merged-unverified") attention.push({ severity: "critical", kind: "ticket", ticket: ticket.id, title: `Issue #${ticket.id} merged without assurance`, detail: ticket.reason, action: ticket.nextAction });
    else if (ticket.operationalFailure?.status === "needs-retry") attention.push({ severity: "warning", kind: "runtime", ticket: ticket.id, title: `Issue #${ticket.id} automation failed`, detail: ticket.operationalFailure.reason, action: ticket.nextAction });
    else if (["parked", "blocked-decision"].includes(ticket.status)) attention.push({ severity: "decision", kind: "ticket", ticket: ticket.id, title: `Issue #${ticket.id} needs a decision`, detail: ticket.reason, action: ticket.nextAction });
    else if (["in-progress", "review", "fix"].includes(ticket.status) && (!ticket.operationalFailure || ticket.operationalFailure.status === "retry-ready") && (!ticket.session || ticket.session.status === "incomplete")) attention.push({ severity: "ready", kind: "dispatch", ticket: ticket.id, title: `Issue #${ticket.id} has a paid step ready`, detail: ticket.nextAction, action: "Advance current work when the cost is authorized" });
  }
  for (const card of cards.filter((item) => item.status === "open")) attention.push({ severity: "decision", kind: "card", title: card.title, detail: card.name, action: "Answer the decision card" });
  for (const loop of loops.filter((item) => item.status === "active" && item.timerConfigured && !item.timerLoaded)) {
    attention.push({ severity: "warning", kind: "timer", title: `${loop.id} is enabled but not armed`, detail: "Its launchd timer is not loaded. It runs only when you start it manually.", action: "Open Control Center to start its schedule" });
  }
  for (const loop of loops.filter((item) => item.status === "active")) {
    for (const task of loop.maintenance.filter((item) => !item.timerLoaded)) {
      attention.push({ severity: "warning", kind: "timer", title: `${task.label} is not armed`, detail: `${task.note} It runs only when you start it manually.`, action: "Open Control Center to start its schedule" });
    }
  }
  for (const loop of loops.filter((item) => item.status === "active" && item.health === "failed")) {
    attention.push({ severity: "critical", kind: "workflow", title: `${loop.id} last run did not complete`, detail: loop.lastEvent, action: "Open Control Center and inspect the workflow" });
  }
  return attention;
}

async function collectActivity(root, sessions) {
  const metricFile = path.join(root, "domains/implement/metrics/runs.jsonl");
  const metricText = await readFile(metricFile, "utf8").catch(() => "");
  const metrics = metricText.split("\n").slice(-240).flatMap((line) => {
    try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; }
  }).filter((item) => item.t && !["frontier-skip"].includes(item.event)).map((item) => {
    let title = item.event || "Workflow event";
    let outcome = "";
    if (item.event === "verdict") {
      title = `Issue #${item.ticket} ${item.profile} review finished`;
      outcome = item.verdict || "";
    } else if (item.event === "assurance-classified") {
      title = `Issue #${item.ticket} revision ${item.round} classified for unified assurance`;
      outcome = item.head || "";
    } else if (item.event === "transient-retry") {
      title = `${item.session} recovered after exit ${item.exit}`;
      outcome = `retry ${item.retry}/${item.limit}`;
    } else if (item.event === "tick") {
      title = item.mode === "reconcile" ? "Current work check completed" : "Current work and issue queue check completed";
      outcome = item.mode === "reconcile" ? "current work only" : "new issue allowed";
    } else if (item.ticket) {
      title = `Issue #${item.ticket} · ${String(item.event).replaceAll("-", " ")}`;
    }
    return { at: item.t, type: "controller", title, outcome };
  });
  const workerEvents = sessions.slice(0, 40).map((session) => ({
    at: session.lastActivity,
    type: "worker",
    title: `${session.id} ${session.status === "running" ? "is running" : session.status === "awaiting harvest" ? "finished" : "was harvested"}`,
    outcome: session.verdict || (session.exitCode === null ? "" : `exit ${session.exitCode}`),
    session: session.id,
    status: session.status
  }));
  return [...metrics, ...workerEvents]
    .filter((item) => item.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((item, index, items) => index === items.findIndex((candidate) => candidate.at === item.at && candidate.title === item.title))
    .slice(0, 40);
}

export async function collectStatus(root = defaultRoot, options = {}) {
  const force = Boolean(options.force);
  const configPath = (await fileStat(path.join(root, "config.json"))) ? path.join(root, "config.json") : path.join(root, "routing.json");
  const routing = JSON.parse(await readFile(configPath, "utf8"));
  const serviceId = routing.daemon?.service_identifier || "dev.kokolog.loop";
  const repoPath = routing.project.repo_path;
  const remote = (await runCommand("git", ["remote", "get-url", "origin"], repoPath)).output;
  const ghrepo = remote.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
  const sessions = await collectSessions(root, routing);
  const loops = await Promise.all(domainIds.map(async (id) => {
    const text = await readFile(path.join(root, `domains/${id}/README.md`), "utf8");
    const def = definitions[id];
    const events = timeline(text);
    const timerLabel = def.timerSuffix ? `${serviceId}.${def.timerSuffix}` : (def.timer || "");
    const schedule = timerLabel ? await readLaunchAgentSchedule(root, timerLabel).catch(() => null) : null;
    const maintenance = await Promise.all((def.maintenance || []).map(async (task) => {
      const taskSchedule = await readLaunchAgentSchedule(root, task.timer).catch(() => null);
      return {
        ...task, cadence: taskSchedule?.cadence || task.cadence, schedule: taskSchedule,
        timerInstalled: await isTimerInstalled(task.timer), timerLoaded: await isTimerLoaded(task.timer, root)
      };
    }));
    const isConfigured = routing.domains?.[id.replace("-", "_")]?.enabled ?? true;
    const rawStatus = field(text, "status");
    const domainStatus = isConfigured ? rawStatus : "disabled";
    return {
      id, status: domainStatus, goal: field(text, "goal"), cadence: schedule?.cadence || def.cadence, schedule,
      timerConfigured: Boolean(timerLabel), timerInstalled: await isTimerInstalled(timerLabel), timerLoaded: await isTimerLoaded(timerLabel, root),
      timerLabel, scheduledCommand: def.scheduledCommand || "", triggerable: Boolean(def.runner),
      unavailable: def.unavailable || "", consumes: def.consumes, produces: def.produces, timeline: events, maintenance,
      lastEvent: events[0] || "Never", health: /\| (FAIL|BLOCKED):|\| skipped:/.test(events[0] || "") ? "failed" : "ok",
      work: sessions.find((item) => item.loop === id && item.status === "running")?.id || "Idle"
    };
  }));
  const tickets = await collectTickets(root, sessions, ghrepo, routing, force);
  const decisionFiles = await readdir(path.join(root, "decisions")).catch(() => []);
  const cards = (await Promise.all(decisionFiles.filter((name) => name.endsWith(".md") && name !== "README.md").map(async (name) => {
    const file = path.join(root, "decisions", name);
    const info = await fileStat(file);
    if (!info?.isFile()) return null;
    const text = await readFile(file, "utf8");
    return { name, status: field(text, "status") || "unknown", title: text.match(/^# (.+)$/m)?.[1]?.trim() || name, text: text.slice(0, 16000) };
  }))).filter(Boolean);
  const logFiles = await readdir(path.join(root, "logs")).catch(() => []);
  const logs = (await Promise.all(logFiles.map(async (name) => ({ name, info: await fileStat(path.join(root, "logs", name)) })))).filter((item) => item.info?.isFile()).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, 30).map((item) => ({ name: item.name, size: item.info.size, modified: item.info.mtime.toISOString() }));
  const frontier = await collectFrontier(root, routing, ghrepo, tickets, force);
  const currentSessions = sessions.filter((session) => ["running", "awaiting harvest", "incomplete"].includes(session.status));
  const paidReady = tickets.filter((ticket) => ["in-progress", "review", "fix"].includes(ticket.status) && (!ticket.operationalFailure || ticket.operationalFailure.status === "retry-ready") && (!ticket.session || ticket.session.status === "incomplete")).length;
  const cbFile = path.join(root, "state/circuit-breaker.json");
  const cbData = await readJson(cbFile);
  let circuitBreaker = null;
  if (cbData && cbData.cooldown_until) {
    const remainingSeconds = Math.max(0, Math.floor((Date.parse(cbData.cooldown_until) - Date.now()) / 1000));
    circuitBreaker = {
      active: remainingSeconds > 0,
      remainingSeconds,
      model: cbData.model || "",
      role: cbData.role || "",
      reason: cbData.reason || "Rate limit cooldown",
      cooldownUntil: cbData.cooldown_until
    };
  }
  const attention = buildAttention(loops, currentSessions, tickets, cards, circuitBreaker);
  const activity = await collectActivity(root, sessions);
  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: routing.project?.name || "kokolog-monitor",
      description: routing.project?.description || ""
    },
    repo: { path: repoPath, ghrepo }, loops, sessions, currentSessions,
    tickets, cards, decisions: cards.filter((card) => card.status === "open").map((card) => card.name), logs, frontier, attention, activity, routing, circuitBreaker,
    summary: {
      enabled: loops.filter((loop) => loop.status === "active").length,
      armed: loops.reduce((count, loop) => count + Number(loop.timerLoaded) + loop.maintenance.filter((task) => task.timerLoaded).length, 0),
      configuredTimers: loops.reduce((count, loop) => count + Number(loop.timerConfigured && loop.status === "active") + loop.maintenance.filter(() => loop.status === "active").length, 0),
      running: currentSessions.filter((session) => session.status === "running").length,
      awaitingHarvest: currentSessions.filter((session) => session.status === "awaiting harvest").length,
      incomplete: currentSessions.filter((session) => session.status === "incomplete").length,
      openDecisionCards: cards.filter((card) => card.status === "open").length,
      humanActions: tickets.filter((ticket) => ["parked", "blocked-decision", "merged-unverified"].includes(ticket.status) || ticket.operationalFailure?.status === "needs-retry").length,
      degraded: loops.filter((loop) => loop.status === "active" && loop.health === "failed").length,
      paidReady
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectStatus().then((status) => process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
