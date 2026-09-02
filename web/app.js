import { LOOP_NAMES, ROLE_NAMES, isResolvedTicket, loopTitle, parseJsonlLog, recommendedAction, sessionLabel, systemMode, ticketDisplayStatus, ticketStages } from "./view-model.mjs";
import { captureUiState, restoreUiState, updateHtml } from "./ui-persistence.mjs";

let state;
let pending;
let selectedTicketId;
const VIEW_IDS = new Set(["now", "tickets", "decisions", "history", "health"]);
const VIEW_STORAGE_KEY = "kokolog-loop.active-view";

function initialView() {
  const hashView = window.location.hash.slice(1);
  if (VIEW_IDS.has(hashView)) return hashView;
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (VIEW_IDS.has(stored)) return stored;
  } catch {}
  return "now";
}

let activeView = initialView();
let connection = "connecting";
let lastStateAt = 0;
let eventSource;
let auditTicketId;
let parkedTicketId;
let scheduleSelection;
let modelCatalog;
let loadingModels = false;
let routeDraft;
let routingDirty = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const VIEW_COPY = {
  now: ["LIVE OPERATOR VIEW", "What needs attention now", "Live truth, current work, and the next safe action"],
  tickets: ["WORK QUEUE", "Tickets and assurance", "Active PRs and issues that are ready to start"],
  decisions: ["OWNER BOUNDARY", "Decisions", "Questions that require an authorized owner answer"],
  history: ["DURABLE EVIDENCE", "History", "Model-session results and controller timelines"],
  health: ["CONTROL PLANE", "Control center", "Run cycles, set schedules, and choose the model for each step"]
};

const LOOP_ROUTES = {
  implement: [
    { id: "role:implementer", label: "Initial build", note: "Creates or updates the first PR from a ready issue." },
    { id: "role:reviewer", label: "Unified assurance review", note: "Checks the selected acceptance, code, security, safety, and QMS dimensions. Only P0/P1 issues block." },
    { id: "role:repairer", label: "P0/P1 repair", note: "Updates the same PR only for blocking issues from the unified review." }
  ],
  "spec-sync": [
    { id: "role:distiller", label: "Specification work", note: "Turns a new transcript into cited controlled-document changes." },
    { id: "role:reviewer", label: "Independent verification", note: "Checks citations, scope, and controlled-document boundaries." }
  ],
  "ticket-factory": [
    { id: "role:ticketer", label: "Ticket planning", note: "Turns an approved specification into a bounded ticket plan." },
    { id: "role:reviewer", label: "Independent verification", note: "Checks scope, dependencies, and acceptance criteria." }
  ],
  gardener: [
    { id: "role:gardener", label: "Improvement analysis", note: "Turns recurring evidence into proposed improvements." },
    { id: "role:reviewer", label: "Independent verification", note: "Checks that proposals stay evidence-based and non-editing." }
  ],
  "decision-desk": [
    { id: "role:decision-desk", label: "Decision queue", note: "Formats parked questions into an owner decision queue." },
    { id: "role:reviewer", label: "Independent verification", note: "Checks queue completeness and traceability." }
  ]
};

