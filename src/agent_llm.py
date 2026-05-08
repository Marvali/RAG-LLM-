"""
Agente RAG con function calling (Fase 3).

El LLM recibe la pregunta y decide de forma autónoma:
  - Si puede responder directamente con conocimiento general.
  - Si necesita buscar en los documentos indexados (search_documents).
  - Si necesita hacer un cálculo (calculate).
  - Si necesita saber la fecha/hora actual (get_current_datetime).
  - Si quiere saber qué documentos están disponibles (get_index_info).

La query de búsqueda la formula el propio modelo, optimizada para
recuperación semántica y no necesariamente igual a la pregunta del usuario.
"""

import os
import sys
import json
import math
import datetime
import textwrap
import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import faiss
except ImportError:
    raise ImportError("pip install faiss-cpu")

import torch
from sentence_transformers import SentenceTransformer

try:
    from openai import OpenAI
except ImportError:
    raise ImportError("pip install openai")


# =========================
# CONFIGURACIÓN
# =========================
OUTPUT_FOLDER = "output"
FAISS_INDEX_FILE = os.path.join(OUTPUT_FOLDER, "faiss_index.bin")
METADATA_JSON_FILE = os.path.join(OUTPUT_FOLDER, "faiss_metadata.json")

EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
USE_COSINE_SIMILARITY = True

LM_STUDIO_BASE_URL = "http://localhost:1234/v1"
LM_STUDIO_API_KEY = "lm-studio"
LLM_MODEL = "local-model"

MAX_CHUNK_CHARS_PER_RESULT = 1200
TEMPERATURE = 0.2
MAX_AGENT_ITERATIONS = 6


# =========================
# DEFINICIÓN DE HERRAMIENTAS
# =========================
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": (
                "Searches the indexed document collection using semantic similarity to retrieve "
                "relevant text fragments. Use this tool whenever the user asks about specific "
                "content, rules, articles, definitions, procedures, or facts that may be "
                "contained in the documents. "
                "IMPORTANT: Formulate the 'query' parameter using KEY CONCEPTS and technical "
                "terms related to what you are looking for — do NOT simply copy the user's "
                "question verbatim. Synonyms, domain vocabulary, and conceptual expansions "
                "improve retrieval quality. "
                "Do NOT use this tool for general knowledge questions, arithmetic, or "
                "questions about the current date/time — use the other tools for those."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "A semantic search query optimized for retrieval. Should contain "
                            "key concepts and technical vocabulary relevant to the information "
                            "needed. May differ substantially from the user's original phrasing. "
                            "Example: user asks '¿Cuáles son las sanciones?' → good query: "
                            "'sanciones infracciones penalidades consecuencias incumplimiento'."
                        ),
                    },
                    "top_k": {
                        "type": "integer",
                        "description": (
                            "Number of document fragments to retrieve (1–10). "
                            "Use 3-5 for focused queries, up to 8-10 when broad coverage is needed. "
                            "Default: 5."
                        ),
                        "default": 5,
                        "minimum": 1,
                        "maximum": 10,
                    },
                    "min_score": {
                        "type": "number",
                        "description": (
                            "Minimum cosine similarity threshold (0.0–1.0). "
                            "Fragments below this score are excluded. "
                            "Use 0.3–0.5 to filter weak matches; 0.0 keeps all results. "
                            "Default: 0.0."
                        ),
                        "default": 0.0,
                        "minimum": 0.0,
                        "maximum": 1.0,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_datetime",
            "description": (
                "Returns the current date and time in UTC. "
                "Use this when the user asks about today's date, the current time, "
                "what day of the week it is, or any question that requires knowing 'now'."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": (
                "Evaluates a safe mathematical expression and returns the numeric result. "
                "Supports: arithmetic (+, -, *, /, //, %, **), comparison operators, "
                "and math functions: sqrt, log, log10, log2, sin, cos, tan, pi, e, "
                "abs, round, floor, ceil, pow, min, max. "
                "Use this for any calculation the user needs: percentages, conversions, "
                "sums of values extracted from documents, etc."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": (
                            "A valid mathematical expression string. "
                            "Examples: '2 + 2', '150 * 0.21', 'sqrt(144)', "
                            "'round((1000 / 12) * 3, 2)', 'pi * 5**2'."
                        ),
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_index_info",
            "description": (
                "Returns metadata about the document knowledge base: which documents are "
                "indexed, total number of text fragments, and index configuration. "
                "Use this when the user asks what documents are available, what topics "
                "the system has knowledge about, or to understand the scope of the index "
                "before deciding whether to search."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]


# =========================
# IMPLEMENTACIONES DE HERRAMIENTAS
# =========================

def _tool_search_documents(
    query: str,
    top_k: int,
    min_score: float,
    state: dict,
) -> dict:
    import time

    model = state["embedding_model"]
    index = state["index"]
    metadata = state["metadata"]

    t0 = time.perf_counter()

    query_vec = model.encode(
        [query],
        convert_to_numpy=True,
        normalize_embeddings=False,
        show_progress_bar=False,
    )[0].astype("float32")

    if USE_COSINE_SIMILARITY:
        norm = np.linalg.norm(query_vec)
        if norm > 0:
            query_vec = query_vec / norm

    distances, indices = index.search(query_vec.reshape(1, -1), top_k)

    results = []
    for score, idx in zip(distances[0], indices[0]):
        if idx < 0 or idx >= len(metadata):
            continue
        if float(score) < min_score:
            continue
        item = metadata[idx]
        results.append({
            "rank": len(results) + 1,
            "score": round(float(score), 4),
            "documento": item["documento"],
            "chunk_id": item["chunk_id"],
            "chunk_len": item["chunk_len"],
            "text": item["chunk_text"][:MAX_CHUNK_CHARS_PER_RESULT],
        })

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    return {
        "query_used": query,
        "total_results": len(results),
        "search_time_ms": elapsed_ms,
        "results": results,
    }


def _tool_get_current_datetime() -> dict:
    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        "datetime_utc": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "date": now.strftime("%Y-%m-%d"),
        "time_utc": now.strftime("%H:%M:%S"),
        "day_of_week": now.strftime("%A"),
        "unix_timestamp": int(now.timestamp()),
    }


