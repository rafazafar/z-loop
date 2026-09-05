import { LOOP_NAMES, ROLE_NAMES, isResolvedTicket, loopTitle, parseJsonlLog, recommendedAction, sessionLabel, systemMode, ticketDisplayStatus, ticketStages } from "./view-model.mjs";
import { captureUiState, restoreUiState, updateHtml } from "./ui-persistence.mjs";

let state;
let pending;
let selectedTicketId;
const VIEW_IDS = new Set(["now", "tickets", "decisions", "history", "health"]);
const VIEW_STORAGE_KEY = "loop.active-view";

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
let currentSelectionType = "ticket"; // "ticket" | "loop"
let selectedLoopId = "implement";
let sidebarTab = "tickets"; // "tickets" | "loops"
let activeQueueFilter = "all";
let activeWorkTab = "pipeline"; // "pipeline" | "diff"
let mobileView = "canvas"; // "canvas" | "queue" | "brain"
const diffCache = new Map();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const VIEW_COPY = {
  now: ["LIVE WORKSPACE", "Active Ticket & Diff Workspace", "Live execution status, stage stepper, and code diff inspector"],
  tickets: ["FRONTIER QUEUE", "Queue & Tracked Issues", "Eligible GitHub issues ready for dispatch and tracked work overview"],
  decisions: ["DECISION DESK", "Owner Decisions", "Open decision cards requiring authorized owner resolution"],
  history: ["DURABLE LEDGER", "History & Proof Evidence", "Model execution sessions, assurance verdicts, and domain timelines"],
  health: ["CONTROL CENTER", "Control Center & Model Routing", "Configure cycle schedules, concurrency limits, and model routing"]
};

const LOOP_ROUTES = {
  implement: [
    { id: "role:implementer", label: "Initial build", note: "Creates or updates the first PR from a ready issue." },
    { id: "role:reviewer", label: "Unified assurance review", note: "Checks acceptance, code, security, safety, and QMS dimensions." },
    { id: "role:repairer", label: "P0/P1 repair", note: "Updates PR only for blocking issues from the unified review." }
  ],
  "spec-sync": [
    { id: "role:distiller", label: "Draft spec PR", note: "Reads new meeting transcripts and proposes cited documentation changes in one draft PR." },
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
  return (state?.tickets || []).filter((ticket) => !isResolvedTicket(ticket));
}

function applyState(next) {
  state = next;
  lastStateAt = Date.now();
  connection = "connected";
  const active = activeTickets();
  if (!active.some((ticket) => ticket.id === selectedTicketId) && state.tickets?.length) {
    selectedTicketId = active.find((ticket) => ["running", "awaiting harvest"].includes(ticket.session?.status))?.id || active[0]?.id || state.tickets[0]?.id;
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
  const stale = lastStateAt && Date.now() - lastStateAt > 25000;
  const mode = stale ? "stale" : connection;
  box.className = `connection-status ${mode}`;
  const label = box.querySelector(".conn-text") || box.querySelector("strong");
  if (label) {
    label.textContent = mode === "connected" ? "Live" : mode === "reconnecting" ? "Reconnecting" : mode === "stale" ? "Stale" : "Connecting";
  }
  const fresh = $("#freshness");
  if (fresh) fresh.textContent = error || (lastStateAt ? `State read ${formatAge(new Date(lastStateAt).toISOString())}` : "Waiting for state");
  const ctrl = $("#controllerMode");
  if (ctrl && state) ctrl.textContent = state.summary.armed ? `Controller heartbeat: ${state.summary.armed} timer${state.summary.armed === 1 ? "" : "s"} armed` : "Controller heartbeat: manual";
}

function setView(view) {
  if (view === "control-center") view = "health";
  if (!VIEW_COPY[view]) return;
  const changed = activeView !== view;
  activeView = view;
  $$("[data-view]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false");
    button.classList.toggle("active", button.dataset.view === view);
  });
  if ($("#viewNow")) $("#viewNow").hidden = view !== "now";
  if ($("#viewTickets")) $("#viewTickets").hidden = view !== "tickets";
  if ($("#viewDecisions")) $("#viewDecisions").hidden = view !== "decisions";
  if ($("#viewHistory")) $("#viewHistory").hidden = view !== "history";
  if ($("#viewHealth")) $("#viewHealth").hidden = view !== "health";

  const [kicker, title, subtitle] = VIEW_COPY[view];
  if ($("#pageKicker")) $("#pageKicker").textContent = kicker;
  if ($("#pageTitle")) $("#pageTitle").textContent = title;
  if ($("#pageSubtitle")) $("#pageSubtitle").textContent = subtitle;

  if (changed) {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view); } catch {}
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (view === "health" && !modelCatalog && !loadingModels) loadModels();
}

function setMobileView(view) {
  mobileView = view;
  document.querySelectorAll(".m-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mobileNav === view);
  });
  const queue = $("#paneQueue");
  const canvas = $("#workspace");
  const brain = $("#paneInspector");
  if (window.innerWidth <= 768) {
    if (queue) queue.style.display = view === "queue" ? "flex" : "none";
    if (canvas) canvas.style.display = view === "canvas" ? "flex" : "none";
    if (brain) brain.style.display = view === "brain" ? "flex" : "none";
  } else {
    if (queue) queue.style.display = "";
    if (canvas) canvas.style.display = "";
    if (brain) brain.style.display = "";
  }
}

window.addEventListener("resize", () => {
  setMobileView(mobileView);
});

function renderLoopsList() {
  const loopsEl = $("#loopsList");
  if (!loopsEl || !state?.loops) return;

  const loopIcons = {
    implement: "🛠️",
    "spec-sync": "📝",
    "ticket-factory": "📋",
    gardener: "🧹",
    "decision-desk": "⚖️"
  };

  const html = state.loops.map((loop) => {
    const isSelected = currentSelectionType === "loop" && loop.id === selectedLoopId;
    const icon = loopIcons[loop.id] || "⚡";
    const statusKey = loop.status === "active" ? "active" : "paused";
    const cadenceStr = loop.cadence || (loop.timerConfigured ? "Scheduled" : "Manual trigger");

    return `
      <div class="q-loop-card ${isSelected ? 'selected' : ''}" data-loop-select="${esc(loop.id)}">
        <div class="q-loop-head">
          <div class="q-loop-title">
            <span class="q-loop-icon">${icon}</span>
            <strong>${esc(loopTitle(loop.id))}</strong>
          </div>
          <span class="status-pill ${statusKey}">${esc(loop.status.toUpperCase())}</span>
        </div>
        <div class="q-loop-goal">${esc(loop.goal)}</div>
        <div class="q-loop-footer">
          <span class="cadence-pill">⏱ ${esc(cadenceStr)}</span>
          ${loop.timerLoaded ? '<span class="armed-pill">ARMED</span>' : ''}
        </div>
      </div>
    `;
  }).join("") || '<div class="empty-state">No loops configured.</div>';

  updateHtml(loopsEl, html);
  if ($("#sideLoopCount")) $("#sideLoopCount").textContent = state.loops.length;
}

