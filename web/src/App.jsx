import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  ExternalLink,
  FileCheck2,
  GitPullRequest,
  History,
  Inbox,
  LayoutList,
  LoaderCircle,
  Menu,
  Pause,
  Play,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X
} from "lucide-react";
import {
  isResolvedTicket,
  parseJsonlLog,
  recommendedAction,
  sessionLabel,
  ticketStages
} from "../view-model.mjs";
import { api } from "./api.js";
import {
  frontActor,
  actionableFronts,
  isActiveTicket,
  NAV_ITEMS,
  pageFromHash,
  parkedResolutionPresentation,
  pickCompatibleVariant,
  queueFrontGroups,
  sanitizeRouteVariants,
  ticketSubtitle,
  workflowState
} from "./ui-model.js";

const NAV_ICONS = {
  work: Inbox,
  queue: LayoutList,
  decisions: FileCheck2,
  runs: History,
  automations: Settings2
};

const PAGE_COPY = {
  work: ["Work", "Choose one item and move it forward."],
  queue: ["Issue queue", "See what needs your action and what the Loop will handle."],
  decisions: ["Decisions", "Resolve the choices that need your judgment."],
  runs: ["Run history", "Inspect results, evidence, and execution logs."],
  automations: ["Automations", "Control schedules, capacity, and model routes."]
};

