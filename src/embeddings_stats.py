import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
import re
from collections import Counter

import numpy as np
import pandas as pd
import torch
from tqdm import tqdm
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from sklearn.decomposition import PCA


# =========================
# CONFIGURACIÓN
# =========================
PDF_FOLDER = "data"                  # carpeta donde tienes los PDFs
OUTPUT_FOLDER = "output"             # carpeta de salida
CHUNK_SIZE = 1000                    # tamaño de chunk en caracteres
CHUNK_OVERLAP = 200                  # solapamiento entre chunks
TOP_N_WORDS = 30                     # vocabulario más frecuente
EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
BATCH_SIZE = 32


# =========================
# UTILIDADES
# =========================
def ensure_output_folder(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def list_pdf_files(folder: str) -> list[str]:
    if not os.path.exists(folder):
        raise FileNotFoundError(f"La carpeta '{folder}' no existe.")
    pdfs = [
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if f.lower().endswith(".pdf")
    ]
    return pdfs


def extract_text_from_pdf(pdf_path: str) -> str:
    """
    Extrae texto de un PDF usando pypdf.
    """
    try:
        reader = PdfReader(pdf_path)
        pages_text = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages_text.append(text)
        return "\n".join(pages_text)
    except Exception as e:
        print(f"[ERROR] No se pudo leer '{pdf_path}': {e}")
        return ""


def clean_text(text: str) -> str:
    """
    Limpieza básica:
    - normaliza espacios
    - elimina saltos repetidos
    """
    if not text:
        return ""

    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def tokenize_words(text: str) -> list[str]:
    """
    Tokenización simple para estadísticas de vocabulario.
    """
    if not text:
        return []
    return re.findall(r"\b[a-zA-Z0-9_]+\b", text.lower())


def estimate_tokens(text: str) -> int:
    """
    Estimación simple de tokens.
    Aproximación razonable para estadísticas generales.
    """
    words = text.split()
    return int(len(words) * 1.47)


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """
    Divide texto en chunks por caracteres con overlap.
    Evita devolver chunks vacíos.
    """
    if not text or not text.strip():
        return []

    if overlap >= chunk_size:
        raise ValueError("CHUNK_OVERLAP debe ser menor que CHUNK_SIZE.")

    chunks = []
    start = 0
    text = text.strip()

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        start += chunk_size - overlap

    return chunks


# =========================
# ESTADÍSTICAS
# =========================
def build_document_stats(documents: list[dict]) -> pd.DataFrame:
    rows = []
    for doc in documents:
        text = doc["text"]
        words = text.split()
        num_words = len(words)
        num_tokens = estimate_tokens(text)
        ratio = (num_tokens / num_words) if num_words > 0 else 0

        rows.append(
            {
                "documento": os.path.basename(doc["path"]),
                "caracteres": len(text),
                "palabras": num_words,
                "tokens": num_tokens,
                "ratio_tokens_palabra": round(ratio, 3),
            }
        )

    return pd.DataFrame(rows)


def build_vocab_stats(documents: list[dict], top_n: int = 30) -> pd.DataFrame:
    counter = Counter()

    for doc in documents:
        words = tokenize_words(doc["text"])
        counter.update(words)

    most_common = counter.most_common(top_n)
    return pd.DataFrame(most_common, columns=["palabra", "frecuencia"])


# =========================
# EMBEDDINGS
# =========================
def load_embedding_model(model_name: str) -> tuple[SentenceTransformer, str]:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print("\nCargando modelo de embeddings en GPU..." if device == "cuda" else "\nCargando modelo de embeddings en CPU...")
    model = SentenceTransformer(model_name, device=device)
    return model, device


def generate_embeddings(model: SentenceTransformer, chunks: list[dict], batch_size: int = 32) -> np.ndarray:
    texts = [c["chunk_text"] for c in chunks if c["chunk_text"].strip()]

    if not texts:
        raise ValueError(
            "No hay chunks válidos para generar embeddings. "
            "Revisa la extracción del texto o el chunking."
        )

    print("\nGenerando embeddings...")
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=False,
    )

    embeddings = np.asarray(embeddings)

    if embeddings.size == 0:
        raise ValueError("La matriz de embeddings está vacía.")
    if embeddings.ndim != 2:
        raise ValueError(f"Embeddings con forma inválida: {embeddings.shape}")

    return embeddings


