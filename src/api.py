"""
FastAPI backend que envuelve la pipeline RAG existente.

Endpoints:
    GET    /api/status         -> Estado del índice (chunks, docs, modelo, dispositivo)
    GET    /api/pdfs           -> Lista de PDFs en data/
    POST   /api/upload         -> Sube uno o varios PDFs a data/
    DELETE /api/pdfs/{name}    -> Borra un PDF de data/
    POST   /api/rebuild        -> Regenera embeddings + índice FAISS
    POST   /api/ask            -> Pregunta al RAG (chunks + LLM, pipeline clásica)
    POST   /api/ask/stream     -> Igual con streaming SSE
    POST   /api/ask/agent      -> Agente con function calling (decide cuándo buscar)
    GET    /                   -> Sirve la UI estática (web/index.html)

Arranque:
    uvicorn src.api:app --reload --port 8000
"""

import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import os
import json
import shutil
import threading
from typing import Optional

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

try:
    import faiss
except ImportError as e:
    raise ImportError("faiss-cpu no instalado. pip install faiss-cpu") from e

import torch
from sentence_transformers import SentenceTransformer

try:
    from openai import OpenAI
except ImportError as e:
    raise ImportError("openai no instalado. pip install openai") from e


# =========================
# RUTAS / CONFIGURACIÓN
# =========================
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_FOLDER = os.path.join(ROOT_DIR, "data")
OUTPUT_FOLDER = os.path.join(ROOT_DIR, "output")
WEB_FOLDER = os.path.join(ROOT_DIR, "web")

FAISS_INDEX_FILE = os.path.join(OUTPUT_FOLDER, "faiss_index.bin")
METADATA_JSON_FILE = os.path.join(OUTPUT_FOLDER, "faiss_metadata.json")

EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
USE_COSINE_SIMILARITY = True

LM_STUDIO_BASE_URL = "http://localhost:1234/v1"
LM_STUDIO_API_KEY = "lm-studio"
DEFAULT_LLM_MODEL = "local-model"

MAX_CONTEXT_CHARS = 5000
MAX_CHUNK_CHARS_PER_RESULT = 1200


# =========================
# IMPORTS DE MÓDULOS PROPIOS
# =========================
sys.path.insert(0, ROOT_DIR)
from src import embeddings_stats as es_mod  # noqa: E402
from src import build_faiss_index as bfi_mod  # noqa: E402
from src.agent_llm import TOOLS as AGENT_TOOLS, SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT, _dispatch as _agent_dispatch  # noqa: E402


# =========================
# ESTADO GLOBAL
# =========================
class RAGState:
    def __init__(self):
        self.index = None
        self.metadata: list[dict] = []
        self.embedding_model: Optional[SentenceTransformer] = None
        self.device: str = "cpu"
        self.llm_client: Optional[OpenAI] = None
        self.llm_model_name: str = DEFAULT_LLM_MODEL
        self.lock = threading.Lock()
        self.rebuilding = False
        self.last_error: Optional[str] = None

    def load_index(self):
        if not (os.path.exists(FAISS_INDEX_FILE) and os.path.exists(METADATA_JSON_FILE)):
            self.index = None
            self.metadata = []
            return
        self.index = faiss.read_index(FAISS_INDEX_FILE)
        with open(METADATA_JSON_FILE, "r", encoding="utf-8") as f:
            self.metadata = json.load(f)

    def load_embedding_model(self):
        if self.embedding_model is not None:
            return
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.embedding_model = SentenceTransformer(EMBEDDING_MODEL, device=self.device)

    def connect_llm(self):
        try:
            self.llm_client = OpenAI(
                base_url=LM_STUDIO_BASE_URL,
                api_key=LM_STUDIO_API_KEY,
            )
            try:
                models = self.llm_client.models.list()
                data = getattr(models, "data", None)
                if data and len(data) > 0:
                    self.llm_model_name = data[0].id
                else:
                    self.llm_model_name = DEFAULT_LLM_MODEL
            except Exception:
                self.llm_model_name = DEFAULT_LLM_MODEL
        except Exception as e:
            self.llm_client = None
            self.last_error = f"No se pudo conectar a LM Studio: {e}"


