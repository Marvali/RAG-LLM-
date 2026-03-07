import os
import sys
import json
import textwrap
import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import faiss
except ImportError:
    raise ImportError(
        "No tienes FAISS instalado. Instala con:\n"
        "pip install faiss-cpu"
    )

import torch
from sentence_transformers import SentenceTransformer

try:
    from openai import OpenAI
except ImportError:
    raise ImportError(
        "No tienes la librería openai instalada. Instala con:\n"
        "pip install openai"
    )


# =========================
# CONFIGURACIÓN
# =========================
OUTPUT_FOLDER = "output"
FAISS_INDEX_FILE = os.path.join(OUTPUT_FOLDER, "faiss_index.bin")
METADATA_JSON_FILE = os.path.join(OUTPUT_FOLDER, "faiss_metadata.json")

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
TOP_K = 5
USE_COSINE_SIMILARITY = True

# LM Studio: OpenAI-compatible endpoint
LM_STUDIO_BASE_URL = "http://localhost:1234/v1"
LM_STUDIO_API_KEY = "lm-studio"  # puede ser cualquier string en local
LLM_MODEL = "local-model"        # luego intentamos autodetectar el nombre real

MAX_CONTEXT_CHARS = 5000
MAX_CHUNK_CHARS_PER_RESULT = 1200
TEMPERATURE = 0.2


# =========================
# UTILIDADES BASE
# =========================
def check_file_exists(path: str) -> None:
    if not os.path.exists(path):
        raise FileNotFoundError(f"No se encontró el archivo: {path}")


def load_faiss_index(path: str):
    print("Cargando índice FAISS...")
    index = faiss.read_index(path)
    print(f"Índice cargado. Vectores indexados: {index.ntotal}")
    return index


