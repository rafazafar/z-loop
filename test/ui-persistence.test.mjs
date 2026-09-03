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

test("DOM morphing updates dynamic text without recreating element nodes (preserves CSS animations)", () => {
  class MockNode {
    constructor(nodeType, nodeValue = null) {
      this.nodeType = nodeType;
      this.nodeValue = nodeValue;
      this.childNodes = [];
      this.parentNode = null;
    }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      const index = this.childNodes.indexOf(refNode);
      if (index === -1) return this.appendChild(newNode);
      newNode.parentNode = this;
      this.childNodes.splice(index, 0, newNode);
      return newNode;
    }
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index !== -1) {
        this.childNodes.splice(index, 1);
        child.parentNode = null;
      }
      return child;
    }
    cloneNode(deep = false) {
      const clone = new this.constructor(this.nodeType, this.nodeValue);
      if (this.tagName) clone.tagName = this.tagName;
      if (this.attributes) {
        clone.attributes = this.attributes.map((a) => ({ ...a }));
      }
      if (this.dataset) clone.dataset = { ...this.dataset };
      if (deep) {
        for (const child of this.childNodes) clone.appendChild(child.cloneNode(true));
      }
      return clone;
    }
  }

  class MockElement extends MockNode {
    constructor(tagName) {
      super(1, null);
      this.tagName = tagName.toUpperCase();
      this.attributes = [];
      this.dataset = {};
      this.ownerDocument = null;
    }
    getAttribute(name) {
      const attr = this.attributes.find((a) => a.name === name);
      return attr ? attr.value : null;
    }
    setAttribute(name, value) {
      const attr = this.attributes.find((a) => a.name === name);
      if (attr) attr.value = String(value);
      else this.attributes.push({ name, value: String(value) });
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
      if (name === "id") this.id = String(value);
    }
    hasAttribute(name) {
      return this.attributes.some((a) => a.name === name);
    }
    removeAttribute(name) {
      const index = this.attributes.findIndex((a) => a.name === name);
      if (index !== -1) {
        this.attributes.splice(index, 1);
        if (name === "id") delete this.id;
      }
    }
    set innerHTML(html) {
      this.childNodes = [];
      if (html.includes("session 7m")) {
        const p = new MockElement("P");
        p.ownerDocument = this.ownerDocument;
        const secMatch = html.match(/session 7m (\d+)s/);
        p.appendChild(new MockNode(3, `session 7m ${secMatch ? secMatch[1] : 0}s`));
        this.appendChild(p);

        const stage = new MockElement("DIV");
        stage.ownerDocument = this.ownerDocument;
        stage.setAttribute("class", "stage running");
        stage.setAttribute("data-stage-index", "1");
        stage.appendChild(new MockNode(3, "Implementation running 68-impl-a1"));
        this.appendChild(stage);
      }
    }
  }

  class MockTemplate extends MockElement {
    constructor() {
      super("TEMPLATE");
      this.content = new MockNode(11);
    }
    set innerHTML(html) {
      this.content.childNodes = [];
      // Minimal test parser for stage-flow and duration paragraph
      if (html.includes("session 7m")) {
        const p = new MockElement("P");
        const secMatch = html.match(/session 7m (\d+)s/);
        p.appendChild(new MockNode(3, `session 7m ${secMatch ? secMatch[1] : 0}s`));
        this.content.appendChild(p);

        const stage = new MockElement("DIV");
        stage.setAttribute("class", "stage running");
        stage.setAttribute("data-stage-index", "1");
        stage.appendChild(new MockNode(3, "Implementation running 68-impl-a1"));
        this.content.appendChild(stage);
      }
    }
  }

  const mockDoc = {
    createElement(tag) {
      if (tag.toLowerCase() === "template") {
        const t = new MockTemplate();
        t.ownerDocument = mockDoc;
        return t;
      }
      const el = new MockElement(tag);
      el.ownerDocument = mockDoc;
      return el;
    }
  };

  const root = new MockElement("DIV");
  root.ownerDocument = mockDoc;

  // Initial render with 7m 57s
  updateHtml(root, `<p>session 7m 57s</p><div class="stage running" data-stage-index="1">Implementation running 68-impl-a1</div>`);

  const initialP = root.childNodes[0];
  const initialStage = root.childNodes[1];
  assert.equal(initialP.childNodes[0].nodeValue, "session 7m 57s");
  assert.equal(initialStage.getAttribute("class"), "stage running");

  // Subsequent render 1 second later with 7m 58s
  const updated = updateHtml(root, `<p>session 7m 58s</p><div class="stage running" data-stage-index="1">Implementation running 68-impl-a1</div>`);
  assert.equal(updated, true);

  // The stage element must be the exact same object reference (DOM node preserved, animation doesn't restart)
  assert.equal(root.childNodes[1], initialStage);
  assert.equal(root.childNodes[0], initialP);
  // The duration text node must be updated in place
  assert.equal(root.childNodes[0].childNodes[0].nodeValue, "session 7m 58s");
});

