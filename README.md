# MemoLink

**Context-Aware AI Companion for Knowledge Capture, Retrieval, and Task Support**

> Capstone Project 2026 — Design and Evaluation of a Context-Aware AI Companion for Knowledge Capture, Contextual Retrieval, and Task Support in Study and Work Settings.

---

## What is MemoLink?

MemoLink lets you capture notes and documents, then ask an AI questions grounded entirely in your personal knowledge base. Every answer cites the source notes that informed it — no hallucinated context, traceable responses.

**Core features:**
- Upload notes and documents (txt, PDF, DOCX, PPTX)
- Ask AI questions via RAG — answers cite your notes as sources
- Multi-turn conversations with persistent history
- Save AI responses back as notes
- Attach files directly in chat
- Markdown + LaTeX rendering in the editor and chat

---

## Project Structure

```
MemoLink/
├── memolink_backend/         FastAPI backend
│   ├── api/v1/               HTTP controllers
│   ├── business/             Services + interfaces
│   ├── domain/               Models, repos, interfaces
│   ├── contracts/            Pydantic DTOs
│   ├── core/                 DB, config, security (bcrypt)
│   └── di/                   Request-scoped DI container
│
├── memolink_web/             React + Vite + TypeScript frontend
│   └── src/
│       ├── api/              Axios API clients
│       ├── components/       Reusable UI components
│       └── pages/            LoginPage, ChatPage
│
├── Overview.html             Project overview (standalone HTML)
├── Requirements Analysis.html
├── Database Design.html
├── API Endpoint Design.html
│
├── requirements.txt          Python dependencies
├── .env.example              Environment variable template
└── CLAUDE.md                 Claude Code project instructions
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | FastAPI + Uvicorn |
| ORM | SQLAlchemy 2.0 |
| Database | PostgreSQL (Supabase) + pgvector |
| AI — Chat | OpenAI GPT-4o-mini |
| AI — Embeddings | text-embedding-3-small (1 536 dims) |
| Password hashing | passlib bcrypt |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| HTTP client | Axios |

---

## Architecture

MemoLink follows **Clean Architecture** with **Domain-Driven Design** and a **Dependency Injection** container:

```
Request → Controller (api/) → Service (business/) → Repository (domain/) → PostgreSQL
```

- Controllers are thin — they only call services via `RequestContainer`.
- Services contain application logic, depend on repository *interfaces*.
- Repositories contain all SQL/ORM queries.
- DTOs (`contracts/`) are separate from ORM models.

---

## RAG Pipeline

```
User prompt
    → Embed via text-embedding-3-small
    → pgvector cosine similarity search (top-K notes)
    → Build context: system prompt + retrieved note chunks
    → GPT generates answer
    → Return answer + source citations
```

---

## Getting Started

### Backend

```bash
cd "Capstone Project/MemoLink"

# 1. Create virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and OPENAI_API_KEY

# 4. Run
python -m uvicorn memolink_backend.main:app --reload

# API docs available at:
# http://localhost:8000/api/docs
```

### Frontend

```bash
cd memolink_web

# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env — set VITE_API_BASE_URL=http://localhost:8000/api

# 3. Run dev server
npm run dev

# 4. Build for production
npm run build
```

---

## Database Setup

MemoLink requires PostgreSQL with the **pgvector** extension. Supabase provides this out of the box.

1. Create a Supabase project
2. Enable the `vector` extension: `CREATE EXTENSION IF NOT EXISTS vector;`
3. Set `DATABASE_URL` in `.env`
4. The backend auto-creates tables on startup via `Base.metadata.create_all()`

---

## Improvements Over RecallAI

| Area | RecallAI | MemoLink |
|---|---|---|
| Password storage | Plain text | bcrypt hashed |
| Chat history | Loaded twice (bug) | Single load, fixed |
| Repository imports | `traitlets` (wrong) | `typing` (stdlib) |
| File extractor | Broken signature | Fixed |
| Config | Debug `print` on startup | Clean |
| System prompt | "You are RecallAI" | MemoLink branding |
| Lambda dependency | `mangum` required | Removed |
| API client (frontend) | Duplicated axios instances | Single shared client |
| Auth storage key | `recallai_user` | `memolink_user` |

---

## Documentation

Open any of the standalone HTML files in a browser — no server needed:

- [`Overview.html`](Overview.html) — Project overview and architecture
- [`Requirements Analysis.html`](Requirements%20Analysis.html) — FR, NFR, use cases, user stories
- [`Database Design.html`](Database%20Design.html) — ERD, table schemas, indexes
- [`API Endpoint Design.html`](API%20Endpoint%20Design.html) — All endpoints with request/response schemas

---

## Security Notes

- Never commit `.env` files
- Never commit API keys, passwords, or tokens
- All passwords are bcrypt-hashed before storage
- User data is scoped by `user_id` — users cannot access each other's notes

---

*MemoLink Capstone Project — 2026*