function renderLoopCanvas(loop) {
  const loopIcons = {
    implement: "🛠️",
    "spec-sync": "📝",
    "ticket-factory": "📋",
    gardener: "🧹",
    "decision-desk": "⚖️"
  };
  const icon = loopIcons[loop.id] || "⚡";

  const timelineHtml = (loop.timeline || []).slice(0, 10).map((line) => {
    const parts = line.split(" | ");
    const date = parts[0] || "";
    const category = parts[1] || "";
    const detail = parts.slice(2).join(" | ") || line;
    const isFail = detail.includes("FAIL") || detail.includes("failure");
    const isResolved = detail.includes("RESOLVED");
    const pillClass = isFail ? "failed" : isResolved ? "done" : "info";

    return `
      <div class="timeline-row">
        <span class="timeline-date">${esc(date)}</span>
        <span class="timeline-cat">${esc(category)}</span>
        <span class="timeline-detail ${pillClass}">${esc(detail)}</span>
      </div>
    `;
  }).join("") || '<div class="empty-state">No execution runs recorded yet.</div>';

  return `
    <header class="work-head loop-head">
      <div class="loop-head-left">
        <span class="loop-big-icon">${icon}</span>
        <div>
          <h3>${esc(loopTitle(loop.id))}</h3>
          <p class="loop-subhead">
            <span class="mono">${esc(loop.id)}</span> · 
            <span>${esc(loop.cadence || "On-demand")}</span> · 
            ${loop.timerLoaded ? '<span class="status-pill done">ARMED</span>' : '<span class="status-pill manual">MANUAL TRIGGER</span>'}
          </p>
        </div>
      </div>
      <div class="loop-head-actions">
        <button type="button" class="btn-primary-action" data-action="run" data-loop="${esc(loop.id)}">
          <span>▶</span> Run Cycle Now
        </button>
      </div>
    </header>

    <div class="loop-mission-card">
      <span class="action-tag">MISSION GOAL</span>
      <p class="mission-goal-text">${esc(loop.goal)}</p>
      <div class="loop-io-grid">
        <div class="io-box">
          <span class="io-label">CONSUMES</span>
          <strong class="io-val">${esc(loop.consumes || "Signals & Events")}</strong>
        </div>
        <div class="io-arrow">➔</div>
        <div class="io-box">
          <span class="io-label">PRODUCES</span>
          <strong class="io-val">${esc(loop.produces || "PRs, Cards, Verdicts")}</strong>
        </div>
      </div>
    </div>

    <div class="loop-timeline-section">
      <div class="section-title-row">
        <h4>MISSION RUN TIMELINE &amp; LEDGER</h4>
        <span class="badge-mini">${(loop.timeline || []).length} entries</span>
      </div>
      <div class="timeline-box">
        ${timelineHtml}
      </div>
    </div>
  `;
}

function renderQueue() {
  const queueEl = $("#queueList");
  if (!queueEl || !state?.tickets) return;

  let filtered = state.tickets;
  if (activeQueueFilter === "active") {
    filtered = activeTickets();
  } else if (activeQueueFilter === "review") {
    filtered = state.tickets.filter((t) => t.status === "review");
  } else if (activeQueueFilter === "merged") {
    filtered = state.tickets.filter((t) => isResolvedTicket(t));
  }

  filtered = filtered.slice().sort((a, b) => {
    const timeA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const timeB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return timeB - timeA;
  });

  const html = filtered.map((t) => {
    const isSelected = currentSelectionType === "ticket" && t.id === selectedTicketId;
    const status = ticketDisplayStatus(t);
    const prStr = t.prNumber ? `<span class="pr-pill">PR #${t.prNumber}</span>` : "";
    return `
      <div class="q-ticket-card ${isSelected ? 'selected' : ''}" data-ticket-select="${t.id}">
        <div class="q-ticket-head">
          <span class="q-ticket-id">#${t.id}</span>
          <span class="status-pill ${status.key}">${esc(status.label)}</span>
        </div>
        <div class="q-ticket-title">${esc(t.title || "Tracked work")}</div>
        <div class="q-ticket-footer">
          ${prStr}
          <span class="pr-pill">rev ${t.round}</span>
        </div>
      </div>
    `;
  }).join("") || '<div class="empty-state">No tickets in this view.</div>';

  updateHtml(queueEl, html);
  if ($("#sideTicketCount")) $("#sideTicketCount").textContent = state.tickets.length;
}

function renderShell() {
  const mode = systemMode(state);
  const projectName = state.project?.name || "kokolog-monitor";
  const brandSpan = $("#brandName");
  if (brandSpan) brandSpan.textContent = projectName;
  document.title = `Loop Cockpit · ${projectName}`;

  if ($("#metricRunning")) $("#metricRunning").textContent = state.summary.running;
  if ($("#metricHarvest")) $("#metricHarvest").textContent = state.summary.awaitingHarvest;
  if ($("#metricHuman")) $("#metricHuman").textContent = state.summary.humanActions + state.summary.openDecisionCards;
  if ($("#metricEligible")) $("#metricEligible").textContent = state.frontier?.eligible ?? 0;
  if ($("#metricArmed")) $("#metricArmed").textContent = `${state.summary.armed} / ${state.summary.configuredTimers}`;
  if ($("#nowCount")) $("#nowCount").textContent = state.attention.length || "0";

  // Decision badge in header nav
  const decBadge = $("#navDecisionBadge");
  if (decBadge) {
    if (state.summary.openDecisionCards > 0) {
      decBadge.textContent = state.summary.openDecisionCards;
      decBadge.hidden = false;
    } else {
      decBadge.hidden = true;
    }
  }

  // System mode banner
  const bannerEl = $("#systemModeBanner");
  if (bannerEl) {
    if (mode.key === "attention" || mode.key === "degraded") {
      bannerEl.innerHTML = `<div class="cooldown-banner"><i>⚠</i><div><strong>${mode.label}</strong>: ${esc(mode.detail)}</div></div>`;
      bannerEl.hidden = false;
    } else {
      bannerEl.innerHTML = "";
      bannerEl.hidden = true;
    }
  }

  // Active session in inspector
  const runningSession = state.currentSessions?.find((s) => s.status === "running") || state.currentSessions?.[0];
  const sessionIdText = runningSession ? runningSession.id.toUpperCase() : "IDLE";
  if ($("#inspectorSessionId")) $("#inspectorSessionId").textContent = sessionIdText;

  // Active Worker Card in right pane
  const workerBlock = $("#activeWorkerBlock");
  if (workerBlock) {
    if (runningSession && runningSession.status === "running") {
      workerBlock.hidden = false;
      const titleEl = $("#activeWorkerTitle");
      if (titleEl) titleEl.textContent = sessionLabel(runningSession);
      const idEl = $("#activeWorkerId");
      if (idEl) idEl.textContent = runningSession.id;
      const durEl = $("#activeWorkerDuration");
      if (durEl) {
        const extra = Math.max(0, Math.floor((Date.now() - Date.parse(state.generatedAt)) / 1000));
        durEl.textContent = formatDuration((runningSession.durationSeconds || 0) + extra);
      }
      const routeEl = $("#activeWorkerRoute");
      if (routeEl) routeEl.textContent = runningSession.route || runningSession.role || "–";
      const logBtn = $("#btnActiveWorkerLog");
      if (logBtn) {
        logBtn.dataset.log = runningSession.log || `${runningSession.id}.jsonl`;
      }
    } else {
      workerBlock.hidden = true;
    }
  }

  renderQueue();
  renderLoopsList();
  updateConnection();
}

