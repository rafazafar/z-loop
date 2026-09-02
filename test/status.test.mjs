import test from "node:test";
import assert from "node:assert/strict";
import { annotateReviewRuns, classifyFrontierIssue, sessionIdentity, ticketNextAction } from "../web/status.mjs";

const baseIssue = {
  number: 90,
  title: "Runnable work",
  createdAt: "2026-08-31T00:00:00Z",
  body: "",
  labels: [],
  blockedBy: { nodes: [] },
  subIssues: { totalCount: 0, nodes: [] }
};

test("frontier count excludes a labeled issue with an open native blocker", () => {
  const issue = { ...baseIssue, blockedBy: { nodes: [{ state: "OPEN" }] } };
  assert.equal(classifyFrontierIssue(issue, new Set(), new Set(), "integration").eligible, false);
  assert.equal(classifyFrontierIssue(issue, new Set(), new Set(), "integration").reason, "1 open blocker(s)");
});

test("frontier count excludes work that the loop already tracks", () => {
  const result = classifyFrontierIssue(baseIssue, new Set(), new Set([90]), "integration");
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "already tracked");
});

test("an unblocked leaf issue is eligible", () => {
  assert.equal(classifyFrontierIssue(baseIssue, new Set(), new Set(), "integration").eligible, true);
});

test("a completed result takes priority in the next action", () => {
  const action = ticketNextAction({ status: "review" }, { id: "46-rev-assurance-r3", status: "awaiting harvest" });
  assert.equal(action, "Collect results · no model session");
});

test("session identity separates repair count from implementation session number", () => {
  assert.deepEqual(sessionIdentity("36-impl-a1"), { ticket: 36, attempt: 1, kind: "implementation", phase: "build", repair: 0 });
  assert.deepEqual(sessionIdentity("36-impl-a3"), { ticket: 36, attempt: 3, kind: "implementation", phase: "repair", repair: 2 });
  assert.deepEqual(sessionIdentity("36-impl-a3-retry1"), { ticket: 36, attempt: 3, kind: "implementation", phase: "repair", repair: 2, runtimeRetry: 1 });
});

test("unified review runs count independently from PR revision history", () => {
  const sessions = annotateReviewRuns([
    { id: "36-rev-assurance-r1", ticket: 36, profile: "assurance", round: 1, kind: "review" },
    { id: "36-rev-assurance-r3", ticket: 36, profile: "assurance", round: 3, kind: "review" }
  ]);
  assert.equal(sessions.find((session) => session.id === "36-rev-assurance-r3").profileRun, 2);
  assert.deepEqual(sessionIdentity("36-rev-assurance-r3"), { ticket: 36, profile: "assurance", round: 3, kind: "review" });
  assert.deepEqual(sessionIdentity("36-rev-assurance-r3-retry2"), { ticket: 36, profile: "assurance", round: 3, runtimeRetry: 2, kind: "review" });
});

test("a recorded post-merge audit needs no further action", () => {
  assert.equal(ticketNextAction({ status: "merged-audited" }), "No action: post-merge audit is recorded");
});

test("an assured merged PR needs no further action", () => {
  assert.equal(ticketNextAction({ status: "merged" }), "No action: PR merged after unified assurance passed");
});

test("an owner-managed PR needs no controller action", () => {
  assert.equal(ticketNextAction({ status: "manual-takeover" }), "No controller action: the PR is owner-managed");
});

test("a retryable reviewer runtime failure offers a same-head retry", () => {
  assert.equal(ticketNextAction({ status: "parked", retryableReviewFailure: true }), "Owner: retry the same assurance review");
});

test("an operational runtime failure asks for a retry, not a product decision", () => {
  assert.equal(ticketNextAction({ status: "in-progress", operationalFailure: { status: "needs-retry" } }), "Owner: start a clean retry from GitHub state");
  assert.equal(ticketNextAction({ status: "in-progress", operationalFailure: { status: "retry-ready" } }), "Clean retry is ready for the next controller heartbeat");
});

test("an incomplete session is explicitly restartable", () => {
  assert.equal(ticketNextAction({ status: "review" }, { id: "36-rev-assurance-r3", status: "incomplete" }), "Advance current work · restarts the missing session");
});
