/* ============================================================
   CONFIG — constantes globales
============================================================ */
const API_BASE = window.location.origin.startsWith("http")
  ? window.location.origin
  : "http://127.0.0.1:8000";

const LS_CHATS_KEY    = "rag_f1_chats_v2";
const LS_SETTINGS_KEY = "rag_f1_settings_v2";
const MAX_CHATS       = 5;

// Mensaje de bienvenida por defecto
const WELCOME_MSG = {
  role: "assistant",
  content: "Bienvenido al **Agentic RAG**. Sube tus PDFs en la pestaña de Documentos, regenera el índice y pregúntame sobre su contenido. Responderé en tu idioma citando los fragmentos relevantes.",
};
