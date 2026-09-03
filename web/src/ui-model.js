import { isResolvedTicket, ticketDisplayStatus } from "../view-model.mjs";

export const NAV_ITEMS = [
  { id: "work", label: "Work" },
  { id: "queue", label: "Issue queue" },
  { id: "decisions", label: "Decisions" },
  { id: "runs", label: "Run history" },
  { id: "automations", label: "Automations" }
];

export function workflowState(ticket) {
  const display = ticketDisplayStatus(ticket);
  if (isResolvedTicket(ticket)) return { label: "Complete", tone: "complete" };
  if (ticket.status === "done") return { label: "Ready to merge", tone: "success" };
  if (
    ticket.session?.status === "awaiting harvest" ||
    ticket.retryableRuntimeFailure ||
    ["parked", "blocked-decision", "merged-unverified"].includes(ticket.status)
  ) return { label: "Needs action", tone: "attention" };
  if (ticket.session?.status === "running" || ["in-progress", "review", "fix"].includes(ticket.status)) {
    return { label: "In progress", tone: "running" };
  }
  if (ticket.status === "ready") return { label: "Ready", tone: "ready" };
  return { label: display.label === "MERGED" ? "Complete" : "Waiting", tone: "waiting" };
}

export function ticketSubtitle(ticket) {
  if (ticket.session?.status === "awaiting harvest") return "Review finished · result not collected";
  if (ticket.retryableRuntimeFailure) return "Automation stopped · retry is available";
  if (ticket.status === "done") return "All checks passed";
  if (ticket.status === "merged-unverified") return "Merge needs an audit record";
  if (["parked", "blocked-decision"].includes(ticket.status)) return "A workflow decision is required";
  if (ticket.session?.status === "running") return "Automation is running";
  if (isResolvedTicket(ticket)) return ticketDisplayStatus(ticket).label.toLowerCase();
  return ticket.nextAction || ticket.reason || "Waiting for the next step";
}

export function parkedResolutionPresentation(disposition) {
  const retry = disposition === "retry";
  return {
    submitLabel: retry ? "Retry automation" : "Apply decision",
    evidenceHidden: retry
  };
}

export function pageFromHash(hash) {
  const raw = hash.replace(/^#/, "").split(/[/?]/)[0];
  const legacy = { now: "work", tickets: "queue", history: "runs", health: "automations" };
  const page = legacy[raw] || raw;
  return NAV_ITEMS.some((item) => item.id === page) ? page : "work";
}

export function isActiveTicket(ticket) {
  return !isResolvedTicket(ticket);
}
