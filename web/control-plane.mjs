import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._+:/@-]*$/i;
const VARIANT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;

export const STANDARD_VARIANTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export function launchAgentExecutablePath(home = os.homedir()) {
  return [
    path.dirname(process.execPath),
    path.join(home, ".opencode", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].join(":");
}

export function launchAgentEnvironment(home = os.homedir()) {
  return {
    HOME: home,
    PATH: launchAgentExecutablePath(home),
    ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {})
  };
}

function formatInterval(minutes) {
  if (minutes === 1440) return "Every day";
  if (minutes % 1440 === 0) return `Every ${minutes / 1440} days`;
  if (minutes === 60) return "Every hour";
  if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
  return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function normalizeTimes(times) {
  if (!Array.isArray(times) || times.length < 1 || times.length > 8) throw new Error("Add between 1 and 8 daily times");
  const normalized = [...new Set(times.map((time) => String(time || "").trim()))];
  if (normalized.some((time) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error("Use 24-hour times such as 09:00 or 17:30");
  if (normalized.length !== times.length) throw new Error("Daily times must be unique");
  return normalized.sort();
}

export function normalizeLaunchAgentSchedule(schedule, expectedKind = "") {
  const kind = String(schedule?.kind || "");
  if (expectedKind && kind !== expectedKind) throw new Error(`This workflow uses ${expectedKind === "interval" ? "an" : "a"} ${expectedKind} schedule`);
  if (kind === "interval") {
    const minutes = Number(schedule?.minutes);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_INTERVAL_MINUTES) throw new Error("Interval must be between 1 minute and 7 days");
    return { kind, minutes, seconds: minutes * 60, cadence: formatInterval(minutes) };
  }
  if (kind === "daily") {
    const times = normalizeTimes(schedule?.times);
    return { kind, times, cadence: times.join(" and ") };
  }
  throw new Error("Unsupported schedule type");
}

export function parseLaunchAgentSchedule(plist) {
  const text = String(plist || "");
  const interval = text.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
  if (interval) {
    const seconds = Number(interval[1]);
    if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds % 60 !== 0) throw new Error("StartInterval must use whole minutes");
    return normalizeLaunchAgentSchedule({ kind: "interval", minutes: seconds / 60 });
  }
  const calendar = text.match(/<key>StartCalendarInterval<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (calendar) {
    const times = [...calendar[1].matchAll(/<dict>\s*<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>\s*<\/dict>/g)]
      .map((match) => `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`);
    return normalizeLaunchAgentSchedule({ kind: "daily", times });
  }
  throw new Error("Launch agent has no supported schedule");
}

function scheduleXml(schedule) {
  if (schedule.kind === "interval") return `<key>StartInterval</key>\n    <integer>${schedule.seconds}</integer>`;
  const entries = schedule.times.map((time) => {
    const [hour, minute] = time.split(":").map(Number);
    return `        <dict>\n            <key>Hour</key><integer>${hour}</integer>\n            <key>Minute</key><integer>${minute}</integer>\n        </dict>`;
  }).join("\n");
  return `<key>StartCalendarInterval</key>\n    <array>\n${entries}\n    </array>`;
}

export function updateLaunchAgentSchedule(plist, schedule) {
  const current = parseLaunchAgentSchedule(plist);
  const next = normalizeLaunchAgentSchedule(schedule, current.kind);
  const pattern = current.kind === "interval"
    ? /<key>StartInterval<\/key>\s*<integer>\d+<\/integer>/
    : /<key>StartCalendarInterval<\/key>\s*<array>[\s\S]*?<\/array>/;
  const updated = String(plist).replace(pattern, scheduleXml(next));
  if (updated === plist) throw new Error("Schedule block could not be updated");
  return { text: updated, schedule: next };
}

export function parseModelList(output) {
  return [...new Set(String(output || "").split("\n").map((line) => line.trim()).filter((line) => MODEL_PATTERN.test(line)))].sort();
}

export function parseModelMetadata(output) {
  const text = String(output || "");
  const parsed = {};
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const metadata = JSON.parse(text.slice(start, index + 1));
          if (metadata.providerID && metadata.id) parsed[`${metadata.providerID}/${metadata.id}`] = Object.keys(metadata.variants || {});
        } catch {}
        start = -1;
      }
    }
  }
  return parsed;
}

export function routeEntries(routing) {
  return Object.entries(routing.roles || {}).map(([id, route]) => ({ id: `role:${id}`, group: "roles", name: id, model: route.model || "", variant: route.variant || "" }));
}

function routeTarget(routing, id) {
  const [group, name, extra] = String(id || "").split(":");
  if (extra || !name) return null;
  if (group === "role" && Object.hasOwn(routing.roles || {}, name)) return routing.roles[name];
  return null;
}

export function applyRouteUpdates(routing, updates, installedModels, variantsByModel = null) {
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 20) throw new Error("No valid routing changes were supplied");
  const allowedModels = new Set(installedModels || []);
  const next = structuredClone(routing);
  const seen = new Set();
  for (const update of updates) {
    const id = String(update?.id || "");
    const model = String(update?.model || "").trim();
    const variant = String(update?.variant || "").trim();
    if (seen.has(id)) throw new Error(`Duplicate routing target: ${id}`);
    seen.add(id);
    const target = routeTarget(next, id);
    if (!target) throw new Error(`Unknown routing target: ${id}`);
    if (!MODEL_PATTERN.test(model) || !allowedModels.has(model)) throw new Error(`Model is not installed: ${model || "(empty)"}`);
    if (!VARIANT_PATTERN.test(variant)) throw new Error(`Invalid variant for ${id}`);
    if (variantsByModel && !variantsByModel[model]?.includes(variant)) throw new Error(`Variant ${variant} is not available for ${model}`);
    target.model = model;
    target.variant = variant;
  }
  return next;
}

export function applyDispatchPolicy(routing, maxStarts) {
  const limit = Number(maxStarts);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw new Error("Paid session limit must be between 1 and 8");
  const next = structuredClone(routing);
  next.rules ||= {};
  next.rules.max_concurrent_sessions = limit;
  return next;
}

export async function writeRouting(root, routing) {
  const file = path.join(root, "routing.json");
  const temporary = `${file}.dashboard.tmp`;
  await writeFile(temporary, `${JSON.stringify(routing, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, file);
}

export function launchAgentPaths(root, label, home = os.homedir()) {
  if (!/^dev\.kokolog\.loop\.[a-z]+$/.test(label)) throw new Error("Invalid launch agent label");
  return {
    source: path.join(root, "run", "plists", `${label}.plist`),
    directory: path.join(home, "Library", "LaunchAgents"),
    installed: path.join(home, "Library", "LaunchAgents", `${label}.plist`)
  };
}

export async function readLaunchAgentSchedule(root, label) {
  const source = launchAgentPaths(root, label).source;
  return parseLaunchAgentSchedule(await readFile(source, "utf8"));
}

export async function installLaunchAgent(root, label, home = os.homedir()) {
  const files = launchAgentPaths(root, label, home);
  const template = await readFile(files.source, "utf8");
  if (!template.includes("__LOOP_ROOT__")) throw new Error(`Launch agent template is invalid: ${label}`);
  const rendered = template
    .replaceAll("__LOOP_ROOT__", root)
    .replaceAll("__LAUNCH_PATH__", launchAgentExecutablePath(home));
  await mkdir(files.directory, { recursive: true });
  const temporary = `${files.installed}.dashboard.tmp`;
  await writeFile(temporary, rendered, { mode: 0o644 });
  await rename(temporary, files.installed);
  return files.installed;
}
