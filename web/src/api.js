async function request(path, options = {}) {
  const response = await fetch(path, options);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.output || data?.error || `Request failed (${response.status})`);
  }
  return data;
}

export const api = {
  state: () => request("/api/state"),
  diff: (ticket) => request(`/api/diff?ticket=${encodeURIComponent(ticket)}`),
  log: (name) => request(`/api/log?name=${encodeURIComponent(name)}`),
  models: (refresh = false) => request(`/api/models${refresh ? "?refresh=1" : ""}`),
  variants: (model) => request(`/api/model-variants?model=${encodeURIComponent(model)}`),
  post: (path, body) => request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
};
