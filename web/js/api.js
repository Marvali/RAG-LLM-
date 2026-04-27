/* ============================================================
   API — wrappers de fetch hacia el backend FastAPI
============================================================ */

async function safeText(r) {
  try {
    const j = await r.json();
    return j.detail || JSON.stringify(j);
  } catch {
    try { return await r.text(); } catch { return ""; }
  }
}

async function apiGet(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(API_BASE + path, { method: "DELETE" });
  if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
  return r.json();
}

async function apiUpload(files) {
  const fd = new FormData();
  for (const f of files) fd.append("files", f, f.name);
  const r = await fetch(API_BASE + "/api/upload", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
  return r.json();
}