test("DOM morphing updates attributes on existing elements and preserves active input values", () => {
  class MockNode {
    constructor(nodeType, nodeValue = null) {
      this.nodeType = nodeType;
      this.nodeValue = nodeValue;
      this.childNodes = [];
      this.parentNode = null;
    }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      const index = this.childNodes.indexOf(refNode);
      if (index === -1) return this.appendChild(newNode);
      newNode.parentNode = this;
      this.childNodes.splice(index, 0, newNode);
      return newNode;
    }
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index !== -1) {
        this.childNodes.splice(index, 1);
        child.parentNode = null;
      }
      return child;
    }
    cloneNode(deep = false) {
      const clone = new this.constructor(this.nodeType, this.nodeValue);
      if (this.tagName) clone.tagName = this.tagName;
      if (this.attributes) {
        clone.attributes = this.attributes.map((a) => ({ ...a }));
      }
      if (this.dataset) clone.dataset = { ...this.dataset };
      if (deep) {
        for (const child of this.childNodes) clone.appendChild(child.cloneNode(true));
      }
      return clone;
    }
  }

  class MockElement extends MockNode {
    constructor(tagName) {
      super(1, null);
      this.tagName = tagName.toUpperCase();
      this.attributes = [];
      this.dataset = {};
      this.ownerDocument = null;
      this.value = "";
    }
    getAttribute(name) {
      const attr = this.attributes.find((a) => a.name === name);
      return attr ? attr.value : null;
    }
    setAttribute(name, value) {
      const attr = this.attributes.find((a) => a.name === name);
      if (attr) attr.value = String(value);
      else this.attributes.push({ name, value: String(value) });
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
      if (name === "id") this.id = String(value);
      if (name === "value") this.value = String(value);
    }
    hasAttribute(name) {
      return this.attributes.some((a) => a.name === name);
    }
    removeAttribute(name) {
      const index = this.attributes.findIndex((a) => a.name === name);
      if (index !== -1) {
        this.attributes.splice(index, 1);
        if (name === "id") delete this.id;
      }
    }
    set innerHTML(html) {
      this.childNodes = [];
      if (html.includes("data-stage-index")) {
        const stage = new MockElement("DIV");
        stage.ownerDocument = this.ownerDocument;
        const isDone = html.includes("stage done");
        stage.setAttribute("class", isDone ? "stage done" : "stage running");
        stage.setAttribute("data-stage-index", "1");
        this.appendChild(stage);

        const input = new MockElement("INPUT");
        input.ownerDocument = this.ownerDocument;
        input.setAttribute("id", "dispatch-limit");
        input.setAttribute("value", "1");
        this.appendChild(input);
      }
    }
  }

  class MockTemplate extends MockElement {
    constructor() {
      super("TEMPLATE");
      this.content = new MockNode(11);
    }
    set innerHTML(html) {
      this.content.childNodes = [];
      if (html.includes("data-stage-index")) {
        const stage = new MockElement("DIV");
        stage.ownerDocument = this.ownerDocument;
        const isDone = html.includes("stage done");
        stage.setAttribute("class", isDone ? "stage done" : "stage running");
        stage.setAttribute("data-stage-index", "1");
        this.content.appendChild(stage);

        const input = new MockElement("INPUT");
        input.ownerDocument = this.ownerDocument;
        input.setAttribute("id", "dispatch-limit");
        input.setAttribute("value", "1");
        this.content.appendChild(input);
      }
    }
  }

  const mockDoc = {
    activeElement: null,
    createElement(tag) {
      if (tag.toLowerCase() === "template") {
        const t = new MockTemplate();
        t.ownerDocument = mockDoc;
        return t;
      }
      const el = new MockElement(tag);
      el.ownerDocument = mockDoc;
      return el;
    }
  };

  const root = new MockElement("DIV");
  root.ownerDocument = mockDoc;

  // Initial render: running stage and input
  updateHtml(root, `<div class="stage running" data-stage-index="1"></div><input id="dispatch-limit" value="1">`);
  const initialStage = root.childNodes[0];
  const initialInput = root.childNodes[1];
  assert.equal(initialStage.getAttribute("class"), "stage running");

  // User focuses input and types "4"
  mockDoc.activeElement = initialInput;
  initialInput.value = "4";

  // State transitions stage to "stage done", server sends template with value="1"
  updateHtml(root, `<div class="stage done" data-stage-index="1"></div><input id="dispatch-limit" value="1">`);

  // Stage element preserved, class updated
  assert.equal(root.childNodes[0], initialStage);
  assert.equal(initialStage.getAttribute("class"), "stage done");

  // Active input element preserved and user's typed value "4" was NOT clobbered!
  assert.equal(root.childNodes[1], initialInput);
  assert.equal(initialInput.value, "4");
});
