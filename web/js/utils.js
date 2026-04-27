/* ============================================================
   UTILS — helpers puros, sin JSX
============================================================ */

/** Une clases CSS filtrando falsy */
function cls(...a) { return a.filter(Boolean).join(" "); }

/**
 * parseThinkingProcess(text)
 * ──────────────────────────
 * Parsea la respuesta raw del LLM buscando etiquetas <think>…</think>.
 * Modelos de razonamiento (DeepSeek-R1, QwQ, etc.) envuelven su chain-of-thought
 * en estas etiquetas antes de dar la respuesta final.
 *
 * Devuelve:
 *   thoughtProcess  — texto entre <think> y </think> (vacío si no existe)
 *   finalAnswer     — texto DESPUÉS de </think> (o el texto completo si no hay tags)
 *   inProgress      — true si <think> fue abierto pero </think> aún no llegó
 *                     (el modelo todavía está "pensando" en streaming)
 */
function parseThinkingProcess(text) {
  if (!text) return { thoughtProcess: "", finalAnswer: "", inProgress: false };

  const OPEN  = "<think>";
  const CLOSE = "</think>";

  const openIdx = text.indexOf(OPEN);

  // Sin etiqueta de apertura → todo es respuesta final
  if (openIdx === -1) {
    return { thoughtProcess: "", finalAnswer: text, inProgress: false };
  }

  const closeIdx = text.indexOf(CLOSE, openIdx + OPEN.length);

  // Etiqueta abierta pero aún sin cerrar → sigue pensando (streaming en curso)
  if (closeIdx === -1) {
    const thoughtProcess = text.slice(openIdx + OPEN.length);
    // Cualquier texto ANTES de <think> lo tratamos como prefijo de respuesta
    const prefix = text.slice(0, openIdx).trim();
    return { thoughtProcess, finalAnswer: prefix, inProgress: true };
  }

  // Tags completos: extraer pensamiento y respuesta limpia
  const thoughtProcess = text.slice(openIdx + OPEN.length, closeIdx);
  const afterClose     = text.slice(closeIdx + CLOSE.length).replace(/^\s+/, "");
  const prefix         = text.slice(0, openIdx).trim();
  const finalAnswer    = prefix ? `${prefix}\n${afterClose}` : afterClose;

  return { thoughtProcess, finalAnswer, inProgress: false };
}

/** Formatea bytes en unidades legibles */
function bytes(n) {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

/** Trunca un string con elipsis */
function shortName(s, n = 36) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Convierte Markdown básico a HTML */
function mdToHtml(md = "") {
  let s = md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/```([\s\S]*?)```/g, (_m, c) => `<pre>${c.trim()}</pre>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.+)$/gm,  "<h2>$1</h2>");
  s = s.replace(/^# (.+)$/gm,   "<h1>$1</h1>");
  s = s.replace(/(^|\n)((?:- .+(?:\n|$))+)/g, (m, p, list) => {
    const items = list.trim().split(/\n/).map(l => l.replace(/^- /, "").trim()).filter(Boolean);
    return `${p}<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
  });
  s = s.split(/\n\n+/).map(p =>
    p.match(/^<(h\d|ul|ol|pre)/) ? p : `<p>${p.replace(/\n/g, "<br/>")}</p>`
  ).join("");
  return s;
}

/** Genera un ID único basado en timestamp + random */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Extrae el título de un chat desde sus mensajes (primer mensaje de usuario) */
function getChatTitle(messages) {
  const first = messages.find(m => m.role === "user");
  if (!first) return "Nueva conversación";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 44 ? t.slice(0, 43) + "…" : t;
}

/**
 * Genera un resumen JSON del chat para enviar como contexto cuando se retoma.
 * Contiene los primeros temas mencionados y el número de mensajes.
 */
function getChatSummary(messages) {
  const userMsgs = messages.filter(m => m.role === "user").slice(0, 4);
  return {
    topics: userMsgs.map(m => m.content.slice(0, 90).trim()),
    messageCount: messages.length,
  };
}

/** Devuelve tiempo relativo desde un timestamp (ms) */
function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "ahora";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/* ---- localStorage helpers ---- */

function loadChats() {
  try { return JSON.parse(localStorage.getItem(LS_CHATS_KEY)) || []; }
  catch { return []; }
}

function saveChats(chats) {
  try { localStorage.setItem(LS_CHATS_KEY, JSON.stringify(chats.slice(0, MAX_CHATS))); }
  catch {}
}

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_SETTINGS_KEY)) || {}; }
  catch { return {}; }
}

function saveSettings(s) {
  try { localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(s)); }
  catch {}
}

/** Crea un objeto chat vacío con mensaje de bienvenida */
function createNewChatObj() {
  return {
    id:        generateId(),
    title:     "Nueva conversación",
    summary:   null,
    messages:  [{ ...WELCOME_MSG }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
