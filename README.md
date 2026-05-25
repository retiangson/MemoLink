# MemoLink

**Context-Aware AI Companion for Knowledge Capture, Retrieval, and Task Support**

> Capstone Project 2026 — Design and Evaluation of a Context-Aware AI Companion for Knowledge Capture, Contextual Retrieval, and Task Support in Study and Work Settings.

---

## What is MemoLink?

MemoLink lets you capture notes and documents, then ask an AI questions grounded entirely in your personal knowledge base. Every answer cites the source notes that informed it — no hallucinated context, traceable responses.

**Core features:**
- Upload notes and documents (txt, PDF, DOCX, PPTX) with rich formatting preserved
- Ask AI questions via RAG — answers cite your notes as sources
- Multi-turn conversations with persistent history
- Save AI responses back as notes
- Attach files directly in chat
- Markdown + LaTeX rendering in the editor and chat
- AI image generation via DALL-E 3 (`/image <prompt>` or natural language triggers) with fallback chain
- Multi-model chat — choose between GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo, Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 1.5 Flash 8B, or Gemini 1.5 Pro
- Model attribution on every chat message and translation bubble
- Translation quality loop with accuracy scoring (Gemini 2.0 Flash Lite + back-translation refinement)
- Web search integration — toggle Brave Search context per message
- Agent mode — agentic tool-use chat via `POST /api/chat/agent/stream`
- Forgot password / reset password via signed JWT email link
- Image insertion in the note editor (upload, drag-drop, clipboard paste)
- Rich file format preservation for bulk upload (headings, bold, lists, tables, embedded images)
- Admin panel — manage users, feature flags, and feedback reports (admin-only)
- Feature flags system — admins toggle feature availability and set defaults app-wide
- Bug reporting and suggestions — users submit reports via Help modal; admins manage status

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
| AI — Chat | OpenAI GPT-4o-mini (default); GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo also selectable |
| AI — Multi-Model | Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 1.5 Flash 8B, Gemini 1.5 Pro (via OpenAI-compatible endpoint) |
| AI — Image Generation | gpt-image-2 → gpt-image-1 → DALL-E 3 → DALL-E 2 → Pollinations.ai (fallback chain) |
| AI — Embeddings | text-embedding-3-small (1 536 dims) |
| AI — Translation | Gemini 2.0 Flash Lite with quality-loop refinement |
| Web Search | Brave Search API |
| Password hashing | passlib bcrypt |
| Email (SMTP) | Optional — feedback notifications + password reset |
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

- Controllers are thin — they only call services via `RequestContainer`.
- Services contain application logic, depend on repository *interfaces*.
- Repositories contain all SQL/ORM queries.
- DTOs (`contracts/`) are separate from ORM models.

---

## RAG Pipeline

```
User prompt
    → Embed via text-embedding-3-small
    → pgvector cosine similarity search (top-K notes, workspace-scoped)
    → Build context: system prompt + retrieved note chunks
    → [Optional] Brave Search web results injected as additional context
    → Selected model (GPT or Gemini) generates answer
    → Return answer + source citations
```

---

## Multi-Model Support

The Settings modal lets each user select their preferred chat model at any time:

| Provider | Models |
|---|---|
| OpenAI | GPT-4o Mini (default), GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo |
| Google Gemini | Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 1.5 Flash 8B, Gemini 1.5 Pro |

Gemini models are accessed via an OpenAI-compatible endpoint using `GEMINI_API_KEY`. When Gemini hits a rate limit during chat, the system silently falls back to GPT and logs a warning — the user sees no error. Every chat message displays a "replied by [Model Name]" attribution badge.

---

## AI Image Generation

Type `/image <prompt>` in the chat, or use natural-language triggers such as "generate an image of …", "draw me a …", "create a picture of …", "paint …", or "sketch …". MemoLink detects the intent via NLP and tries models in order:

1. **gpt-image-2** → **gpt-image-1** → **DALL-E 3** → **DALL-E 2** → **Pollinations.ai** (free fallback)

The stream yields:

1. An initial "🎨 Generating your image…" status token (animated spinner shown in the UI)
2. The rendered image embedded in Markdown as a base64 data URL, followed by the model's revised prompt

Images are stored as base64 data URLs directly in `messages.content` — no file storage needed, no expiry. Base64 images are stripped from RAG context and conversation history before sending to OpenAI to avoid token overflow. The SSE `done` event carries the `model` field so attribution reflects the actual model used. No new endpoint is required — handled inside the existing `POST /api/chat/stream` and `POST /api/chat`.

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
# Edit .env — set DATABASE_URL, OPENAI_API_KEY, and optional keys below

# 4. Run
python -m uvicorn memolink_backend.main:app --reload

# API docs available at:
# http://localhost:8000/api/docs
```

**Optional environment variables for new features:**

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Enables Gemini model selection and translation quality loop |
| `BRAVE_SEARCH_API_KEY` | Enables per-message web search context |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Enables forgot-password email delivery and feedback notifications |
| `FRONTEND_URL` | Reset-password link base URL in emails |

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

## Admin System & Feature Flags

The first registered user is automatically promoted to admin on startup. Admins access the **Admin Panel** — a full-screen overlay in the user menu — with three tabs:

- **Feedback** — view, filter by type/status, and update bug reports and suggestions submitted by users
- **Feature Flags** — toggle individual features on/off (web search, agent mode, model selection, image generation, translation, file upload) and set defaults (`default_model`, `default_language`)
- **Users** — list all users, promote or demote admin status

JWT tokens include an `is_admin` claim. Admin-only endpoints use the `get_current_admin` dependency and return 403 if the caller is not an admin.

Feature flags are stored in the `feature_flags` table (8 default entries). The frontend fetches flags on login and hides disabled buttons or forces the default model accordingly.

### Bug Reporting

Users can submit bug reports or feature suggestions via **Help → Report Bug / Suggestion**. Reports are stored in the `feedback` table with a status lifecycle (`open` → `read` → `resolved`). An optional SMTP notification is sent to the admin on new submissions.

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
| Agent mode | Not available | Tool-use agentic stream endpoint |
| Note editor images | Not available | Upload, drag-drop, clipboard paste |
| Admin panel | Not available | Feature flags, user management, feedback triage |
| Bug reporting | Not available | In-app form + DB storage + SMTP notification |
| Feature flags | Not available | Per-feature toggles with admin UI |
| Token overflow | Base64 in context | Base64 stripped before OpenAI calls |

---

## Documentation

Open any of the standalone HTML files in a browser — no server needed:

- [`Overview.html`](Overview.html) — Project overview and architecture
- [`Requirements Analysis.html`](Requirements%20Analysis.html) — FR, NFR, use cases, user stories
- [`Database Design.html`](Database%20Design.html) — ERD, table schemas, indexes
- [`API Endpoint Design.html`](API%20Endpoint%20Design.html) — All endpoints with request/response schemas

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

## Security Notes

- Never commit `.env` files
- Never commit API keys, passwords, or tokens
- All passwords are bcrypt-hashed before storage
- Password reset tokens are signed JWTs with a 1-hour expiry and a `purpose:"reset"` claim
- User data is scoped by `user_id` — users cannot access each other's notes
- Admin endpoints use `get_current_admin` dependency — non-admins receive 403
- JWT tokens include an `is_admin` claim verified on every admin request
- The first registered user is automatically promoted to admin at startup

---

*MemoLink Capstone Project — 2026*