def reduce_embeddings_pca(embeddings: np.ndarray) -> np.ndarray:
    if embeddings.ndim != 2 or embeddings.shape[0] == 0:
        raise ValueError(f"No se puede aplicar PCA a embeddings con shape {embeddings.shape}")

    if embeddings.shape[0] < 2:
        raise ValueError("Se necesitan al menos 2 embeddings para aplicar PCA a 2 dimensiones.")

    pca = PCA(n_components=2)
    coords = pca.fit_transform(embeddings)
    return coords


# =========================
# MAIN
# =========================
def main():
    ensure_output_folder(OUTPUT_FOLDER)

    pdf_files = list_pdf_files(PDF_FOLDER)
    if not pdf_files:
        raise FileNotFoundError(f"No se encontraron PDFs en la carpeta '{PDF_FOLDER}'.")

    documents = []
    all_chunks = []

    print("Leyendo PDFs...\n")

    for pdf_path in pdf_files:
        raw_text = extract_text_from_pdf(pdf_path)
        text = clean_text(raw_text)

        if not text:
            print(f"[WARN] '{os.path.basename(pdf_path)}' no devolvió texto útil. Se omite.")
            continue

        doc = {
            "path": pdf_path,
            "text": text,
        }
        documents.append(doc)

        doc_chunks = chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)

        for i, chunk in enumerate(doc_chunks):
            all_chunks.append(
                {
                    "documento": os.path.basename(pdf_path),
                    "chunk_id": i,
                    "chunk_text": chunk,
                    "chunk_len": len(chunk),
                }
            )

    if not documents:
        raise ValueError("No se pudo extraer texto útil de ningún PDF.")

    if not all_chunks:
        raise ValueError(
            "No se generó ningún chunk. "
            "Revisa CHUNK_SIZE, CHUNK_OVERLAP o la extracción de texto."
        )

    # =========================
    # ESTADÍSTICAS POR DOCUMENTO
    # =========================
    df_docs = build_document_stats(documents)
    print("\n=== Estadísticas por documento ===")
    print(df_docs.to_string(index=False))

    docs_csv = os.path.join(OUTPUT_FOLDER, "document_stats.csv")
    df_docs.to_csv(docs_csv, index=False, encoding="utf-8-sig")

    # =========================
    # VOCABULARIO
    # =========================
    df_vocab = build_vocab_stats(documents, top_n=TOP_N_WORDS)
    print("\n=== Vocabulario más frecuente ===")
    print(df_vocab.to_string(index=False))

    vocab_csv = os.path.join(OUTPUT_FOLDER, "vocab_stats.csv")
    df_vocab.to_csv(vocab_csv, index=False, encoding="utf-8-sig")

    # =========================
    # INFO CHUNKS
    # =========================
    df_chunks = pd.DataFrame(all_chunks)
    chunks_csv = os.path.join(OUTPUT_FOLDER, "chunks.csv")
    df_chunks.to_csv(chunks_csv, index=False, encoding="utf-8-sig")

    print(f"\nChunks generados: {len(all_chunks)}")
    print("Primer chunk preview:")
    print(repr(all_chunks[0]["chunk_text"][:300]))

    # =========================
    # EMBEDDINGS
    # =========================
    model, device = load_embedding_model(EMBEDDING_MODEL)
    print(f"Usando dispositivo: {device}")

    embeddings = generate_embeddings(model, all_chunks, batch_size=BATCH_SIZE)
    print(f"Shape embeddings: {embeddings.shape}")

    embeddings_npy = os.path.join(OUTPUT_FOLDER, "embeddings.npy")
    np.save(embeddings_npy, embeddings)

    # =========================
    # PCA
    # =========================
    coords = reduce_embeddings_pca(embeddings)
    print(f"Shape PCA coords: {coords.shape}")

    df_pca = df_chunks[["documento", "chunk_id", "chunk_len"]].copy()
    df_pca["pca_x"] = coords[:, 0]
    df_pca["pca_y"] = coords[:, 1]

    pca_csv = os.path.join(OUTPUT_FOLDER, "embeddings_pca.csv")
    df_pca.to_csv(pca_csv, index=False, encoding="utf-8-sig")

    print("\nArchivos generados:")
    print(f"- {docs_csv}")
    print(f"- {vocab_csv}")
    print(f"- {chunks_csv}")
    print(f"- {embeddings_npy}")
    print(f"- {pca_csv}")

    print("\nProceso completado correctamente.")


if __name__ == "__main__":
    main()