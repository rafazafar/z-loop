import assert from "node:assert/strict";
import test from "node:test";
import { actionableFronts, frontActor, pageFromHash, parkedResolutionPresentation, queueFrontGroups, workflowState } from "../web/src/ui-model.js";

test("the dashboard maps workflow states to operator language", () => {
  assert.deepEqual(workflowState({ status: "done" }), { label: "Ready to merge", tone: "success" });
  assert.deepEqual(workflowState({ status: "in-progress", session: { status: "running" } }), { label: "In progress", tone: "running" });
  assert.deepEqual(workflowState({ status: "parked" }), { label: "Needs action", tone: "attention" });
  assert.deepEqual(workflowState({ status: "container" }), { label: "Parent context", tone: "waiting" });
  assert.deepEqual(workflowState({ status: "deferred" }), { label: "Waiting", tone: "waiting" });
  assert.deepEqual(workflowState({ status: "merged" }), { label: "Complete", tone: "complete" });
});

test("legacy dashboard links open the corresponding rebuilt view", () => {
  assert.equal(pageFromHash("#now"), "work");
  assert.equal(pageFromHash("#tickets"), "queue");
  assert.equal(pageFromHash("#history"), "runs");
  assert.equal(pageFromHash("#health"), "automations");
});

test("retry presentation hides evidence that is not required", () => {
  assert.deepEqual(parkedResolutionPresentation("retry"), {
    submitLabel: "Retry automation",
    evidenceHidden: true
  });
});

test("the issue queue separates owner work from automatic work", () => {
  const fronts = [
    { number: 108, key: "external", labels: ["deps", "ready-for-worker"], immediateUnlocks: [{ number: 109 }] },
    { number: 56, key: "decision", immediateUnlocks: [{ number: 57 }] },
    { number: 96, key: "quality", immediateUnlocks: [] }
  ];
  const groups = queueFrontGroups(fronts);

  assert.equal(groups.primaryManual.number, 56);
  assert.deepEqual(groups.automatic.map((front) => front.number), [108]);
  assert.deepEqual(groups.later.map((front) => front.number), [96]);
  assert.deepEqual(frontActor(groups.primaryManual), { label: "Your decision", tone: "owner" });
  assert.deepEqual(frontActor(groups.automatic[0]), { label: "Loop automatic", tone: "loop" });
});

test("the queue badge counts only fronts that need owner action", () => {
  const fronts = [
    { number: 47, key: "worker", labels: ["ready-for-worker"] },
    { number: 57, key: "worker", labels: ["ready-for-worker"] },
    { number: 56, key: "decision" },
    { number: 96, key: "quality" },
    { number: 109, key: "external" }
  ];

  assert.deepEqual(actionableFronts(fronts).map((front) => front.number), [56, 96, 109]);
  assert.deepEqual(actionableFronts(fronts.filter((front) => front.key === "worker")), []);
  assert.deepEqual(actionableFronts(), []);
});