function mdInline(text) {
  return text.replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => /^(https?:\/\/|\/|#)/.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : match)
    .replace(/(^|[\s(])(https?:\/\/[^\s<>)]+)/g, (match, prefix, url) => {
      const clean = url.replace(/[.,;:!?]+$/, "");
      return `${prefix}<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${url.slice(clean.length)}`;
    });
}

function md(text) {
  const body = text.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\n+/, "").replace(/^#[^\n]*\n+/, "");
  let html = "";
  let list = false;
  let paragraph = [];
  const flush = () => { if (paragraph.length) { html += `<p>${mdInline(esc(paragraph.join(" ")))}</p>`; paragraph = []; } };
  const closeList = () => { if (list) { html += "</ul>"; list = false; } };
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); closeList(); continue; }
    let match;
    if ((match = trimmed.match(/^(#{1,4})\s+(.+)$/))) {
      flush(); closeList();
      const level = Math.min(match[1].length + 1, 5);
      html += `<h${level}>${mdInline(esc(match[2]))}</h${level}>`;
    } else if ((match = trimmed.match(/^[-*]\s+(.+)$/))) {
      flush();
      if (!list) { html += "<ul>"; list = true; }
      html += `<li>${mdInline(esc(match[1]))}</li>`;
    } else {
      closeList(); paragraph.push(trimmed);
    }
  }
  flush(); closeList();
  return html;
}

function formatDuration(seconds) {
  if (seconds == null) return "unknown";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatAge(iso) {
  if (!iso) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatClock(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–";
}

function workerDuration(ticket) {
  if (!ticket.session) return "";
  const extra = ticket.session.status === "running" ? Math.max(0, Math.floor((Date.now() - Date.parse(state.generatedAt)) / 1000)) : 0;
  return formatDuration((ticket.session.durationSeconds || 0) + extra);
}

function activeTickets() {
  return state.tickets.filter((ticket) => !isResolvedTicket(ticket));
}

function applyState(next) {
  state = next;
  lastStateAt = Date.now();
  connection = "connected";
  const active = activeTickets();
  if (!active.some((ticket) => ticket.id === selectedTicketId)) {
    selectedTicketId = active.find((ticket) => ["running", "awaiting harvest"].includes(ticket.session?.status))?.id || active[0]?.id;
  }
  if (modelCatalog && !routingDirty) routeDraft = routeEntriesFromState();
  render();
}

async function loadState() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("State unavailable");
    applyState(await response.json());
  } catch (error) {
    connection = "stale";
    updateConnection(error.message);
  }
}

function connectEvents() {
  if (!("EventSource" in window)) return;
  eventSource?.close();
  eventSource = new EventSource("/api/events");
  eventSource.onopen = () => { connection = "connected"; updateConnection(); };
  eventSource.addEventListener("state", (event) => {
    try { applyState(JSON.parse(event.data)); } catch { connection = "stale"; updateConnection("Invalid live state"); }
  });
  eventSource.onerror = () => { connection = "reconnecting"; updateConnection(); };
}

function updateConnection(error = "") {
  const box = $("#connectionState");
  if (!box) return;
  const stale = lastStateAt && Date.now() - lastStateAt > 20000;
  const mode = stale ? "stale" : connection;
  box.className = `connection-state ${mode}`;
  box.querySelector("strong").textContent = mode === "connected" ? "Live state connected" : mode === "reconnecting" ? "Reconnecting" : mode === "stale" ? "State is stale" : "Connecting";
  $("#freshness").textContent = error || (lastStateAt ? `State read ${formatAge(new Date(lastStateAt).toISOString())}` : "Waiting for state");
  if (state) $("#controllerMode").textContent = state.summary.armed ? `Controller heartbeat: ${state.summary.armed} timer${state.summary.armed === 1 ? "" : "s"} armed` : "Controller heartbeat: manual";
}

function setView(view) {
  if (!VIEW_COPY[view]) return;
  const changed = activeView !== view;
  activeView = view;
  $$('[data-view]').forEach((button) => button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false"));
  $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
  const [kicker, title, subtitle] = VIEW_COPY[view];
  $("#pageKicker").textContent = kicker;
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle;
  if (changed) {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view); } catch {}
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (view === "health" && !modelCatalog && !loadingModels) loadModels();
}

function renderShell() {
  const mode = systemMode(state);
  $("#systemMode").className = `system-mode ${mode.key}`;
  updateHtml($("#systemMode"), `<i>${mode.key === "running" ? "▶" : mode.key === "attention" ? "!" : mode.key === "degraded" ? "×" : mode.key === "ready" ? "→" : "·"}</i><div><strong>${mode.label}</strong><span>${esc(mode.detail)}</span></div>`);
  $("#metricRunning").textContent = state.summary.running;
  $("#metricRunning").className = state.summary.running ? "metric-live" : "";
  $("#metricHarvest").textContent = state.summary.awaitingHarvest;
  $("#metricHarvest").className = state.summary.awaitingHarvest ? "metric-warn" : "";
  $("#metricPaid").textContent = state.summary.paidReady;
  $("#metricPaid").className = state.summary.paidReady ? "metric-warn" : "";
  $("#metricHuman").textContent = state.summary.humanActions + state.summary.openDecisionCards;
  $("#metricHuman").className = state.summary.humanActions + state.summary.openDecisionCards ? "metric-warn" : "";
  $("#metricEligible").textContent = state.frontier.eligible;
  $("#metricArmed").textContent = `${state.summary.armed} / ${state.summary.configuredTimers}`;
  $("#metricArmed").className = state.summary.armed === 0 && state.summary.enabled ? "metric-warn" : "";
  $("#nowCount").textContent = state.attention.length || "";
  $("#ticketCount").textContent = activeTickets().length || "";
  $("#decisionCount").textContent = state.summary.openDecisionCards || "";
  updateConnection();
}

function renderCommand() {
  const action = recommendedAction(state);
  const control = action.action ? `<button class="${action.tone === "primary" ? "primary" : ""}" data-action="${action.action}" data-loop="${action.loop}">${esc(action.label)}</button>` : `<button class="${action.tone === "primary" ? "primary" : ""}" data-view-jump="${action.view}">${esc(action.label)}</button>`;
  const advance = action.action === "run" ? `<button class="outline-danger" data-action="advance" data-loop="implement" ${state.frontier.eligible === 0 ? "disabled" : ""}>Start next issue · ${state.frontier.eligible} ready</button>` : "";
  const clearCooldown = state?.circuitBreaker?.active ? `<button type="button" class="outline-danger" data-clear-cooldown>Clear cooldown & retry</button>` : "";
  $("#commandBar").className = `command-bar ${action.tone}`;
  updateHtml($("#commandBar"), `<div><span>RECOMMENDED NEXT ACTION</span><strong>${esc(action.title)}</strong><p>${esc(action.detail)}</p></div><div class="command-actions">${control}${advance}${clearCooldown}</div>`);
}

function renderCurrentWork() {
  const active = activeTickets();
  updateHtml($("#ticketTabs"), active.map((ticket) => {
    const status = ticketDisplayStatus(ticket);
    return `<button data-ticket-select="${ticket.id}" aria-pressed="${ticket.id === selectedTicketId}">#${ticket.id}${ticket.prNumber ? ` · PR ${ticket.prNumber}` : ""}<i class="tab-state ${status.key}" title="${esc(status.label)}"></i></button>`;
  }).join("") || '<span class="empty-inline">No tracked tickets</span>');
  const ticket = active.find((item) => item.id === selectedTicketId);
  if (!ticket) {
    updateHtml($("#currentWork"), '<div class="empty-state">No tracked ticket is active.</div>');
    return;
  }
  const display = ticketDisplayStatus(ticket);
  const stages = ticketStages(ticket);
  const issueUrl = `https://github.com/${state.repo.ghrepo}/issues/${ticket.id}`;
  updateHtml($("#currentWork"), `
    <header class="work-head">
      <div><h3><a href="${issueUrl}" target="_blank" rel="noopener noreferrer">Issue #${ticket.id}</a> · ${esc(ticket.title || "Tracked work")}</h3><p>${ticket.pr ? `<a href="${esc(ticket.pr)}" target="_blank" rel="noopener noreferrer">PR ${ticket.prNumber}</a> · ${esc(ticket.prState || "unknown")}` : "No PR"}${ticket.headShort ? ` · head ${esc(ticket.headShort)}` : ""} · revision ${ticket.round} · P0/P1 repair ${ticket.repair}/${ticket.repairLimit}${ticket.session ? ` · session ${workerDuration(ticket)}` : ""}</p></div>
      <span class="work-status ${display.key}">${display.key === "running" ? "<i></i>" : ""}${esc(display.label)}</span>
    </header>
    <div class="stage-flow">${stages.map((stage, index) => `<div class="stage ${stage.state}" title="${esc(stage.detail)}"><small>${String(index + 1).padStart(2, "0")}</small><strong>${esc(stage.label)}</strong>${stage.detail ? `<span>${esc(stage.detail)}</span>` : ""}</div>`).join("")}</div>
    <div class="next-action"><span>CURRENT STATUS</span><strong>${esc(ticket.nextAction)}</strong>${ticket.reason ? `<p>${esc(ticket.reason)}</p>` : ""}${ticket.status === "merged-unverified" ? `<div class="next-controls"><button class="primary" data-audit-ticket="${ticket.id}">Record audit resolution</button></div>` : ""}${["parked", "blocked-decision"].includes(ticket.status) || ticket.retryableRuntimeFailure ? `<div class="next-controls"><button class="primary" data-parked-ticket="${ticket.id}">${ticket.retryableRuntimeFailure ? "Start clean retry" : "Choose workflow disposition"}</button></div>` : ""}${ticket.postMergeAudit ? `<div class="audit-record"><b>RECORDED ${esc(ticket.postMergeAudit.recorded_at)}</b><span>${esc(ticket.postMergeAudit.note)}</span></div>` : ""}</div>`);
}

function renderActivity() {
  updateHtml($("#activity"), state.activity.slice(0, 14).map((item) => `<div class="activity-row ${esc(item.status || "")}"><time datetime="${esc(item.at)}" title="${new Date(item.at).toLocaleString()}">${formatClock(item.at)}</time><div><strong>${esc(item.title)}</strong><span>${esc(item.type)}</span></div><b>${esc(item.outcome || formatAge(item.at))}</b></div>`).join("") || '<div class="empty-state">No activity is recorded.</div>');
}

function renderAttention() {
  updateHtml($("#attention"), state.attention.map((item) => `<article class="attention-item ${esc(item.severity)}"><span>${esc(item.severity.toUpperCase())}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.detail || "")}</p><b>Next: ${esc(item.action)}</b></div>${item.ticket ? `<div class="attention-actions"><button data-ticket-jump="${item.ticket}">Open #${item.ticket}</button>${item.severity === "critical" ? `<button class="primary" data-audit-ticket="${item.ticket}">Resolve</button>` : item.severity === "decision" || item.kind === "runtime" ? `<button class="primary" data-parked-ticket="${item.ticket}">${item.kind === "runtime" ? "Retry" : "Choose action"}</button>` : ""}</div>` : ""}</article>`).join("") || '<div class="empty-state good">No operator action is required.</div>');
}

function renderTickets() {
  updateHtml($("#tickets"), activeTickets().map((ticket) => {
    const display = ticketDisplayStatus(ticket);
    const stages = ticketStages(ticket);
    const stagePills = stages.map((stage) => `<span class="stage-pill ${stage.state}" title="${esc(stage.detail || stage.label)}">${esc(stage.label)}</span>`).join('<i class="pill-arrow">→</i>');
    return `<article class="ticket-row">
      <div class="ticket-identity"><a href="https://github.com/${state.repo.ghrepo}/issues/${ticket.id}" target="_blank" rel="noopener noreferrer">#${ticket.id}</a><span class="work-status ${display.key}">${esc(display.label)}</span><strong>${esc(ticket.title || "Tracked work")}</strong></div>
      <div class="ticket-pr">${ticket.pr ? `<a href="${esc(ticket.pr)}" target="_blank" rel="noopener noreferrer">PR ${ticket.prNumber}</a> · ${esc(ticket.prState || "unknown")}` : "No PR"}<span>${ticket.headShort ? `head ${esc(ticket.headShort)} · ` : ""}last activity ${formatAge(ticket.lastActivity)}</span></div>
      <div class="ticket-proof"><strong>Pipeline stage · round ${ticket.round}</strong><span>P0/P1 repair ${ticket.repair}/${ticket.repairLimit}${ticket.session ? ` · session ${workerDuration(ticket)}` : ""}</span><div class="stage-pills">${stagePills}</div></div>
      <div class="ticket-next"><span>CURRENT STATUS</span><strong>${esc(ticket.nextAction)}</strong>${ticket.reason ? `<p>${esc(ticket.reason)}</p>` : ""}${ticket.postMergeAudit ? `<p class="resolved-note">${esc(ticket.postMergeAudit.note)}</p>` : ""}<button data-ticket-jump="${ticket.id}">View flow</button>${ticket.status === "merged-unverified" ? `<button class="primary" data-audit-ticket="${ticket.id}">Record audit resolution</button>` : ""}${["parked", "blocked-decision"].includes(ticket.status) || ticket.retryableRuntimeFailure ? `<button class="primary" data-parked-ticket="${ticket.id}">${ticket.retryableRuntimeFailure ? "Clean retry" : "Choose action"}</button>` : ""}</div>
    </article>`;
  }).join("") || '<div class="empty-state good">No active ticket needs work.</div>');

  const sorted = state.frontier.issues.slice().sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.number - b.number);
  updateHtml($("#frontier"), `<header><div><strong>${state.frontier.eligible}</strong><span>ready now</span></div><div><strong>${state.frontier.deferred}</strong><span>waiting</span></div><div><strong>${state.frontier.labeled}</strong><span>in queue</span></div><p>${state.frontier.available ? (state.frontier.next ? `Next: #${state.frontier.next.number} ${esc(state.frontier.next.title)}` : "No issue is ready to start.") : "The GitHub issue queue is unavailable."}</p></header><div class="frontier-list">${sorted.map((issue) => `<div class="frontier-row ${issue.eligible ? "eligible" : "deferred"}"><a href="https://github.com/${state.repo.ghrepo}/issues/${issue.number}" target="_blank" rel="noopener noreferrer">#${issue.number}</a><strong>${esc(issue.title)}</strong><span>${issue.eligible ? "READY" : esc(issue.reason)}</span></div>`).join("")}</div>`);
}

function renderCards() {
  const cards = state.cards.slice().sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || a.name.localeCompare(b.name));
  updateHtml($("#cards"), cards.map((card) => {
    const options = [...card.text.matchAll(/^## Option ([A-Z]) — (.+)$/gm)];
    const form = card.status === "open" ? `<form class="card-answer" data-card="${esc(card.name)}">${options.map((match) => `<label><input type="radio" name="opt-${esc(card.name)}" value="${match[1]}" required><b>${match[1]}</b><span>${esc(match[2])}</span></label>`).join("")}<textarea name="note" maxlength="2000" placeholder="Optional reasoning. It will be recorded in the card."></textarea><button class="primary" type="submit">Record answer</button></form>` : "";
    return `<details class="decision-card" data-ui-key="decision:${esc(card.name)}" ${card.status === "open" ? "open" : ""}><summary><span class="decision-state ${card.status === "open" ? "open" : ""}">${esc(card.status.toUpperCase())}</span><strong>${esc(card.title)}</strong><small>${esc(card.name)}</small></summary><div class="card-copy">${md(card.text)}</div>${form}</details>`;
  }).join("") || '<div class="empty-state good">No decision cards exist.</div>');
}

function renderHistory() {
  const sessions = state.sessions.slice(0, 30);
  updateHtml($("#sessionHistory"), sessions.map((session) => {
    const severitySummary = session.severities
      ? ["P0", "P1", "P2", "P3"].filter((severity) => session.severities[severity]).map((severity) => `${session.severities[severity]} ${severity}`).join(" · ")
      : "";
    const outcome = session.assuranceReport
      ? `${session.verdict} · ${session.blockerCount} blocker${session.blockerCount === 1 ? "" : "s"}${severitySummary ? ` · ${severitySummary}` : ""}`
      : session.verdict || (session.exitCode === null ? "" : `exit ${session.exitCode}`);
    const report = session.assuranceReport || (session.terminationReason ? `STOPPED BY CONTROLLER: ${session.terminationReason}\n\n${session.result || ""}`.trim() : session.result) || "No result was written.";
    const reportLabel = session.assuranceReport
      ? `<p class="report-label"><strong>Full assurance report</strong> · <code>${esc(session.assuranceReportFile)}</code></p>`
      : "";
    return `<details class="history-row ${esc(session.status.replaceAll(" ", "-"))}" data-ui-key="history:${esc(session.id)}"><summary><span class="session-state">${esc(session.status.toUpperCase())}</span><strong>${esc(sessionLabel(session))}</strong><time>${formatClock(session.lastActivity)} · ${formatAge(session.lastActivity)}</time><b>${esc(outcome)}</b></summary><div><p><code>${esc(session.id)}</code> · ${esc(ROLE_NAMES[session.role] || session.role)} · ${esc(session.route)}</p><p>Duration: ${formatDuration(session.durationSeconds)}</p>${reportLabel}<pre>${esc(report)}</pre></div></details>`;
  }).join("") || '<div class="empty-state">No model sessions exist.</div>');
  const resolved = state.tickets.filter(isResolvedTicket);
  updateHtml($("#resolvedTickets"), resolved.map((ticket) => {
    const record = ticket.postMergeAudit || ticket.manualIntervention || {};
    const exception = record.original_exception || record.parked_reason || "None recorded";
    const recordedAt = record.recorded_at || ticket.mergedAt;
    const note = ticket.status === "merged" ? "Unified assurance passed before the owner merged this PR." : record.note || "No owner note recorded.";
    return `<details class="resolved-ticket" data-ui-key="resolved:${ticket.id}"><summary><span>${esc(ticketDisplayStatus(ticket).label)}</span><strong>#${ticket.id} · ${esc(ticket.title || "Resolved ticket")}</strong><time>${recordedAt ? formatAge(recordedAt) : "recorded"}</time></summary><div><p>${esc(note)}</p><dl><div><dt>Pull request</dt><dd><a href="${esc(ticket.pr)}" target="_blank" rel="noopener noreferrer">PR ${ticket.prNumber}</a> · ${esc(ticket.prState)}</dd></div><div><dt>Recorded head</dt><dd><code>${esc(record.current_head || ticket.head)}</code></dd></div><div><dt>Prior exception</dt><dd>${esc(exception)}</dd></div><div><dt>Recorded by</dt><dd>${esc(record.recorded_by || "Owner")}</dd></div></dl></div></details>`;
  }).join("") || '<div class="empty-state">No resolved ticket records exist.</div>');
  updateHtml($("#timelines"), state.loops.map((loop) => `<article class="timeline-card"><header><strong>${esc(loopTitle(loop.id))}</strong><span>${loop.status === "active" ? "ENABLED" : "PAUSED"} · ${loop.timerConfigured ? (loop.timerLoaded ? "ARMED" : "NOT ARMED") : "MANUAL"}</span></header>${loop.timeline.map((line) => `<p>${esc(line)}</p>`).join("") || "<p>No timeline events.</p>"}</article>`).join(""));
}

function renderHealth() {
  updateHtml($("#workflows"), state.loops.map((loop) => {
    const running = state.currentSessions.find((session) => session.loop === loop.id && session.status === "running");
    const runLabel = loop.id === "implement" ? "Advance current work" : "Run once";
    const timerLabel = loop.timerLoaded ? (loop.health === "failed" ? "SCHEDULE DEGRADED" : "SCHEDULE ON") : loop.timerInstalled ? "SCHEDULE OFF" : "NOT INSTALLED";
    const timerButton = loop.timerConfigured ? `<button type="button" class="${loop.timerLoaded ? "outline-danger" : ""}" data-timer-action="${loop.timerLoaded ? "disarm" : "arm"}" data-loop="${loop.id}" ${loop.status !== "active" && !loop.timerLoaded ? "disabled" : ""}>${loop.timerLoaded ? "Stop schedule" : "Start schedule"}</button>` : "";
    const scheduleButton = loop.timerConfigured ? `<button type="button" data-schedule-loop="${loop.id}">Change schedule</button>` : "";
    const dispatchPolicy = loop.id === "implement" ? `<section class="dispatch-policy"><div><strong>Concurrent session limit</strong><span>Maximum paid model sessions running at one time.</span></div><input type="number" min="1" max="8" step="1" value="${Number(state.routing.rules?.max_concurrent_sessions || 1)}" data-dispatch-limit aria-label="Concurrent session limit"><button type="button" data-save-dispatch-limit>Save limit</button></section>` : "";
    const maintenance = loop.maintenance.length ? `<section class="maintenance-routes"><header><strong>No-model automation</strong><span>These tasks never start a model session.</span></header>${loop.maintenance.map((task) => `<div class="maintenance-row"><div><strong>${esc(task.label)} · ${esc(task.cadence)}</strong><span>${esc(task.note)}</span></div><div><button type="button" data-action="${esc(task.id)}" data-loop="${loop.id}">Run now</button><button type="button" data-schedule-loop="${loop.id}" data-schedule-task="${esc(task.id)}">Change timing</button><button type="button" class="${task.timerLoaded ? "outline-danger" : ""}" data-timer-action="${task.timerLoaded ? "disarm" : "arm"}" data-loop="${loop.id}" data-task="${esc(task.id)}">${task.timerLoaded ? "Stop" : "Start"}</button></div></div>`).join("")}</section>` : "";
    return `<article class="workflow-card ${esc(loop.status)} ${loop.timerLoaded ? "scheduled" : ""} ${esc(loop.health)}"><header><div><strong>${esc(loopTitle(loop.id))}</strong><span>${loop.status === "active" ? "WORKFLOW ACTIVE" : "WORKFLOW PAUSED"}</span></div><i class="timer-state ${loop.timerLoaded && loop.health !== "failed" ? "armed" : ""}">${loop.timerConfigured ? timerLabel : "ON DEMAND"}</i></header><p>${esc(loop.goal)}</p><dl><div><dt>Manual action</dt><dd>${loop.id === "implement" ? "Advance tracked work · bounded paid dispatch" : "Start one cycle"}</dd></div>${loop.timerConfigured ? `<div><dt>Paid schedule</dt><dd>${esc(loop.cadence)}</dd></div><div><dt>Scheduled command</dt><dd><code>${esc(loop.scheduledCommand)}</code>${loop.id === "implement" ? `<small>Maximum ${state.routing.rules?.max_concurrent_sessions || 1} paid model session(s) running at once.</small>` : ""}</dd></div>` : `<div><dt>Schedule</dt><dd>On demand only</dd></div>`}<div><dt>Current work</dt><dd>${running ? esc(sessionLabel(running)) : "Idle"}</dd></div><div><dt>Last event</dt><dd>${esc(loop.lastEvent || "Never")}</dd></div></dl>${dispatchPolicy}${maintenance}<section class="workflow-routes" data-cycle-routes="${loop.id}"></section><footer><button type="button" class="primary" data-action="run" data-loop="${loop.id}" ${!loop.triggerable || loop.status !== "active" ? "disabled" : ""}>${runLabel}</button>${loop.id === "implement" ? `<button type="button" class="outline-danger" data-action="advance" data-loop="implement" ${state.frontier.eligible === 0 || state.summary.paidReady > 0 || loop.status !== "active" ? "disabled" : ""}>Start next issue</button>` : ""}${scheduleButton}${timerButton}<button type="button" data-action="toggle" data-loop="${loop.id}">${loop.status === "active" ? "Pause workflow" : "Resume workflow"}</button><button type="button" data-inspect="${loop.id}">Inspect</button></footer></article>`;
  }).join(""));
  renderRouting();
}

function routeEntriesFromState() {
  return Object.entries(state.routing.roles || {}).map(([name, route]) => ({ id: `role:${name}`, group: "roles", name, model: route.model, variant: route.variant }));
}

function groupedModelOptions(current) {
  const models = modelCatalog?.models || [];
  const groups = models.reduce((result, model) => {
    const provider = model.split("/")[0];
    if (!result.has(provider)) result.set(provider, []);
    result.get(provider).push(model);
    return result;
  }, new Map());
  return [...groups.entries()].map(([provider, entries]) => `<optgroup label="${esc(provider)}">${entries.map((model) => `<option value="${esc(model)}" ${model === current ? "selected" : ""}>${esc(model.slice(provider.length + 1))}</option>`).join("")}</optgroup>`).join("");
}

function renderRouting() {
  const toolbar = $("#routingToolbar");
  const slots = $$('[data-cycle-routes]');
  if (loadingModels) {
    updateHtml(toolbar, '<div><strong>Reading installed models…</strong><span>Model controls will appear inside each cycle.</span></div>');
    slots.forEach((slot) => { updateHtml(slot, '<div class="routing-empty"><strong>Loading model controls…</strong></div>'); });
    return;
  }
  if (!modelCatalog) {
    updateHtml(toolbar, '<div><strong>Model catalog is unavailable.</strong><span>Cycle controls remain usable.</span></div><button type="button" data-refresh-models>Try again</button>');
    slots.forEach((slot) => { updateHtml(slot, '<div class="routing-empty"><strong>Model controls unavailable.</strong></div>'); });
    return;
  }
  const entries = routeDraft || routeEntriesFromState();
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const row = (definition) => {
    const route = entryById.get(definition.id);
    if (!route) return "";
    const reportedVariants = modelCatalog.variantsByModel?.[route.model] || [route.variant];
    const variantOptions = [...new Set([...reportedVariants, route.variant])].map((variant) => `<option value="${esc(variant)}" ${variant === route.variant ? "selected" : ""}>${esc(variant)}</option>`).join("");
    return `<div class="cycle-route" data-route-id="${esc(route.id)}"><div><strong>${esc(definition.label)}</strong><span>${esc(definition.note)}</span></div><label><span>Model</span><select form="routingForm" data-route-model>${groupedModelOptions(route.model)}</select></label><label><span>Variant</span><select form="routingForm" data-route-variant>${variantOptions}</select></label></div>`;
  };
  slots.forEach((slot) => {
    const definitions = LOOP_ROUTES[slot.dataset.cycleRoutes] || [];
    updateHtml(slot, `<header><strong>Models for this cycle</strong><span>New work only</span></header>${definitions.map(row).join("")}`);
  });
  updateHtml(toolbar, `<div><strong>Model changes apply to new work only.</strong><span>Shared verification controls stay synchronized across cycles. Active work keeps its current route.</span></div><div><button type="button" data-refresh-models>Refresh models</button><button class="primary" type="submit" form="routingForm" ${routingDirty ? "" : "disabled"}>Save model changes</button></div>`);
}

async function loadModels(force = false) {
  loadingModels = true;
  if (state) renderRouting();
  try {
    const response = await fetch(`/api/models${force ? "?refresh=1" : ""}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Model catalog unavailable");
    modelCatalog = result;
    if (!routingDirty) routeDraft = routeEntriesFromState();
  } catch (error) {
    modelCatalog = null;
    toast(`FAILED · ${error.message}`);
  } finally {
    loadingModels = false;
    if (state) renderRouting();
  }
}

async function loadRouteVariants(route) {
  try {
    const response = await fetch(`/api/model-variants?model=${encodeURIComponent(route.model)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Variant metadata unavailable");
    modelCatalog.variantsByModel ||= {};
    modelCatalog.variantsByModel[route.model] = result.variants;
    if (!result.variants.includes(route.variant)) route.variant = result.variants.includes("high") ? "high" : result.variants[0];
    renderRouting();
  } catch (error) {
    toast(`FAILED · ${error.message}`);
  }
}

function render() {
  const uiState = captureUiState(document);
  renderShell();
  renderCommand();
  renderCurrentWork();
  renderActivity();
  renderAttention();
  renderTickets();
  renderCards();
  renderHistory();
  renderHealth();
  setView(activeView);
  restoreUiState(document, uiState);
}

function inspectLoop(id) {
  const loop = state.loops.find((item) => item.id === id);
  const sessions = state.sessions.filter((item) => item.loop === id).slice(0, 15);
  const logs = state.logs.filter((log) => sessions.some((session) => session.log === log.name));
  updateHtml($("#drawerBody"), `<span class="kicker">WORKFLOW DETAIL · ${esc(id)}</span><h2>${esc(loopTitle(id))}</h2><span class="drawer-state">${loop.status === "active" ? "ENABLED" : "PAUSED"} · ${loop.timerConfigured ? (loop.timerLoaded ? "ARMED" : "NOT ARMED") : "MANUAL"}</span><p class="drawer-goal">${esc(loop.goal)}</p><div class="flow-facts"><div><span>CONSUMES</span>${esc(loop.consumes)}</div><div><span>PRODUCES</span>${esc(loop.produces)}</div></div><section><h3>Recent timeline</h3>${loop.timeline.map((line) => `<p class="drawer-event">${esc(line)}</p>`).join("") || "<p>No runs recorded.</p>"}</section><section><h3>Model sessions</h3>${sessions.map((session) => `<details class="drawer-session" data-ui-key="drawer-session:${esc(session.id)}"><summary>${esc(sessionLabel(session))} · ${esc(session.status)}</summary><p>${esc(session.route)}</p><pre>${esc(session.result || "No result was written.")}</pre></details>`).join("") || "<p>No model sessions.</p>"}</section><section><h3>Logs</h3>${logs.map((log) => `<button class="log-link" data-log="${esc(log.name)}">${esc(log.name)} · ${Math.max(1, Math.round(log.size / 1024))} KB</button>`).join("") || "<p>No logs for recent sessions.</p>"}</section>`);
  $("#drawer").classList.add("open");
  $("#scrim").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#scrim").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
}

function openAudit(ticketId) {
  const ticket = state.tickets.find((item) => item.id === Number(ticketId));
  if (!ticket || ticket.status !== "merged-unverified") return toast("Audit action is not available for this ticket");
  auditTicketId = ticket.id;
  $("#auditTarget").innerHTML = `<div><span>ISSUE #${ticket.id}</span><span>PR ${ticket.prNumber}</span><span>HEAD ${esc(ticket.headShort)}</span></div><strong>${esc(ticket.reason)}</strong>`;
  $("#auditForm").reset();
  syncAuditSubmit();
  $("#auditDialog").showModal();
  $("#auditNote").focus();
}

function syncAuditSubmit() {
  const form = $("#auditForm");
  const noteValid = form.note.value.trim().length >= 12;
  form.querySelector('[type="submit"]').disabled = !(noteValid && form.acknowledged.checked);
}

function openParked(ticketId) {
  const ticket = state.tickets.find((item) => item.id === Number(ticketId));
  if (!ticket || (!ticket.retryableRuntimeFailure && !["parked", "blocked-decision"].includes(ticket.status))) return toast("Workflow resolution is not available for this ticket");
  parkedTicketId = ticket.id;
  $("#parkedTarget").innerHTML = `<div><span>ISSUE #${ticket.id}</span>${ticket.prNumber ? `<span>PR ${ticket.prNumber}</span>` : ""}${ticket.headShort ? `<span>REVIEWED ${esc(ticket.headShort)}</span>` : ""}${ticket.liveHeadShort ? `<span>CURRENT ${esc(ticket.liveHeadShort)}</span>` : ""}</div><strong>${esc(ticket.reason)}</strong>`;
  const form = $("#parkedForm");
  form.reset();
  const retry = form.querySelector('[value="retry"]');
  const resume = form.querySelector('[value="resume"]');
  retry.disabled = !ticket.retryableRuntimeFailure;
  resume.disabled = !(ticket.prState === "OPEN" && ticket.revisionChanged);
  $("#retryOption").classList.toggle("unavailable", retry.disabled);
  $("#resumeOption").classList.toggle("unavailable", resume.disabled);
  (!retry.disabled ? retry : !resume.disabled ? resume : form.querySelector('[value="manual"]')).checked = true;
  syncParkedSubmit();
  $("#parkedDialog").showModal();
  $("#parkedNote").focus();
}

function syncParkedSubmit() {
  const form = $("#parkedForm");
  const ticket = state?.tickets.find((item) => item.id === parkedTicketId);
  const disposition = form.querySelector('[name="disposition"]:checked')?.value;
  const retry = disposition === "retry";
  const evidence = $("#parkedDecisionEvidence");
  evidence.hidden = retry;
  form.note.required = !retry;
  form.acknowledged.required = !retry;
  const valid = retry || (form.note.value.trim().length >= 12 && form.acknowledged.checked);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = !(disposition && valid);
  submit.textContent = retry ? "Retry automation" : "Apply disposition";
  $("#parkedFooterNote").textContent = disposition === "retry"
    ? "A new worker will start from the authoritative GitHub issue and PR head. Failed local edits and prior session logs are not reused."
    : disposition === "resume"
      ? "The safe reconcile starts after this record is written."
      : "The loop stops managing this PR; prior failures remain recorded.";
}

async function submitParked(form) {
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch("/api/parked-resolution", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: parkedTicketId, disposition: form.disposition.value, note: form.note.value, acknowledged: form.acknowledged.checked }) });
    const result = await response.json();
    if (!response.ok || result.ok === false) return toast(`FAILED · ${result.output || result.error}`);
    $("#parkedDialog").close();
    toast(result.output);
    await loadState();
  } catch (error) {
    toast(`FAILED · ${error.message}`);
  } finally {
    syncParkedSubmit();
  }
}

async function submitAudit(form) {
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch("/api/merged-audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: auditTicketId, note: form.note.value, acknowledged: form.acknowledged.checked }) });
    const result = await response.json();
    if (!response.ok || result.ok === false) return toast(`FAILED · ${result.output || result.error}`);
    $("#auditDialog").close();
    toast(result.output);
    await loadState();
  } catch (error) {
    toast(`FAILED · ${error.message}`);
  } finally {
    syncAuditSubmit();
  }
}

function ask(action, loop) {
  pending = { action, loop };
  const item = state.loops.find((entry) => entry.id === loop);
  $("#confirmTitle").textContent = action === "collect" ? "Collect completed results?" : action === "sync" ? "Refresh repository state?" : action === "advance" ? "Start the next issue?" : action === "run" && loop === "implement" ? "Advance current work?" : action === "run" ? `Run ${loopTitle(loop)}` : `Change ${loopTitle(loop)}`;
  $("#confirmText").textContent = action === "collect" ? "This updates durable state and starts no model sessions." : action === "sync" ? "This refreshes GitHub and repository state and starts no model sessions." : action === "advance" ? "Start at most one implementation session. Tracked paid work must be clear first." : action === "run" && loop === "implement" ? "Start at most one model session for tracked work. Completed results are not collected by this action." : action === "run" ? `Start one ${item.cadence.toLowerCase()} check now.` : `${item.status === "active" ? "Pause" : "Resume"} this workflow. Running model sessions are not stopped.`;
  $("#confirm").showModal();
}

function scheduleItem(loopId, taskId = "") {
  const loop = state.loops.find((entry) => entry.id === loopId);
  return taskId ? loop?.maintenance.find((task) => task.id === taskId) : loop;
}

function askTimer(timerAction, loop, task = "") {
  const item = state.loops.find((entry) => entry.id === loop);
  const target = scheduleItem(loop, task);
  if (!target || (!task && !item?.timerConfigured)) return toast("This workflow has no automatic schedule");
  pending = { action: "timer", timerAction, loop, ...(task ? { task } : {}) };
  const title = task ? target.label : loopTitle(loop);
  $("#confirmTitle").textContent = timerAction === "arm" ? `Start ${title} schedule` : `Stop ${title} schedule`;
  $("#confirmText").textContent = timerAction === "arm"
    ? `${target.cadence}. The scheduled command is ${target.scheduledCommand}.${target.paid === false ? " It cannot start a model session." : loop === "implement" ? " It can start at most one model session." : ""}`
    : "Automatic starts will stop. A model session that is already running will continue.";
  $("#confirm").showModal();
}

function intervalParts(minutes) {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

function scheduleTimes(value) {
  return String(value || "").split(",").map((time) => time.trim()).filter(Boolean);
}

function openSchedule(loopId, taskId = "") {
  const loop = state.loops.find((item) => item.id === loopId);
  const target = scheduleItem(loopId, taskId);
  if (!target?.schedule || (!taskId && !loop?.timerConfigured)) return toast("This workflow has no editable schedule");
  scheduleSelection = { loop: loop.id, task: taskId };
  const form = $("#scheduleForm");
  form.reset();
  $("#scheduleTitle").textContent = `Change ${taskId ? target.label : loopTitle(loop.id)} schedule`;
  $("#scheduleTarget").innerHTML = `<div><span>CURRENT ${esc(target.cadence)}</span><span>${target.timerLoaded ? "SCHEDULE ON" : "SCHEDULE OFF"}</span></div><strong>${esc(target.scheduledCommand)}</strong>`;
  $("#scheduleIntervalFields").hidden = target.schedule.kind !== "interval";
  $("#scheduleDailyFields").hidden = target.schedule.kind !== "daily";
  if (target.schedule.kind === "interval") {
    const parts = intervalParts(target.schedule.minutes);
    form.interval.value = parts.value;
    form.unit.value = parts.unit;
  } else {
    form.times.value = target.schedule.times.join(", ");
  }
  $("#scheduleFooterNote").textContent = target.timerLoaded ? "The active schedule will restart with the new timing." : "The new timing will apply the next time the schedule starts.";
  syncScheduleSubmit();
  $("#scheduleDialog").showModal();
  (target.schedule.kind === "interval" ? form.interval : form.times).focus();
}

function scheduleDraft(form, kind) {
  if (kind === "interval") {
    const value = Number(form.interval.value);
    const multiplier = { minutes: 1, hours: 60, days: 1440 }[form.unit.value];
    const minutes = value * multiplier;
    return Number.isSafeInteger(value) && Number.isSafeInteger(minutes) && value >= 1 && minutes <= 10080 ? { kind, minutes } : null;
  }
  const times = scheduleTimes(form.times.value);
  const unique = new Set(times);
  return times.length >= 1 && times.length <= 8 && unique.size === times.length && times.every((time) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) ? { kind, times } : null;
}

function syncScheduleSubmit() {
  const form = $("#scheduleForm");
  const target = scheduleSelection && scheduleItem(scheduleSelection.loop, scheduleSelection.task);
  form.querySelector('[type="submit"]').disabled = !(target?.schedule && scheduleDraft(form, target.schedule.kind) && form.acknowledged.checked);
}

async function submitSchedule(form) {
  const target = scheduleSelection && scheduleItem(scheduleSelection.loop, scheduleSelection.task);
  const schedule = target?.schedule && scheduleDraft(form, target.schedule.kind);
  if (!target || !schedule || !form.acknowledged.checked) return syncScheduleSubmit();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  document.body.classList.add("action-running");
  try {
    const response = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loop: scheduleSelection.loop, ...(scheduleSelection.task ? { task: scheduleSelection.task } : {}), schedule, acknowledged: true }) });
    const result = await response.json();
    if (!response.ok || result.ok === false) return toast(`FAILED · ${result.output || result.error}`);
    $("#scheduleDialog").close();
    toast(result.output);
    await loadState();
  } catch (error) {
    toast(`FAILED · ${error.message}`);
  } finally {
    document.body.classList.remove("action-running");
    syncScheduleSubmit();
  }
}

