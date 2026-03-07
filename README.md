# RAG System for Formula 1 Technical Regulations (2026)

This project implements a **Retrieval-Augmented Generation (RAG)** pipeline that allows querying the **2026 Formula 1 Technical Regulations** using a local LLM.

The system processes a PDF document, converts it into vector embeddings, indexes them using FAISS, and retrieves relevant fragments to answer user questions.

The language model runs locally through **LM Studio**, enabling offline semantic search and question answering.

---

# Project Overview

The pipeline works as follows:


PDF
↓
Text extraction
↓
Chunking (document split into fragments)
↓
Embedding generation
↓
Vector index (FAISS)
↓
Semantic search
↓
Context sent to local LLM
↓
Generated answer


This approach allows the model to answer questions based on the **actual content of the document**, instead of relying only on its pretraining knowledge.

---

# Technologies Used

- Python
- FAISS (vector similarity search)
- Sentence Transformers
- LM Studio (local LLM inference)
- NumPy / Pandas
- PyPDF

Models used:

- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`
- LLM: `Qwen` running locally via LM Studio

---

# Project Structure


RAG-LLM/
│
├── data/
│ └── fia_2026_formula_1_technical_regulations_issue_8_-_2024-06-24.pdf
│
├── output/
│ ├── chunks.csv
│ ├── embeddings.npy
│ ├── faiss_index.bin
│ └── faiss_metadata.json
│
├── src/
│ ├── embeddings_stats.py
│ ├── build_faiss_index.py
│ ├── search_faiss.py
│ └── ask_local_llm.py
│
└── README.md


---

# Installation

Clone the repository:


git clone https://github.com/yourusername/RAG-LLM.git

cd RAG-LLM


Install dependencies:


pip install sentence-transformers faiss-cpu numpy pandas pypdf openai torch tqdm


---

# Step 1: Vectorize the PDF

This script:

- extracts text from the PDF
- splits the document into chunks
- generates embeddings


python src/embeddings_stats.py


Generated files:


output/chunks.csv
output/embeddings.npy


---

# Step 2: Build the FAISS Index

Create a vector search index:


python src/build_faiss_index.py


Generated files:


output/faiss_index.bin
output/faiss_metadata.json


---

# Step 3: Search the Document

Perform semantic search on the regulation document:


python src/search_faiss.py


Example query:


What are the 2026 power unit rules?


The system returns the most relevant fragments from the document.

---

# Step 4: Ask the Local LLM

To generate full answers using retrieved fragments, run:


python src/ask_local_llm.py


Example:


python src/ask_local_llm.py "How many power units does a team have?"


The system will:

1. retrieve relevant chunks
2. send them as context to the LLM
3. generate a natural language answer

---

# Example Query


Question:
How many power units does a team have?

Answer:
The regulation does not provide a fixed number directly. It defines the minimum number of power units per team as the number allowed per driver per season under the Sporting Regulations multiplied by two, plus additional units required to complete 5000 km of testing.


---

# Dataset

The document used in this project is the official:

**FIA Formula 1 Technical Regulations (2026)**.

---

# Key Concepts Implemented

- Document chunking
- Text embeddings
- Vector similarity search
- Retrieval-Augmented Generation (RAG)
- Local LLM inference

---

# Future Improvements

Possible improvements include:

- smarter chunking based on document sections
- better query preprocessing
- UI interface for easier interaction
- multi-document support
- vector database integration (ChromaDB, Weaviate, etc.)

---

# Author

Isaac