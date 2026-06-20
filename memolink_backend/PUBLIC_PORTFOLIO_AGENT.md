# Public Portfolio Agent

An embeddable, anonymous-visitor chat widget that answers questions using only
notes the workspace owner has explicitly marked public. Off by default end to
end: the feature flag, every `PublicAgent`, and every note's public flag all
default to disabled.

## Feature flag

`public_portfolio_agent_enabled` in the `feature_flags` table (default
`"false"`). While off, both routers below 404 as if they don't exist —
including the authenticated management endpoints, so the Settings tab itself
disappears. Toggle it from Admin Panel → Features.

## Availability and access-level gating

Public Portfolio Agents are available to **any logged-in user**, not just
admins — this is a tiered feature like Web Search, TTS, or Research Mode, not
an admin-only tool. Two independent gates apply, both enforced server-side:

1. `public_portfolio_agent_enabled` (above) — master kill switch for the
   whole feature.
2. `public_portfolio_agent_min_level` in `feature_flags` (default `"regular"`)
   — the minimum access tier (`regular` / `plus` / `pro`) required to *manage*
   agents. Set per-feature in Admin Panel → Features → Access Level
   Requirements, alongside every other tiered feature.

`GET /features` (`features_controller.py`) force-overwrites
`public_portfolio_agent_enabled` to `"false"` in its response for any
non-admin user whose `access_level` doesn't meet the min-level — this is how
the Settings tab disappears for under-tier users with zero extra frontend
logic. The backend additionally enforces the level check directly on every
authenticated management endpoint via the `require_public_agent_level`
dependency in `public_agent_controller.py` (403 if under-tier), so the gate
can't be bypassed by calling the API directly. Admins always pass regardless
of tier. The public, unauthenticated chat endpoint is deliberately **not**
level-gated — level-gating concerns who may manage/create agents, not who may
chat with an already-public one.

## Data model

- `notes.public_agent_enabled` (boolean, default `false`) — per-note opt-in.
  Set via `POST /api/notes/public-agent`. `NoteService.set_public_agent_enabled`
  raises if the note `is_core_memory` — core memories can never be made public,
  even by an explicit owner request.
- `public_agents` table — one row per embeddable agent: `name`, `token`
  (unique, random, used in the public chat URL and widget embed),
  `workspace_id` (the single workspace this agent may read from),
  `description`, `system_prompt` (owner-supplied persona text, appended to but
  never able to override the hardcoded safety system prompt), `public_enabled`
  (master kill switch, default `false`), `allowed_domains` (comma-separated
  origin allowlist; empty = unrestricted), `avatar_url` (optional, a base64
  image data URL — see "Avatar" below), `created_by`.

## Avatar

Owners may optionally set a static picture avatar per agent (Settings →
Public Agents → Avatar). There is no upload endpoint or object storage in
this codebase, so the image is read client-side via `FileReader.readAsDataURL`
and stored directly as a base64 `data:image/...` string in `avatar_url`
(`PublicAgentCreateDTO`/`PublicAgentUpdateDTO` validate it starts with
`data:image/` and cap its length at `MAX_AVATAR_DATA_URL_LENGTH`, ~500KB of
binary image data, in `public_agent_dtos.py`). The frontend additionally
rejects files over 500KB before encoding (`PublicAgentsPanel.tsx`). Clearing
an avatar requires `clear_avatar: true` on update — `avatar_url: null` alone
is treated as "leave unchanged," matching every other optional field on this
endpoint. An animated/3D avatar was considered and intentionally skipped: it
would require WebGL/Three.js or a paid third-party avatar/lip-sync service,
conflicting with the widget's dependency-free, vanilla-JS design.

## Centralized retrieval filtering

All public-agent retrieval goes through two `NoteRepository` methods —
`get_public_agent_notes_for_workspace` and `search_public_agent_notes_by_vector`
— which are the *only* methods permitted to back this feature. Both enforce,
in SQL, all three conditions at once: exact `workspace_id` match (no
`workspace_id IS NULL` passthrough like the personal-search methods),
`public_agent_enabled = TRUE`, and `is_core_memory IS NULL OR is_core_memory = FALSE`.
`PublicAgentService` is the only caller of these methods — do not add a second
retrieval path for this feature, and do not reuse the personal search methods
for it (their permissive null-workspace semantics would leak cross-workspace
notes).

`PublicAgentService.answer_public_chat` always returns the literal sentence
`"I don't have that information in Ronald's public notes."` (exported as
`FALLBACK_MESSAGE`) whenever no public note matches or the model's own answer
equals that sentence — this also catches the model trying to talk about
private/core data, since the system prompt instructs it to treat "ask about
private info" identically to "no match found."

## Endpoints