state = RAGState()


# =========================
# FASTAPI
# =========================
app = FastAPI(title="Agentic RAG", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    os.makedirs(DATA_FOLDER, exist_ok=True)
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    try:
        state.load_index()
    except Exception as e:
        state.last_error = f"Error cargando índice: {e}"
    try:
        state.load_embedding_model()
    except Exception as e:
        state.last_error = f"Error cargando modelo de embeddings: {e}"
    state.connect_llm()


# =========================
# UTILIDADES INTERNAS
# =========================
def _normalize(vec: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(vec)
    if n == 0:
        return vec
    return vec / n


def _embed_query(query: str) -> np.ndarray:
    if state.embedding_model is None:
        state.load_embedding_model()
    qv = state.embedding_model.encode(
        [query],
        convert_to_numpy=True,
        normalize_embeddings=False,
        show_progress_bar=False,
    )[0].astype("float32")
    if USE_COSINE_SIMILARITY:
        qv = _normalize(qv)
    return qv.reshape(1, -1)


def _rewrite_and_expand_query(user_query: str, history: list) -> str:
    """
    Optimiza la pregunta del usuario antes de la búsqueda vectorial:
      1. Query Rewriting: usa el historial para dar contexto a la pregunta actual.
      2. Query Expansion: añade sinónimos / términos clave relacionados.

    Si el LLM no está disponible o la llamada falla, devuelve la `user_query`
    original como fallback (defensivo: nunca rompe el pipeline RAG).
    """
    if state.llm_client is None or not user_query or not user_query.strip():
        return user_query

    system_prompt = (
        "You are an expert in information retrieval. Your only task is to optimize the user's query for a vector search system (RAG).\n"
        "Steps:\n"
        "1. Analyze the history (if any) to give full context to the current question (Query Rewriting).\n"
        "2. Expand the query by adding synonyms and key terms in BOTH Spanish and English to maximize retrieval of relevant fragments (Query Expansion).\n"
        "Return ONLY the optimized query on a single line. No explanations, no greetings, no quotes."
    )

    # Construir un bloque de historial compacto (solo últimos turnos)
    history_text = ""
    if history:
        recent = []
        for m in history[-6:]:
            # `m` puede ser un ChatMessage (pydantic) o un dict
            role = getattr(m, "role", None) or (m.get("role") if isinstance(m, dict) else None)
            content = getattr(m, "content", None) or (m.get("content") if isinstance(m, dict) else None)
            if not role or not content:
                continue
            if role not in ("user", "assistant"):
                continue
            content = str(content).strip()
            if not content:
                continue
            recent.append(f"{role.upper()}: {content[:400]}")
        if recent:
            history_text = "\n".join(recent)

    user_block = (
        f"Historial reciente:\n{history_text}\n\n" if history_text else ""
    ) + f"Pregunta actual del usuario:\n{user_query}\n\nConsulta optimizada:"

    try:
        response = state.llm_client.chat.completions.create(
            model=state.llm_model_name,
            temperature=0.1,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_block},
            ],
        )
        rewritten = (response.choices[0].message.content or "").strip()
        # Sanitizado mínimo: una sola línea, sin comillas envolventes
        rewritten = rewritten.splitlines()[0].strip() if rewritten else ""
        if rewritten.startswith(("\"", "'", "“", "‘")) and rewritten.endswith(("\"", "'", "”", "’")):
            rewritten = rewritten[1:-1].strip()
        # Si por algún motivo el LLM devolvió algo vacío, fallback
        return rewritten or user_query
    except Exception:
        # Fallback silencioso: nunca rompemos el RAG por un fallo de reescritura
        return user_query


