import sys
sys.stdout.reconfigure(encoding='utf-8')
from pathlib import Path
from pypdf import PdfReader


def read_pdf(path: Path) -> str:
    text = []
    reader = PdfReader(str(path))
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text.append(page_text)
    return "\n".join(text)


def read_txt(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def load_documents(data_dir: str = "../data") -> list:
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