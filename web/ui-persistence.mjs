const renderedHtml = new WeakMap();

function getNodeKey(node) {
  if (!node || node.nodeType !== 1) return null;
  return node.dataset?.uiKey ||
         (node.dataset?.ticketId ? `ticket:${node.dataset.ticketId}` : null) ||
         (node.dataset?.ticketSelect ? `tab:${node.dataset.ticketSelect}` : null) ||
         (node.dataset?.stageIndex ? `stage:${node.dataset.stageIndex}` : null) ||
         (node.dataset?.routeId ? `route:${node.dataset.routeId}` : null) ||
         (node.dataset?.cycleRoutes ? `cycle:${node.dataset.cycleRoutes}` : null) ||
         (node.dataset?.card ? `card:${node.dataset.card}` : null) ||
         (node.dataset?.loop ? `loop:${node.dataset.loop}` : null) ||
         (node.id ? `id:${node.id}` : null);
}

function canMorph(targetNode, sourceNode) {
  if (targetNode.nodeType !== sourceNode.nodeType) return false;
  if (targetNode.nodeType === 3 || targetNode.nodeType === 8) return true;
  if (targetNode.nodeType === 1) {
    if (targetNode.tagName !== sourceNode.tagName) return false;
    const targetKey = getNodeKey(targetNode);
    const sourceKey = getNodeKey(sourceNode);
    if (targetKey || sourceKey) return targetKey === sourceKey;
    return true;
  }
  return false;
}

function morphNode(targetNode, sourceNode) {
  if (targetNode.nodeType === 3 || targetNode.nodeType === 8) {
    if (targetNode.nodeValue !== sourceNode.nodeValue) {
      targetNode.nodeValue = sourceNode.nodeValue;
    }
    return;
  }
  if (targetNode.nodeType === 1) {
    const sourceAttrs = sourceNode.attributes;
    for (let i = 0; i < sourceAttrs.length; i++) {
      const attr = sourceAttrs[i];
      if (targetNode.getAttribute(attr.name) !== attr.value) {
        targetNode.setAttribute(attr.name, attr.value);
      }
    }
    const targetAttrs = targetNode.attributes;
    for (let i = targetAttrs.length - 1; i >= 0; i--) {
      const attr = targetAttrs[i];
      if (!sourceNode.hasAttribute(attr.name)) {
        targetNode.removeAttribute(attr.name);
      }
    }

    const doc = targetNode.ownerDocument;
    const isActive = doc && doc.activeElement === targetNode;
    if (targetNode.tagName === "INPUT" || targetNode.tagName === "TEXTAREA") {
      if (targetNode.type === "checkbox" || targetNode.type === "radio") {
        if (!isActive && targetNode.checked !== sourceNode.checked) {
          targetNode.checked = sourceNode.checked;
        }
      } else if (!isActive && targetNode.value !== sourceNode.value) {
        targetNode.value = sourceNode.value;
      }
    } else if (targetNode.tagName === "SELECT") {
      if (!isActive && targetNode.value !== sourceNode.value) {
        targetNode.value = sourceNode.value;
      }
    }

    morphChildren(targetNode, sourceNode);
  }
}

function morphChildren(targetParent, sourceParent) {
  const targetNodes = [...targetParent.childNodes];
  const sourceNodes = [...sourceParent.childNodes];

  const targetKeyed = new Map();
  for (const node of targetNodes) {
    const key = getNodeKey(node);
    if (key) targetKeyed.set(key, node);
  }

  let targetIndex = 0;
  for (let sourceIndex = 0; sourceIndex < sourceNodes.length; sourceIndex++) {
    const sourceChild = sourceNodes[sourceIndex];
    const sourceKey = getNodeKey(sourceChild);

    let matchedTargetNode = null;
    if (sourceKey && targetKeyed.has(sourceKey)) {
      matchedTargetNode = targetKeyed.get(sourceKey);
    } else {
      const candidate = targetParent.childNodes[targetIndex];
      if (candidate && canMorph(candidate, sourceChild)) {
        matchedTargetNode = candidate;
      }
    }

    if (matchedTargetNode) {
      const currentAtPos = targetParent.childNodes[targetIndex];
      if (currentAtPos !== matchedTargetNode) {
        targetParent.insertBefore(matchedTargetNode, currentAtPos);
      }
      morphNode(matchedTargetNode, sourceChild);
      targetIndex++;
    } else {
      const newNode = sourceChild.cloneNode(true);
      const currentAtPos = targetParent.childNodes[targetIndex];
      targetParent.insertBefore(newNode, currentAtPos);
      targetIndex++;
    }
  }

  while (targetParent.childNodes.length > targetIndex) {
    targetParent.removeChild(targetParent.lastChild);
  }
}