function formatDiff(rawPatch) {
  if (!rawPatch || !rawPatch.trim()) return '<div class="empty-state">No local diff available.</div>';
  const fileChunks = rawPatch.split(/^diff --git /m).filter(Boolean);
  if (fileChunks.length === 0) return `<div class="diff-file"><div class="diff-lines">${esc(rawPatch)}</div></div>`;

  return fileChunks.map((chunk) => {
    const lines = chunk.split("\n");
    const firstLine = lines[0] || "";
    const fileMatch = firstLine.match(/a\/(.+?)\s+b\/(.+)/);
    const fileName = fileMatch ? fileMatch[2] : (firstLine.replace(/^a\//, "") || "Changed file");

    let adds = 0;
    let dels = 0;
    const bodyLines = lines.slice(1).map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        adds++;
        return `<span class="diff-line diff-line-add">${esc(line)}</span>`;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        dels++;
        return `<span class="diff-line diff-line-del">${esc(line)}</span>`;
      }
      if (line.startsWith("@@")) {
        return `<span class="diff-line diff-line-info">${esc(line)}</span>`;
      }
      return `<span class="diff-line">${esc(line)}</span>`;
    }).join("");

    return `
      <div class="diff-file">
        <div class="diff-file-header">
          <span>${esc(fileName)}</span>
          <span><b style="color: #16a34a">+${adds}</b> <b style="color: #dc2626">-${dels}</b></span>
        </div>
        <div class="diff-lines">${bodyLines}</div>
      </div>
    `;
  }).join("");
}

function renderCommand() {
  const action = recommendedAction(state);
  const control = action.action ? `<button class="${action.tone === "primary" ? "primary" : ""}" data-action="${action.action}" data-loop="${action.loop}">${esc(action.label)}</button>` : `<button class="${action.tone === "primary" ? "primary" : ""}" data-view-jump="${action.view}">${esc(action.label)}</button>`;
  const advance = action.action === "run" ? `<button class="outline-danger" data-action="advance" data-loop="implement" ${state.frontier.eligible === 0 ? "disabled" : ""}>Start next issue · ${state.frontier.eligible} ready</button>` : "";
  const clearCooldown = state?.circuitBreaker?.active ? `<button type="button" class="outline-danger" data-clear-cooldown>Clear cooldown & retry</button>` : "";
  
  const cb = state?.circuitBreaker;
  let cooldownBanner = "";
  if (cb?.status === "tripped") {
    cooldownBanner = `
      <div class="cooldown-banner" style="margin-bottom: 10px;">
        <i>⚠</i>
        <div>
          <strong>API Rate Limit Cooldown Active (${esc(cb.model || "model")})</strong>
          <span>${esc(cb.reason || "Provider rate limit reached")}. Automated retries are paused to prevent quota waste.</span>
        </div>
      </div>
    `;
  }

  const bar = $("#commandBar");
  if (!bar) return;
  bar.className = `command-bar ${action.tone}`;
  updateHtml(bar, `
    ${cooldownBanner}
    <div class="command-info">
      <span class="command-kicker">RECOMMENDED NEXT ACTION</span>
      <strong class="command-title">${esc(action.title)}</strong>
      <p class="command-detail">${esc(action.detail)}</p>
    </div>
    <div class="command-actions">${control}${advance}${clearCooldown}</div>
  `);
}

function renderCurrentWork() {
  const container = $("#currentWork");
  if (!container) return;

  if (currentSelectionType === "loop") {
    const loop = state.loops?.find((l) => l.id === selectedLoopId) || state.loops?.[0];
    if (loop) {
      updateHtml(container, renderLoopCanvas(loop));
      return;
    }
  }

  const active = activeTickets();
  const ticket = state.tickets?.find((item) => item.id === selectedTicketId) || active[0] || state.tickets?.[0];
  if (!ticket) {
    updateHtml(container, '<div class="empty-state">No tracked ticket is active.</div>');
    return;
  }

  const display = ticketDisplayStatus(ticket);
  const stages = ticketStages(ticket);
  const issueUrl = `https://github.com/${state.repo.ghrepo}/issues/${ticket.id}`;
  
  const subtabs = `
    <div class="work-subtabs">
      <button type="button" class="work-subtab ${activeWorkTab === 'pipeline' ? 'active' : ''}" data-work-tab="pipeline">Pipeline &amp; Status</button>
      <button type="button" class="work-subtab ${activeWorkTab === 'diff' ? 'active' : ''}" data-work-tab="diff">Code Diff Inspector</button>
    </div>
  `;

  let tabContent = "";
  if (activeWorkTab === "pipeline") {
    tabContent = `
      <div class="stage-flow">${stages.map((stage, index) => `
        <div class="stage ${stage.state}" data-stage-index="${index}" title="${esc(stage.detail)}">
          <div class="stage-top">
            <small class="stage-num">${String(index + 1).padStart(2, "0")}</small>
            <span class="stage-badge ${stage.state}">${stage.state.toUpperCase()}</span>
          </div>
          <strong class="stage-name">${esc(stage.label)}</strong>
          ${stage.detail ? `<span class="stage-desc">${esc(stage.detail)}</span>` : ""}
        </div>
      `).join("")}</div>
      <div class="next-action">
        <span class="action-tag">RECOMMENDED ACTION</span>
        <strong class="action-headline">${esc(ticket.nextAction)}</strong>
        ${ticket.reason ? `<p class="action-explanation">${esc(ticket.reason)}</p>` : ""}
        <div class="action-buttons">
          ${ticket.status === "merged-unverified" ? `<button class="btn-action primary" data-audit-ticket="${ticket.id}">Record audit resolution</button>` : ""}
          ${["parked", "blocked-decision"].includes(ticket.status) || ticket.retryableRuntimeFailure ? `<button class="btn-action primary" data-parked-ticket="${ticket.id}">${ticket.retryableRuntimeFailure ? "Start clean retry" : "Choose workflow disposition"}</button>` : ""}
        </div>
        ${ticket.postMergeAudit ? `<div class="audit-record"><b>RECORDED ${esc(ticket.postMergeAudit.recorded_at)}</b><span>${esc(ticket.postMergeAudit.note)}</span></div>` : ""}
      </div>
    `;
  } else {
    if (!diffCache.has(ticket.id)) {
      diffCache.set(ticket.id, "loading");
      fetch(`/api/diff?ticket=${ticket.id}`)
        .then((r) => r.json())
        .then((data) => {
          diffCache.set(ticket.id, data.patch || "No local diff found.");
          renderCurrentWork();
        })
        .catch((err) => {
          diffCache.set(ticket.id, `Error fetching diff: ${err.message}`);
          renderCurrentWork();
        });
    }
    const cachedDiff = diffCache.get(ticket.id);
    tabContent = `
      <div class="diff-viewer">
        ${cachedDiff === "loading" ? '<div class="empty-state">Loading git diff...</div>' : formatDiff(cachedDiff)}
      </div>
    `;
  }

  updateHtml(container, `
    <header class="work-head">
      <div>
        <h3><a href="${issueUrl}" target="_blank" rel="noopener noreferrer">Issue #${ticket.id}</a> · ${esc(ticket.title || "Tracked work")}</h3>
        <p>${ticket.pr ? `<a href="${esc(ticket.pr)}" target="_blank" rel="noopener noreferrer">PR ${ticket.prNumber}</a> · ${esc(ticket.prState || "unknown")}${ticket.conflicted ? ' <span class="badge-conflict">CONFLICTS WITH MAIN</span>' : ''}` : "No PR"}${ticket.headShort ? ` · head ${esc(ticket.headShort)}` : ""} · revision ${ticket.round} · P0/P1 repair ${ticket.repair}/${ticket.repairLimit}${ticket.session ? ` · session ${workerDuration(ticket)}` : ""}</p>
      </div>
      <span class="work-status ${display.key}">${esc(display.label)}</span>
    </header>
    ${subtabs}
    ${tabContent}
  `);
}

