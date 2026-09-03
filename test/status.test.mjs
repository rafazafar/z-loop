import test from "node:test";
import assert from "node:assert/strict";
import { annotateReviewRuns, buildParallelFronts, classifyFrontierIssue, sessionIdentity, ticketNextAction } from "../web/status.mjs";

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

test("parent context takes precedence over stale tracked state", () => {
  const issue = {
    ...baseIssue,
    subIssues: { totalCount: 1, nodes: [{ number: 91, state: "OPEN" }] }
  };
  const result = classifyFrontierIssue(issue, new Set(), new Set([90]), "loop-integration");
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "parent container");
});

test("an integration parent waits for all subissues", () => {
  const issue = {
    ...baseIssue,
    labels: [{ name: "loop-integration" }],
    subIssues: { totalCount: 1, nodes: [{ number: 91, state: "OPEN" }] }
  };
  const result = classifyFrontierIssue(issue, new Set(), new Set(), "loop-integration");
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "1 open subissue(s)");
});

test("an unblocked leaf issue is eligible", () => {
  assert.equal(classifyFrontierIssue(baseIssue, new Set(), new Set(), "integration").eligible, true);
});

test("parallel fronts keep independent root blockers visible", () => {
  const issue = (number, title, blockers = [], labels = []) => ({
    number,
    title,
    url: `https://example.test/issues/${number}`,
    createdAt: `2026-08-${String(number).padStart(2, "0")}T00:00:00Z`,
    body: "",
    labels: labels.map((name) => ({ name })),
    blockedBy: { nodes: blockers.map((blocker) => ({ number: blocker, state: "OPEN" })) },
    subIssues: { totalCount: 0, nodes: [] }
  });
  const allIssues = [
    issue(53, "Device lifecycle", [95], ["ready-for-worker"]),
    issue(56, "Display decisions", [], ["need-decision"]),
    issue(57, "One lane", [56], ["ready-for-worker"]),
    issue(58, "Gap states", [57], ["ready-for-worker"]),
    issue(59, "Four lanes", [53, 58], ["ready-for-worker"]),
    issue(62, "Display controls", [59], ["ready-for-worker"]),
    issue(78, "Qualification automation", [62, 96], ["ready-for-worker"]),
    issue(95, "Cloud service", [], ["deps", "need-decision"]),
    issue(96, "Document control", [], ["docs", "need-evidence", "need-decision"])
  ];
  const frontier = allIssues.filter((item) => item.labels.some((label) => label.name === "ready-for-worker"));
  const fronts = buildParallelFronts(allIssues, frontier);

  assert.deepEqual(fronts.map((front) => front.number).sort((a, b) => a - b), [56, 95, 96]);
  assert.deepEqual(fronts.find((front) => front.number === 56).immediateUnlocks.map((item) => item.number), [57]);
  assert.deepEqual(fronts.find((front) => front.number === 56).availableSequence.map((item) => item.number), [57, 58]);
  assert.equal(fronts.find((front) => front.number === 56).stalledAt.number, 59);
  assert.deepEqual(fronts.find((front) => front.number === 56).stalledAt.remainingBlockers.map((item) => item.number), [53]);
  assert.equal(fronts.find((front) => front.number === 96).stalledAt.number, 78);
  assert.deepEqual(fronts.find((front) => front.number === 96).stalledAt.remainingBlockers.map((item) => item.number), [62]);
});

test("a ready dependency issue is presented as automatic worker work", () => {
  const issue = (number, labels) => ({
    number,
    title: "Cloud API",
    url: `https://example.test/issues/${number}`,
    createdAt: "2026-09-03T00:00:00Z",
    body: "",
    labels: labels.map((name) => ({ name })),
    blockedBy: { nodes: [] },
    subIssues: { totalCount: 0, nodes: [] }
  });
  const readyDependency = issue(108, ["deps", "ready-for-worker"]);

  const [front] = buildParallelFronts([readyDependency], [readyDependency]);

  assert.equal(front.key, "worker");
  assert.equal(front.label, "Agent work");
});

test("an open external dependency stays a visible front even when no worker issue depends on it", () => {
  const issue = (number, labels, blockers = []) => ({
    number,
    title: `Issue ${number}`,
    url: `https://example.test/issues/${number}`,
    createdAt: "2026-09-03T00:00:00Z",
    body: "",
    labels: labels.map((name) => ({ name })),
    blockedBy: { nodes: blockers.map((blocker) => ({ number: blocker, state: "OPEN" })) },
    subIssues: { totalCount: 0, nodes: [] }
  });
  const environment = issue(109, ["deps"]);
  const worker = issue(47, ["ready-for-worker"]);

  const fronts = buildParallelFronts([environment, worker], [worker]);
  const external = fronts.find((front) => front.number === 109);

  assert.ok(external, "external dependency front exists");
  assert.equal(external.key, "external");
  assert.equal(external.label, "External dependency");
  assert.equal(external.downstreamCount, 0);
  assert.equal(fronts.find((front) => front.number === 47).key, "worker");
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

test("a conflicted PR asks for rebase and conflict resolution", () => {
  assert.equal(ticketNextAction({ status: "done", conflicted: true }), "PR has merge conflicts with main · rebase & conflict resolution required");
  assert.equal(ticketNextAction({ status: "review", conflicted: true }), "PR has merge conflicts with main · rebase & conflict resolution required");
});