function askRouting() {
  if (!routingDirty || !routeDraft) return;
  pending = { action: "routing", updates: routeDraft.map(({ id, model, variant }) => ({ id, model, variant })) };
  $("#confirmTitle").textContent = "Save model routing";
  $("#confirmText").textContent = "New model sessions will use these routes. Sessions that are already running will not change.";
  $("#confirm").showModal();
}

function askDispatchPolicy() {
  const input = $("[data-dispatch-limit]");
  const maxStarts = Number(input?.value);
  if (!Number.isSafeInteger(maxStarts) || maxStarts < 1 || maxStarts > 8) return toast("Paid session limit must be between 1 and 8");
  pending = { action: "dispatch-policy", maxStarts };
  $("#confirmTitle").textContent = "Change paid session limit?";
  $("#confirmText").textContent = `Each paid dispatch can start at most ${maxStarts} new model session${maxStarts === 1 ? "" : "s"}. Collection and repository refresh remain model-free.`;
  $("#confirm").showModal();
}

async function act() {
  document.body.classList.add("action-running");
  try {
    const endpoint = pending.action === "timer" ? "/api/timer" : pending.action === "routing" ? "/api/routing" : pending.action === "dispatch-policy" ? "/api/dispatch-policy" : "/api/action";
    const body = pending.action === "routing" ? { updates: pending.updates, acknowledged: true } : pending.action === "dispatch-policy" ? { maxStarts: pending.maxStarts, acknowledged: true } : pending;
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    toast(!response.ok || result.ok === false ? `FAILED · ${result.output || result.error}` : result.output || "Action complete");
    if (response.ok && result.ok !== false && pending.action === "routing") {
      routingDirty = false;
      routeDraft = null;
    }
    await loadState();
  } catch (error) {
    toast(`FAILED · ${error.message}`);
  } finally {
    document.body.classList.remove("action-running");
    pending = null;
  }
}

