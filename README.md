# MemoLink

**Context-Aware AI Companion for Knowledge Capture, Retrieval, and Task Support**

> Capstone Project 2026 - Design and Evaluation of a Context-Aware AI Companion for Knowledge Capture, Contextual Retrieval, and Task Support in Study and Work Settings.

---

## What is MemoLink?

MemoLink lets you capture notes and documents, then ask an AI questions grounded entirely in your personal knowledge base. Every answer cites the source notes that informed it - no hallucinated context, traceable responses.

**Core features:**
- Upload notes and documents (txt, PDF, DOCX, PPTX) with rich formatting preserved
- Ask AI questions via RAG - answers cite your notes as sources
- Multi-turn conversations with persistent history
- Save AI responses back as notes
- Attach files directly in chat
- Smart Response Engine - request analysis, mode routing, unified prompt building, and answer quality checks
- Markdown + LaTeX rendering in the editor and chat
- AI image generation via DALL-E 3 (`/image <prompt>` or natural language triggers) with fallback chain
- Multi-model chat - choose between GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo, Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 2.5 Pro, DeepSeek V3, DeepSeek R1, or DeepSeek Coder
- Model attribution on every chat message and translation bubble
- Translation quality loop with accuracy scoring (Gemini 2.5 Flash Lite + back-translation refinement)
- Web search integration - toggle Brave Search context per message, with conversation-aware retry queries
- Automatic smart actions - regular chat now routes note, reminder, web-search, and other tool-worthy requests through an internal action agent when needed
- Long-form academic draft pipeline with section planning, streamed progress, and external paper retrieval
- Academic paper search across Semantic Scholar, CORE, arXiv, and OpenAlex fallback
- Auto-save cited papers as notes for future grounded retrieval
- Typed SSE stream events for messages, tools, quizzes, note actions, and workflow actions
- Forgot password / reset password via signed JWT email link
- Image insertion in the note editor (upload, drag-drop, clipboard paste)
- Rich file format preservation for bulk upload (headings, bold, lists, tables, embedded images)
- Admin panel - manage users, feature flags, and feedback reports (admin-only)
- Feature flags system - admins toggle feature availability and set defaults app-wide
- Bug reporting and suggestions - users submit reports via Help modal; admins manage status
- Books Library - admin-managed OneDrive book sync with a built-in multi-format reader (PDF, EPUB, PPTX, audio, TXT, SRT/VTT, CBZ/CBR, MOBI), reading progress, bookmarks, color modes (light/dark/sepia), text-to-speech, and in-book text highlighting
- Highlight-to-note - selecting text in a supported book format appends it to a per-book "{Title} - Highlights" note, with double-click jump-back from the note to the exact highlighted passage; the Notes list updates instantly on highlight
- "Save as Note Source" - extract a book's full text (PDF/EPUB/PPTX/TXT/SRT/VTT) into searchable, RAG-retrievable notes

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
│       │   └── book-readers/ Per-format book reader views (PDF, EPUB, PPTX, audio, TXT, captions, comic, MOBI)
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
| AI - Chat | OpenAI GPT-4o-mini (default); GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo also selectable |
| AI - Multi-Model | Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 2.5 Pro, DeepSeek V3, DeepSeek R1, DeepSeek Coder |
| AI - Image Generation | gpt-image-2 → gpt-image-1 → DALL-E 3 → DALL-E 2 → Pollinations.ai (fallback chain) |
| AI - Embeddings | text-embedding-3-small (1 536 dims) |
| AI - Translation | Gemini 2.5 Flash Lite with quality-loop refinement |
| AI - Academic Search | Semantic Scholar + CORE + arXiv + OpenAlex fallback |
| Web Search | Brave Search API |
| Password hashing | passlib bcrypt |
| Email (SMTP) | Optional - feedback notifications + password reset |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| Note Editor | Tiptap (with image extension) |
| HTTP client | Axios |

---

## Architecture

MemoLink follows **Clean Architecture** with **Domain-Driven Design** and a **Dependency Injection** container:

```
Request → Controller (api/) → Service (business/) → Repository (domain/) → PostgreSQL
```

