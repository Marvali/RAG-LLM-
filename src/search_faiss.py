import os
import sys
import json
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


# =========================
# CONFIGURACIÓN
# =========================
OUTPUT_FOLDER = "output"
FAISS_INDEX_FILE = os.path.join(OUTPUT_FOLDER, "faiss_index.bin")
METADATA_JSON_FILE = os.path.join(OUTPUT_FOLDER, "faiss_metadata.json")

EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
TOP_K = 5
USE_COSINE_SIMILARITY = True


# =========================
# UTILIDADES
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


def format_score(score: float, use_cosine: bool = True) -> str:
    if use_cosine:
        return f"{score:.4f}"
    return f"{score:.4f}"


def print_results(distances, indices, metadata, use_cosine: bool = True):
    print("\n" + "=" * 80)
    print("RESULTADOS")
    print("=" * 80)

    found_any = False

    for rank, (score, idx) in enumerate(zip(distances, indices), start=1):
        if idx < 0 or idx >= len(metadata):
            continue

        found_any = True
        item = metadata[idx]

        print(f"\n[{rank}] Score: {format_score(float(score), use_cosine)}")
        print(f"Documento: {item['documento']}")
        print(f"Chunk ID: {item['chunk_id']}")
        print(f"Longitud: {item['chunk_len']}")
        print("-" * 80)
        print(item["chunk_text"][:1200])
        print("-" * 80)

    if not found_any:
        print("No se encontraron resultados válidos.")


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

    model, device = load_embedding_model(EMBEDDING_MODEL)
    print(f"Usando dispositivo: {device}")

    print("\nEscribe tu pregunta sobre el documento.")
    print("Pulsa Enter vacío para salir.\n")

    while True:
        query = input("Pregunta > ").strip()

        if not query:
            print("Saliendo.")
            break

        query_vector = embed_query(model, query, use_cosine=USE_COSINE_SIMILARITY)
        distances, indices = search_index(index, query_vector, top_k=TOP_K)

        print_results(distances, indices, metadata, use_cosine=USE_COSINE_SIMILARITY)


if __name__ == "__main__":
    main()