function renderFormattedLog(rawText) {
  const steps = parseJsonlLog(rawText);
  if (!steps.length) {
    return `<div class="log-empty">No formatted events in this log.</div>`;
  }
  return steps.map((step) => {
    const timeStr = step.timestamp ? formatClock(step.timestamp) : "";
    const tokenStr = step.tokens?.total ? `${step.tokens.total.toLocaleString()} tokens` : "";
    const metaParts = [timeStr, tokenStr].filter(Boolean).join(" · ");
    const toolsHtml = step.tools.map((t) => {
      let badgeHtml = "";
      if (t.exitCode !== null) {
        badgeHtml = `<span class="log-tool-badge ${t.exitCode === 0 ? "ok" : "err"}">exit ${t.exitCode}</span>`;
      } else if (t.matches !== null) {
        badgeHtml = `<span class="log-tool-badge ok">${t.matches} match${t.matches === 1 ? "" : "es"}</span>`;
      }
      let contentHtml = "";
      if (t.tool === "todowrite" && Array.isArray(t.input?.todos)) {
        contentHtml = `<ul class="log-todo-list">${t.input.todos.map((todo) => {
          const status = todo.status || "pending";
          const icon = status === "completed" ? "✓" : status === "in_progress" ? "▶" : "○";
          return `<li class="log-todo-item ${status}"><span>${icon}</span><span>${esc(todo.content)}</span></li>`;
        }).join("")}</ul>`;
      } else if (t.output) {
        contentHtml = `<pre class="log-tool-output">${esc(t.output)}</pre>`;
      }
      return `<div class="log-tool-item">
        <div class="log-tool-title-row">
          <span class="tool-tag ${esc(t.tool)}">${esc(t.tool)}</span>
          <span class="log-tool-target">${esc(t.title)}</span>
          ${badgeHtml}
        </div>
        ${contentHtml}
      </div>`;
    }).join("");

    return `<div class="log-step-card">
      <div class="log-step-header">
        <strong>Step ${step.index}</strong>
        <span>${esc(metaParts)}</span>
      </div>
      ${toolsHtml}
    </div>`;
  }).join("");
}

