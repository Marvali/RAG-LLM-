"""
FastAPI backend que envuelve la pipeline RAG existente.

Endpoints:
    GET    /api/status         -> Estado del índice (chunks, docs, modelo, dispositivo)
    GET    /api/pdfs           -> Lista de PDFs en data/
    POST   /api/upload         -> Sube uno o varios PDFs a data/
    DELETE /api/pdfs/{name}    -> Borra un PDF de data/
    POST   /api/rebuild        -> Regenera embeddings + índice FAISS
    POST   /api/ask            -> Pregunta al RAG (chunks + LLM)
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
from fastapi.responses import FileResponse, JSONResponse
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

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
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
app = FastAPI(title="Agentic RAG - F1 2026", version="1.0.0")

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
            doc_chunks = es_mod.chunk_text(
                text,
                chunk_size=es_mod.CHUNK_SIZE,
                overlap=es_mod.CHUNK_OVERLAP,
            )
            for i, c in enumerate(doc_chunks):
                all_chunks.append({
                    "documento": os.path.basename(pdf_path),
                    "chunk_id": i,
                    "chunk_text": c,
                    "chunk_len": len(c),
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

    # Recuperar fragmentos
    results = _retrieve(req.question, top_k=max(1, min(req.top_k, 15)))
    context = _build_context(results)

    system_prompt = (
        "Eres un asistente experto en regulaciones técnicas de Fórmula 1 (FIA 2026). "
        "Respondes apoyándote ÚNICAMENTE en los fragmentos del documento que se te proporcionan. "
        "Si la respuesta no está en el contexto, dilo claramente. "
        "Cuando sea posible, menciona los números de fragmento que respaldan la respuesta. "
        "Sé claro, técnico y conciso."
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
        f"Pregunta:\n{req.question}\n\n"
        f"Contexto recuperado:\n{context}\n\n"
        "Responde basándote únicamente en el contexto. Cita los fragmentos relevantes."
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