function renderActivity() {
  const container = $("#activity");
  if (!container || !state?.activity) return;

  const html = state.activity.slice(0, 18).map((item) => {
    let logName = item.log || "";
    if (!logName && item.session) {
      logName = `${item.session}.jsonl`;
    }
    const logAttr = logName ? `data-log="${esc(logName)}"` : "";
    const hoverTitle = logName ? `Click to view log (${esc(logName)})` : new Date(item.at).toLocaleString();

    return `
      <div class="activity-row ${esc(item.status || "")}" ${logAttr} title="${hoverTitle}">
        <time datetime="${esc(item.at)}">${formatClock(item.at)}</time>
        <div>
          <strong>${esc(item.title)}</strong>
          <span>${esc(item.type)}</span>
        </div>
        <b>${esc(item.outcome || formatAge(item.at))}</b>
      </div>
    `;
  }).join("") || '<div class="empty-state">No activity recorded.</div>';

  updateHtml(container, html);
}

function renderAttention() {
  const container = $("#attention");
  if (!container || !state?.attention) return;

  const html = state.attention.map((item) => `
    <article class="attention-item ${esc(item.severity)}">
      <span>${esc(item.severity.toUpperCase())}</span>
      <div>
        <strong>${esc(item.title)}</strong>
        <p>${esc(item.detail || "")}</p>
        <b>Next: ${esc(item.action)}</b>
      </div>
      ${item.ticket ? `
        <div class="attention-actions">
          <button type="button" data-ticket-jump="${item.ticket}">Open #${item.ticket}</button>
          ${item.severity === "critical" ? `<button type="button" class="primary" data-audit-ticket="${item.ticket}">Resolve</button>` : item.severity === "decision" || item.kind === "runtime" ? `<button type="button" class="primary" data-parked-ticket="${item.ticket}">${item.kind === "runtime" ? "Retry" : "Choose action"}</button>` : ""}
        </div>
      ` : ""}
    </article>
  `).join("") || '<div class="empty-state good">No operator action required.</div>';

  updateHtml(container, html);
}