async function openLog(name) {
  const response = await fetch(`/api/log?name=${encodeURIComponent(name)}`);
  if (!response.ok) return toast("FAILED · Log unavailable");
  const text = await response.text();
  $("#logTitle").textContent = name;
  $("#logMeta").textContent = `${Math.max(1, Math.round(text.length / 1024))} KB`;
  $("#logText").textContent = text;
  $("#logFormatted").innerHTML = renderFormattedLog(text);
  
  $("#logTabFormatted").classList.add("active");
  $("#logTabRaw").classList.remove("active");
  $("#logFormatted").hidden = false;
  $("#logText").hidden = true;
  
  $("#logDialog").showModal();
}

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(box.timer);
  box.timer = setTimeout(() => box.classList.remove("show"), 6000);
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) return setView(nav.dataset.view);
  const jump = event.target.closest("[data-view-jump]");
  if (jump) return setView(jump.dataset.viewJump);
  const ticketSelect = event.target.closest("[data-ticket-select]");
  if (ticketSelect) { selectedTicketId = Number(ticketSelect.dataset.ticketSelect); return renderCurrentWork(); }
  const ticketJump = event.target.closest("[data-ticket-jump]");
  if (ticketJump) { selectedTicketId = Number(ticketJump.dataset.ticketJump); setView("now"); return renderCurrentWork(); }
  const inspect = event.target.closest("[data-inspect]");
  if (inspect) return inspectLoop(inspect.dataset.inspect);
  const action = event.target.closest("[data-action]");
  if (action) return ask(action.dataset.action, action.dataset.loop);
  const timer = event.target.closest("[data-timer-action]");
  if (timer) return askTimer(timer.dataset.timerAction, timer.dataset.loop, timer.dataset.task || "");
  const schedule = event.target.closest("[data-schedule-loop]");
  if (schedule) return openSchedule(schedule.dataset.scheduleLoop, schedule.dataset.scheduleTask || "");
  if (event.target.closest("[data-refresh-models]")) return loadModels(true);
  if (event.target.closest("[data-save-dispatch-limit]")) return askDispatchPolicy();
  const log = event.target.closest("[data-log]");
  if (log) return openLog(log.dataset.log);
  const audit = event.target.closest("[data-audit-ticket]");
  if (audit) return openAudit(audit.dataset.auditTicket);
  const parked = event.target.closest("[data-parked-ticket]");
  if (parked) return openParked(parked.dataset.parkedTicket);
  if (event.target.closest("[data-close-audit]")) return $("#auditDialog").close();
  if (event.target.closest("[data-close-parked]")) return $("#parkedDialog").close();
  if (event.target.closest("[data-close-schedule]")) return $("#scheduleDialog").close();
  if (event.target.closest("[data-clear-cooldown]")) {
    return fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "clear-cooldown" }) })
      .then((res) => res.json())
      .then((data) => {
        toast(data.ok ? "Cooldown cleared · retrying now" : "Failed to clear cooldown");
        return loadState();
      });
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "routingForm") {
    event.preventDefault();
    return askRouting();
  }
  if (event.target.id === "auditForm") {
    event.preventDefault();
    return submitAudit(event.target);
  }
  if (event.target.id === "parkedForm") {
    event.preventDefault();
    return submitParked(event.target);
  }
  if (event.target.id === "scheduleForm") {
    event.preventDefault();
    return submitSchedule(event.target);
  }
  const form = event.target.closest(".card-answer");
  if (!form) return;
  event.preventDefault();
  const option = form.querySelector("input[type=radio]:checked");
  try {
    const response = await fetch("/api/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card: form.dataset.card, option: option?.value, note: form.note.value }) });
    const result = await response.json();
    toast(!response.ok || result.ok === false ? `FAILED · ${result.output || result.error}` : result.output || "Decision recorded");
    await loadState();
  } catch (error) {
    toast(`FAILED · ${error.message}`);
  }
});