- Controllers are thin - they only call services via `RequestContainer`.
- Services contain application logic, depend on repository *interfaces*.
- Repositories contain all SQL/ORM queries.
- DTOs (`contracts/`) are separate from ORM models.

Recent refactors also introduced a clearer orchestration layer for LLM work:

```
User input
    → Request analysis
    → Mode routing
    → Context engine preparation
    → Unified primary prompt
    → Generation / streaming
    → Optional quality pass
    → Persistence of messages, actions, and cited papers
```

This keeps prompt logic, retrieval logic, and persistence concerns more separated than the earlier stacked-prompt approach.

---

## RAG Pipeline

```
User prompt
    → Smart Response Engine analyses intent
    → Context engine selects the right retrieval strategy
    → Embed via text-embedding-3-small
    → pgvector cosine similarity search (top-K notes, workspace-scoped)
    → Build context: system prompt + retrieved note chunks
    → [Optional] Brave Search web results injected as additional context
    → [Academic mode] External paper context from Semantic Scholar / CORE / arXiv / OpenAlex
    → Selected model (GPT or Gemini) generates answer
    → Return answer + source citations
```

For large academic requests, MemoLink switches to a dedicated long-form draft path that plans sections, streams status updates, and can save cited papers back into notes.

---

## Multi-Model Support

The Settings modal lets each user select their preferred chat model at any time:

| Provider | Models |
|---|---|
| OpenAI | GPT-4o Mini (default), GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo |
| Google Gemini | Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 2.5 Pro |
| DeepSeek | DeepSeek V3, DeepSeek R1, DeepSeek Coder |

Gemini and DeepSeek models are accessed via OpenAI-compatible endpoints using `GEMINI_API_KEY` and `DEEPSEEK_API_KEY`. When a provider hits a rate limit or temporary failure, the system can fall back to another available model. Every chat message displays a "replied by [Model Name]" attribution badge.

---

## AI Image Generation

Type `/image <prompt>` in the chat, or use natural-language triggers such as "generate an image of …", "draw me a …", "create a picture of …", "paint …", or "sketch …". MemoLink detects the intent via NLP and tries models in order:

1. **gpt-image-2** → **gpt-image-1** → **DALL-E 3** → **DALL-E 2** → **Pollinations.ai** (free fallback)

The stream yields:

1. An initial "🎨 Generating your image…" status token (animated spinner shown in the UI)
2. The rendered image embedded in Markdown as a base64 data URL, followed by the model's revised prompt

Images are stored as base64 data URLs directly in `messages.content` - no file storage needed, no expiry. Base64 images are stripped from RAG context and conversation history before sending to OpenAI to avoid token overflow. The SSE `done` event carries the `model` field so attribution reflects the actual model used. No new endpoint is required - handled inside the existing `POST /api/chat/stream` and `POST /api/chat`.

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
# Edit .env - set DATABASE_URL, OPENAI_API_KEY, and optional keys below

# 4. Run
python -m uvicorn memolink_backend.main:app --reload

# API docs available at:
# http://localhost:8000/api/docs
```

**Optional environment variables for new features:**

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Enables Gemini model selection and translation quality loop |
| `DEEPSEEK_API_KEY` | Enables DeepSeek model selection |
| `BRAVE_SEARCH_API_KEY` | Enables per-message web search context |
| `SEMANTIC_SCHOLAR_API_KEY` | Enables higher-quality academic paper metadata retrieval |
| `CORE_API_KEY` | Enables CORE full-text academic paper retrieval |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Enables forgot-password email delivery and feedback notifications |
| `FRONTEND_URL` | Reset-password link base URL in emails |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` | Enables the Books Library's OneDrive sync (admin connects a OneDrive account via OAuth) |
| `ONEDRIVE_BOOKS_FOLDER_ID` / `ONEDRIVE_BOOKS_FOLDER_PATH` | Which OneDrive folder to sync books from (ID takes priority over path) |
| `ONEDRIVE_SYNC_ENABLED` | Toggles the Books Library sync feature on/off |

### Frontend