def _retrieve(query: str, top_k: int) -> list[dict]:
    if state.index is None or not state.metadata:
        return []
    qv = _embed_query(query)
    distances, indices = state.index.search(qv, top_k)
    results = []
    for score, idx in zip(distances[0], indices[0]):
        if idx < 0 or idx >= len(state.metadata):
            continue
        item = state.metadata[idx]
        results.append({
            "score": float(score),
            "documento": item["documento"],
            "chunk_id": int(item["chunk_id"]),
            "chunk_len": int(item.get("chunk_len", len(item.get("chunk_text", "")))),
            "chunk_text": item["chunk_text"],
            "article_number": item.get("article_number"),
            "article_title": item.get("article_title"),
            "section": item.get("section"),
            "context": item.get("context"),
        })
    return results


def _build_context(results: list[dict]) -> str:
    parts, current = [], 0
    for i, item in enumerate(results, 1):
        chunk = item["chunk_text"][:MAX_CHUNK_CHARS_PER_RESULT].strip()
        block = (
            f"[Fragmento {i} | score={item['score']:.4f} | "
            f"doc={item['documento']} | chunk_id={item['chunk_id']}]\n{chunk}\n"
        )
        if current + len(block) > MAX_CONTEXT_CHARS:
            break
        parts.append(block)
        current += len(block)
    return "\n".join(parts)


