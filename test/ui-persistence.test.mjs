import assert from "node:assert/strict";
import test from "node:test";
import { captureUiState, restoreUiState, updateHtml } from "../web/ui-persistence.mjs";

test("identical render output keeps the existing DOM node", () => {
  let writes = 0;
  const element = {
    get innerHTML() { return this.html || ""; },
    set innerHTML(value) { this.html = value; writes += 1; }
  };
  assert.equal(updateHtml(element, "same"), true);
  assert.equal(updateHtml(element, "same"), false);
  assert.equal(writes, 1);
});

test("accordion state and report scroll survive a render", () => {
  const beforePre = { scrollTop: 120, scrollLeft: 4, closest: () => beforeDetail };
  const beforeDetail = { dataset: { uiKey: "history:37-review" }, open: true, querySelector: () => beforePre };
  const beforeRoot = {
    activeElement: null,
    querySelectorAll(selector) {
      if (selector === "details[data-ui-key]") return [beforeDetail];
      if (selector === "details[data-ui-key] pre") return [beforePre];
      return [];
    }
  };
  const snapshot = captureUiState(beforeRoot);

  const afterPre = { scrollTop: 0, scrollLeft: 0 };
  const afterDetail = { dataset: { uiKey: "history:37-review" }, open: false, querySelector: () => afterPre };
  const afterRoot = {
    querySelectorAll(selector) {
      if (selector === "details[data-ui-key]") return [afterDetail];
      return [];
    }
  };
  restoreUiState(afterRoot, snapshot);
  assert.equal(afterDetail.open, true);
  assert.deepEqual({ top: afterPre.scrollTop, left: afterPre.scrollLeft }, { top: 120, left: 4 });
});

test("only the control being used is restored across a render", () => {
  const active = { id: "route-model", value: "model/a", closest: () => null, selectionStart: null };
  const inactive = { id: "unrelated", value: "old", closest: () => null, selectionStart: null };
  const beforeRoot = {
    activeElement: active,
    querySelectorAll(selector) {
      if (selector === "input, select, textarea") return [active, inactive];
      return [];
    }
  };
  const snapshot = captureUiState(beforeRoot);
  assert.equal(snapshot.controls.has("id:route-model"), true);
  assert.equal(snapshot.controls.has("id:unrelated"), false);

  const newActive = { id: "route-model", value: "model/b", closest: () => null, selectionStart: null, focus: () => { newActive.focused = true; } };
  const newInactive = { id: "unrelated", value: "new", closest: () => null, selectionStart: null };
  const afterRoot = {
    querySelectorAll(selector) {
      if (selector === "input, select, textarea") return [newActive, newInactive];
      return [];
    }
  };
  restoreUiState(afterRoot, snapshot);
  assert.equal(newActive.value, "model/a");
  assert.equal(newActive.focused, true);
  assert.equal(newInactive.value, "new");
});
