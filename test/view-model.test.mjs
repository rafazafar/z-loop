import test from "node:test";
import assert from "node:assert/strict";
import { isResolvedTicket, parseJsonlLog, recommendedAction, sessionLabel, systemMode, ticketDisplayStatus, ticketStages } from "../web/view-model.mjs";

function status(overrides = {}) {
  return {
    summary: { running: 0, awaitingHarvest: 0, humanActions: 0, openDecisionCards: 0, armed: 0, enabled: 3, degraded: 0, paidReady: 0, ...overrides.summary },
    frontier: { available: true, eligible: 0, deferred: 37, ...overrides.frontier }
  };
}

test("running model sessions define the overall system mode", () => {
  assert.deepEqual(systemMode(status({ summary: { running: 2 } })), {
    key: "running",
    label: "RUNNING",
    detail: "2 model sessions active"
  });
});

test("session labels distinguish unified reviews and repairs", () => {
  assert.equal(sessionLabel({ kind: "review", ticket: 36, profile: "assurance", round: 3, profileRun: 1 }), "Issue #36 · Unified assurance · revision 3");
  assert.equal(sessionLabel({ kind: "review", ticket: 36, profile: "assurance", round: 3, runtimeRetry: 2 }), "Issue #36 · Unified assurance · revision 3 · runtime retry 2");
  assert.equal(sessionLabel({ kind: "implementation", ticket: 36, phase: "repair", repair: 2 }), "Issue #36 · Repair 2");
  assert.equal(sessionLabel({ kind: "implementation", ticket: 36, phase: "build", repair: 0 }), "Issue #36 · Initial build");
});

test("an incomplete session makes the system need attention", () => {
  assert.equal(systemMode(status({ summary: { incomplete: 1 } })).key, "attention");
});

test("a failed scheduled run makes the system degraded", () => {
  assert.deepEqual(systemMode(status({ summary: { degraded: 1 } })), {
    key: "degraded",
    label: "DEGRADED",
    detail: "1 workflow did not complete its last run"
  });
});

test("a completed result recommends continuing current work", () => {
  const action = recommendedAction(status({ summary: { awaitingHarvest: 2 } }));
  assert.equal(action.action, "collect");
  assert.equal(action.loop, "implement");
  assert.match(action.detail, /without starting a model session/);
});

test("a ready paid step is distinct from idle", () => {
  assert.equal(systemMode(status({ summary: { paidReady: 1 } })).key, "ready");
  const action = recommendedAction(status({ summary: { paidReady: 1 } }));
  assert.equal(action.label, "Advance current work");
  assert.match(action.detail, /at most one model session/);
});

test("merged owner actions route to tickets when no card is open", () => {
  const action = recommendedAction(status({ summary: { humanActions: 1 } }));
  assert.equal(action.view, "tickets");
});

test("awaiting unified verdict puts controller harvest before owner merge", () => {
  const stages = ticketStages({
    pr: "https://example.test/pull/1",
    status: "review",
    action: "review",
    reason: "",
    assurance: {
      profiles: [
        { name: "assurance", status: "current" }
      ]
    },
    session: { id: "46-rev-assurance-r3", status: "awaiting harvest", kind: "review", profile: "assurance", verdict: "PASS" }
  });
  assert.deepEqual(stages.map((stage) => stage.label), [
    "PR opened",
    "Unified assurance review · PASS",
    "Collect result",
    "Owner merge"
  ]);
  assert.equal(stages[2].state, "current");
});

test("a unified BLOCK verdict is displayed as blocked", () => {
  const stages = ticketStages({
    pr: "https://example.test/pull/1",
    status: "review",
    action: "review",
    reason: "",
    assurance: { profiles: [{ name: "assurance", status: "current" }] },
    session: { id: "46-rev-assurance-r3", status: "awaiting harvest", kind: "review", profile: "assurance", verdict: "BLOCK" }
  });
  assert.equal(stages[1].state, "blocked");
});

test("merged-unverified work never looks like an active review", () => {
  const stages = ticketStages({ status: "merged-unverified", reason: "0/4 profiles passed" });
  assert.deepEqual(stages.map((stage) => stage.state), ["done", "done", "blocked", "future", "future"]);
});

