import sys
sys.stdout.reconfigure(encoding='utf-8')
from pathlib import Path
from pypdf import PdfReader


def read_pdf(path: Path) -> str:
    """
    Leer PDF -> pasarlo a texto.
    Args:        path (Path): The path to the PDF file.
    Returns:        str: The extracted text from the PDF.
    """
    text = []
    reader = PdfReader(str(path))
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text.append(page_text)
    return "\n".join(text)


def read_txt(path: Path) -> str:
    """
    leer TXT -> pasarlo a texto.
    Args:        path (Path): The path to the text file.
    Returns:        str: The content of the text file.
    """

    return path.read_text(encoding="utf-8", errors="ignore")


def load_documents(data_dir: str = "../data") -> list:
    """Cargar documentos desde un directorio específico.
    Args:        data_dir (str): The directory containing the documents to load.
    Returns:        list: A list of dictionaries, each containing the source and text of a document.
    """
    data_path = Path(data_dir)
    documents = []

    for file_path in data_path.iterdir():
        if file_path.suffix.lower() == ".pdf":
            content = read_pdf(file_path)
        elif file_path.suffix.lower() in [".txt", ".md"]:
            content = read_txt(file_path)
        else:
            continue

        if content.strip():
            documents.append({
                "source": file_path.name,
                "text": content
            })

    return documents