```bash
cd memolink_web

# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env - set VITE_API_BASE_URL=http://localhost:8000/api

# 3. Run dev server
npm run dev

# 4. Build for production
npm run build
```

---

## Admin System & Feature Flags

The first registered user is automatically promoted to admin on startup. Admins access the **Admin Panel** - a full-screen overlay in the user menu - with three tabs:

- **Feedback** - view, filter by type/status, and update bug reports and suggestions submitted by users
- **Feature Flags** - toggle individual features on/off (web search, model selection, image generation, translation, file upload, workflow actions, and more) and set defaults (`default_model`, `default_language`)
- **Users** - list all users, promote or demote admin status

JWT tokens include an `is_admin` claim. Admin-only endpoints use the `get_current_admin` dependency and return 403 if the caller is not an admin.

Feature flags are stored in the `feature_flags` table (8 default entries). The frontend fetches flags on login and hides disabled buttons or forces the default model accordingly.

### Bug Reporting

Users can submit bug reports or feature suggestions via **Help → Report Bug / Suggestion**. Reports are stored in the `feedback` table with a status lifecycle (`open` → `read` → `resolved`). An optional SMTP notification is sent to the admin on new submissions.

---

## Books Library

Admins connect a OneDrive account (OAuth via `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`) and sync a chosen OneDrive folder into a shared **Books Library** that all users can browse, borrow, and read in-app.

**Supported formats:** PDF, EPUB, PPTX, audio, TXT, SRT/VTT (captions), CBZ/CBR (comics), MOBI.

- **Reader** - paginated reading view per format with light/dark/sepia color modes, text-to-speech, bookmarks, and reading-progress tracking (resumes where you left off)
- **Highlighting** - select text (PDF, EPUB, PPTX, TXT, captions, MOBI) and save it as a highlight with a color tag; each highlight is appended to an auto-generated "{Title} - Highlights" note, and the Notes list refreshes instantly when a highlight is added
- **Jump-back** - double-clicking a highlight inside its note jumps the reader straight to that exact passage
- **Save as Note Source** - extracts a book's full text (PDF, EPUB, PPTX, TXT, SRT/VTT) into chunked, embedded notes so it becomes part of the RAG knowledge base and is citable in chat
- **Admin management** - publish/unpublish books (individually, selected, or all), trigger manual or paginated OneDrive sync, and monitor sync status/errors from the Admin Panel's **Books** tab

New domain tables: `books`, `user_books`, `book_bookmarks`, `book_highlights`, `book_note_sources`, `book_note_chunks`, `onedrive_accounts`.

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
| Password reset | Not available | JWT-signed email link (1 h expiry) |
| Chat model | GPT only | GPT + Gemini multi-model selection |
| Image generation | Not available | Multi-model fallback chain (gpt-image-2 → Pollinations.ai) |
| Translation quality | Single LLM pass | Gemini quality loop with accuracy score |
| File upload fidelity | Plain text extraction | Rich HTML: headings, bold, lists, tables, images |
| Web search | Not available | Brave Search API per-message toggle |
| Smart actions | Not available | Unified chat entry with internal action-agent routing and typed tool events |
| Note editor images | Not available | Upload, drag-drop, clipboard paste |
| Admin panel | Not available | Feature flags, user management, feedback triage |
| Bug reporting | Not available | In-app form + DB storage + SMTP notification |
| Feature flags | Not available | Per-feature toggles with admin UI |
| Token overflow | Base64 in context | Base64 stripped before OpenAI calls |
| Book reading | Not available | OneDrive-synced Books Library with multi-format reader, highlights, bookmarks, and RAG note extraction |

---

## Documentation

Open any of the standalone HTML files in a browser - no server needed:

- [`Overview.html`](Overview.html) - Project overview and architecture
- [`Smart Response Engine.html`](Smart%20Response%20Engine.html) - LLM orchestration workflow, routing, and academic/research pipeline
- [`Requirements Analysis.html`](Requirements%20Analysis.html) - FR, NFR, use cases, user stories
- [`Database Design.html`](Database%20Design.html) - ERD, table schemas, indexes
- [`API Endpoint Design.html`](API%20Endpoint%20Design.html) - All endpoints with request/response schemas

