import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
import json
import numpy as np
import pandas as pd

try:
    import faiss
except ImportError:
    raise ImportError(
        "No tienes FAISS instalado.\n"
        "Prueba con: pip install faiss-cpu\n"
        "Si estás en Windows y falla, te digo otra alternativa."
    )


# =========================
# CONFIGURACIÓN
# =========================
OUTPUT_FOLDER = "output"
EMBEDDINGS_FILE = os.path.join(OUTPUT_FOLDER, "embeddings.npy")
CHUNKS_FILE = os.path.join(OUTPUT_FOLDER, "chunks.csv")

FAISS_INDEX_FILE = os.path.join(OUTPUT_FOLDER, "faiss_index.bin")
METADATA_JSON_FILE = os.path.join(OUTPUT_FOLDER, "faiss_metadata.json")

USE_COSINE_SIMILARITY = True
SAVE_METADATA_AS_JSON = True


# =========================
# UTILIDADES
# =========================
def check_file_exists(path: str) -> None:
    if not os.path.exists(path):
        raise FileNotFoundError(f"No se encontró el archivo: {path}")


def load_embeddings(path: str) -> np.ndarray:
    embeddings = np.load(path)

    if not isinstance(embeddings, np.ndarray):
        raise TypeError("El archivo de embeddings no contiene un numpy array válido.")

    if embeddings.ndim != 2:
        raise ValueError(f"Los embeddings deben ser 2D. Shape recibido: {embeddings.shape}")

    if embeddings.shape[0] == 0:
        raise ValueError("El array de embeddings está vacío.")

    # FAISS espera float32
    embeddings = embeddings.astype("float32")

    return embeddings


def load_chunks(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig")

    required_cols = {"documento", "chunk_id", "chunk_text", "chunk_len"}
    missing = required_cols - set(df.columns)

    if missing:
        raise ValueError(f"Faltan columnas en chunks.csv: {missing}")

    if len(df) == 0:
        raise ValueError("El archivo chunks.csv está vacío.")

    return df


def normalize_embeddings(embeddings: np.ndarray) -> np.ndarray:
    """
    Normaliza cada embedding a norma 1.
    Esto permite usar producto interno como similitud coseno.
    """
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1e-12
    return embeddings / norms


def build_faiss_index(embeddings: np.ndarray, use_cosine: bool = True):
    dim = embeddings.shape[1]

    if use_cosine:
        # Para coseno: normalizar + IndexFlatIP
        embeddings = normalize_embeddings(embeddings)
        index = faiss.IndexFlatIP(dim)
    else:
        # Distancia euclídea
        index = faiss.IndexFlatL2(dim)

    index.add(embeddings)

    return index, embeddings


def save_metadata_json(df_chunks: pd.DataFrame, path: str) -> None:
    records = []

    for _, row in df_chunks.iterrows():
        records.append(
            {
                "documento": str(row["documento"]),
                "chunk_id": int(row["chunk_id"]),
                "chunk_len": int(row["chunk_len"]),
                "chunk_text": str(row["chunk_text"]),
            }
        )

    with open(path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def main():
    print("Comprobando archivos de entrada...")
    check_file_exists(EMBEDDINGS_FILE)
    check_file_exists(CHUNKS_FILE)

    print("Cargando embeddings...")
    embeddings = load_embeddings(EMBEDDINGS_FILE)
    print(f"Shape embeddings: {embeddings.shape}")

    print("Cargando chunks...")
    df_chunks = load_chunks(CHUNKS_FILE)
    print(f"Número de chunks en CSV: {len(df_chunks)}")

    if embeddings.shape[0] != len(df_chunks):
        raise ValueError(
            "El número de embeddings no coincide con el número de chunks.\n"
            f"Embeddings: {embeddings.shape[0]}\n"
            f"Chunks: {len(df_chunks)}"
        )

    print("Construyendo índice FAISS...")
    index, processed_embeddings = build_faiss_index(
        embeddings,
        use_cosine=USE_COSINE_SIMILARITY
    )

    print(f"Vectores indexados: {index.ntotal}")
    print(f"Dimensión: {processed_embeddings.shape[1]}")
    print(
        "Métrica: coseno (IndexFlatIP + normalización)"
        if USE_COSINE_SIMILARITY
        else "Métrica: L2"
    )

    print("Guardando índice FAISS...")
    faiss.write_index(index, FAISS_INDEX_FILE)

    if SAVE_METADATA_AS_JSON:
        print("Guardando metadata...")
        save_metadata_json(df_chunks, METADATA_JSON_FILE)

    print("\nArchivos generados:")
    print(f"- {FAISS_INDEX_FILE}")
    if SAVE_METADATA_AS_JSON:
        print(f"- {METADATA_JSON_FILE}")

    print("\nÍndice FAISS creado correctamente.")


if __name__ == "__main__":
    main()