export async function api(path, { method = "GET", headers = {}, body, signal } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "include", signal,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  
  return data;
}