Recent documentation updates also cover the Gmail connector cleanup: token refresh, draft sending, attachment download, email-to-note, and email-to-reminder flows now run through a dedicated connector/service boundary instead of controller-owned Gmail logic.

---

## New API Endpoints (Admin, Feedback, Features)

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/feedback` | Submit bug report or suggestion | User |
| `GET` | `/api/features` | Get all feature flags | User |
| `GET` | `/api/admin/feedback` | List feedback with optional `type` and `status` filters | Admin |
| `PATCH` | `/api/admin/feedback/{id}` | Update feedback status (`open`/`read`/`resolved`) | Admin |
| `GET` | `/api/admin/users` | List all users with roles | Admin |
| `PATCH` | `/api/admin/users/{id}/role` | Promote or demote user admin status | Admin |
| `GET` | `/api/admin/features` | Get all feature flags (admin view) | Admin |
| `PUT` | `/api/admin/features` | Update one or more feature flags | Admin |

---

## Books Library API Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/api/books` | List published books | User |
| `GET` | `/api/books/my` | List the current user's borrowed books | User |
| `GET` | `/api/books/{id}` | Get a single book | User |
| `POST` | `/api/books/{id}/borrow` | Borrow a book into "My Books" | User |
| `DELETE` | `/api/books/{id}/my` | Remove a book from "My Books" | User |
| `POST` | `/api/books/{id}/progress` | Update reading progress (page/percent) | User |
| `POST` | `/api/books/{id}/bookmark` | Add a bookmark | User |
| `GET` | `/api/books/{id}/bookmarks` | List bookmarks | User |
| `POST` | `/api/books/{id}/highlights` | Add a highlight (appends to the book's Highlights note) | User |
| `GET` | `/api/books/highlights/{highlight_id}` | Get a single highlight | User |
| `GET` | `/api/books/{id}/highlights` | List highlights for a book | User |
| `GET` | `/api/books/{id}/read` | Stream the book file | User |
| `GET` | `/api/books/{id}/slides` | Get extracted PPTX slide content | User |
| `POST` | `/api/books/{id}/save-as-note-source` | Extract book text into searchable notes | User |
| `GET` | `/api/books/{id}/note-source-status` | Poll note-extraction job status | User |
| `GET` | `/api/admin/books` | List all books (admin view) | Admin |
| `GET` | `/api/admin/books/onedrive/status` | Check OneDrive connection status | Admin |
| `GET` | `/api/admin/books/onedrive/auth-url` | Get OneDrive OAuth consent URL | Admin |
| `GET` | `/api/admin/books/onedrive/callback` | OneDrive OAuth callback | Admin |
| `DELETE` | `/api/admin/books/onedrive/disconnect` | Disconnect the OneDrive account | Admin |
| `POST` | `/api/admin/books/sync` | Sync all books from OneDrive | Admin |
| `POST` | `/api/admin/books/sync/page` | Sync one page of books from OneDrive | Admin |
| `PATCH` | `/api/admin/books/{id}` | Update book metadata | Admin |
| `POST` | `/api/admin/books/{id}/publish` / `/unpublish` | Publish or unpublish a book | Admin |
| `POST` | `/api/admin/books/publish-all` / `/unpublish-all` | Bulk publish/unpublish all books | Admin |
| `POST` | `/api/admin/books/publish-selected` / `/unpublish-selected` | Bulk publish/unpublish selected books | Admin |

---

## Security Notes

- Never commit `.env` files
- Never commit API keys, passwords, or tokens
- All passwords are bcrypt-hashed before storage
- Password reset tokens are signed JWTs with a 1-hour expiry and a `purpose:"reset"` claim
- User data is scoped by `user_id` - users cannot access each other's notes
- Admin endpoints use `get_current_admin` dependency - non-admins receive 403
- JWT tokens include an `is_admin` claim verified on every admin request
- The first registered user is automatically promoted to admin at startup

---

*MemoLink Capstone Project - 2026*
