const renderedHtml = new WeakMap();

export function updateHtml(element, html) {
  if (!element) return false;
  if (renderedHtml.get(element) === html) return false;
  element.innerHTML = html;
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