export function updateHtml(element, html) {
  if (!element) return false;
  if (renderedHtml.get(element) === html) return false;

  const doc = element.ownerDocument;
  if (!doc || typeof doc.createElement !== "function" || !element.nodeType || element.nodeType !== 1) {
    element.innerHTML = html;
    renderedHtml.set(element, html);
    return true;
  }

  if (!element.firstChild) {
    element.innerHTML = html;
    renderedHtml.set(element, html);
    return true;
  }

  const template = doc.createElement("template");
  template.innerHTML = html;
  morphChildren(element, template.content);
  renderedHtml.set(element, html);
  return true;
}

function controlKey(control) {
  if (!control) return "";
  if (control.id) return `id:${control.id}`;
  if (control.dataset?.uiFocusKey) return `focus:${control.dataset.uiFocusKey}`;
  const route = control.closest?.("[data-route-id]");
  if (route) {
    const field = control.matches?.("[data-route-model]") ? "model" : control.matches?.("[data-route-variant]") ? "variant" : control.name || control.tagName;
    return `route:${route.dataset.routeId}:${field}`;
  }
  if (control.matches?.("[data-dispatch-limit]")) return "dispatch-limit";
  const owner = control.closest?.("[data-ui-key]");
  if (!owner) return "";
  return `${owner.dataset.uiKey}:${control.tagName}:${control.name || ""}:${control.type === "radio" ? control.value : ""}`;
}

export function captureUiState(root) {
  const details = new Map([...root.querySelectorAll("details[data-ui-key]")].map((item) => [item.dataset.uiKey, item.open]));
  const scroll = new Map([...root.querySelectorAll("details[data-ui-key] pre")].map((item) => [item.closest("details").dataset.uiKey, { top: item.scrollTop, left: item.scrollLeft }]));
  const controls = new Map();
  const active = root.activeElement;
  const activeKey = controlKey(active);
  const activeOwner = activeKey && active.closest?.("[data-ui-key]");
  const activeControls = activeOwner ? activeOwner.querySelectorAll("input, select, textarea") : activeKey ? [active] : [];
  for (const control of activeControls) {
    const key = controlKey(control);
    if (!key) continue;
    controls.set(key, {
      value: control.value,
      checked: Boolean(control.checked),
      selectionStart: typeof control.selectionStart === "number" ? control.selectionStart : null,
      selectionEnd: typeof control.selectionEnd === "number" ? control.selectionEnd : null
    });
  }
  return { details, scroll, controls, focus: activeKey };
}

export function restoreUiState(root, snapshot) {
  if (!snapshot) return;
  for (const item of root.querySelectorAll("details[data-ui-key]")) {
    if (snapshot.details.has(item.dataset.uiKey)) item.open = snapshot.details.get(item.dataset.uiKey);
    const position = snapshot.scroll.get(item.dataset.uiKey);
    const content = position && item.querySelector("pre");
    if (content) {
      content.scrollTop = position.top;
      content.scrollLeft = position.left;
    }
  }
  let focusTarget = null;
  for (const control of root.querySelectorAll("input, select, textarea")) {
    const key = controlKey(control);
    const saved = snapshot.controls.get(key);
    if (saved) {
      control.value = saved.value;
      if ("checked" in control) control.checked = saved.checked;
      if (saved.selectionStart !== null && control.setSelectionRange) control.setSelectionRange(saved.selectionStart, saved.selectionEnd);
    }
    if (key && key === snapshot.focus) focusTarget = control;
  }
  if (!focusTarget && snapshot.focus) {
    focusTarget = [...root.querySelectorAll("button, summary, a[href]")].find((element) => controlKey(element) === snapshot.focus) || null;
  }
  focusTarget?.focus({ preventScroll: true });
}