_SAFE_MATH_NS: dict = {
    "__builtins__": {},
    "sqrt": math.sqrt,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "pi": math.pi,
    "e": math.e,
    "abs": abs,
    "round": round,
    "floor": math.floor,
    "ceil": math.ceil,
    "pow": pow,
    "min": min,
    "max": max,
}


def _tool_calculate(expression: str) -> dict:
    try:
        result = eval(expression, _SAFE_MATH_NS)  # noqa: S307
        return {
            "expression": expression,
            "result": result,
            "result_formatted": str(result),
        }
    except ZeroDivisionError:
        return {"expression": expression, "error": "División por cero"}
    except Exception as exc:
        return {"expression": expression, "error": f"Error al evaluar: {exc}"}


def _tool_get_index_info(state: dict) -> dict:
    index = state["index"]
    metadata = state["metadata"]

    doc_chunks: dict[str, int] = {}
    for item in metadata:
        doc = item["documento"]
        doc_chunks[doc] = doc_chunks.get(doc, 0) + 1

    return {
        "total_fragments": len(metadata),
        "total_vectors_in_index": index.ntotal,
        "embedding_model": EMBEDDING_MODEL,
        "similarity_metric": "cosine" if USE_COSINE_SIMILARITY else "euclidean",
        "documents": [
            {"name": name, "fragments": count}
            for name, count in sorted(doc_chunks.items())
        ],
    }


def _dispatch(tool_name: str, tool_args: dict, state: dict) -> str:
    try:
        if tool_name == "search_documents":
            result = _tool_search_documents(
                query=tool_args.get("query", ""),
                top_k=int(tool_args.get("top_k", 5)),
                min_score=float(tool_args.get("min_score", 0.0)),
                state=state,
            )
        elif tool_name == "get_current_datetime":
            result = _tool_get_current_datetime()
        elif tool_name == "calculate":
            result = _tool_calculate(str(tool_args.get("expression", "")))
        elif tool_name == "get_index_info":
            result = _tool_get_index_info(state=state)
        else:
            result = {"error": f"Herramienta desconocida: '{tool_name}'"}
    except Exception as exc:
        result = {"error": str(exc)}

    return json.dumps(result, ensure_ascii=False, indent=2)