test("a post-merge audit preserves the exception and shows resolution", () => {
  const ticket = { status: "merged-audited", reason: "", postMergeAudit: { original_exception: "0/4 profiles passed", recorded_at: "2026-09-01T00:00:00Z" } };
  const stages = ticketStages(ticket);
  assert.deepEqual(stages.map((stage) => stage.state), ["done", "done", "blocked", "done", "done"]);
  assert.deepEqual(ticketDisplayStatus(ticket), { key: "resolved", label: "EXCEPTION RECORDED" });
  assert.equal(isResolvedTicket(ticket), true);
  assert.equal(isResolvedTicket({ status: "review" }), false);
});

test("an assured merged PR is terminal and leaves active tickets", () => {
  const ticket = { status: "merged", mergedAt: "2026-09-02T00:00:00Z" };
  assert.equal(isResolvedTicket(ticket), true);
  assert.deepEqual(ticketDisplayStatus(ticket), { key: "resolved", label: "MERGED" });
  assert.deepEqual(ticketStages(ticket).map((stage) => stage.state), ["done", "done", "done"]);
});

test("a manual takeover is a resolved workflow record without a PASS claim", () => {
  const ticket = { status: "manual-takeover", manualIntervention: { parked_reason: "review limit", recorded_at: "2026-09-01T00:00:00Z" } };
  assert.equal(isResolvedTicket(ticket), true);
  assert.deepEqual(ticketDisplayStatus(ticket), { key: "resolved", label: "OWNER-MANAGED" });
  assert.deepEqual(ticketStages(ticket).map((stage) => stage.label), ["Implementation", "Automation parked", "Owner takeover", "Owner validation", "Owner merge"]);
});

test("a runtime failure is displayed as operational and retryable", () => {
  const ticket = {
    status: "in-progress",
    operationalFailure: { status: "needs-retry", reason: "inactivity watchdog" },
    assurance: { profiles: [] }
  };
  assert.deepEqual(ticketDisplayStatus(ticket), { key: "attention", label: "RUNTIME FAILURE" });
  assert.deepEqual(ticketStages(ticket).map((stage) => stage.label), ["Implementation", "Automation runtime", "Clean retry"]);
  assert.equal(isResolvedTicket(ticket), false);
});

test("parseJsonlLog structures raw JSONL events into readable steps and tools", () => {
  const sampleJsonl = [
    JSON.stringify({ type: "step_start", timestamp: 1788334000000 }),
    JSON.stringify({
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          input: { command: "flutter test" },
          output: "All tests passed!",
          metadata: { exit: 0 },
          title: "flutter test"
        }
      }
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        tool: "read",
        state: {
          input: { path: "lib/main.dart" },
          output: "void main() {}",
          title: "lib/main.dart"
        }
      }
    }),
    JSON.stringify({
      type: "step_finish",
      part: {
        tokens: { total: 1200, input: 1000, output: 200 },
        reason: "tool-calls"
      }
    })
  ].join("\n");

  const steps = parseJsonlLog(sampleJsonl);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].index, 1);
  assert.equal(steps[0].tools.length, 2);
  assert.equal(steps[0].tools[0].tool, "bash");
  assert.equal(steps[0].tools[0].title, "flutter test");
  assert.equal(steps[0].tools[0].exitCode, 0);
  assert.equal(steps[0].tools[0].output, "All tests passed!");
  assert.equal(steps[0].tools[1].tool, "read");
  assert.equal(steps[0].tools[1].title, "lib/main.dart");
  assert.equal(steps[0].tokens.total, 1200);
});

test("a rate limit circuit breaker sets system mode to cooldown and recommends switching model", () => {
  const state = {
    circuitBreaker: {
      active: true,
      remainingSeconds: 150,
      model: "10router/ag/gemini-3.7-flash-high"
    },
    summary: { running: 0, awaitingHarvest: 0, incomplete: 0, humanActions: 0, openDecisionCards: 0, degraded: 0, paidReady: 1, armed: 1, enabled: 1 },
    frontier: { available: true }
  };
  const mode = systemMode(state);
  assert.equal(mode.key, "attention");
  assert.equal(mode.label, "COOLDOWN");
  assert.match(mode.detail, /resumes in 2m 30s/);

  const action = recommendedAction(state);
  assert.match(action.title, /Rate limit cooldown/);
  assert.equal(action.view, "control-center");
});
