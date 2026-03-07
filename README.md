# RAG System for Formula 1 Technical Regulations (2026)

A Retrieval-Augmented Generation (RAG) pipeline that enables semantic search and question answering over the 2026 Formula 1 Technical Regulations using a local LLM.

## Overview

This project implements an intelligent document retrieval system that:
- **Processes** the official FIA F1 2026 Technical Regulations PDF
- **Converts** text into vector embeddings using transformer models
- **Indexes** embeddings with FAISS for fast semantic search
- **Retrieves** relevant document fragments based on user queries
- **Generates** accurate answers using a locally-running language model

Instead of relying solely on the LLM's pretraining knowledge, the system grounds responses in the actual regulation document content.

### Pipeline Flow

```
PDF Document
    ↓
Text Extraction & Chunking
    ↓
Embedding Generation
    ↓
FAISS Vector Index
    ↓
Semantic Search (User Query)
    ↓
Context Retrieval
    ↓
Local LLM (Qwen via LM Studio)
    ↓
Generated Answer
```

---

## 📋 Project Structure

```
RAG-LLM/
├── data/
│   └── fia_2026_formula_1_technical_regulations_issue_8_-_2024-06-24.pdf
│
├── output/
│   ├── chunks.csv
│   ├── embeddings.npy
│   ├── faiss_index.bin
│   └── faiss_metadata.json
│
├── src/
│   ├── embeddings_stats.py
│   ├── build_faiss_index.py
│   ├── search_faiss.py
│   └── ask_local_llm.py
│
└── README.md
```

### Directory Description

| Directory | Purpose |
|-----------|---------|
| **data/** | Source PDF document (FIA F1 2026 Technical Regulations) |
| **output/** | Generated artifacts (chunks, embeddings, FAISS index, metadata) |
| **src/** | Python scripts implementing the RAG pipeline |

---

## 🛠️ Technologies & Models

### Core Libraries
- **Python** - Programming language
- **FAISS** - Vector similarity search and indexing
- **Sentence Transformers** - Text-to-embedding conversion
- **PyPDF** - PDF text extraction
- **NumPy / Pandas** - Data processing
- **LM Studio** - Local LLM inference engine

### Models

| Component | Model | Purpose |
|-----------|-------|---------|
| **Embeddings** | `sentence-transformers/all-MiniLM-L6-v2` | Convert text chunks to vectors |
| **LLM** | `Qwen` (via LM Studio) | Generate natural language responses |

---

## 📦 Installation

### Prerequisites
- Python 3.8+
- LM Studio (download from [lmstudio.ai](https://lmstudio.ai))

### Step 1: Clone Repository

```bash
git clone https://github.com/yourusername/RAG-LLM.git
cd RAG-LLM
```

### Step 2: Install Python Dependencies

```bash
pip install sentence-transformers faiss-cpu numpy pandas pypdf openai torch tqdm
```

### Step 3: Set Up Local LLM

1. Download and install [LM Studio](https://lmstudio.ai)
2. Download the `Qwen` model (or your preferred model)
3. Start the LM Studio server on `localhost:1234`

---

## 🚀 Usage

### Step 1: Vectorize the PDF

Extract text from the PDF, split into chunks, and generate embeddings:

```bash
python src/embeddings_stats.py
```

**Output files:**
- `output/chunks.csv` - Document chunks and metadata
- `output/embeddings.npy` - Vector embeddings

### Step 2: Build FAISS Index

Create a searchable vector index:

```bash
python src/build_faiss_index.py
```

**Output files:**
- `output/faiss_index.bin` - FAISS index file
- `output/faiss_metadata.json` - Chunk metadata

### Step 3: Semantic Search (Optional)

Perform pure semantic search on the document:

```bash
python src/search_faiss.py
```

**Example query:**
```
What are the 2026 power unit rules?
```

The system returns the most relevant text fragments from the regulations.

### Step 4: Ask Questions with LLM

Generate complete answers by combining retrieval with LLM inference:

```bash
python src/ask_local_llm.py "Your question here"
```

**Example:**
```bash
python src/ask_local_llm.py "How many power units does a team have?"
```

**Output:**
```
The regulation does not provide a fixed number directly. It defines the minimum 
number of power units per team as the number allowed per driver per season under 
the Sporting Regulations multiplied by two, plus additional units required to 
complete 5000 km of testing.
```

---

## 📚 Example Queries

| Question | Type |
|----------|------|
| How many power units does a team have? | Factual |
| What are the aerodynamic restrictions? | Technical |
| Explain the new 2026 hybrid power unit regulations | Explanation |
| What is the minimum weight of the car? | Specification |

---

## 🔑 Key Concepts

- **Document Chunking** - Breaking the PDF into manageable text fragments
- **Text Embeddings** - Converting text to high-dimensional vectors capturing semantic meaning
- **Vector Similarity Search** - Finding chunks most relevant to a query
- **Retrieval-Augmented Generation (RAG)** - Combining retrieval with LLM generation for accurate, grounded responses
- **Local LLM Inference** - Running the language model on-device for privacy and offline capability

---

## 📊 Dataset

**Source:** Official FIA Formula 1 Technical Regulations (2026)
- Document: `fia_2026_formula_1_technical_regulations_issue_8_-_2024-06-24.pdf`
- Version: Issue 8
- Date: June 24, 2024

---

## 🔮 Future Improvements

- [ ] Smarter chunking based on document section hierarchy
- [ ] Query preprocessing and expansion
- [ ] Web UI for easier interaction
- [ ] Multi-document support (rules, sporting regulations, etc.)
- [ ] Vector database integration (ChromaDB, Weaviate, Pinecone)
- [ ] Conversation history and context management
- [ ] Custom fine-tuning on F1 domain
- [ ] Performance benchmarking and optimization

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 👤 Author

**Isaac**

---

## 📞 Support

For issues, questions, or contributions, please open an issue on GitHub.

---

**Last Updated:** March 2026