# =========================
# PROMPT DEL SISTEMA
# =========================
SYSTEM_PROMPT = """\
You are an intelligent assistant with access to an indexed document knowledge base and several tools.

Reasoning process:
1. Read the user's question carefully.
2. Decide whether you need information from the indexed documents, a calculation, the current date/time, or index metadata.
3. For factual questions about document content, ALWAYS call search_documents — do not answer from general knowledge alone.
4. When searching, craft a query that uses KEY CONCEPTS and technical terms relevant to the topic, not a copy of the user's question.
5. You may call multiple tools in sequence (e.g., search first, then calculate based on what you find).
6. If search results do not contain enough information, acknowledge it explicitly.
7. IMPORTANT: Detect the language of the user's question and respond in that same language.
"""


# =========================
# BUCLE DEL AGENTE
# =========================
def run_agent(user_question: str, state: dict, client: OpenAI, model_name: str) -> str:
    """
    Agentic loop: sends the question, executes tool calls returned by the LLM,
    appends results, and repeats until the model produces a final textual answer.
    """
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_question},
    ]

    for iteration in range(1, MAX_AGENT_ITERATIONS + 1):
        print(f"\n[Agente — iteración {iteration}/{MAX_AGENT_ITERATIONS}]")

        response = client.chat.completions.create(
            model=model_name,
            temperature=TEMPERATURE,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )

        choice = response.choices[0]
        msg = choice.message
        finish_reason = choice.finish_reason

        if finish_reason == "stop" or not msg.tool_calls:
            return msg.content or ""

        # Append assistant turn (with tool_calls) before executing them
        messages.append(msg)

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            print(f"  → {fn_name}({json.dumps(fn_args, ensure_ascii=False)})")
            tool_result = _dispatch(fn_name, fn_args, state)

            preview = tool_result[:300]
            suffix = "…" if len(tool_result) > 300 else ""
            print(f"    ✓ {preview}{suffix}")

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": tool_result,
            })

    return "El agente alcanzó el límite de iteraciones sin producir una respuesta final."


# =========================
# CARGA DE RECURSOS
# =========================
def load_state() -> dict:
    for path in (FAISS_INDEX_FILE, METADATA_JSON_FILE):
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"Archivo no encontrado: {path}\n"
                "Ejecuta primero build_faiss_index.py para generar el índice."
            )

    print("Cargando índice FAISS...")
    index = faiss.read_index(FAISS_INDEX_FILE)
    print(f"  Vectores indexados: {index.ntotal}")

    print("Cargando metadata...")
    with open(METADATA_JSON_FILE, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    print(f"  Chunks en metadata: {len(metadata)}")

    if index.ntotal != len(metadata):
        raise ValueError(
            f"Desajuste entre índice ({index.ntotal}) y metadata ({len(metadata)}).\n"
            "Regenera el índice con build_faiss_index.py."
        )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Cargando modelo de embeddings ({EMBEDDING_MODEL}) en {device}...")
    embedding_model = SentenceTransformer(EMBEDDING_MODEL, device=device)

    return {
        "index": index,
        "metadata": metadata,
        "embedding_model": embedding_model,
        "device": device,
    }


# =========================
# PUNTO DE ENTRADA
# =========================
def main() -> None:
    state = load_state()

    print("\nConectando con LM Studio...")
    client = OpenAI(base_url=LM_STUDIO_BASE_URL, api_key=LM_STUDIO_API_KEY)

    model_name = LLM_MODEL
    try:
        models = client.models.list()
        data = getattr(models, "data", None)
        if data:
            model_name = data[0].id
    except Exception:
        pass
    print(f"Modelo LLM detectado: {model_name}")

    # ── Modo argumento ──────────────────────────────────────────────────
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:]).strip()
        print(f"\nPregunta: {question}")
        answer = run_agent(question, state, client, model_name)
        print("\n" + "=" * 80)
        print("RESPUESTA")
        print("=" * 80)
        print(textwrap.fill(answer, width=100))
        return

    # ── Modo interactivo ────────────────────────────────────────────────
    print("\nAgente RAG con function calling activo.")
    print("Escribe tu pregunta y pulsa Enter. Enter vacío para salir.\n")

    while True:
        try:
            question = input("Pregunta > ").strip()
        except EOFError:
            print("\nEntrada no interactiva detectada. Saliendo.")
            break

        if not question:
            print("Saliendo.")
            break

        answer = run_agent(question, state, client, model_name)
        print("\n" + "=" * 80)
        print("RESPUESTA")
        print("=" * 80)
        print(textwrap.fill(answer, width=100))
        print()


if __name__ == "__main__":
    main()