function formatAge(iso) {
  if (!iso) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDuration(seconds = 0) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function Status({ state }) {
  return <span className={`status status--${state.tone}`}><i />{state.label}</span>;
}

function Spinner({ label = "Loading" }) {
  return <div className="loading"><LoaderCircle size={18} />{label}</div>;
}

function Empty({ title, detail }) {
  return <div className="empty"><Check size={22} /><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}

function IconButton({ label, children, ...props }) {
  return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("connecting");
  const [page, setPageState] = useState(() => pageFromHash(window.location.hash));
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [ticketFilter, setTicketFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [mobilePane, setMobilePane] = useState("inbox");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [auditTicket, setAuditTicket] = useState(null);
  const [parkedTicket, setParkedTicket] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [logName, setLogName] = useState("");
  const [healthOpen, setHealthOpen] = useState(false);
  const [selectedFrontNumber, setSelectedFrontNumber] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.state();
      setState(next);
      setError("");
      setConnection("live");
    } catch (requestError) {
      setError(requestError.message);
      setConnection("offline");
    }
  }, []);

  useEffect(() => {
    refresh();
    const events = new EventSource("/api/events");
    events.onopen = () => setConnection("live");
    events.addEventListener("state", (event) => {
      try {
        setState(JSON.parse(event.data));
        setConnection("live");
      } catch {
        setConnection("offline");
      }
    });
    events.onerror = () => setConnection("reconnecting");
    return () => events.close();
  }, [refresh]);

  useEffect(() => {
    if (!state?.tickets?.length) return;
    const exists = state.tickets.some((ticket) => ticket.id === selectedTicketId);
    if (exists) return;
    const preferred = state.tickets.find((ticket) => ["running", "awaiting harvest"].includes(ticket.session?.status))
      || state.tickets.find(isActiveTicket)
      || state.tickets[0];
    setSelectedTicketId(preferred?.id ?? null);
  }, [state, selectedTicketId]);

  useEffect(() => {
    const fronts = state?.frontier?.fronts || [];
    if (!fronts.length) return;
    if (fronts.some((front) => front.number === selectedFrontNumber)) return;
    setSelectedFrontNumber(queueFrontGroups(fronts).primaryManual?.number || fronts[0].number);
  }, [state, selectedFrontNumber]);

  useEffect(() => {
    const onHash = () => setPageState(pageFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (state?.project?.name) document.title = `${PAGE_COPY[page][0]} · ${state.project.name}`;
  }, [page, state?.project?.name]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const setPage = (next) => {
    setPageState(next);
    window.history.replaceState(null, "", `#${next}`);
    setMobilePane(next === "work" ? "inbox" : "focus");
  };

  const mutate = useCallback(async (path, body, successMessage) => {
    setBusy(true);
    try {
      const result = await api.post(path, body);
      setNotice({ tone: "success", text: result.output || successMessage || "Saved" });
      await refresh();
      return true;
    } catch (requestError) {
      setNotice({ tone: "error", text: requestError.message });
      return false;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const runAction = (action, loop = "implement", label = "Run this action") => {
    if (action === "collect" || action === "clear-cooldown") {
      return mutate("/api/action", { action, loop });
    }
    setConfirm({
      title: label,
      detail: action === "run" || action === "advance"
        ? "This can start a paid model session."
        : "This changes the workflow state.",
      button: label,
      run: () => mutate("/api/action", { action, loop })
    });
  };

  if (!state) {
    return <div className="startup"><div className="loop-mark"><span /><span /></div><Spinner label={error || "Reading workspace"} /><button onClick={refresh}>Try again</button></div>;
  }

  const selectedTicket = state.tickets?.find((ticket) => ticket.id === selectedTicketId) || null;
  const queueGroups = queueFrontGroups(state.frontier?.fronts || []);
  const selectedFront = state.frontier?.fronts?.find((front) => front.number === selectedFrontNumber) || queueGroups.primaryManual || state.frontier?.fronts?.[0] || null;
  const openTickets = state.tickets?.filter(isActiveTicket) || [];

  const selectTicket = (id) => {
    setSelectedTicketId(id);
    setPage("work");
    setMobilePane("focus");
  };

  return (
    <div className={`app-shell mobile-${mobilePane}`}>
      <WorkspaceHeader
        state={state}
        page={page}
        setPage={setPage}
        connection={connection}
        healthOpen={healthOpen}
        setHealthOpen={setHealthOpen}
        onRefresh={refresh}
        onSelectTicket={(id) => {
          setHealthOpen(false);
          selectTicket(id);
        }}
      />
      <LeftColumn
        state={state}
        page={page}
        selectedTicketId={selectedTicketId}
        selectTicket={selectTicket}
        filter={ticketFilter}
        setFilter={setTicketFilter}
        search={search}
        setSearch={setSearch}
        onLog={setLogName}
        selectedFrontNumber={selectedFront?.number || null}
        onSelectFront={setSelectedFrontNumber}
      />

      <main className="focus-column">
        <PageHeader
          page={page}
          onBack={() => setMobilePane("inbox")}
          onDetails={() => setMobilePane("details")}
        />
        <div className="focus-scroll">
          {page === "work" && (
            <WorkPage
              state={state}
              ticket={selectedTicket}
              busy={busy}
              runAction={runAction}
              onAudit={setAuditTicket}
              onParked={setParkedTicket}
              onLog={setLogName}
            />
          )}
          {page === "queue" && <QueuePage state={state} selectedFront={selectedFront} onSelectFront={setSelectedFrontNumber} onSelect={selectTicket} busy={busy} runAction={runAction} />}
          {page === "decisions" && <DecisionsPage state={state} mutate={mutate} busy={busy} />}
          {page === "runs" && <RunsPage state={state} onLog={setLogName} />}
          {page === "automations" && (
            <AutomationsPage
              state={state}
              runAction={runAction}
              mutate={mutate}
              busy={busy}
              onSchedule={setScheduleTarget}
            />
          )}
        </div>
      </main>

      <DetailsColumn
        state={state}
        ticket={selectedTicket}
        page={page}
        front={selectedFront}
        onClose={() => setMobilePane("focus")}
        onLog={setLogName}
      />

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={mobilePane === "inbox" ? "active" : ""} onClick={() => setMobilePane("inbox")}><Menu size={19} />Inbox</button>
        <button className={mobilePane === "focus" ? "active" : ""} onClick={() => setMobilePane("focus")}><CircleDot size={19} />Focus</button>
        <button className={mobilePane === "details" ? "active" : ""} onClick={() => setMobilePane("details")}><SlidersHorizontal size={19} />Details</button>
      </nav>

      {confirm && <ConfirmDialog value={confirm} busy={busy} onClose={() => setConfirm(null)} />}
      {auditTicket && <AuditDialog ticket={auditTicket} busy={busy} mutate={mutate} onClose={() => setAuditTicket(null)} />}
      {parkedTicket && <ParkedDialog ticket={parkedTicket} busy={busy} mutate={mutate} onClose={() => setParkedTicket(null)} />}
      {scheduleTarget && <ScheduleDialog target={scheduleTarget} busy={busy} mutate={mutate} onClose={() => setScheduleTarget(null)} />}
      {logName && <LogDialog name={logName} onClose={() => setLogName("")} />}
      {busy && <div className="progress-line" />}
      {notice && <div className={`toast toast--${notice.tone}`}>{notice.tone === "success" ? <Check size={17} /> : <AlertTriangle size={17} />}{notice.text}</div>}
      {error && <div className="connection-warning">Live updates are unavailable. {error}</div>}
      <span className="sr-only">{openTickets.length} open work items</span>
    </div>
  );
}

function WorkspaceHeader({ state, page, setPage, connection, healthOpen, setHealthOpen, onRefresh, onSelectTicket }) {
  const issueCount = state.attention?.length || 0;
  const unhealthy = issueCount > 0 || state.summary.degraded > 0 || state.summary.incomplete > 0;
  return (
    <header className="workspace-header">
      <button className="workspace-brand" onClick={() => setPage("work")}>
        <div className="loop-mark" aria-hidden="true"><span /><span /></div>
        <span><strong>Loop</strong><small>{state.project?.name || "Workspace"}</small></span>
      </button>
      <nav className="workspace-nav" aria-label="Workspace">
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
            {item.label}
            {item.id === "queue" && actionableFronts(state.frontier?.fronts).length > 0 && <b>{actionableFronts(state.frontier?.fronts).length}</b>}
            {item.id === "decisions" && state.summary.openDecisionCards > 0 && <b>{state.summary.openDecisionCards}</b>}
          </button>
        ))}
        <a href="/bench" target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', color: '#58a6ff', padding: '0 12px', fontSize: 13, fontWeight: 600 }}>
          ⚡ Bench
        </a>
      </nav>
      <div className="workspace-tools">
        <span className={`connection connection--${connection}`}><i />{connection}</span>
        <IconButton label="Refresh workspace" onClick={onRefresh}><RefreshCcw size={17} /></IconButton>
        <div className="health-menu">
          <button className={`health-button ${unhealthy ? "health-button--warn" : ""}`} onClick={() => setHealthOpen(!healthOpen)} aria-expanded={healthOpen}>
            {unhealthy ? <AlertTriangle size={16} /> : <Check size={16} />}
            <span>{unhealthy ? `${issueCount || state.summary.incomplete} needs attention` : "Workspace healthy"}</span>
            <ChevronDown size={14} />
          </button>
          {healthOpen && (
            <div className="health-popover">
              <header><div><strong>Workspace status</strong><small>{state.summary.running ? `${state.summary.running} model session running` : `${state.summary.armed} schedule active`}</small></div><button aria-label="Close workspace status" onClick={() => setHealthOpen(false)}><X size={16} /></button></header>
              <div className="health-summary">
                <span><b>{state.summary.running}</b>Running</span>
                <span><b>{state.summary.awaitingHarvest}</b>Results ready</span>
                <span><b>{state.summary.armed}</b>Scheduled</span>
              </div>
              <section>
                <h3>Needs attention</h3>
                {(state.attention || []).map((item, index) => (
                  <button key={`${item.title}-${index}`} className="health-alert" onClick={() => item.ticket && onSelectTicket(item.ticket)}>
                    <AlertTriangle size={15} /><span><strong>{item.title}</strong><small>{item.action}</small></span>
                  </button>
                ))}
                {!state.attention?.length && <p>Nothing needs your attention.</p>}
              </section>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function LeftColumn({ state, page, selectedTicketId, selectTicket, filter, setFilter, search, setSearch, onLog, selectedFrontNumber, onSelectFront }) {
  const tickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state.tickets || []).filter((ticket) => {
      const visible = filter === "all" || (filter === "open" ? isActiveTicket(ticket) : workflowState(ticket).tone === "attention");
      return visible && (!term || `${ticket.id} ${ticket.title}`.toLowerCase().includes(term));
    });
  }, [state.tickets, filter, search]);

  return (
    <aside className="left-column">
      {page === "work" && <section className="inbox-section">
        <div className="inbox-heading"><strong>Work inbox</strong><span>{tickets.length}</span></div>
        <div className="segmented" aria-label="Filter work">
          <button className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Open</button>
          <button className={filter === "action" ? "active" : ""} onClick={() => setFilter("action")}>Needs action</button>
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
        </div>
        <label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an issue" /></label>
        <div className="work-list">
          {tickets.map((ticket) => {
            const itemState = workflowState(ticket);
            return (
              <button key={ticket.id} className={`work-row ${selectedTicketId === ticket.id ? "selected" : ""}`} onClick={() => selectTicket(ticket.id)}>
                <span className="work-row-top"><b>#{ticket.id}</b><Status state={itemState} /></span>
                <strong>{ticket.title || "Tracked work"}</strong>
                <small>{ticketSubtitle(ticket)}</small>
              </button>
            );
          })}
          {!tickets.length && <p className="list-empty">No work matches this filter.</p>}
        </div>
      </section>}
      {page === "queue" && <SidebarList title="Work by owner" count={state.frontier?.fronts?.length || 0}>{(state.frontier?.fronts || []).map((front) => { const actor = frontActor(front); return <button className={`context-row ${selectedFrontNumber === front.number ? "selected" : ""}`} key={front.number} onClick={() => onSelectFront(front.number)}><span><b>#{front.number}</b>{actor.label}</span><strong>{front.title}</strong><small>{actor.tone === "loop" ? "No manual action" : front.priority}</small></button>; })}</SidebarList>}
      {page === "decisions" && <SidebarList title="Decision desk" count={state.cards?.length || 0}>{(state.cards || []).map((card) => <div className="context-row" key={card.name}><span><b>{card.status === "open" ? "Open" : "Recorded"}</b></span><strong>{card.title}</strong></div>)}</SidebarList>}
      {page === "runs" && <SidebarList title="Recent runs" count={state.sessions?.length || 0}>{(state.sessions || []).slice(0, 40).map((session) => <button className="context-row" key={session.id} onClick={() => session.log && onLog(session.log)}><span><b>{session.verdict || session.status}</b>{formatAge(session.lastActivity)}</span><strong>{sessionLabel(session)}</strong></button>)}</SidebarList>}
      {page === "automations" && <SidebarList title="Workflows" count={state.loops?.length || 0}>{(state.loops || []).map((loop) => <div className="context-row" key={loop.id}><span><b>{loop.status}</b>{loop.timerLoaded ? loop.cadence : "Schedule off"}</span><strong>{loop.id.replaceAll("-", " ")}</strong></div>)}</SidebarList>}
    </aside>
  );
}

function SidebarList({ title, count, children }) {
  return <section className="context-list"><div className="inbox-heading"><strong>{title}</strong><span>{count}</span></div><div className="work-list">{children}</div></section>;
}

function PageHeader({ page, onBack, onDetails }) {
  const [title, subtitle] = PAGE_COPY[page];
  return (
    <header className="page-header">
      <IconButton label="Back to inbox" onClick={onBack}><ArrowLeft size={20} /></IconButton>
      <div><h1>{title}</h1><p>{subtitle}</p></div>
      <div className="page-header-actions">
        <button className="details-button" onClick={onDetails}>Details</button>
      </div>
    </header>
  );
}

function WorkPage({ state, ticket, busy, runAction, onAudit, onParked, onLog }) {
  const [tab, setTab] = useState("overview");
  if (!ticket) return <Empty title="No work is selected" detail="Choose an item from the inbox." />;
  const itemState = workflowState(ticket);
  const stages = ticketStages(ticket);
  const recommendation = recommendedAction(state);
  const relatedSessions = (state.sessions || []).filter((session) => session.ticket === ticket.id);

  let action = null;
  if (state.circuitBreaker?.active) {
    action = { label: "Clear cooldown and retry", onClick: () => runAction("clear-cooldown", "implement", "Clear cooldown and retry") };
  } else if (ticket.status === "merged-unverified") {
    action = { label: "Record audit resolution", onClick: () => onAudit(ticket) };
  } else if (["parked", "blocked-decision"].includes(ticket.status) || ticket.retryableRuntimeFailure) {
    action = { label: ticket.retryableRuntimeFailure ? "Retry automation" : "Choose next step", onClick: () => onParked(ticket) };
  } else if (ticket.session?.status === "awaiting harvest") {
    action = { label: "Collect result", onClick: () => runAction("collect", "implement", "Collect result") };
  } else if (ticket.status === "done" && ticket.pr) {
    action = { label: "Open pull request", href: ticket.pr };
  } else if (recommendation.action && ["run", "advance", "collect"].includes(recommendation.action)) {
    action = { label: recommendation.label, onClick: () => runAction(recommendation.action, recommendation.loop, recommendation.label) };
  }
  const nextTitle = state.circuitBreaker?.active ? recommendation.title : ticket.nextAction || recommendation.title || "No action is required";
  const nextDetail = state.circuitBreaker?.active ? recommendation.detail : ticket.reason || ticketSubtitle(ticket);

  return (
    <article className="work-focus">
      <header className="work-title">
        <div className="eyebrow"><span>Issue #{ticket.id}</span><Status state={itemState} /></div>
        <h2>{ticket.title || "Tracked work"}</h2>
        <div className="link-row">
          <a href={`https://github.com/${state.repo.ghrepo}/issues/${ticket.id}`} target="_blank" rel="noreferrer">View issue <ExternalLink size={13} /></a>
          {ticket.pr && <a href={ticket.pr} target="_blank" rel="noreferrer">PR #{ticket.prNumber} <ExternalLink size={13} /></a>}
        </div>
      </header>

      <section className={`action-panel action-panel--${itemState.tone}`}>
        <div>
          <span>Next step</span>
          <h3>{nextTitle}</h3>
          <p>{nextDetail}</p>
        </div>
        {action?.href && <a className="button button--primary" href={action.href} target="_blank" rel="noreferrer">{action.label}<ExternalLink size={15} /></a>}
        {action?.onClick && <button className="button button--primary" disabled={busy} onClick={action.onClick}>{action.label}</button>}
      </section>

      <ol className="stepper" aria-label="Workflow progress">
        {stages.map((stage, index) => (
          <li key={`${stage.label}-${index}`} className={`step step--${stage.state}`}>
            <span>{stage.state === "done" ? <Check size={14} /> : index + 1}</span>
            <div><strong>{stage.label}</strong>{stage.state === "current" && stage.detail && <small>{stage.detail}</small>}</div>
          </li>
        ))}
      </ol>

      <div className="content-tabs" role="tablist">
        {[["overview", "Overview"], ["changes", "Changes"], ["evidence", "Evidence"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "overview" && <Overview ticket={ticket} />}
      {tab === "changes" && <Changes ticket={ticket} />}
      {tab === "evidence" && <Evidence sessions={relatedSessions} onLog={onLog} />}
    </article>
  );
}

function Overview({ ticket }) {
  return (
    <div className="overview-grid">
      <section>
        <h3>Current state</h3>
        <p>{ticket.reason || "The controller did not report a blocking condition."}</p>
        {ticket.postMergeAudit && <div className="note"><ShieldCheck size={18} /><div><strong>Audit recorded</strong><p>{ticket.postMergeAudit.note}</p></div></div>}
      </section>
      <section>
        <h3>Pull request</h3>
        <dl className="facts">
          <div><dt>State</dt><dd>{ticket.prState || "No pull request"}</dd></div>
          <div><dt>Revision</dt><dd>{ticket.round || 0}</dd></div>
          <div><dt>Blocking repairs</dt><dd>{ticket.repair || 0} of {ticket.repairLimit || 0}</dd></div>
          <div><dt>Last update</dt><dd>{formatAge(ticket.lastActivity)}</dd></div>
        </dl>
      </section>
      <details className="technical-details">
        <summary>Technical details <ChevronDown size={16} /></summary>
        <dl className="facts">
          <div><dt>Head</dt><dd><code>{ticket.head || "—"}</code></dd></div>
          <div><dt>Merge state</dt><dd>{ticket.mergeStateStatus || "Unknown"}</dd></div>
          <div><dt>Session</dt><dd><code>{ticket.session?.id || "None"}</code></dd></div>
        </dl>
      </details>
    </div>
  );
}

function Changes({ ticket }) {
  const [patch, setPatch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.diff(ticket.id).then((result) => {
      if (alive) setPatch(result.patch || "No changes were found.");
    }).catch((requestError) => {
      if (alive) setError(requestError.message);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [ticket.id]);

  if (loading) return <Spinner label="Loading changes" />;
  return <div className="code-view"><header><Code2 size={16} /><strong>Changes for issue #{ticket.id}</strong></header><pre>{error || patch}</pre></div>;
}

function Evidence({ sessions, onLog }) {
  if (!sessions.length) return <Empty title="No evidence yet" detail="Results will appear after the first run." />;
  return (
    <div className="evidence-list">
      {sessions.slice(0, 12).map((session) => (
        <details key={session.id} className="evidence-row">
          <summary>
            <span className={`run-dot run-dot--${session.verdict === "PASS" ? "pass" : session.exitCode === 0 ? "neutral" : "fail"}`} />
            <div><strong>{sessionLabel(session)}</strong><small>{formatAge(session.lastActivity)} · {formatDuration(session.durationSeconds)}</small></div>
            <b>{session.verdict || (session.exitCode === 0 ? "Complete" : `Exit ${session.exitCode ?? "—"}`)}</b>
            <ChevronDown size={16} />
          </summary>
          <div className="evidence-body">
            <pre>{session.assuranceReport || session.result || "No result was written."}</pre>
            {session.log && <button className="text-button" onClick={() => onLog(session.log)}>Open execution log</button>}
          </div>
        </details>
      ))}
    </div>
  );
}

function QueuePage({ state, selectedFront, onSelectFront, onSelect, busy, runAction }) {
  const issues = state.frontier?.issues || [];
  const fronts = state.frontier?.fronts || [];
  const { primaryManual, automatic, later } = queueFrontGroups(fronts);
  const implementLoop = (state.loops || []).find((loop) => loop.id === "implement");
  const automaticState = implementLoop?.status === "active" && implementLoop.timerLoaded
    ? `Scheduled · ${implementLoop.cadence}`
    : implementLoop?.status === "active" ? "Ready · schedule is off" : "Workflow is paused";
  const contextTickets = (state.tickets || []).filter((ticket) => ticket.status === "container").slice(0, 3);
  const shownNumbers = new Set([...fronts.map((front) => front.number), ...contextTickets.map((ticket) => ticket.id)]);
  const automaticFollowUps = automatic.flatMap((front) => front.immediateUnlocks.map((issue) => ({ ...issue, after: front.number }))).filter((issue) => !shownNumbers.has(issue.number));
  const issueUrl = (number, url = "") => url || `https://github.com/${state.repo.ghrepo}/issues/${number}`;
  return (
    <div className="page-content">
      <section className={`queue-action-hero ${primaryManual ? "" : "queue-action-hero--clear"}`}>
        {primaryManual ? <>
          <div className="queue-action-copy">
            <span className="queue-eyebrow">{frontActor(primaryManual).label} now · {primaryManual.downstreamCount} downstream</span>
            <h2>#{primaryManual.number} {primaryManual.title}</h2>
            <p>Resolve this item first. It unlocks {primaryManual.immediateUnlocks.map((issue) => `#${issue.number}`).join(", ") || "the next path"}.</p>
          </div>
          <div className="queue-action-buttons">
            <a className="button button--primary" href={issueUrl(primaryManual.number, primaryManual.url)} target="_blank" rel="noreferrer">Open issue <ExternalLink size={15} /></a>
            <button className="button" onClick={() => onSelectFront(primaryManual.number)}>Show impact</button>
          </div>
        </> : <>
          <div className="queue-action-copy"><span className="queue-eyebrow">No manual action now</span><h2>The Loop can continue without your input</h2><p>Automatic work is ready or all current paths are waiting.</p></div>
          <Check size={24} />
        </>}
      </section>
      <div className="queue-action-grid">
        <section className="queue-action-panel queue-action-panel--loop">
          <header><div><h2>The Loop is handling</h2><p>No manual action is required.</p></div><Bot size={19} /></header>
          <div className="queue-action-list">
            {automatic.map((front) => <button key={front.number} className={selectedFront?.number === front.number ? "selected" : ""} onClick={() => onSelectFront(front.number)}><b>#{front.number}</b><span><strong>{front.title}</strong><small>Next automatic task · {front.downstreamCount} downstream · {automaticState}</small></span><em>{implementLoop?.timerLoaded ? "Scheduled" : "Ready"}</em></button>)}
            {contextTickets.map((ticket) => <button key={ticket.id} onClick={() => onSelect(ticket.id)}><b>#{ticket.id}</b><span><strong>{ticket.title || "Parent issue context"}</strong><small>Parent context · closes after its sub-issues</small></span><em>Context</em></button>)}
            {!automatic.length && !contextTickets.length && <p className="queue-panel-empty">No automatic or parent-context work is visible.</p>}
          </div>
          {automatic.length > 0 && <button className="button queue-run-button" disabled={busy} onClick={() => runAction("advance", "implement", `Run #${automatic[0].number} now`)}>Run next task now</button>}
        </section>
        <section className="queue-action-panel">
          <header><div><h2>Plan for later</h2><p>Important, but not the first action.</p></div><Clock3 size={19} /></header>
          <div className="queue-action-list">
            {later.map((front) => <button key={front.number} className={selectedFront?.number === front.number ? "selected" : ""} onClick={() => onSelectFront(front.number)}><b>#{front.number}</b><span><strong>{front.title}</strong><small>{frontActor(front).label} · {front.immediateUnlocks.length ? `unlocks ${front.immediateUnlocks.map((issue) => `#${issue.number}`).join(", ")}` : "no immediate unlock"}</small></span><em>Later</em></button>)}
            {automaticFollowUps.map((issue) => <a key={`${issue.after}-${issue.number}`} href={issueUrl(issue.number, issue.url)} target="_blank" rel="noreferrer"><b>#{issue.number}</b><span><strong>{issue.title}</strong><small>Starts after #{issue.after}</small></span><em>Waiting</em></a>)}
            {!later.length && !automaticFollowUps.length && <p className="queue-panel-empty">No later owner action is visible.</p>}
          </div>
        </section>
      </div>
      {state.summary.incomplete > 0 && <p className="queue-maintenance-note"><AlertTriangle size={14} />Workspace warnings are separate from issue blockers. Review them from Workspace status.</p>}
      <details className="queue-disclosure plain-section">
        <summary><span><strong>Full worker queue</strong><small>{issues.length} issues ordered by GitHub dependencies</small></span><ChevronDown size={17} /></summary>
        <div className="table-list">
          {issues.map((issue) => (
            <a key={issue.number} className="table-row" href={`https://github.com/${state.repo.ghrepo}/issues/${issue.number}`} target="_blank" rel="noreferrer">
              <b>#{issue.number}</b><strong>{issue.title}</strong><span>{issue.eligible ? "Ready" : issue.reason}</span><ExternalLink size={15} />
            </a>
          ))}
          {!issues.length && <Empty title="The issue queue is empty" />}
        </div>
      </details>
      <details className="queue-disclosure plain-section">
        <summary><span><strong>Tracked work</strong><small>{(state.tickets || []).length} work items</small></span><ChevronDown size={17} /></summary>
        <div className="table-list">
          {(state.tickets || []).map((ticket) => (
            <button key={ticket.id} className="table-row" onClick={() => onSelect(ticket.id)}>
              <b>#{ticket.id}</b><strong>{ticket.title}</strong><Status state={workflowState(ticket)} /><span>{formatAge(ticket.lastActivity)}</span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

function DecisionsPage({ state, mutate, busy }) {
  const cards = state.cards || [];
  if (!cards.length) return <div className="page-content"><Empty title="No decisions are waiting" detail="The decision desk is clear." /></div>;
  return <div className="page-content decision-list">{cards.map((card) => <DecisionCard key={card.name} card={card} mutate={mutate} busy={busy} />)}</div>;
}

function DecisionCard({ card, mutate, busy }) {
  const options = [...card.text.matchAll(/^## Option ([A-Z]) — (.+)$/gm)].map((match) => ({ id: match[1], label: match[2] }));
  const context = card.text.match(/## Context\s+([\s\S]*?)(?=\n## )/)?.[1]?.trim();
  const [option, setOption] = useState("");
  const [note, setNote] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (await mutate("/api/decide", { card: card.name, option, note })) setOption("");
  };
  return (
    <article className="decision-item">
      <div className="eyebrow"><span>{card.status === "open" ? "Decision needed" : "Recorded decision"}</span></div>
      <h2>{card.title}</h2>
      {context && <p className="decision-context">{context.replace(/\n+/g, " ")}</p>}
      {card.status === "open" ? (
        <form onSubmit={submit}>
          <fieldset>
            {options.map((item) => <label key={item.id} className={option === item.id ? "selected" : ""}><input type="radio" name={`decision-${card.name}`} value={item.id} checked={option === item.id} onChange={() => setOption(item.id)} /><b>{item.id}</b><span>{item.label}</span></label>)}
          </fieldset>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note (optional)" maxLength={2000} />
          <button className="button button--primary" disabled={!option || busy}>Record decision</button>
        </form>
      ) : <details className="technical-details"><summary>Read the decision record <ChevronDown size={16} /></summary><pre>{card.text}</pre></details>}
    </article>
  );
}

function RunsPage({ state, onLog }) {
  const [filter, setFilter] = useState("all");
  const sessions = (state.sessions || []).filter((session) => filter === "all" || session.status === filter);
  return (
    <div className="page-content">
      <div className="toolbar">
        <div className="segmented"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button><button className={filter === "running" ? "active" : ""} onClick={() => setFilter("running")}>Running</button><button className={filter === "incomplete" ? "active" : ""} onClick={() => setFilter("incomplete")}>Incomplete</button></div>
        <span>{sessions.length} runs</span>
      </div>
      <div className="runs-list">
        {sessions.slice(0, 60).map((session) => (
          <details key={session.id} className="run-row">
            <summary><span className={`run-dot run-dot--${session.verdict === "PASS" ? "pass" : session.status === "running" ? "running" : session.exitCode === 0 ? "neutral" : "fail"}`} /><div><strong>{sessionLabel(session)}</strong><small>{session.role} · {formatAge(session.lastActivity)}</small></div><b>{session.verdict || session.status}</b><ChevronDown size={16} /></summary>
            <div><dl className="facts"><div><dt>Duration</dt><dd>{formatDuration(session.durationSeconds)}</dd></div><div><dt>Route</dt><dd>{session.route}</dd></div><div><dt>Session</dt><dd><code>{session.id}</code></dd></div></dl><pre>{session.assuranceReport || session.result || "No result was written."}</pre>{session.log && <button className="text-button" onClick={() => onLog(session.log)}>Open execution log</button>}</div>
          </details>
        ))}
      </div>
    </div>
  );
}

function AutomationsPage({ state, runAction, mutate, busy, onSchedule }) {
  const [catalog, setCatalog] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [capacity, setCapacity] = useState(state.routing?.rules?.max_concurrent_sessions || 1);
  const [loadingModels, setLoadingModels] = useState(false);

  const loadModels = useCallback(async (refresh = false) => {
    setLoadingModels(true);
    try {
      const next = await api.models(refresh);
      setCatalog(next);
      setRoutes(sanitizeRouteVariants(next.routes || [], next));
    } catch {
      setCatalog(null);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const updateRoute = (id, field, value) => setRoutes((current) => current.map((route) => route.id === id ? { ...route, [field]: value } : route));

  const handleModelChange = async (id, newModel) => {
    const knownVariants = catalog?.variantsByModel?.[newModel];
    if (Array.isArray(knownVariants) && knownVariants.length > 0) {
      setRoutes((current) => current.map((route) => {
        if (route.id !== id) return route;
        return {
          ...route,
          model: newModel,
          variant: pickCompatibleVariant(knownVariants, route.variant)
        };
      }));
      return;
    }

    setRoutes((current) => current.map((route) => route.id === id ? { ...route, model: newModel } : route));

    try {
      const data = await api.variants(newModel);
      if (Array.isArray(data?.variants) && data.variants.length > 0) {
        setCatalog((prev) => prev ? {
          ...prev,
          variantsByModel: {
            ...prev.variantsByModel,
            [newModel]: data.variants
          }
        } : prev);
        setRoutes((current) => current.map((route) => {
          if (route.id !== id || route.model !== newModel) return route;
          return {
            ...route,
            variant: pickCompatibleVariant(data.variants, route.variant)
          };
        }));
      }
    } catch {
      // Keep existing variant if lookup fails
    }
  };

  const saveRoutes = () => {
    const sanitized = sanitizeRouteVariants(routes, catalog);
    setRoutes(sanitized);
    mutate("/api/routing", { updates: sanitized, acknowledged: true }, "Model routes saved");
  };
  const saveCapacity = () => mutate("/api/dispatch-policy", { maxStarts: Number(capacity), acknowledged: true }, "Capacity saved");

  return (
    <div className="page-content">
      <section className="plain-section">
        <header><div><h2>Workflow schedules</h2><p>Run a workflow now or change when it runs.</p></div></header>
        <div className="automation-list">
          {(state.loops || []).map((loop) => (
            <article key={loop.id} className="automation-row">
              <div className={`automation-icon ${loop.timerLoaded ? "on" : ""}`}>{loop.timerLoaded ? <Play size={16} /> : <Pause size={16} />}</div>
              <div className="automation-copy"><strong>{loop.id.replaceAll("-", " ")}</strong><p>{loop.goal}</p><small>{loop.timerLoaded ? `Scheduled · ${loop.cadence}` : loop.timerConfigured ? "Schedule is off" : "Runs on demand"}</small></div>
              <div className="automation-actions"><button onClick={() => runAction("run", loop.id, "Run now")} disabled={busy || !loop.triggerable}>Run now</button>{loop.timerConfigured && <button onClick={() => onSchedule(loop)}>Schedule</button>}{loop.timerConfigured && <button onClick={() => mutate("/api/timer", { loop: loop.id, timerAction: loop.timerLoaded ? "disarm" : "arm" })}>{loop.timerLoaded ? "Turn off" : "Turn on"}</button>}<button onClick={() => runAction("toggle", loop.id, loop.status === "active" ? "Pause workflow" : "Resume workflow")}>{loop.status === "active" ? "Pause" : "Resume"}</button></div>
            </article>
          ))}
        </div>
      </section>

      <section className="plain-section settings-block">
        <header><div><h2>Concurrent model sessions</h2><p>Limit how many paid sessions can run at one time.</p></div></header>
        <div className="inline-setting"><input type="number" min="1" max="8" value={capacity} onChange={(event) => setCapacity(event.target.value)} /><button className="button" disabled={busy} onClick={saveCapacity}>Save limit</button></div>
      </section>

      <section className="plain-section settings-block">
        <header><div><h2>Model routes</h2><p>Changes apply to new work only.</p></div><button className="text-button" onClick={() => loadModels(true)}><RefreshCcw size={14} />Refresh</button></header>
        {loadingModels && <Spinner label="Reading installed models" />}
        {!loadingModels && !catalog && <Empty title="Model routes are unavailable" detail="Refresh to try again." />}
        {catalog && <div className="route-list">{routes.map((route) => {
          const modelVariants = catalog.variantsByModel?.[route.model];
          const variants = (Array.isArray(modelVariants) && modelVariants.length > 0)
            ? modelVariants
            : ((Array.isArray(catalog.variants) && catalog.variants.length > 0) ? catalog.variants : [route.variant]);
          const selectedVariant = variants.includes(route.variant) ? route.variant : variants[0];
          return <div className="route-row" key={route.id}><div><strong>{route.name.replaceAll("-", " ")}</strong><small>{route.id}</small></div><label><span>Model</span><select value={route.model} onChange={(event) => handleModelChange(route.id, event.target.value)}>{catalog.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><label><span>Effort</span><select value={selectedVariant} onChange={(event) => updateRoute(route.id, "variant", event.target.value)}>{variants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}</select></label></div>;
        })}<button className="button button--primary save-routes" disabled={busy} onClick={saveRoutes}>Save model routes</button></div>}
      </section>
    </div>
  );
}

function DetailsColumn({ state, ticket, page, front, onClose, onLog }) {
  const [tab, setTab] = useState("details");
  const workContext = page === "work" && ticket;
  const relatedSession = workContext ? (state.currentSessions || []).find((session) => session.ticket === ticket.id) || (state.sessions || []).find((session) => session.ticket === ticket.id) : null;
  const shownActivity = workContext
    ? (state.activity || []).filter((item) => item.title?.includes(`#${ticket.id}`) || item.session?.startsWith(`${ticket.id}-`)).slice(0, 10)
    : [];
  const sectionTitle = workContext ? `Issue #${ticket.id}` : page === "queue" && front ? `Issue #${front.number}` : PAGE_COPY[page][0];
  return (
    <aside className="details-column">
      <header className="details-header"><div><h2>{sectionTitle}</h2><p>{workContext ? "Selected work details" : page === "queue" && front ? "Selected queue item" : "Section details"}</p></div><IconButton label="Close details" onClick={onClose}><X size={19} /></IconButton></header>
      {workContext && <div className="details-tabs"><button className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>Details</button><button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Activity</button></div>}
      <div className="details-scroll">
        {workContext && tab === "details" && (
          <>
            <section className="side-section"><h3>Selected work</h3><dl className="side-facts"><div><dt>Status</dt><dd><Status state={workflowState(ticket)} /></dd></div><div><dt>Pull request</dt><dd>{ticket.pr ? <a href={ticket.pr} target="_blank" rel="noreferrer">#{ticket.prNumber}</a> : "None"}</dd></div><div><dt>Revision</dt><dd>{ticket.round}</dd></div><div><dt>Last update</dt><dd>{formatAge(ticket.lastActivity)}</dd></div></dl></section>
            {relatedSession && <section className="side-section"><h3>Latest run</h3><div className="session-summary"><Bot size={18} /><div><strong>{sessionLabel(relatedSession)}</strong><p>{relatedSession.status} · {formatDuration(relatedSession.durationSeconds)}</p></div></div>{relatedSession.log && <button className="text-button" onClick={() => onLog(relatedSession.log)}>View log</button>}<details className="technical-details"><summary>Technical details <ChevronDown size={14} /></summary><code>{relatedSession.id}</code><p>{relatedSession.route}</p></details></section>}
            <section className="side-section"><h3>Related state</h3><dl className="side-facts"><div><dt>Merge state</dt><dd>{ticket.mergeStateStatus || "Unknown"}</dd></div><div><dt>Repairs</dt><dd>{ticket.repair || 0} of {ticket.repairLimit || 0}</dd></div><div><dt>Assurance</dt><dd>{ticket.assurance?.passed || 0} of {ticket.assurance?.total || 0}</dd></div></dl></section>
          </>
        )}
        {workContext && tab === "activity" && <section className="side-section activity-section">{shownActivity.map((item, index) => <button key={`${item.at}-${index}`} className="activity-row" onClick={() => item.session && onLog(`${item.session}.jsonl`)}><span><Clock3 size={14} /></span><div><strong>{item.title}</strong><p>{item.type} · {formatAge(item.at)}</p></div>{item.outcome && <b>{item.outcome}</b>}</button>)}{!shownActivity.length && <p className="side-empty">No activity is linked to this issue.</p>}</section>}
        {!workContext && <SectionContext state={state} page={page} front={front} />}
      </div>
    </aside>
  );
}

function SectionContext({ state, page, front }) {
  if (page === "queue" && front) { const actor = frontActor(front); return <>
    <section className="side-section"><span className={`front-type front-type--${front.key}`}>{actor.label}</span><h3 className="front-side-title">Why this item matters</h3><p className="context-copy">{front.priority}. It affects {front.downstreamCount} queued worker issue{front.downstreamCount === 1 ? "" : "s"}.</p><dl className="side-facts"><div><dt>Who acts</dt><dd>{actor.label}</dd></div><div><dt>First unlocks</dt><dd>{front.immediateUnlocks.length || "None yet"}</dd></div><div><dt>Total affected</dt><dd>{front.totalAffected}</dd></div></dl><a className="text-button" href={front.url} target="_blank" rel="noreferrer">Open GitHub issue <ExternalLink size={13} /></a></section>
    {front.immediateUnlocks.length > 0 && <section className="side-section"><h3>Immediately unlocks</h3><div className="side-issue-list">{front.immediateUnlocks.map((issue) => <a key={issue.number} href={issue.url} target="_blank" rel="noreferrer"><b>#{issue.number}</b><span>{issue.title}</span></a>)}</div></section>}
    {front.stalledAt && <section className="side-section"><h3>Converges with another front</h3><p className="context-copy"><b>#{front.stalledAt.number}</b> {front.stalledAt.title}</p><div className="remaining-blockers">Still needs {front.stalledAt.remainingBlockers.map((blocker) => <a key={blocker.number} href={blocker.url} target="_blank" rel="noreferrer">#{blocker.number}</a>)}</div></section>}
  </>; }
  if (page === "queue") return <section className="side-section"><h3>Queue summary</h3><dl className="side-facts"><div><dt>Ready</dt><dd>{state.frontier?.eligible || 0}</dd></div><div><dt>Waiting</dt><dd>{state.frontier?.deferred || 0}</dd></div><div><dt>Root fronts</dt><dd>{state.frontier?.fronts?.length || 0}</dd></div></dl></section>;
  if (page === "decisions") return <section className="side-section"><h3>Decision desk</h3><p className="context-copy">Record only choices that require owner judgment. Operational failures belong in workspace status.</p><dl className="side-facts"><div><dt>Open</dt><dd>{state.summary.openDecisionCards || 0}</dd></div><div><dt>Recorded</dt><dd>{(state.cards || []).filter((card) => card.status !== "open").length}</dd></div></dl></section>;
  if (page === "runs") return <section className="side-section"><h3>Run summary</h3><dl className="side-facts"><div><dt>Running</dt><dd>{state.summary.running || 0}</dd></div><div><dt>Results ready</dt><dd>{state.summary.awaitingHarvest || 0}</dd></div><div><dt>Incomplete</dt><dd>{state.summary.incomplete || 0}</dd></div></dl></section>;
  return <section className="side-section"><h3>Automation summary</h3><dl className="side-facts"><div><dt>Active workflows</dt><dd>{state.summary.enabled || 0}</dd></div><div><dt>Schedules on</dt><dd>{state.summary.armed || 0}</dd></div><div><dt>Capacity</dt><dd>{state.routing?.rules?.max_concurrent_sessions || 1}</dd></div></dl></section>;
}

function LogDialog({ name, onClose }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("steps");

  useEffect(() => {
    let alive = true;
    api.log(name).then((text) => {
      if (alive) setRaw(text);
    }).catch((requestError) => {
      if (alive) setError(requestError.message);
    });
    return () => { alive = false; };
  }, [name]);

  const steps = useMemo(() => raw ? parseJsonlLog(raw) : [], [raw]);
  return (
    <Modal title="Execution log" subtitle={name} onClose={onClose} wide>
      <div className="log-toolbar"><div className="segmented"><button className={mode === "steps" ? "active" : ""} onClick={() => setMode("steps")}>Steps</button><button className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}>Raw</button></div></div>
      {!raw && !error && <Spinner label="Loading log" />}
      {error && <div className="warning-box"><AlertTriangle size={17} /><p>{error}</p></div>}
      {raw && mode === "raw" && <pre className="raw-log">{raw}</pre>}
      {raw && mode === "steps" && <div className="log-steps">{steps.map((step) => <section key={step.index}><header><span>{step.index}</span><strong>Step {step.index}</strong><small>{step.tokens?.total ? `${step.tokens.total.toLocaleString()} tokens` : ""}</small></header>{step.tools.map((tool, index) => <details key={`${tool.tool}-${index}`}><summary>{tool.exitCode === 0 ? <Check size={14} /> : <Code2 size={14} />}<strong>{tool.title || tool.tool}</strong><small>{tool.exitCode == null ? tool.tool : `exit ${tool.exitCode}`}</small><ChevronDown size={14} /></summary>{tool.output && <pre>{tool.output}</pre>}</details>)}</section>)}{!steps.length && <Empty title="No structured steps were found" detail="Use the raw view to inspect this log." />}</div>}
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? "modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close" onClick={onClose}><X size={20} /></IconButton></header><div className="modal-body">{children}</div>{footer && <footer>{footer}</footer>}</section></div>;
}

function ConfirmDialog({ value, busy, onClose }) {
  const submit = async () => { if (await value.run()) onClose(); };
  return <Modal title={value.title} subtitle={value.detail} onClose={onClose} footer={<><button className="button" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy} onClick={submit}>{value.button}</button></>}><p className="confirm-copy">Check the selected workflow before you continue.</p></Modal>;
}

function AuditDialog({ ticket, busy, mutate, onClose }) {
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const submit = async () => { if (await mutate("/api/merged-audit", { ticket: ticket.id, note, acknowledged: ack })) onClose(); };
  return <Modal title="Record audit resolution" subtitle={`Issue #${ticket.id} · PR #${ticket.prNumber}`} onClose={onClose} footer={<><button className="button" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy || note.trim().length < 12 || !ack} onClick={submit}>Record resolution</button></>}><div className="warning-box"><AlertTriangle size={18} /><p>This records an accepted exception. It does not change the original assurance result.</p></div><label className="field"><span>Evidence reviewed and reason for acceptance</span><textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={12} maxLength={4000} /></label><label className="check-field"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I reviewed the merged pull request and accept this exception.</span></label></Modal>;
}

function ParkedDialog({ ticket, busy, mutate, onClose }) {
  const [disposition, setDisposition] = useState(ticket.retryableRuntimeFailure ? "retry" : "");
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const presentation = parkedResolutionPresentation(disposition);
  const options = [
    ["retry", "Retry automation", "Use the same revision and current reviewer route."],
    ["resume", "Resume automated review", "Use the current pull request revision and continue."],
    ["manual", "Take over manually", "Close the automated workflow and keep owner responsibility."]
  ];
  const valid = disposition && (presentation.evidenceHidden || (note.trim().length >= 12 && ack));
  const submit = async () => { if (await mutate("/api/parked-resolution", { ticket: ticket.id, disposition, note, acknowledged: ack })) onClose(); };
  return <Modal title="Choose the next step" subtitle={`Issue #${ticket.id}`} onClose={onClose} footer={<><button className="button" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy || !valid} onClick={submit}>{presentation.submitLabel}</button></>}><div className="choice-list">{options.map(([id, label, detail]) => <label key={id} className={disposition === id ? "selected" : ""}><input type="radio" name="disposition" value={id} checked={disposition === id} onChange={() => setDisposition(id)} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div>{!presentation.evidenceHidden && <><label className="field"><span>Decision note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={12} maxLength={4000} /></label><label className="check-field"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I reviewed the reason and accept this decision.</span></label></>}</Modal>;
}

function ScheduleDialog({ target, busy, mutate, onClose }) {
  const daily = target.schedule?.kind === "daily";
  const [value, setValue] = useState(daily ? (target.schedule?.times || []).join(", ") : target.schedule?.minutes || 10);
  const [ack, setAck] = useState(false);
  const submit = async () => {
    const schedule = daily ? { kind: "daily", times: String(value).split(",").map((time) => time.trim()).filter(Boolean) } : { kind: "interval", minutes: Number(value) };
    if (await mutate("/api/schedule", { loop: target.id, schedule, acknowledged: ack })) onClose();
  };
  return <Modal title="Change schedule" subtitle={target.id.replaceAll("-", " ")} onClose={onClose} footer={<><button className="button" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy || !ack || !value} onClick={submit}>Save schedule</button></>}><label className="field"><span>{daily ? "Daily times" : "Run every (minutes)"}</span><input type={daily ? "text" : "number"} min="1" max="10080" value={value} onChange={(event) => setValue(event.target.value)} /></label><label className="check-field"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I reviewed this schedule. Restart it with the new timing if it is active.</span></label></Modal>;
}

export default App;