def _do_rebuild():
    """Regenera embeddings + índice FAISS desde data/."""
    state.rebuilding = True
    try:
        os.makedirs(OUTPUT_FOLDER, exist_ok=True)

        pdfs = [
            os.path.join(DATA_FOLDER, f)
            for f in os.listdir(DATA_FOLDER)
            if f.lower().endswith(".pdf")
        ]
        if not pdfs:
            raise RuntimeError("No hay PDFs en data/. Sube alguno antes de regenerar.")

        documents, all_chunks = [], []
        for pdf_path in pdfs:
            raw = es_mod.extract_text_from_pdf(pdf_path)
            text = es_mod.clean_text(raw)
            if not text:
                continue
            documents.append({"path": pdf_path, "text": text})
            doc_name = os.path.basename(pdf_path)
            doc_chunks = es_mod.chunk_by_articles(
                text,
                doc_name=doc_name,
                max_chunk_size=es_mod.MAX_ARTICLE_CHUNK_SIZE,
                overlap=es_mod.CHUNK_OVERLAP,
            )
            for i, c in enumerate(doc_chunks):
                all_chunks.append({
                    "documento": doc_name,
                    "chunk_id": i,
                    "chunk_text": c["chunk_text"],
                    "chunk_len": len(c["chunk_text"]),
                    "article_number": c.get("article_number"),
                    "article_title": c.get("article_title"),
                    "section": c.get("section"),
                    "context": c.get("context"),
                })

        if not all_chunks:
            raise RuntimeError("No se generó ningún chunk a partir de los PDFs.")

        # Embeddings
        if state.embedding_model is None:
            state.load_embedding_model()
        emb_model = state.embedding_model
        emb = emb_model.encode(
            [c["chunk_text"] for c in all_chunks],
            batch_size=32,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=False,
        ).astype("float32")

        np.save(os.path.join(OUTPUT_FOLDER, "embeddings.npy"), emb)

        # CSV chunks
        import pandas as pd
        df = pd.DataFrame(all_chunks)
        df.to_csv(os.path.join(OUTPUT_FOLDER, "chunks.csv"), index=False, encoding="utf-8-sig")

        # FAISS
        if USE_COSINE_SIMILARITY:
            emb_norm = bfi_mod.normalize_embeddings(emb)
            index = faiss.IndexFlatIP(emb.shape[1])
            index.add(emb_norm)
        else:
            index = faiss.IndexFlatL2(emb.shape[1])
            index.add(emb)

        faiss.write_index(index, FAISS_INDEX_FILE)
        with open(METADATA_JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(all_chunks, f, ensure_ascii=False, indent=2)

        state.load_index()
        state.last_error = None
    except Exception as e:
        state.last_error = str(e)
        raise
    finally:
        state.rebuilding = False


# =========================
# MODELOS PYDANTIC
# =========================
class ChatMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    top_k: int = 5
    temperature: float = 0.2
    history: list[ChatMessage] = []
    use_history: bool = True


class AgentAskRequest(BaseModel):
    question: str
    temperature: float = 0.2
    max_iterations: int = 6


# =========================
# ENDPOINTS
# =========================
@app.get("/api/status")
def api_status():
    pdfs = []
    if os.path.exists(DATA_FOLDER):
        for f in sorted(os.listdir(DATA_FOLDER)):
            if f.lower().endswith(".pdf"):
                full = os.path.join(DATA_FOLDER, f)
                pdfs.append({
                    "name": f,
                    "size": os.path.getsize(full),
                })

    return {
        "ready": state.index is not None and len(state.metadata) > 0,
        "rebuilding": state.rebuilding,
        "n_chunks": len(state.metadata) if state.metadata else 0,
        "n_pdfs": len(pdfs),
        "pdfs": pdfs,
        "embedding_model": EMBEDDING_MODEL,
        "device": state.device,
        "llm_connected": state.llm_client is not None,
        "llm_model": state.llm_model_name,
        "lm_studio_url": LM_STUDIO_BASE_URL,
        "last_error": state.last_error,
    }


_STATS_CACHE: dict = {"sig": None, "data": None}
_DOC_PALETTE = [
    "#ef4444", "#f97316", "#a78bfa", "#38bdf8",
    "#22c55e", "#eab308", "#ec4899", "#14b8a6",
    "#f43f5e", "#8b5cf6", "#06b6d4", "#84cc16",
]
_STOPWORDS_ES = {
    "de","la","el","y","en","a","los","las","del","que","un","una","por",
    "para","con","se","no","es","al","lo","como","más","mas","o","su","sus",
    "este","esta","estos","estas","esa","ese","esos","esas","sobre","entre",
    "ya","si","sí","cuando","donde","muy","sin","ni","pero","también","tambien",
    "ha","han","fue","ser","son","será","sera","están","estan","está","esta",
    "ante","tras","desde","hasta","cada","todo","toda","todos","todas","otro","otra","otros","otras",
    "the","and","of","to","in","is","it","for","on","as","be","by","with","that","this","an","or","at","from","are","was","were","but","not","which","can","may","shall","must",
}


def _compute_stats() -> dict:
    """Calcula métricas reales del índice y las cachea por firma del archivo."""
    if not (os.path.exists(FAISS_INDEX_FILE) and os.path.exists(METADATA_JSON_FILE)):
        return {
            "ready": False,
            "doc_stats": [],
            "faiss_meta": None,
            "pca": [],
            "vocab": [],
            "totals": {"n_docs": 0, "n_chunks": 0, "n_tokens": 0, "n_words": 0, "avg_chunk_tokens": 0},
        }

    sig = (
        os.path.getmtime(FAISS_INDEX_FILE),
        os.path.getmtime(METADATA_JSON_FILE),
        len(state.metadata or []),
    )
    if _STATS_CACHE.get("sig") == sig and _STATS_CACHE.get("data"):
        return _STATS_CACHE["data"]

    metadata = state.metadata or []

    # ── Stats por documento ──
    per_doc: dict[str, dict] = {}
    for item in metadata:
        doc = item.get("documento", "?")
        text = item.get("chunk_text", "") or ""
        n_words = len(text.split())
        n_tokens = es_mod.estimate_tokens(text) if hasattr(es_mod, "estimate_tokens") else int(n_words * 1.47)
        d = per_doc.setdefault(doc, {"documento": doc, "n_chunks": 0, "n_tokens": 0, "n_words": 0})
        d["n_chunks"] += 1
        d["n_tokens"] += n_tokens
        d["n_words"]  += n_words

    doc_stats = []
    for d in per_doc.values():
        d["avg_chunk_tokens"] = int(round(d["n_tokens"] / d["n_chunks"])) if d["n_chunks"] else 0
        doc_stats.append(d)
    doc_stats.sort(key=lambda x: x["n_chunks"], reverse=True)

    totals = {
        "n_docs": len(doc_stats),
        "n_chunks": sum(d["n_chunks"] for d in doc_stats),
        "n_tokens": sum(d["n_tokens"] for d in doc_stats),
        "n_words":  sum(d["n_words"]  for d in doc_stats),
    }
    totals["avg_chunk_tokens"] = (
        int(round(totals["n_tokens"] / totals["n_chunks"])) if totals["n_chunks"] else 0
    )

    # ── Vocabulario top-10 (sin stopwords, palabras ≥ 4 letras) ──
    from collections import Counter
    counter: Counter = Counter()
    for item in metadata:
        text = (item.get("chunk_text", "") or "").lower()
        for w in es_mod.tokenize_words(text) if hasattr(es_mod, "tokenize_words") else text.split():
            if len(w) < 4:
                continue
            if w in _STOPWORDS_ES:
                continue
            if w.isdigit():
                continue
            counter[w] += 1
    vocab = [{"word": w, "count": c} for w, c in counter.most_common(10)]

    # ── FAISS meta ──
    n_vectors = state.index.ntotal if state.index is not None else 0
    dimension = state.index.d if state.index is not None else 0
    index_type = type(state.index).__name__ if state.index is not None else "—"
    try:
        index_size_bytes = os.path.getsize(FAISS_INDEX_FILE)
    except Exception:
        index_size_bytes = 0
    faiss_meta = {
        "n_vectors": int(n_vectors),
        "dimension": int(dimension),
        "index_type": index_type,
        "index_size_bytes": int(index_size_bytes),
        "model": EMBEDDING_MODEL,
    }

    # ── PCA 2D (sólo si tenemos embeddings persistidos) ──
    pca_points: list[dict] = []
    emb_path = os.path.join(OUTPUT_FOLDER, "embeddings.npy")
    if os.path.exists(emb_path) and len(metadata) > 2:
        try:
            from sklearn.decomposition import PCA
            emb = np.load(emb_path)
            n = min(len(emb), len(metadata))
            emb = emb[:n]
            # Submuestreo para no enviar cientos de KB en JSON
            MAX_POINTS = 350
            if n > MAX_POINTS:
                idxs = np.linspace(0, n - 1, MAX_POINTS).astype(int)
            else:
                idxs = np.arange(n)
            pca = PCA(n_components=2)
            coords = pca.fit_transform(emb[idxs])
            doc_color = {d["documento"]: _DOC_PALETTE[i % len(_DOC_PALETTE)]
                         for i, d in enumerate(doc_stats)}
            for k, idx in enumerate(idxs):
                m = metadata[int(idx)]
                pca_points.append({
                    "pca_x": float(coords[k, 0]),
                    "pca_y": float(coords[k, 1]),
                    "chunk_id": int(m.get("chunk_id", idx)),
                    "documento": m.get("documento", "?"),
                    "color": doc_color.get(m.get("documento", "?"), "#94a3b8"),
                })
        except Exception:
            pca_points = []

    # Color por doc (también para la tabla del front)
    for i, d in enumerate(doc_stats):
        d["color"] = _DOC_PALETTE[i % len(_DOC_PALETTE)]

    data = {
        "ready": True,
        "doc_stats": doc_stats,
        "faiss_meta": faiss_meta,
        "pca": pca_points,
        "vocab": vocab,
        "totals": totals,
    }
    _STATS_CACHE["sig"] = sig
    _STATS_CACHE["data"] = data
    return data


@app.get("/api/stats")
def api_stats():
    """
    Devuelve métricas reales del índice RAG actual:
      - doc_stats: chunks/tokens/palabras por documento
      - faiss_meta: vectores, dimensión, tipo de índice, tamaño en disco
      - pca: proyección 2D de los embeddings (submuestreo a ≤350 puntos)
      - vocab: top-10 palabras del corpus (sin stopwords)
      - totals: agregados globales
    """
    try:
        return _compute_stats()
    except Exception as e:
        # Nunca devolvemos 500 al dashboard: preferimos un payload vacío.
        return JSONResponse(
            {"ready": False, "error": str(e),
             "doc_stats": [], "faiss_meta": None, "pca": [], "vocab": [],
             "totals": {"n_docs": 0, "n_chunks": 0, "n_tokens": 0, "n_words": 0, "avg_chunk_tokens": 0}},
            status_code=200,
        )


@app.get("/api/pdfs")
def api_list_pdfs():
    if not os.path.exists(DATA_FOLDER):
        return []
    return [
        {"name": f, "size": os.path.getsize(os.path.join(DATA_FOLDER, f))}
        for f in sorted(os.listdir(DATA_FOLDER))
        if f.lower().endswith(".pdf")
    ]


@app.post("/api/upload")
async def api_upload(files: list[UploadFile] = File(...)):
    os.makedirs(DATA_FOLDER, exist_ok=True)
    saved = []
    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            continue
        # nombre seguro
        safe = os.path.basename(f.filename)
        dest = os.path.join(DATA_FOLDER, safe)
        with open(dest, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append({"name": safe, "size": os.path.getsize(dest)})
    return {"saved": saved}


@app.delete("/api/pdfs/{name}")
def api_delete_pdf(name: str):
    safe = os.path.basename(name)
    path = os.path.join(DATA_FOLDER, safe)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="PDF no encontrado")
    os.remove(path)
    return {"ok": True, "deleted": safe}


@app.post("/api/rebuild")
def api_rebuild():
    if state.rebuilding:
        raise HTTPException(status_code=409, detail="Ya hay una regeneración en curso")
    try:
        _do_rebuild()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {
        "ok": True,
        "n_chunks": len(state.metadata),
    }


@app.post("/api/ask")
def api_ask(req: AskRequest):
    if state.index is None or not state.metadata:
        raise HTTPException(
            status_code=400,
            detail="El índice RAG no está disponible. Sube PDFs y pulsa 'Regenerar RAG'."
        )
    if state.llm_client is None:
        # Intento de reconexión silencioso
        state.connect_llm()
        if state.llm_client is None:
            raise HTTPException(
                status_code=503,
                detail=f"LM Studio no responde en {LM_STUDIO_BASE_URL}. Levanta el servidor local.",
            )

    # ── Query Rewriting + Expansion (antes del retrieval) ──
    enhanced_query = _rewrite_and_expand_query(
        req.question,
        req.history if req.use_history else [],
    )

    # Recuperar fragmentos con la consulta optimizada
    results = _retrieve(enhanced_query, top_k=max(1, min(req.top_k, 15)))
    context = _build_context(results)

    system_prompt = (
        "You are an expert assistant designed to answer questions based strictly on the provided documents. "
        "Answer using ONLY the retrieved text fragments. "
        "If the answer is not found in the provided context, say so clearly and do not invent information. "
        "When possible, mention the fragment numbers that support your answer. "
        "Be clear and concise. "
        "IMPORTANT: Detect the language of the user's question and respond in that same language. "
        "If the question is in Spanish, answer entirely in Spanish. If the question is in English, answer entirely in English."
    )

    messages = [{"role": "system", "content": system_prompt}]

    # Historial de conversación previo (solo turnos completos)
    if req.use_history and req.history:
        hist_msgs = [
            m for m in req.history[-12:]
            if m.role in ("user", "assistant") and m.content.strip()
        ]
        # El historial debe empezar siempre con un mensaje 'user'
        # (el mensaje de bienvenida del asistente rompe el template Jinja de LM Studio)
        while hist_msgs and hist_msgs[0].role == "assistant":
            hist_msgs.pop(0)
        # Y debe terminar con 'assistant' para no generar dos 'user' consecutivos
        while hist_msgs and hist_msgs[-1].role == "user":
            hist_msgs.pop()
        for m in hist_msgs:
            messages.append({"role": m.role, "content": m.content})

    user_prompt = (
        f"Question:\n{req.question}\n\n"
        f"Retrieved context:\n{context}\n\n"
        "Answer based only on the context above, in the same language as the question. Cite relevant fragments."
    )
    messages.append({"role": "user", "content": user_prompt})

    try:
        response = state.llm_client.chat.completions.create(
            model=state.llm_model_name,
            temperature=float(req.temperature),
            messages=messages,
        )
        answer = response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error llamando al LLM: {e}")

    return {
        "answer": answer,
        "sources": results,
        "model": state.llm_model_name,
        "device": state.device,
        "n_sources": len(results),
        "original_query": req.question,
        "enhanced_query": enhanced_query,
    }


@app.post("/api/ask/stream")
def api_ask_stream(req: AskRequest):
    """
    Igual que /api/ask pero devuelve Server-Sent Events (SSE) con:
      - { type: "status", msg: "..." }          estado del proceso
      - { type: "chunk",  index, doc, score, chunk_id }  fragmento RAG recuperado
      - { type: "token",  content: "..." }       token del LLM en tiempo real
      - { type: "done",   sources: [...] }       fin de la respuesta
      - { type: "error",  msg: "..." }           si algo falla
    """
    if state.index is None or not state.metadata:
        raise HTTPException(
            status_code=400,
            detail="El índice RAG no está disponible. Sube PDFs y pulsa 'Regenerar RAG'."
        )
    if state.llm_client is None:
        state.connect_llm()
        if state.llm_client is None:
            raise HTTPException(
                status_code=503,
                detail=f"LM Studio no responde en {LM_STUDIO_BASE_URL}."
            )

    # Construir el prompt de historial aquí (fuera del generador, en hilo sync)
    system_prompt = (
        "You are an expert assistant designed to answer questions based strictly on the provided documents. "
        "Answer using ONLY the retrieved text fragments. "
        "If the answer is not found in the provided context, say so clearly and do not invent information. "
        "When possible, mention the fragment numbers that support your answer. "
        "Be clear and concise. "
        "IMPORTANT: Detect the language of the user's question and respond in that same language. "
        "If the question is in Spanish, answer entirely in Spanish. If the question is in English, answer entirely in English."
    )

    def build_messages(context: str, question: str) -> list:
        msgs = [{"role": "system", "content": system_prompt}]
        if req.use_history and req.history:
            hist = [
                m for m in req.history[-12:]
                if m.role in ("user", "assistant") and m.content.strip()
            ]
            while hist and hist[0].role == "assistant":
                hist.pop(0)
            while hist and hist[-1].role == "user":
                hist.pop()
            for m in hist:
                msgs.append({"role": m.role, "content": m.content})
        user_prompt = (
            f"Question:\n{question}\n\n"
            f"Retrieved context:\n{context}\n\n"
            "Answer based only on the context above, in the same language as the question. Cite relevant fragments."
        )
        msgs.append({"role": "user", "content": user_prompt})
        return msgs

    def sse(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    def generate():
        # ── 0. Query Rewriting + Expansion ──
        yield sse({"type": "status", "msg": "✍ Reescribiendo y expandiendo la consulta…"})
        try:
            enhanced_query = _rewrite_and_expand_query(
                req.question,
                req.history if req.use_history else [],
            )
        except Exception:
            enhanced_query = req.question

        if enhanced_query and enhanced_query.strip() and enhanced_query.strip() != req.question.strip():
            yield sse({"type": "status", "msg": f"💡 Consulta expandida: {enhanced_query}"})
        else:
            yield sse({"type": "status", "msg": "💡 Consulta sin cambios tras el rewriting"})

        # ── 1. Recuperar fragmentos ──
        yield sse({"type": "status", "msg": "🔍 Buscando en el índice FAISS…"})

        results = _retrieve(enhanced_query, top_k=max(1, min(req.top_k, 15)))

        if not results:
            yield sse({"type": "status", "msg": "⚠ Sin fragmentos relevantes encontrados."})
        else:
            yield sse({"type": "status", "msg": f"✓ {len(results)} fragmento(s) recuperado(s)"})

        for i, r in enumerate(results):
            yield sse({
                "type":     "chunk",
                "index":    i + 1,
                "doc":      r["documento"],
                "score":    round(r["score"], 4),
                "chunk_id": r["chunk_id"],
            })

        context = _build_context(results)

        # ── 2. Llamar al LLM con streaming ──
        yield sse({"type": "status", "msg": f"🤖 Llamando a {state.llm_model_name}…"})

        # Para la generación final usamos la pregunta original del usuario,
        # así la respuesta del LLM se ajusta a su intención literal y no a la
        # consulta expandida (que está pensada para el retrieval, no para el chat).
        messages = build_messages(context, req.question)

        try:
            stream = state.llm_client.chat.completions.create(
                model=state.llm_model_name,
                temperature=float(req.temperature),
                messages=messages,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield sse({"type": "token", "content": chunk.choices[0].delta.content})

        except Exception as e:
            yield sse({"type": "error", "msg": f"Error LLM: {e}"})
            return

        # ── 3. Fin ──
        yield sse({
            "type": "done",
            "sources": results,
            "original_query": req.question,
            "enhanced_query": enhanced_query,
        })

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


@app.post("/api/ask/agent")
def api_ask_agent(req: AgentAskRequest):
    """
    Agente RAG con function calling.

    El LLM decide de forma autónoma si buscar en documentos, calcular,
    consultar la fecha/hora o examinar el índice.  Devuelve la respuesta
    final junto con un log de las herramientas invocadas.
    """
    if state.index is None or not state.metadata:
        raise HTTPException(
            status_code=400,
            detail="El índice RAG no está disponible. Sube PDFs y pulsa 'Regenerar RAG'.",
        )
    if state.llm_client is None:
        state.connect_llm()
        if state.llm_client is None:
            raise HTTPException(
                status_code=503,
                detail=f"LM Studio no responde en {LM_STUDIO_BASE_URL}.",
            )

    # Estado compatible con las herramientas de agent_llm
    agent_state = {
        "index": state.index,
        "metadata": state.metadata,
        "embedding_model": state.embedding_model,
    }

    messages = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {"role": "user",   "content": req.question},
    ]
    tool_calls_log: list[dict] = []

    for iteration in range(1, req.max_iterations + 1):
        try:
            response = state.llm_client.chat.completions.create(
                model=state.llm_model_name,
                temperature=float(req.temperature),
                messages=messages,
                tools=AGENT_TOOLS,
                tool_choice="auto",
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error llamando al LLM: {e}")

        choice = response.choices[0]
        msg = choice.message
        finish_reason = choice.finish_reason

        if finish_reason == "stop" or not msg.tool_calls:
            return {
                "answer": msg.content or "",
                "tool_calls_log": tool_calls_log,
                "iterations_used": iteration,
                "model": state.llm_model_name,
                "device": state.device,
            }

        messages.append(msg)

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            raw_result = _agent_dispatch(fn_name, fn_args, agent_state)
            try:
                parsed_result = json.loads(raw_result)
            except Exception:
                parsed_result = {"raw": raw_result}

            tool_calls_log.append({
                "iteration": iteration,
                "tool": fn_name,
                "args": fn_args,
                "result": parsed_result,
            })

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": raw_result,
            })

    return {
        "answer": "El agente alcanzó el límite de iteraciones sin producir una respuesta.",
        "tool_calls_log": tool_calls_log,
        "iterations_used": req.max_iterations,
        "model": state.llm_model_name,
        "device": state.device,
    }


# =========================
# UI ESTÁTICA
# =========================
if os.path.isdir(WEB_FOLDER):
    @app.get("/")
    def root_index():
        idx = os.path.join(WEB_FOLDER, "index.html")
        if os.path.exists(idx):
            return FileResponse(idx)
        return JSONResponse({"detail": "web/index.html no encontrado"}, status_code=404)

    app.mount("/web", StaticFiles(directory=WEB_FOLDER, html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.api:app", host="127.0.0.1", port=8000, reload=False)