$("#scheduleForm").addEventListener("input", syncScheduleSubmit);
$("#scheduleForm").addEventListener("change", syncScheduleSubmit);

document.addEventListener("change", (event) => {
  const row = event.target.closest("[data-route-id]");
  if (!row || !routeDraft) return;
  const route = routeDraft.find((item) => item.id === row.dataset.routeId);
  if (!route) return;
  if (event.target.matches("[data-route-model]")) {
    route.model = event.target.value;
    loadRouteVariants(route);
  }
  if (event.target.matches("[data-route-variant]")) {
    route.variant = event.target.value;
  }
  routingDirty = true;
  $('[type="submit"][form="routingForm"]').disabled = false;
});

$("#auditForm").addEventListener("input", syncAuditSubmit);
$("#auditForm").addEventListener("change", syncAuditSubmit);
$("#parkedForm").addEventListener("input", syncParkedSubmit);
$("#parkedForm").addEventListener("change", syncParkedSubmit);

$("#closeDrawer").addEventListener("click", closeDrawer);
$("#scrim").addEventListener("click", closeDrawer);
$("#closeLog").addEventListener("click", () => $("#logDialog").close());
$("#logDialog").addEventListener("click", (event) => { if (event.target === $("#logDialog")) $("#logDialog").close(); });
$("#logTabFormatted").addEventListener("click", () => {
  $("#logTabFormatted").classList.add("active");
  $("#logTabRaw").classList.remove("active");
  $("#logFormatted").hidden = false;
  $("#logText").hidden = true;
});
$("#logTabRaw").addEventListener("click", () => {
  $("#logTabRaw").classList.add("active");
  $("#logTabFormatted").classList.remove("active");
  $("#logFormatted").hidden = true;
  $("#logText").hidden = false;
});
$("#confirm").addEventListener("close", () => { if ($("#confirm").returnValue === "confirm") act(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && (!eventSource || eventSource.readyState === EventSource.CLOSED)) connectEvents(); });

setInterval(() => {
  updateConnection();
  if (state?.summary.running) {
    renderCurrentWork();
    renderTickets();
  }
}, 1000);

loadState();
connectEvents();
