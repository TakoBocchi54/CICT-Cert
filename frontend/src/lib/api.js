// A File/Blob body (an image upload) is sent as-is with its own type; anything else as JSON.
export async function api(path, { method = "GET", headers = {}, body, signal } = {}) {
  const raw = body instanceof Blob;
  const res = await fetch(path, {
    method,
    credentials: "include", signal,
    headers: { ...(body ? { "Content-Type": raw ? body.type : "application/json" } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  
  return data;
}
