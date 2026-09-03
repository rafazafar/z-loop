export const LOOP_NAMES = {
  "spec-sync": "Write Specs",
  "ticket-factory": "Plan Tickets",
  "decision-desk": "Queue Decisions",
  implement: "Build & Verify",
  gardener: "Propose Issues"
};

export const ROLE_NAMES = {
  implementer: "Code Implementer",
  repairer: "Repair Implementer",
  reviewer: "Independent Reviewer",
  ticketer: "Ticket Planner",
  distiller: "Specification Writer",
  gardener: "Improvement Analyst",
  "decision-desk": "Decision Queue Builder"
};

export function loopTitle(id) {
  return LOOP_NAMES[id] || id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

export function sessionLabel(session) {
  if (session.kind === "implementation") {
    return session.phase === "repair"
      ? `Issue #${session.ticket} · Repair ${session.repair}`
      : `Issue #${session.ticket} · Initial build`;
  }
  if (session.kind === "review") {
    return `Issue #${session.ticket} · Unified assurance · revision ${session.round}${session.runtimeRetry ? ` · runtime retry ${session.runtimeRetry}` : ""}`;
  }
  if (session.id.startsWith(`loop-${session.loop}-`)) return `${loopTitle(session.loop)} · ${ROLE_NAMES[session.role] || "Model session"}`;
  return session.id;
}

export function isResolvedTicket(ticket) {
  return ["merged", "merged-audited", "manual-takeover"].includes(ticket?.status);
}

export function systemMode(state) {
  if (state?.circuitBreaker?.active) {
    const mins = Math.floor(state.circuitBreaker.remainingSeconds / 60);
    const secs = state.circuitBreaker.remainingSeconds % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    return { key: "attention", label: "COOLDOWN", detail: `${state.circuitBreaker.model || "Provider"} rate-limited (429) · auto-resumes in ${timeStr}` };
  }
  if (!state?.frontier?.available) return { key: "degraded", label: "DEGRADED", detail: "The GitHub issue queue is unavailable" };
  if (state.summary.degraded > 0) return { key: "degraded", label: "DEGRADED", detail: `${state.summary.degraded} workflow${state.summary.degraded === 1 ? "" : "s"} did not complete its last run` };
  if (state.summary.running > 0) return { key: "running", label: "RUNNING", detail: `${state.summary.running} model session${state.summary.running === 1 ? "" : "s"} active` };
  if (state.summary.awaitingHarvest > 0 || state.summary.incomplete > 0 || state.summary.humanActions > 0 || state.summary.openDecisionCards > 0) {
    return { key: "attention", label: "NEEDS ACTION", detail: "Completed work or an owner decision is waiting" };
  }
  if (state.summary.paidReady > 0) return { key: "ready", label: "READY", detail: `${state.summary.paidReady} paid step${state.summary.paidReady === 1 ? "" : "s"} awaiting dispatch` };
  if (state.summary.armed === 0 && state.summary.enabled > 0) return { key: "manual", label: "MANUAL", detail: "Enabled workflows run only when started manually" };
  return { key: "idle", label: "IDLE", detail: "No model session or owner action is pending" };
}

export function recommendedAction(state) {
  if (state?.circuitBreaker?.active) {
    const mins = Math.floor(state.circuitBreaker.remainingSeconds / 60);
    const secs = state.circuitBreaker.remainingSeconds % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    return {
      title: `Rate limit cooldown active on ${state.circuitBreaker.model || "provider"}`,
      detail: `Model dispatches paused for ${timeStr}. Switch model in Control Center or wait for quota reset.`,
      label: "Switch model in Control Center",
      view: "control-center",
      tone: "warn"
    };
  }
  if (state.summary.awaitingHarvest > 0) {
    return {
      title: `Collect ${state.summary.awaitingHarvest} completed result${state.summary.awaitingHarvest === 1 ? "" : "s"}`,
      detail: "Update durable state without starting a model session.",
      label: "Collect results",
      action: "collect",
      loop: "implement",
      tone: "primary"
    };
  }
  if (state.summary.running > 0) {
    return { title: "Model sessions are active", detail: "Watch the current stages. The console updates when state changes.", label: "View current work", view: "now", tone: "neutral" };
  }
  if (state.summary.humanActions > 0 || state.summary.openDecisionCards > 0) {
    const view = state.summary.openDecisionCards > 0 ? "decisions" : "tickets";
    return { title: "Owner input is required", detail: "Resolve the first attention item before more work advances.", label: view === "decisions" ? "Open decisions" : "Open ticket actions", view, tone: "warning" };
  }
  if (state.summary.paidReady > 0) {
    return { title: `${state.summary.paidReady} paid step${state.summary.paidReady === 1 ? " is" : "s are"} ready`, detail: "Start at most one model session for tracked work.", label: "Advance current work", action: "run", loop: "implement", tone: "primary" };
  }
  if (state.frontier.eligible > 0) {
    return { title: `${state.frontier.eligible} issue${state.frontier.eligible === 1 ? " is" : "s are"} ready`, detail: "Update current work, then start at most one issue.", label: "Start next issue", action: "advance", loop: "implement", tone: "primary" };
  }
  return { title: "No issue is ready to start", detail: `${state.frontier.deferred} issue${state.frontier.deferred === 1 ? " is" : "s are"} waiting on state or dependencies.`, label: "View issue queue", view: "tickets", tone: "neutral" };
}

function profileLabel(name) {
  return name === "assurance" ? "Unified assurance review" : "Unknown review";
}

export function ticketStages(ticket) {
  const stages = [];
  const add = (label, state, detail = "") => stages.push({ label, state, detail });
  const session = ticket.session;

  if (ticket.status === "container") {
    add("Parent context", "current", ticket.reason || "Implementation is delegated to sub-issues");
    add("Sub-issues complete", "future");
    add("Parent closure", "future");
    return stages;
  }

  if (ticket.status === "deferred") {
    add("Implementation", "blocked", ticket.reason || "GitHub eligibility conditions are not satisfied");
    add("Automatic recheck", "current");
    return stages;
  }

  if (ticket.status === "merged") {
    add("Implementation", "done");
    add("Unified assurance", "done", "PASS");
    add("Owner merge", "done", ticket.mergedAt || "Merged");
    return stages;
  }

  if (ticket.status === "merged-unverified") {
    add("Implementation", "done");
    add("PR merged", "done");
    add("Assurance skipped", "blocked", ticket.reason || "Required profiles did not finish before merge");
    add("Owner audit", "future");
    add("Evidence record", "future");
    return stages;
  }

  if (ticket.status === "merged-audited") {
    add("Implementation", "done");
    add("PR merged", "done");
    add("Assurance exception", "blocked", ticket.postMergeAudit?.original_exception || ticket.reason);
    add("Owner audit", "done");
    add("Evidence record", "done", ticket.postMergeAudit?.recorded_at || "Recorded");
    return stages;
  }

  if (ticket.status === "manual-takeover") {
    add("Implementation", "done");
    add("Automation parked", "done", ticket.manualIntervention?.parked_reason || ticket.reason);
    add("Owner takeover", "done", ticket.manualIntervention?.recorded_at || "Recorded");
    add("Owner validation", "current");
    add("Owner merge", "future");
    return stages;
  }

  add(ticket.pr ? "PR opened" : "Implementation", ticket.pr ? "done" : session?.status === "running" ? "running" : "current");

  if (ticket.operationalFailure?.status === "needs-retry") {
    add("Automation runtime", "blocked", ticket.operationalFailure.reason || "Worker stopped before it completed");
    add("Clean retry", "current");
    if (ticket.pr) add("Owner merge", "future");
    return stages;
  }

  if (session?.status === "running" && session.kind === "implementation") {
    add(ticket.action === "fix" ? "Fix running" : "Implementation running", "running", session.id);
  }

  const harvestedProfile = session?.status === "awaiting harvest" && session.kind === "review" ? session.profile : "";
  if (session?.status === "awaiting harvest" && session.kind === "implementation") {
    add(ticket.action === "fix" ? "Fix complete" : "Implementation complete", "done", session.exitCode === null ? "" : `exit ${session.exitCode}`);
    add("Collect result", "current", "The result is ready, but the ticket has not been updated");
  }

  let harvestAdded = session?.status === "awaiting harvest" && session.kind === "implementation";
  for (const profile of ticket.assurance.profiles) {
    if (profile.name === harvestedProfile) {
      add(`${profileLabel(profile.name)} · ${session.verdict || "complete"}`, session.verdict === "BLOCK" ? "blocked" : "done", session.id);
      add("Collect result", "current", "The result is ready, but the ticket has not been updated");
      harvestAdded = true;
      continue;
    }
    if (profile.status === "passed") add(`${profileLabel(profile.name)} · PASS`, "done");
    else if (profile.status === "current" && session?.status === "running" && session.kind === "review") add(`${profileLabel(profile.name)} running`, "running", session.id);
    else if (profile.status === "current") add(profileLabel(profile.name), session?.status === "awaiting harvest" ? "future" : "current");
    else add(profileLabel(profile.name), "future");
  }

  if (session?.status === "awaiting harvest" && !harvestAdded) add("Collect result", "current", "The result is ready, but the ticket has not been updated");
  if (ticket.status === "done") add("Owner merge", "current");
  else add("Owner merge", "future");
  return stages;
}

export function ticketDisplayStatus(ticket) {
  if (ticket.session?.status === "running") return { key: "running", label: "RUNNING" };
  if (ticket.session?.status === "awaiting harvest") return { key: "attention", label: "RESULT READY" };
  if (ticket.status === "container") return { key: "active", label: "PARENT CONTEXT" };
  if (ticket.status === "deferred") return { key: "blocked", label: "WAITING ON GITHUB" };
  if (ticket.status === "merged") return { key: "resolved", label: "MERGED" };
  if (ticket.status === "merged-unverified") return { key: "blocked", label: "OWNER AUDIT" };
  if (ticket.status === "merged-audited") return { key: "resolved", label: "EXCEPTION RECORDED" };
  if (ticket.status === "manual-takeover") return { key: "resolved", label: "OWNER-MANAGED" };
  if (ticket.operationalFailure?.status === "needs-retry") return { key: "attention", label: "RUNTIME FAILURE" };
  if (["parked", "blocked-decision"].includes(ticket.status)) return { key: "blocked", label: "NEEDS DECISION" };
  if (ticket.status === "done") return { key: "ready", label: "READY FOR MERGE" };
  return { key: "active", label: ticket.status.replaceAll("-", " ").toUpperCase() };
}

export function parseJsonlLog(rawText) {
  if (!rawText || typeof rawText !== "string") return [];
  const lines = rawText.split("\n").filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  const steps = [];
  let currentStep = { index: 1, tools: [], tokens: null, timestamp: null, finishReason: null };
  for (const event of events) {
    if (event.type === "step_start") {
      if (currentStep.tools.length > 0 || currentStep.tokens) {
        steps.push(currentStep);
        currentStep = { index: steps.length + 1, tools: [], tokens: null, timestamp: event.timestamp || null, finishReason: null };
      } else if (event.timestamp) {
        currentStep.timestamp = event.timestamp;
      }
    } else if (event.type === "tool_use") {
      const p = event.part || {};
      const tool = p.tool || "tool";
      const st = p.state || {};
      const input = st.input || {};
      const metadata = st.metadata || {};
      let title = st.title || "";
      let detail = "";
      if (tool === "bash") {
        detail = input.command || "";
        title = title || detail;
      } else if (tool === "read") {
        detail = input.path || input.AbsolutePath || "";
        title = title || detail;
      } else if (tool === "edit" || tool === "replace_file_content") {
        detail = input.path || input.TargetFile || "";
        title = title || detail;
      } else if (tool === "write" || tool === "write_to_file") {
        detail = input.path || input.TargetFile || "";
        title = title || detail;
      } else if (tool === "grep" || tool === "grep_search") {
        detail = input.pattern || input.Query || "";
        title = title || `${detail} ${input.path ? `in ${input.path}` : ""}`.trim();
      } else if (tool === "glob" || tool === "find_by_name") {
        detail = input.pattern || input.Pattern || "";
        title = title || detail;
      } else if (tool === "todowrite") {
        title = `${(input.todos || []).length} todos`;
      }
      currentStep.tools.push({
        tool,
        title: title || tool,
        detail,
        input,
        output: st.output || "",
        exitCode: metadata.exit ?? null,
        matches: metadata.matches ?? metadata.count ?? null,
        status: st.status || "completed",
        time: st.time || null
      });
    } else if (event.type === "step_finish") {
      const p = event.part || {};
      if (p.tokens) {
        currentStep.tokens = p.tokens;
      }
      if (p.reason) {
        currentStep.finishReason = p.reason;
      }
    }
  }
  if (currentStep.tools.length > 0 || currentStep.tokens) {
    steps.push(currentStep);
  }
  return steps;
}
