# MemoLink Configuration Guide

Copy `.env.example` to `.env` and fill in the values below. Never commit `.env` to version control.

```bash
cp .env.example .env
```

---

## Required

The app will not start without these three variables.

| Variable | Description | How to get it |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Supabase → **Settings → Database → Connection string** (use the **Transaction mode pooler**, port 6543) |
| `OPENAI_API_KEY` | OpenAI API key | [platform.openai.com](https://platform.openai.com) → API keys |
| `JWT_SECRET_KEY` | Secret used to sign auth tokens | Run `openssl rand -hex 32` — any random 32+ character string |

**Example:**
```env
DATABASE_URL=postgresql+psycopg2://postgres.xxxx:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
OPENAI_API_KEY=sk-...
JWT_SECRET_KEY=a3f8c2d1e9b7a6f4c3d2e1b8a7f6c5d4e3b2a1f0c9d8e7b6a5f4c3d2e1b0a9
```

---

## Model Settings

These have sensible defaults — only change if needed.

| Variable | Default | Description |
|---|---|---|
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Default chat model when no model is selected in Settings |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model used for RAG vector search |

---

## CORS / Frontend URL

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin. **Must be set to your deployed frontend URL in production** or all browser requests will be blocked. |

**Local development** (default is fine):
```env
FRONTEND_URL=http://localhost:5173
```

**Production example:**
```env
FRONTEND_URL=https://your-app.azurestaticapps.net
```

---

## Optional Features

Leave blank to disable the feature — the app will start and run normally without them.

### Gemini Models & Translation

| Variable | Description | How to get it |
|---|---|---|
| `GEMINI_API_KEY` | Enables Gemini chat models and the translation quality loop | [aistudio.google.com](https://aistudio.google.com) → **Get API key** (free) |

Without this key: Gemini models are unavailable in the model selector, and translation falls back to GPT-4o Mini only.

### DeepSeek Models

| Variable | Description | How to get it |
|---|---|---|
| `DEEPSEEK_API_KEY` | Enables DeepSeek V3 (`deepseek-chat`) and DeepSeek R1 (`deepseek-reasoner`) | [platform.deepseek.com](https://platform.deepseek.com) → API keys (pay-as-you-go, very cheap) |

Without this key: DeepSeek models are hidden in the model selector. DeepSeek V3 is comparable to GPT-4o at a fraction of the cost; DeepSeek R1 is a reasoning model similar to o1.

### Web Search

| Variable | Description | How to get it |
|---|---|---|
| `BRAVE_SEARCH_API_KEY` | Enables the Web Search toggle in the chat input | [api.search.brave.com](https://api.search.brave.com) → Create app → **Data for Search** plan (free tier available) |

Without this key: the web search button is hidden from the UI.

### Academic Search (Research Mode)

| Variable | Description | How to get it |
|---|---|---|
| `SEMANTIC_SCHOLAR_API_KEY` | Upgrades Research Mode from OpenAlex to Semantic Scholar (100 req/s vs public rate limit) | [semanticscholar.org/product/api](https://www.semanticscholar.org/product/api) → **Request API Key** (free, 1–3 business days) |

Without this key: Research Mode still works using **OpenAlex** as a free fallback — no degradation in normal usage. Adding the key gives higher rate limits and Semantic Scholar's broader index.

---

## Email / Password Reset

All SMTP variables are optional. If left blank, password reset links are printed to the backend console instead of emailed.

| Variable | Example value | Description |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port (587 = STARTTLS, 465 = SSL) |
| `SMTP_USER` | `you@gmail.com` | SMTP login username |
| `SMTP_PASSWORD` | `xxxx xxxx xxxx xxxx` | SMTP password or **App Password** |
| `SMTP_FROM` | `you@gmail.com` | Sender address shown in outgoing emails |

> **Gmail users:** do not use your Gmail login password. Go to **myaccount.google.com → Security → 2-Step Verification → App passwords**, generate an app password, and use that as `SMTP_PASSWORD`.

---

## Frontend Environment

Create `memolink_web/.env` (separate from the backend `.env`):

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Full URL of the backend API, including `/api` |

**Local development:**
```env
VITE_API_BASE_URL=http://localhost:8000/api
```

**Production:**
```env
VITE_API_BASE_URL=https://your-backend.up.railway.app/api
```

---

## Minimum Setup (local development)

```env
# .env  (backend)
DATABASE_URL=postgresql+psycopg2://postgres.xxxx:password@aws-0-region.pooler.supabase.com:6543/postgres
OPENAI_API_KEY=sk-...
JWT_SECRET_KEY=change-me-to-a-long-random-string
```

```env
# memolink_web/.env  (frontend)
VITE_API_BASE_URL=http://localhost:8000/api
```

Everything else has a working default or degrades gracefully when not set.

---

## Full `.env` Template

```env
# ── Required ────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+psycopg2://user:password@host:6543/postgres
OPENAI_API_KEY=sk-...
JWT_SECRET_KEY=change-me-to-a-long-random-string

# ── Model defaults ──────────────────────────────────────────────────────────
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# ── CORS ────────────────────────────────────────────────────────────────────
FRONTEND_URL=http://localhost:5173

# ── Optional features ───────────────────────────────────────────────────────
GEMINI_API_KEY=
DEEPSEEK_API_KEY=
BRAVE_SEARCH_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=

# ── Email / password reset ───────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```