function renderTickets() {
  const ticketsEl = $("#tickets");
  if (ticketsEl && state?.tickets) {
    const html = state.tickets.map((ticket) => {
      const display = ticketDisplayStatus(ticket);
      const stages = ticketStages(ticket);
      const stagePills = stages.map((stage) => `<span class="stage-pill ${stage.state}" title="${esc(stage.detail || stage.label)}">${esc(stage.label)}</span>`).join('<i class="pill-arrow">→</i>');
      return `
        <article class="ticket-row" data-ticket-id="${ticket.id}">
          <div class="ticket-identity">
            <a href="https://github.com/${state.repo.ghrepo}/issues/${ticket.id}" target="_blank" rel="noopener noreferrer">#${ticket.id}</a>
            <span class="work-status ${display.key}">${esc(display.label)}</span>
            <strong>${esc(ticket.title || "Tracked work")}</strong>
          </div>
          <div class="ticket-pr">
            ${ticket.pr ? `<a href="${esc(ticket.pr)}" target="_blank" rel="noopener noreferrer">PR ${ticket.prNumber}</a> · ${esc(ticket.prState || "unknown")}${ticket.conflicted ? ' <span class="badge-conflict">CONFLICTS</span>' : ''}` : "No PR"}
            <span>${ticket.headShort ? `head ${esc(ticket.headShort)} · ` : ""}last activity ${formatAge(ticket.lastActivity)}</span>
          </div>
          <div class="ticket-proof">
            <strong>Pipeline stage · round ${ticket.round}</strong>
            <span>P0/P1 repair ${ticket.repair}/${ticket.repairLimit}${ticket.session ? ` · session ${workerDuration(ticket)}` : ""}</span>
            <div class="stage-pills">${stagePills}</div>
          </div>
          <div class="ticket-next">
            <span>CURRENT STATUS</span>
            <strong>${esc(ticket.nextAction)}</strong>
            ${ticket.reason ? `<p>${esc(ticket.reason)}</p>` : ""}
            ${ticket.postMergeAudit ? `<p class="resolved-note">${esc(ticket.postMergeAudit.note)}</p>` : ""}
            <button type="button" data-ticket-jump="${ticket.id}">View in workspace</button>
            ${ticket.status === "merged-unverified" ? `<button type="button" class="primary" data-audit-ticket="${ticket.id}">Record audit resolution</button>` : ""}
            ${["parked", "blocked-decision"].includes(ticket.status) || ticket.retryableRuntimeFailure ? `<button type="button" class="primary" data-parked-ticket="${ticket.id}">${ticket.retryableRuntimeFailure ? "Clean retry" : "Choose action"}</button>` : ""}
          </div>
        </article>
      `;
    }).join("") || '<div class="empty-state good">No tracked tickets found.</div>';
    updateHtml(ticketsEl, html);
  }

  const frontierEl = $("#frontier");
  if (frontierEl && state?.frontier) {
    const sorted = (state.frontier.issues || []).slice().sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.number - b.number);
    updateHtml(frontierEl, `
      <header>
        <div><strong>${state.frontier.eligible}</strong><span>ready now</span></div>
        <div><strong>${state.frontier.deferred}</strong><span>waiting</span></div>
        <div><strong>${state.frontier.labeled}</strong><span>in queue</span></div>
        <p>${state.frontier.available ? (state.frontier.next ? `Next: #${state.frontier.next.number} ${esc(state.frontier.next.title)}` : "No issue is ready to start.") : "The GitHub issue queue is unavailable."}</p>
      </header>
      <div class="frontier-list">
        ${sorted.map((issue) => `
          <div class="frontier-row ${issue.eligible ? "eligible" : "deferred"}">
            <a href="https://github.com/${state.repo.ghrepo}/issues/${issue.number}" target="_blank" rel="noopener noreferrer">#${issue.number}</a>
            <strong>${esc(issue.title)}</strong>
            <span>${issue.eligible ? "READY" : esc(issue.reason)}</span>
          </div>
        `).join("") || '<div class="empty-state">No issues in frontier.</div>'}
      </div>
    `);
  }
}

function renderCards() {
  const cardsEl = $("#cards");
  if (!cardsEl || !state?.cards) return;

  const cards = state.cards.slice().sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || a.name.localeCompare(b.name));
  const html = cards.map((card) => {
    const options = [...card.text.matchAll(/^## Option ([A-Z]) — (.+)$/gm)];
    const form = card.status === "open" ? `
      <form class="card-answer" data-card="${esc(card.name)}">
        ${options.map((match) => `
          <label>
            <input type="radio" name="opt-${esc(card.name)}" value="${match[1]}" required>
            <b>${match[1]}</b>
            <span>${esc(match[2])}</span>
          </label>
        `).join("")}
        <textarea name="note" maxlength="2000" placeholder="Optional reasoning. It will be recorded in the card."></textarea>
        <button class="primary" type="submit">Record answer</button>
      </form>
    ` : "";
    return `
      <details class="decision-card" data-ui-key="decision:${esc(card.name)}" ${card.status === "open" ? "open" : ""}>
        <summary>
          <span class="decision-state ${card.status === "open" ? "open" : ""}">${esc(card.status.toUpperCase())}</span>
          <strong>${esc(card.title)}</strong>
          <small>${esc(card.name)}</small>
        </summary>
        <div class="card-copy">${md(card.text)}</div>
        ${form}
      </details>
    `;
  }).join("") || '<div class="empty-state good">No decision cards exist.</div>';

  updateHtml(cardsEl, html);
}

function renderHistory() {
  const sessionEl = $("#sessionHistory");
  if (sessionEl && state?.sessions) {
    const sessions = state.sessions.slice(0, 30);
    const html = sessions.map((session) => {
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
      return `
        <details class="history-row ${esc(session.status.replaceAll(" ", "-"))}" data-ui-key="history:${esc(session.id)}">
          <summary>
            <span class="session-state">${esc(session.status.toUpperCase())}</span>
            <strong>${esc(sessionLabel(session))}</strong>
            <time>${formatClock(session.lastActivity)} · ${formatAge(session.lastActivity)}</time>
            <b>${esc(outcome)}</b>
          </summary>
          <div>
            <p><code>${esc(session.id)}</code> · ${esc(ROLE_NAMES[session.role] || session.role)} · ${esc(session.route)}</p>
            <p>Duration: ${formatDuration(session.durationSeconds)}</p>
            ${reportLabel}
            <pre>${esc(report)}</pre>
          </div>
        </details>
      `;
    }).join("") || '<div class="empty-state">No model sessions exist.</div>';
    updateHtml(sessionEl, html);
  }

  const resolvedEl = $("#resolvedTickets");
  if (resolvedEl && state?.tickets) {
    const resolved = state.tickets.filter(isResolvedTicket);
    const html = resolved.map((ticket) => {
      const record = ticket.postMergeAudit || ticket.manualIntervention || {};
      const exception = record.original_exception || record.parked_reason || "None recorded";
      const recordedAt = record.recorded_at || ticket.mergedAt;
      const note = ticket.status === "merged" ? "Unified assurance passed before the owner merged this PR." : record.note || "No owner note recorded.";
      return `
        <details class="resolved-ticket" data-ui-key="resolved:${ticket.id}">
          <summary>
            <span>${esc(ticketDisplayStatus(ticket).label)}</span>
            <strong>#${ticket.id} · ${esc(ticket.title || "Resolved ticket")}</strong>
            <time>${recordedAt ? formatAge(recordedAt) : "recorded"}</time>
          </summary>
          <div>
            <p>${esc(note)}</p>
            <dl>
              <div><dt>Pull request</dt><dd><a href="${esc(ticket.pr)}" target="_blank" rel="noopener noreferrer">PR ${ticket.prNumber}</a> · ${esc(ticket.prState)}</dd></div>
              <div><dt>Recorded head</dt><dd><code>${esc(record.current_head || ticket.head)}</code></dd></div>
              <div><dt>Prior exception</dt><dd>${esc(exception)}</dd></div>
              <div><dt>Recorded by</dt><dd>${esc(record.recorded_by || "Owner")}</dd></div>
            </dl>
          </div>
        </details>
      `;
    }).join("") || '<div class="empty-state">No resolved ticket records exist.</div>';
    updateHtml(resolvedEl, html);
  }

  const timelinesEl = $("#timelines");
  if (timelinesEl && state?.loops) {
    const html = state.loops.map((loop) => `
      <article class="timeline-card">
        <header>
          <strong>${esc(loopTitle(loop.id))}</strong>
          <span>${loop.status === "active" ? "ENABLED" : "PAUSED"} · ${loop.timerConfigured ? (loop.timerLoaded ? "ARMED" : "NOT ARMED") : "MANUAL"}</span>
        </header>
        ${loop.timeline.map((line) => `<p>${esc(line)}</p>`).join("") || "<p>No timeline events.</p>"}
      </article>
    `).join("");
    updateHtml(timelinesEl, html);
  }
}

function renderHealth() {
  const workflowsEl = $("#workflows");
  if (!workflowsEl || !state?.loops) return;

  const html = state.loops.map((loop) => {
    const running = state.currentSessions?.find((session) => session.loop === loop.id && session.status === "running");
    const runLabel = loop.id === "implement" ? "Advance current work" : "Run once";
    const timerLabel = loop.timerLoaded ? (loop.health === "failed" ? "SCHEDULE DEGRADED" : "SCHEDULE ON") : loop.timerInstalled ? "SCHEDULE OFF" : "NOT INSTALLED";
    const timerButton = loop.timerConfigured ? `<button type="button" class="${loop.timerLoaded ? "outline-danger" : ""}" data-timer-action="${loop.timerLoaded ? "disarm" : "arm"}" data-loop="${loop.id}" ${loop.status !== "active" && !loop.timerLoaded ? "disabled" : ""}>${loop.timerLoaded ? "Stop schedule" : "Start schedule"}</button>` : "";
    const scheduleButton = loop.timerConfigured ? `<button type="button" data-schedule-loop="${loop.id}">Change schedule</button>` : "";
    const dispatchPolicy = loop.id === "implement" ? `<section class="dispatch-policy"><div><strong>Concurrent session limit</strong><span>Maximum paid model sessions running at one time.</span></div><input type="number" min="1" max="8" step="1" value="${Number(state.routing.rules?.max_concurrent_sessions || 1)}" data-dispatch-limit aria-label="Concurrent session limit"><button type="button" data-save-dispatch-limit>Save limit</button></section>` : "";
    const maintenance = loop.maintenance?.length ? `<section class="maintenance-routes"><header><strong>No-model automation</strong><span>These tasks never start a model session.</span></header>${loop.maintenance.map((task) => `<div class="maintenance-row"><div><strong>${esc(task.label)} · ${esc(task.cadence)}</strong><span>${esc(task.note)}</span></div><div><button type="button" data-action="${esc(task.id)}" data-loop="${loop.id}">Run now</button><button type="button" data-schedule-loop="${loop.id}" data-schedule-task="${esc(task.id)}">Change timing</button><button type="button" class="${task.timerLoaded ? "outline-danger" : ""}" data-timer-action="${task.timerLoaded ? "disarm" : "arm"}" data-loop="${loop.id}" data-task="${esc(task.id)}">${task.timerLoaded ? "Stop" : "Start"}</button></div></div>`).join("")}</section>` : "";
    return `
      <article class="workflow-card ${esc(loop.status)} ${loop.timerLoaded ? "scheduled" : ""} ${esc(loop.health)}">
        <header>
          <div>
            <strong>${esc(loopTitle(loop.id))}</strong>
            <span>${loop.status === "active" ? "WORKFLOW ACTIVE" : "WORKFLOW PAUSED"}</span>
          </div>
          <i class="timer-state ${loop.timerLoaded && loop.health !== "failed" ? "armed" : ""}">${loop.timerConfigured ? timerLabel : "ON DEMAND"}</i>
        </header>
        <p>${esc(loop.goal)}</p>
        <dl>
          <div><dt>Manual action</dt><dd>${loop.id === "implement" ? "Advance tracked work · bounded paid dispatch" : "Start one cycle"}</dd></div>
          ${loop.timerConfigured ? `<div><dt>Paid schedule</dt><dd>${esc(loop.cadence)}</dd></div><div><dt>Scheduled command</dt><dd><code>${esc(loop.scheduledCommand)}</code>${loop.id === "implement" ? `<small>Maximum ${state.routing.rules?.max_concurrent_sessions || 1} paid model session(s) running at once.</small>` : ""}</dd></div>` : `<div><dt>Schedule</dt><dd>On demand only</dd></div>`}
          <div><dt>Current work</dt><dd>${running ? esc(sessionLabel(running)) : "Idle"}</dd></div>
          <div><dt>Last event</dt><dd>${esc(loop.lastEvent || "Never")}</dd></div>
        </dl>
        ${dispatchPolicy}
        ${maintenance}
        <section class="workflow-routes" data-cycle-routes="${loop.id}"></section>
        <footer>
          <button type="button" class="primary" data-action="run" data-loop="${loop.id}" ${!loop.triggerable || loop.status !== "active" ? "disabled" : ""}>${runLabel}</button>
          ${loop.id === "implement" ? `<button type="button" class="outline-danger" data-action="advance" data-loop="implement" ${state.frontier.eligible === 0 || state.summary.paidReady > 0 || loop.status !== "active" ? "disabled" : ""}>Start next issue</button>` : ""}
          ${scheduleButton}
          ${timerButton}
          <button type="button" data-action="toggle" data-loop="${loop.id}">${loop.status === "active" ? "Pause workflow" : "Resume workflow"}</button>
          <button type="button" data-inspect="${loop.id}">Inspect</button>
        </footer>
      </article>
    `;
  }).join("");

  updateHtml(workflowsEl, html);
  renderRouting();
}

function routeEntriesFromState() {
  if (!state?.routing?.roles) return [];
  return Object.entries(state.routing.roles).map(([name, route]) => ({ id: `role:${name}`, group: "roles", name, model: route.model, variant: route.variant }));
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
  const slots = $$("[data-cycle-routes]");
  if (loadingModels) {
    if (toolbar) updateHtml(toolbar, "<div><strong>Reading installed models…</strong><span>Model controls will appear inside each cycle.</span></div>");
    slots.forEach((slot) => { updateHtml(slot, '<div class="routing-empty"><strong>Loading model controls…</strong></div>'); });
    return;
  }
  if (!modelCatalog) {
    if (toolbar) updateHtml(toolbar, '<div><strong>Model catalog is unavailable.</strong><span>Cycle controls remain usable.</span></div><button type="button" data-refresh-models>Try again</button>');
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
    return `
      <div class="cycle-route" data-route-id="${esc(route.id)}">
        <div><strong>${esc(definition.label)}</strong><span>${esc(definition.note)}</span></div>
        <label><span>Model</span><select form="routingForm" data-route-model>${groupedModelOptions(route.model)}</select></label>
        <label><span>Variant</span><select form="routingForm" data-route-variant>${variantOptions}</select></label>
      </div>
    `;
  };
  slots.forEach((slot) => {
    const definitions = LOOP_ROUTES[slot.dataset.cycleRoutes] || [];
    updateHtml(slot, `<header><strong>Models for this cycle</strong><span>New work only</span></header>${definitions.map(row).join("")}`);
  });
  if (toolbar) {
    updateHtml(toolbar, `
      <div><strong>Model changes apply to new work only.</strong><span>Shared verification controls stay synchronized across cycles. Active work keeps its current route.</span></div>
      <div>
        <button type="button" data-refresh-models>Refresh models</button>
        <button class="primary" type="submit" form="routingForm" ${routingDirty ? "" : "disabled"}>Save model changes</button>
      </div>
    `);
  }
}

async function loadModels(force = false) {
  loadingModels = true;
  if (state) renderRouting();
  try {
    const response = await fetch(`/api/models${force ? "?refresh=1" : ""}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Model catalog unavailable");
    modelCatalog = result;
    if (!routingDirty && state) routeDraft = routeEntriesFromState();
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
  if (!loop) return;
  const sessions = state.sessions.filter((item) => item.loop === id).slice(0, 15);
  const logs = state.logs.filter((log) => sessions.some((session) => session.log === log.name));
  updateHtml($("#drawerBody"), `
    <span class="kicker">WORKFLOW DETAIL · ${esc(id)}</span>
    <h2>${esc(loopTitle(id))}</h2>
    <span class="drawer-state">${loop.status === "active" ? "ENABLED" : "PAUSED"} · ${loop.timerConfigured ? (loop.timerLoaded ? "ARMED" : "NOT ARMED") : "MANUAL"}</span>
    <p class="drawer-goal">${esc(loop.goal)}</p>
    <div class="flow-facts">
      <div><span>CONSUMES</span>${esc(loop.consumes)}</div>
      <div><span>PRODUCES</span>${esc(loop.produces)}</div>
    </div>
    <section>
      <h3>Recent timeline</h3>
      ${loop.timeline.map((line) => `<p class="drawer-event">${esc(line)}</p>`).join("") || "<p>No runs recorded.</p>"}
    </section>
    <section>
      <h3>Model sessions</h3>
      ${sessions.map((session) => `<details class="drawer-session" data-ui-key="drawer-session:${esc(session.id)}"><summary>${esc(sessionLabel(session))} · ${esc(session.status)}</summary><p>${esc(session.route)}</p><pre>${esc(session.result || "No result was written.")}</pre></details>`).join("") || "<p>No model sessions.</p>"}
    </section>
    <section>
      <h3>Logs</h3>
      ${logs.map((log) => `<button type="button" class="log-link" data-log="${esc(log.name)}">${esc(log.name)} · ${Math.max(1, Math.round(log.size / 1024))} KB</button>`).join("") || "<p>No logs for recent sessions.</p>"}
    </section>
  `);
  $("#drawer")?.classList.add("open");
  $("#scrim")?.classList.add("open");
  $("#drawer")?.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("#drawer")?.classList.remove("open");
  $("#scrim")?.classList.remove("open");
  $("#drawer")?.setAttribute("aria-hidden", "true");
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
  if (!form) return;
  const noteValid = form.note.value.trim().length >= 12;
  form.querySelector('[type="submit"]').disabled = !(noteValid && form.acknowledged.checked);
}

function openParked(ticketId) {
  const ticket = state.tickets.find((item) => item.id === Number(ticketId));
  if (!ticket || (!ticket.retryableRuntimeFailure && !["parked", "blocked-decision"].includes(ticket.status))) return toast("Workflow resolution is not available for this ticket");
  parkedTicketId = ticket.id;
  $("#parkedTarget").innerHTML = `
    <div class="target-badge-row">
      <span class="pill-badge">Issue #${ticket.id}</span>
      ${ticket.prNumber ? `<span class="pill-badge">PR #${ticket.prNumber}</span>` : ""}
      ${ticket.headShort ? `<span class="pill-badge mono">Reviewed: ${esc(ticket.headShort)}</span>` : ""}
      ${ticket.liveHeadShort ? `<span class="pill-badge mono">Current: ${esc(ticket.liveHeadShort)}</span>` : ""}
    </div>
    <div class="target-reason">${esc(ticket.reason || "")}</div>
  `;
  const form = $("#parkedForm");
  form.reset();
  const retry = form.querySelector('[value="retry"]');
  const resume = form.querySelector('[value="resume"]');
  retry.disabled = !ticket.retryableRuntimeFailure;
  resume.disabled = !(ticket.prState === "OPEN" && ticket.revisionChanged);
  $("#retryOption")?.classList.toggle("unavailable", retry.disabled);
  $("#resumeOption")?.classList.toggle("unavailable", resume.disabled);
  (!retry.disabled ? retry : !resume.disabled ? resume : form.querySelector('[value="manual"]')).checked = true;
  syncParkedSubmit();
  $("#parkedDialog").showModal();
  $("#parkedNote").focus();
}

function syncParkedSubmit() {
  const form = $("#parkedForm");
  if (!form) return;
  const disposition = form.querySelector('[name="disposition"]:checked')?.value;
  const retry = disposition === "retry";
  const evidence = $("#parkedDecisionEvidence");
  if (evidence) evidence.hidden = retry;
  form.note.required = !retry;
  form.acknowledged.required = !retry;
  const valid = retry || (form.note.value.trim().length >= 12 && form.acknowledged.checked);
  const submit = form.querySelector('[type="submit"]');
  if (submit) {
    submit.disabled = !(disposition && valid);
    submit.textContent = retry ? "Retry automation" : "Apply disposition";
  }
  const footerNote = $("#parkedFooterNote");
  if (footerNote) {
    footerNote.textContent = disposition === "retry"
      ? "A new worker will start from the authoritative GitHub issue and PR head. Failed local edits and prior session logs are not reused."
      : disposition === "resume"
        ? "The safe reconcile starts after this record is written."
        : "The loop stops managing this PR; prior failures remain recorded.";
  }
}

async function submitParked(form) {
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch("/api/parked-resolution", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: parkedTicketId, disposition: form.disposition.value, note: form.note.value, acknowledged: form.acknowledged.checked }) });
    const result = await response.json();
    if (!response.ok || result.ok === false) return toast(`FAILED · ${result.output || result.error}`);
    $("#parkedDialog")?.close();
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
    $("#auditDialog")?.close();
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
  const item = state.loops?.find((entry) => entry.id === loop);
  $("#confirmTitle").textContent = action === "collect" ? "Collect completed results?" : action === "sync" ? "Refresh repository state?" : action === "advance" ? "Start the next issue?" : action === "run" && loop === "implement" ? "Advance current work?" : action === "run" ? `Run ${loopTitle(loop)}` : `Change ${loopTitle(loop)}`;
  $("#confirmText").textContent = action === "collect" ? "This updates durable state and starts no model sessions." : action === "sync" ? "This refreshes GitHub and repository state and starts no model sessions." : action === "advance" ? "Start at most one implementation session. Tracked paid work must be clear first." : action === "run" && loop === "implement" ? "Start at most one model session for tracked work. Completed results are not collected by this action." : action === "run" ? `Start one ${item?.cadence?.toLowerCase() || "cycle"} check now.` : `${item?.status === "active" ? "Pause" : "Resume"} this workflow. Running model sessions are not stopped.`;
  $("#confirm").showModal();
}

function scheduleItem(loopId, taskId = "") {
  const loop = state.loops?.find((entry) => entry.id === loopId);
  return taskId ? loop?.maintenance?.find((task) => task.id === taskId) : loop;
}

function askTimer(timerAction, loop, task = "") {
  const item = state.loops?.find((entry) => entry.id === loop);
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
  const loop = state.loops?.find((item) => item.id === loopId);
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
    $("#scheduleDialog")?.close();
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
  const progressEl = $("#globalProgress");
  if (progressEl) progressEl.hidden = false;
  toast("⏳ Starting cycle...");
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
    if (progressEl) progressEl.hidden = true;
    pending = null;
  }
}

function renderFormattedLog(rawText) {
  const steps = parseJsonlLog(rawText);
  if (!steps.length) {
    return '<div class="empty-state">No structured events found in this log. Switch to Raw view.</div>';
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
      return `
        <div class="log-tool-item">
          <div class="log-tool-title-row">
            <span class="tool-tag ${esc(t.tool)}">${esc(t.tool)}</span>
            <span class="log-tool-target">${esc(t.title)}</span>
            ${badgeHtml}
          </div>
          ${contentHtml}
        </div>
      `;
    }).join("");

    return `
      <div class="log-step-card">
        <div class="log-step-header">
          <strong>Step ${step.index}</strong>
          <span>${esc(metaParts)}</span>
        </div>
        ${toolsHtml}
      </div>
    `;
  }).join("");
}

async function openLog(name) {
  if (!name) return;
  try {
    const response = await fetch(`/api/log?name=${encodeURIComponent(name)}`);
    if (!response.ok) return toast("FAILED · Log unavailable");
    const text = await response.text();
    $("#logTitle").textContent = name;
    $("#logMeta").textContent = `${Math.max(1, Math.round(text.length / 1024))} KB`;
    $("#logText").textContent = text;
    $("#logFormatted").innerHTML = renderFormattedLog(text);
    
    $("#logTabFormatted")?.classList.add("active");
    $("#logTabRaw")?.classList.remove("active");
    if ($("#logFormatted")) $("#logFormatted").hidden = false;
    if ($("#logText")) $("#logText").hidden = true;
    
    $("#logDialog").showModal();
  } catch (err) {
    toast(`FAILED · ${err.message}`);
  }
}

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(box.timer);
  box.timer = setTimeout(() => box.classList.remove("show"), 5000);
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) return setView(nav.dataset.view);
  const jump = event.target.closest("[data-view-jump]");
  if (jump) return setView(jump.dataset.viewJump);
  const qFilter = event.target.closest("[data-q-filter]");
  if (qFilter) {
    activeQueueFilter = qFilter.dataset.qFilter;
    document.querySelectorAll(".q-filter").forEach((btn) => {
      btn.classList.toggle("active", btn === qFilter);
    });
    renderQueue();
    return;
  }
  const sTab = event.target.closest("[data-sidebar-tab]");
  if (sTab) {
    sidebarTab = sTab.dataset.sidebarTab;
    document.querySelectorAll(".s-tab").forEach((b) => b.classList.toggle("active", b === sTab));
    if ($("#sidebarTicketsView")) $("#sidebarTicketsView").hidden = sidebarTab !== "tickets";
    if ($("#sidebarLoopsView")) $("#sidebarLoopsView").hidden = sidebarTab !== "loops";
    if (sidebarTab === "tickets") {
      currentSelectionType = "ticket";
      setView("now");
      renderCurrentWork();
    } else {
      currentSelectionType = "loop";
      setView("now");
      renderCurrentWork();
    }
    return;
  }
  const loopSelect = event.target.closest("[data-loop-select]");
  if (loopSelect) {
    selectedLoopId = loopSelect.dataset.loopSelect;
    currentSelectionType = "loop";
    document.querySelectorAll(".q-loop-card").forEach((c) => c.classList.toggle("selected", c.dataset.loopSelect === selectedLoopId));
    document.querySelectorAll(".q-ticket-card").forEach((c) => c.classList.remove("selected"));
    setView("now");
    setMobileView("canvas");
    return renderCurrentWork();
  }
  const mobileNav = event.target.closest("[data-mobile-nav]");
  if (mobileNav) {
    return setMobileView(mobileNav.dataset.mobileNav);
  }
  const workTab = event.target.closest("[data-work-tab]");
  if (workTab) {
    activeWorkTab = workTab.dataset.workTab;
    return renderCurrentWork();
  }
  const ticketSelect = event.target.closest("[data-ticket-select]");
  if (ticketSelect) {
    selectedTicketId = Number(ticketSelect.dataset.ticketSelect);
    currentSelectionType = "ticket";
    document.querySelectorAll(".q-ticket-card").forEach((c) => c.classList.toggle("selected", c.dataset.ticketSelect === String(selectedTicketId)));
    document.querySelectorAll(".q-loop-card").forEach((c) => c.classList.remove("selected"));
    setView("now");
    setMobileView("canvas");
    return renderCurrentWork();
  }
  const ticketJump = event.target.closest("[data-ticket-jump]");
  if (ticketJump) {
    selectedTicketId = Number(ticketJump.dataset.ticketJump);
    currentSelectionType = "ticket";
    setView("now");
    return renderCurrentWork();
  }
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
  if (event.target.closest("[data-close-confirm]")) return $("#confirm")?.close();
  if (event.target.closest("[data-close-audit]")) return $("#auditDialog")?.close();
  if (event.target.closest("[data-close-parked]")) return $("#parkedDialog")?.close();
  if (event.target.closest("[data-close-schedule]")) return $("#scheduleDialog")?.close();
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

$("#scheduleForm")?.addEventListener("input", syncScheduleSubmit);
$("#scheduleForm")?.addEventListener("change", syncScheduleSubmit);

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

$("#auditForm")?.addEventListener("input", syncAuditSubmit);
$("#auditForm")?.addEventListener("change", syncAuditSubmit);
$("#parkedForm")?.addEventListener("input", syncParkedSubmit);
$("#parkedForm")?.addEventListener("change", syncParkedSubmit);

$("#closeDrawer")?.addEventListener("click", closeDrawer);
$("#scrim")?.addEventListener("click", closeDrawer);
$("#closeLog")?.addEventListener("click", () => $("#logDialog")?.close());
$("#logDialog")?.addEventListener("click", (event) => { if (event.target === $("#logDialog")) $("#logDialog")?.close(); });
$("#logTabFormatted")?.addEventListener("click", () => {
  $("#logTabFormatted")?.classList.add("active");
  $("#logTabRaw")?.classList.remove("active");
  if ($("#logFormatted")) $("#logFormatted").hidden = false;
  if ($("#logText")) $("#logText").hidden = true;
});
$("#logTabRaw")?.addEventListener("click", () => {
  $("#logTabRaw")?.classList.add("active");
  $("#logTabFormatted")?.classList.remove("active");
  if ($("#logFormatted")) $("#logFormatted").hidden = true;
  if ($("#logText")) $("#logText").hidden = false;
});
$("#confirm")?.addEventListener("close", () => { if ($("#confirm")?.returnValue === "confirm") act(); });

// Backdrop click dismissal for all modal dialogs
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("mousedown", (event) => {
    const rect = dialog.getBoundingClientRect();
    const isInside = (
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width
    );
    if (!isInside) {
      dialog.close();
    }
  });
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && (!eventSource || eventSource.readyState === EventSource.CLOSED)) connectEvents(); });

setInterval(() => {
  updateConnection();
  if (state?.summary?.running) {
    if (activeView === "now") renderCurrentWork();
    else if (activeView === "tickets") renderTickets();
    const workerBlock = $("#activeWorkerBlock");
    const runningSession = state.currentSessions?.find((s) => s.status === "running");
    if (workerBlock && runningSession) {
      const durEl = $("#activeWorkerDuration");
      if (durEl) {
        const extra = Math.max(0, Math.floor((Date.now() - Date.parse(state.generatedAt)) / 1000));
        durEl.textContent = formatDuration((runningSession.durationSeconds || 0) + extra);
      }
    }
  }
}, 1000);

loadState();
connectEvents();