Authenticated, owner-scoped (`/api/public-agents/...`, requires login +
ownership check, 403 if another user's agent id is passed):
`POST /` create, `POST /list`, `POST /get`, `POST /update`, `POST /enable`,
`POST /disable`, `POST /regenerate-token`, `POST /delete`.

Public, unauthenticated (`/api/public/agents/{token}/chat`):
- Request: `{"message": "..."}` (1–2000 chars after trim, else 422).
- Response: `{"answer": "...", "sources": [{"note_id": ..., "title": ...}]}`.
- `404` unknown token. `403` agent disabled, or the request's `Origin` (or
  `Referer` fallback) isn't in `allowed_domains`. `429` after 20 requests per
  60s per `(token, client_ip)` (in-memory sliding window — swap for a shared
  store if the backend ever runs multi-process).
- Domain check fails closed: if `allowed_domains` is set but the request has
  no Origin/Referer at all, it is rejected rather than allowed.
- Visitor chat history is never persisted server-side — each call is
  stateless; nothing is written to any table by this endpoint.

## Embeddable widget

Script-tag embed (chosen over a React-component embed so it works on any
external site regardless of stack):

```html
<script
  src="https://<memolink-web-host>/widget.js"
  data-agent-token="YOUR_PUBLIC_AGENT_TOKEN"
  data-api-base="https://<memolink-api-host>/api"
  data-title="Portfolio Assistant"
  data-avatar-url="data:image/png;base64,..."
  async
></script>
```

`data-title` is generated per-agent from the agent's own `name` field by
`embedSnippet()` — it is **not** tied to the workspace and not a fixed,
shared string: each owner's agents show their own name, since this is a
multi-tenant feature (the literal default `"Portfolio Assistant"` inside
`widget.js` only applies if a hand-written embed omits `data-title`
entirely). `data-avatar-url` is generated the same way from the agent's
optional `avatar_url` and is omitted from the snippet when no avatar is set.
The widget header always shows a small "Powered by MemoLink" line under the
title, and the avatar (if set) also renders inside the floating launcher
button.

`memolink_web/public/widget.js` is vanilla JS (no React/axios/bundler
dependency) so it can run unmodified on a third-party page. It renders inside
a Shadow DOM (host-page CSS can't bleed in or out), reads its config from its
own `data-*` attributes via `document.currentScript`, and calls only
`POST {api-base}/public/agents/{token}/chat`. All rendered text (visitor
messages, agent answers, source titles) is inserted via `textContent`, never
`innerHTML`, so nothing in a note or a model response can inject markup into
the host page. Chat history lives in a plain in-memory JS array for the life
of the tab — never `localStorage`/`sessionStorage`/cookies — and is lost on
refresh, per the "never persisted" requirement on both the client and server
side. 403/404/422/429 responses are mapped to plain-language inline error
bubbles instead of being surfaced as raw HTTP errors.

The exact embed string is generated by `PublicAgentsPanel.tsx`'s
`embedSnippet()` — keep that function and this widget's expected attribute
names in sync if either changes.

## Management UI

Settings → Public Agents tab (visible to any logged-in user once both gates
above pass): create/edit agents (name, workspace, description, persona system
prompt, allowed domains, optional avatar picture), enable/disable, delete,
regenerate token, and copy the embed snippet. This is the same `PublicAgentsPanel.tsx` component
formerly only reachable from the Admin Panel — it has no admin-specific logic,
so moving it to Settings required no internal changes, only relocating where
it's mounted. Admin Panel → Features tab has the master
`public_portfolio_agent_enabled` toggle and, in the Access Level Requirements
section, the `public_portfolio_agent_min_level` tier control. The per-note
"Public" / "Private" toggle lives in the note editor's bottom action bar and
only renders when the feature flag is on; it calls
`set_notePublicAgentEnabled`, which surfaces the backend's core-memory
rejection as an `alert()`.

## Usage walkthrough

1. Admin Panel → Features → enable "Public Portfolio Agent" and set its
   minimum access level (defaults to `regular`, i.e. all users).
2. Open notes intended to be public, click the new "Public" toggle in the note
   editor's action bar (disabled/blocked for core memories).
3. Settings → Public Agents → create an agent, pick the workspace containing
   those notes, optionally set `allowed_domains`, then Enable it.
4. Copy the generated `<script>` embed snippet and paste it into the external
   site. The floating button appears bottom-right; visitors can ask questions
   and only get answers sourced from that workspace's public, non-core-memory
   notes.

## Security decisions made under ambiguity

- Default-closed at every layer (flag, agent, note) rather than default-open
  with an exclusion list — a single missed flag/toggle fails safe instead of
  leaking data.
- `allowed_domains` empty means unrestricted rather than "blocked until
  configured" — conservative for embedding convenience while the flag and the
  per-agent `public_enabled` switch remain the real gates; an owner who wants
  origin-locking opts in explicitly.
- Domain check fails closed on a missing Origin/Referer when a restriction is
  configured, so a restriction can't be routed around by a header-less
  request.
- Rate limiting and CORS/domain checks are enforced server-side per request,
  not relied upon as widget-side behavior, since a visitor's browser console
  can always bypass anything the widget itself would enforce.
- The widget never reveals the agent's internal `name` field over the network
  beyond what the page owner already put in `data-title`; no new "get agent
  info" endpoint was added, keeping the public surface to exactly one route.
