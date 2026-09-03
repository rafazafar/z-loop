import assert from "node:assert/strict";
import test from "node:test";
import { pageFromHash, parkedResolutionPresentation, workflowState } from "../web/src/ui-model.js";

test("the dashboard maps workflow states to operator language", () => {
  assert.deepEqual(workflowState({ status: "done" }), { label: "Ready to merge", tone: "success" });
  assert.deepEqual(workflowState({ status: "in-progress", session: { status: "running" } }), { label: "In progress", tone: "running" });
  assert.deepEqual(workflowState({ status: "parked" }), { label: "Needs action", tone: "attention" });
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
