## Project Overview

MemoLink is a capstone project — a context-aware AI knowledge companion.

**Research topic:** Design and Evaluation of a Context-Aware AI Companion for Knowledge Capture, Contextual Retrieval, and Task Support in Study and Work Settings.

The software is a full-stack RAG application:
- FastAPI backend (`memolink_backend/`)
- React/Vite/TypeScript frontend (`memolink_web/`)
- PostgreSQL + pgvector (Supabase) database
- OpenAI GPT for chat, text-embedding-3-small for embeddings

It also includes a **Books Library**: admin-managed OneDrive book sync (PDF, EPUB, PPTX,
audio, TXT, SRT/VTT, CBZ/CBR, MOBI) with an in-app multi-format reader, bookmarks, color
modes, text-to-speech, in-book highlighting (highlights are appended to a per-book
"{Title} - Highlights" note), and optional "Save as Note Source" full-text RAG extraction.

Documentation pages (standalone HTML) are in the `MemoLink/` root folder:
- `Overview.html`
- `Requirements Analysis.html`
- `Database Design.html`
- `API Endpoint Design.html`

## Repository Structure

```
MemoLink/
├── memolink_backend/    FastAPI backend (Clean Architecture + DI)
│   └── ...              Includes Books Library (OneDrive sync, books/highlights/bookmarks)
├── memolink_web/        React/Vite frontend
│   └── src/components/book-readers/   Per-format book reader views
├── Overview.html        Project overview doc
├── Requirements Analysis.html
├── Database Design.html
├── API Endpoint Design.html
├── requirements.txt     Python deps
├── .env.example         Environment variable template
└── .gitignore
```

## Backend Standards

Clean Architecture + Domain-Driven Design + Dependency Injection:
- `api/v1/`         → Thin FastAPI controllers (no business logic)
- `business/`       → Services and interfaces
- `domain/`         → ORM models, repo interfaces, repo implementations
- `contracts/`      → Pydantic DTOs
- `core/`           → DB engine, config, password hashing (bcrypt via passlib)
- `di/`             → RequestContainer (per-request DI wiring)

Rules:
- Controllers call services only via RequestContainer
- Services call repository interfaces only
- Repositories contain all SQLAlchemy queries
- DTOs are separate from ORM models
- Passwords are ALWAYS hashed (passlib bcrypt) — never store plain text

## Frontend Standards

React 18 + TypeScript + Vite + Tailwind CSS v4.

Rules:
- API calls only in `src/api/`
- Auth state stored in localStorage key `memolink_user`
- Base URL from `VITE_API_BASE_URL` env var
- No hard-coded backend URLs in components

## Development Commands

Backend:
```bash
pip install -r requirements.txt
python -m uvicorn memolink_backend.main:app --reload
# API docs: http://localhost:8000/api/docs
```

Frontend:
```bash
cd memolink_web
cp .env.example .env          # set VITE_API_BASE_URL
npm install
npm run dev
npm run build
```

## Improvements Over RecallAI

1. **Password hashing** — bcrypt via passlib (RecallAI stored plain text)
2. **Fixed duplicate history load** bug in ChatService
3. **Fixed `traitlets` import** in ConversationRepository → stdlib `typing`
4. **Fixed `extract_text_gpt`** function signature
5. **Removed debug print** from config.py
6. **MemoLink branding** throughout — system prompt, UI, localStorage key
7. **Removed mangum** (Lambda-only) — plain ASGI/uvicorn
8. **Consolidated API client** — single axios instance from `src/api/client.ts`
9. **Cleaner frontend UI** — indigo accent, dark theme matching docs

## Git and Change Management

- Do not delete files unless explicitly asked.
- Do not commit unless explicitly asked.
- Do not run destructive git commands.

## Security

Never commit:
- `.env` files
- API keys
- Database passwords
- Credentials or tokens