def load_metadata(path: str) -> list[dict]:
    print("Cargando metadata...")
    with open(path, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    if not isinstance(metadata, list) or len(metadata) == 0:
        raise ValueError("La metadata está vacía o no tiene formato válido.")

    print(f"Chunks en metadata: {len(metadata)}")
    return metadata


def load_embedding_model(model_name: str):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Cargando modelo de embeddings en {device}...")
    model = SentenceTransformer(model_name, device=device)
    return model, device


def normalize_vector(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    if norm == 0:
        return vec
    return vec / norm


def embed_query(model: SentenceTransformer, query: str, use_cosine: bool = True) -> np.ndarray:
    query_vec = model.encode(
        [query],
        convert_to_numpy=True,
        normalize_embeddings=False,
        show_progress_bar=False
    )[0].astype("float32")

    if use_cosine:
        query_vec = normalize_vector(query_vec)

    return query_vec.reshape(1, -1)


def search_index(index, query_vector: np.ndarray, top_k: int = 5):
    distances, indices = index.search(query_vector, top_k)
    return distances[0], indices[0]


def retrieve_chunks(query, model, index, metadata, top_k=5):
    query_vector = embed_query(model, query, use_cosine=USE_COSINE_SIMILARITY)
    distances, indices = search_index(index, query_vector, top_k=top_k)

    results = []
    for score, idx in zip(distances, indices):
        if idx < 0 or idx >= len(metadata):
            continue
        item = metadata[idx]
        results.append({
            "score": float(score),
            "documento": item["documento"],
            "chunk_id": item["chunk_id"],
            "chunk_len": item["chunk_len"],
            "chunk_text": item["chunk_text"],
        })
    return results


def build_context(results, max_context_chars=5000, max_chunk_chars=1200):
    context_parts = []
    current_len = 0

    for i, item in enumerate(results, start=1):
        chunk_text = item["chunk_text"][:max_chunk_chars].strip()
        block = (
            f"[Fragmento {i} | score={item['score']:.4f} | "
            f"doc={item['documento']} | chunk_id={item['chunk_id']}]\n"
            f"{chunk_text}\n"
        )

        if current_len + len(block) > max_context_chars:
            break

        context_parts.append(block)
        current_len += len(block)

    return "\n".join(context_parts)


# =========================
# LM STUDIO
# =========================
def create_lmstudio_client():
    return OpenAI(
        base_url=LM_STUDIO_BASE_URL,
        api_key=LM_STUDIO_API_KEY,
    )


def detect_loaded_model_name(client):
    """
    Intenta listar modelos del servidor compatible OpenAI.
    """
    try:
        models = client.models.list()
        data = getattr(models, "data", None)
        if data and len(data) > 0:
            return data[0].id
    except Exception:
        pass
    return LLM_MODEL


def ask_llm(client, model_name, user_question, context):
    system_prompt = (
        "You are a precise assistant answering questions about a technical document.\n"
        "Use only the provided context.\n"
        "If the answer is not in the context, say you are not sure based on the retrieved fragments.\n"
        "When possible, mention the relevant fragment numbers.\n"
        "Answer clearly and briefly."
    )

    user_prompt = (
        f"Question:\n{user_question}\n\n"
        f"Context:\n{context}\n\n"
        "Answer based only on the context."
    )

    response = client.chat.completions.create(
        model=model_name,
        temperature=TEMPERATURE,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    return response.choices[0].message.content


def print_retrieved_chunks(results):
    print("\n" + "=" * 80)
    print("CHUNKS RECUPERADOS")
    print("=" * 80)

    for i, item in enumerate(results, start=1):
        print(f"\n[{i}] Score: {item['score']:.4f}")
        print(f"Documento: {item['documento']}")
        print(f"Chunk ID: {item['chunk_id']}")
        print("-" * 80)
        print(item["chunk_text"][:800])
        print("-" * 80)


def run_query(query, emb_model, index, metadata, client, model_name):
    results = retrieve_chunks(
        query=query,
        model=emb_model,
        index=index,
        metadata=metadata,
        top_k=TOP_K
    )

    if not results:
        print("No se recuperaron chunks.")
        return

    print_retrieved_chunks(results)

    context = build_context(
        results,
        max_context_chars=MAX_CONTEXT_CHARS,
        max_chunk_chars=MAX_CHUNK_CHARS_PER_RESULT
    )

    print("\n" + "=" * 80)
    print("RESPUESTA DEL MODELO")
    print("=" * 80)

    answer = ask_llm(
        client=client,
        model_name=model_name,
        user_question=query,
        context=context
    )
    print(textwrap.fill(answer, width=100))


def main():
    check_file_exists(FAISS_INDEX_FILE)
    check_file_exists(METADATA_JSON_FILE)

    index = load_faiss_index(FAISS_INDEX_FILE)
    metadata = load_metadata(METADATA_JSON_FILE)

    if index.ntotal != len(metadata):
        raise ValueError(
            "El número de vectores del índice no coincide con la metadata.\n"
            f"Índice: {index.ntotal}\n"
            f"Metadata: {len(metadata)}"
        )

    emb_model, device = load_embedding_model(EMBEDDING_MODEL)
    print(f"Usando dispositivo para embeddings: {device}")

    print("Conectando con LM Studio...")
    client = create_lmstudio_client()
    model_name = detect_loaded_model_name(client)
    print(f"Modelo LM Studio detectado: {model_name}")

    # Modo argumento
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:]).strip()
        run_query(query, emb_model, index, metadata, client, model_name)
        return

    # Modo interactivo
    print("\nEscribe tu pregunta sobre el documento.")
    print("Pulsa Enter vacío para salir.\n")

    while True:
        try:
            query = input("Pregunta > ").strip()
        except EOFError:
            print("\nEntrada no interactiva detectada. Saliendo.")
            break

        if not query:
            print("Saliendo.")
            break

        run_query(query, emb_model, index, metadata, client, model_name)


if __name__ == "__main__":
    main()