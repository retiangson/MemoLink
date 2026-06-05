from typing import List, Iterator, Optional
from fastapi import UploadFile
from sqlalchemy.orm import Session
from openai import OpenAI, RateLimitError, APIStatusError
from datetime import date
import json
import logging
import re
import time
import base64
import mimetypes

from memolink_backend.core.config import settings

logger = logging.getLogger(__name__)
_HTML_TAG = re.compile(r"<[^>]+>")
# Matches markdown images with base64 data URLs - e.g. ![...](data:image/png;base64,...)
_BASE64_IMG_MD = re.compile(r'!\[([^\]]*)\]\(data:[^)]{20,}\)', re.IGNORECASE)
# Matches HTML img tags whose src is a base64 data URL
_BASE64_IMG_HTML = re.compile(r'<img\b[^>]*\bsrc=["\']data:[^"\']{20,}["\'][^>]*>', re.IGNORECASE)


def _strip_base64_images(text: str) -> str:
    """Replace embedded base64 images with a short placeholder to prevent token overflow."""
    text = _BASE64_IMG_MD.sub(r'[generated image: \1]', text)
    text = _BASE64_IMG_HTML.sub('[embedded image]', text)
    return text
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.interfaces.i_conversation_repository import IConversationRepository
from memolink_backend.domain.interfaces.i_note_repository import INoteRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.interfaces.i_chat_service import IChatService
from memolink_backend.utils.file_extractor import extract_text_local
from memolink_backend.utils.web_search import brave_search
from memolink_backend.contracts.chat_dtos import ChatResponseDTO, ChatAnswerSource, ChatRequestDTO, ChatAttachmentDTO
from memolink_backend.business.services.autopilot_service import route as autopilot_route

_GEMINI_MODELS = {
    "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro",
}
_DEEPSEEK_MODELS = {"deepseek-chat", "deepseek-reasoner", "deepseek-coder"}
_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
_MODEL_ALIASES = {
    "gemini-2.0-flash": "gemini-2.5-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
    "gemini-1.5-flash-8b": "gemini-2.5-flash-lite",
    "gemini-1.5-pro": "gemini-2.5-pro",
}

# Canonical fallback model per provider (used when building the chain)
_PROVIDER_FALLBACK = {
    "openai":    lambda: settings.openai_chat_model,
    "gemini":    lambda: "gemini-2.5-flash",
    "deepseek":  lambda: "deepseek-chat",
}


def _canonical_model(model: str) -> str:
    return _MODEL_ALIASES.get(model, model)


def _get_client(model: str, user_keys: dict | None = None) -> OpenAI:
    """Build an OpenAI-compatible client. User's custom provider takes priority over server keys."""
    model = _canonical_model(model)
    keys = user_keys or {}
    if model in keys:
        cfg = keys[model]
        return OpenAI(api_key=cfg["key"], base_url=cfg.get("base_url") or None)
    if model in _GEMINI_MODELS:
        return OpenAI(api_key=settings.gemini_api_key, base_url=_GEMINI_BASE_URL)
    if model in _DEEPSEEK_MODELS:
        return OpenAI(api_key=settings.deepseek_api_key, base_url=_DEEPSEEK_BASE_URL)
    return OpenAI(api_key=settings.openai_api_key)


def _completion_kwargs(model: str) -> dict:
    """Per-provider chat-completion options. Gemini 2.5 is a 'thinking' model whose
    internal reasoning eats into the output budget — without a generous max_tokens
    the visible reply gets truncated mid-sentence, so we reserve plenty of room."""
    if _canonical_model(model) in _GEMINI_MODELS:
        return {"max_tokens": 8192}
    return {}


# ── Confidence layer ──────────────────────────────────────────────────────────

# ── Confidence layer ──────────────────────────────────────────────────────────
# Matches <confidence level="HIGH">reason</confidence> in various formats that
# LLMs may produce: optional quotes, extra whitespace, markdown wrapping, etc.
_CONFIDENCE_RE = re.compile(
    r'(?:```[a-z]*\s*)?'                          # optional opening code-fence
    r'<confidence\s+level\s*=\s*["\']?'           # opening tag + level=
    r'(HIGH|MEDIUM|LOW|UNSUPPORTED)'              # level value
    r'["\']?\s*>(.*?)</confidence>'               # > reason </confidence>
    r'(?:\s*```)?',                               # optional closing code-fence
    re.DOTALL | re.IGNORECASE,
)

# Sent as a SEPARATE final system message so the model sees it clearly
_CONFIDENCE_SYSTEM_MSG = (
    "IMPORTANT - CONFIDENCE ASSESSMENT:\n"
    "At the very end of your response, after a blank line, you MUST append:\n"
    "<confidence level=\"LEVEL\">one sentence reason</confidence>\n\n"
    "Replace LEVEL with exactly one of: HIGH, MEDIUM, LOW, UNSUPPORTED\n"
    "- HIGH        : answer is directly and substantially grounded in the user's notes above\n"
    "- MEDIUM      : answer is partially grounded; some notes relevant but coverage is incomplete\n"
    "- LOW         : minimal note grounding; answer draws mainly on general knowledge\n"
    "- UNSUPPORTED : notes have no relevant content; answer is entirely general AI knowledge\n\n"
    "Example: <confidence level=\"HIGH\">The answer is fully supported by the Project Plan note.</confidence>\n"
    "This tag is stripped before display - always include it."
)

_WEB_SEARCH_SYSTEM_MSG = (
    "WEB SEARCH MODE IS ENABLED:\n"
    "- The following web results were fetched live for this user request.\n"
    "- You DO have web search context for this turn. Never say you cannot access the internet, cannot browse, or cannot perform live searches when web results are provided.\n"
    "- Answer the user's question using the web results first, then optionally connect them to the user's notes.\n"
    "- Cite specific result URLs inline or in a short Sources section.\n"
    "- If the web results are thin, say what they do and do not establish, then suggest a better query.\n"
    f"- Today's date is {date.today().isoformat()}."
)

_WEB_SEARCH_EMPTY_MSG = (
    "WEB SEARCH MODE WAS REQUESTED, but MemoLink did not receive usable Brave Search results for this turn. "
    "Do not claim the model simply cannot browse. Instead, explain briefly that the configured web search provider returned no results or may be unavailable, then answer from notes/general knowledge if possible."
)


def _parse_confidence(text: str) -> tuple[str, str | None, str | None]:
    """Strip the <confidence> tag and return (clean_text, level, reason).
    Returns (text, None, None) when absent so the caller can fall back to pre-computed."""
    m = _CONFIDENCE_RE.search(text)
    if not m:
        return text.rstrip(), None, None
    level = m.group(1).upper()
    reason = m.group(2).strip()
    clean = _CONFIDENCE_RE.sub("", text).rstrip()
    return clean, level, reason


def _pre_confidence(all_notes: list, top_notes: list) -> tuple[str, str]:
    """Deterministic server-side confidence estimate based on retrieval context.
    Used as a guaranteed fallback when the LLM doesn't output a confidence tag."""
    total = len(all_notes)
    if total == 0:
        return "UNSUPPORTED", "No notes exist in this workspace yet - answer is based on general knowledge."
    if total <= 20:
        # Small workspace: all notes included - confidence depends on note count
        if total <= 2:
            return "LOW", f"Only {total} note(s) in workspace - limited context available."
        if total <= 5:
            return "MEDIUM", f"{total} notes available - answer draws from your full workspace."
        return "HIGH", f"All {total} workspace notes included as context."
    # Large workspace - confidence based on vector search results
    found = len(top_notes)
    if found == 0:
        return "UNSUPPORTED", "No relevant notes found for this question - answer is general knowledge."
    if found <= 2:
        return "LOW", f"Only {found} relevant note(s) found - answer may lack full context."
    if found <= 4:
        return "MEDIUM", f"{found} relevant notes found - answer partially grounded in your notes."
    return "HIGH", f"{found} relevant notes found - answer strongly grounded in your workspace."


# ── Improve-note regex ─────────────────────────────────────────────────────────
_IMPROVE_NOTE_RE = re.compile(
    r"\b(?:improve|enhance|reformat|format|clean[\s-]?up|fix|polish|rewrite|update|edit|upgrade|revise|optimise|optimize)\s+"
    r"(?:my\s+)?(?:note|notes?)\s*[:\-]?\s*(.+?)(?:\s*[\.?!])?$",
    re.IGNORECASE,
)
# "make my [name] note better/nicer/cleaner/improved/prettier"
_MAKE_NAME_NOTE_BETTER_RE = re.compile(
    r"\bmake\s+(?:my\s+|the\s+)?(.+?)\s+note\s+(?:better|nicer|cleaner|clearer|improved|prettier|look better|more readable|well[- ]?formatted)",
    re.IGNORECASE,
)
# "make my note [name] better" | "make [name] note better"
_MAKE_NOTE_NAME_BETTER_RE = re.compile(
    r"\bmake\s+(?:my\s+|the\s+)?note\s+(.+?)\s+(?:better|nicer|cleaner|clearer|improved|prettier|more readable|well[- ]?formatted)[\s\.?!]*$",
    re.IGNORECASE,
)


def _extract_improve_note_name(text: str) -> str | None:
    t = text.strip()
    for pattern in (_IMPROVE_NOTE_RE, _MAKE_NAME_NOTE_BETTER_RE, _MAKE_NOTE_NAME_BETTER_RE):
        m = pattern.search(t)
        if m:
            return m.group(1).strip().strip('"\'')
    return None


# High-capability OpenAI models with a low tokens-per-minute (TPM) cap on lower
# OpenAI tiers — a large RAG context can 429 ("Request too large") on these even
# though it fits their 128K context window. We proactively re-route oversized
# requests to Gemini (1M-token window + generous limits) before the call.
_LOW_TPM_OPENAI_MODELS = {
    "gpt-4o", "gpt-4o-2024-08-06", "gpt-4o-2024-05-13",
    "gpt-4-turbo", "gpt-4-turbo-preview", "gpt-4", "chatgpt-4o-latest",
}
# ~30K TPM tier-1 cap, kept with margin. ≈ chars/4 tokens.
_LARGE_REQUEST_TOKEN_LIMIT = 28000


def _estimate_tokens(messages: list[dict]) -> int:
    """Rough token estimate (~4 chars/token) for the assembled request."""
    return sum(len(m.get("content") or "") for m in messages) // 4


def _reroute_large_request(model: str, est_tokens: int, gemini_key: str, default_model: str):
    """If a low-TPM OpenAI model would receive an oversized request, send it to
    Gemini instead (or the default mini if no Gemini key). Returns
    (model, routing_reason) — routing_reason is None when nothing changed."""
    if model in _LOW_TPM_OPENAI_MODELS and est_tokens > _LARGE_REQUEST_TOKEN_LIMIT:
        if gemini_key:
            return "gemini-2.5-flash", "Large context → Gemini"
        if not model.endswith("-mini"):
            return default_model, "Large context → GPT-4o Mini"
    return model, None


def _build_fallback_chain(primary: str, user_keys: dict | None = None) -> list[str]:
    """Return ordered list of models to try:
    1. Primary (selected model)
    2. User's other configured custom models
    3. Server-configured providers
    4. Server default (always last resort)
    """
    keys = user_keys or {}
    chain = [_canonical_model(primary)]
    # User's other custom model IDs (try user keys before server keys)
    for m in keys:
        if m not in chain:
            chain.append(m)
    # Server-configured fallbacks
    candidates = [
        _canonical_model(settings.openai_chat_model),
        "gemini-2.5-flash" if settings.gemini_api_key else None,
        "deepseek-chat"    if settings.deepseek_api_key else None,
    ]
    for m in candidates:
        if m and m not in chain:
            chain.append(m)
    return chain

IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}

# ── Image generation ─────────────────────────────────────────────────────────
# Matches the image-generation verb phrase wherever it appears in the message
_IMAGE_TRIGGERS = re.compile(
    r"(?:"
    r"/image\s+"
    r"|(?:(?:generate|create|make|produce|design)\s+(?:(?:me|us|an?|a)\s+)*(?:image|picture|photo|illustration|artwork|drawing|painting|logo|icon|banner|poster|wallpaper|thumbnail))"
    r"|(?:(?:draw|paint|sketch)\s+(?:me\s+)?(?:an?\s+)?)"
    r")",
    re.IGNORECASE,
)

# Optional polite/conversational prefix before the verb phrase
_POLITE_PREFIX = re.compile(
    r"^\s*(?:can\s+you\s+|could\s+you\s+|please\s+|i\s+(?:want|need)\s+(?:you\s+to\s+)?)?",
    re.IGNORECASE,
)


def _is_image_request(text: str) -> bool:
    # Strip polite prefix then check if the trigger appears at the start
    stripped = _POLITE_PREFIX.sub("", text, count=1)
    return bool(_IMAGE_TRIGGERS.match(stripped))


def _extract_image_prompt(text: str) -> str:
    # Remove polite prefix + trigger verb phrase, then strip leading prepositions
    stripped = _POLITE_PREFIX.sub("", text, count=1)
    cleaned = _IMAGE_TRIGGERS.sub("", stripped, count=1).strip()
    cleaned = re.sub(r"^(?:for|of|about|with|on)\s+", "", cleaned, flags=re.IGNORECASE)
    return cleaned or text.strip()


def _generate_image(prompt: str) -> tuple[str, str, str]:
    """Generate image. Returns (data_url, revised_prompt, model_name).
    Tries DALL-E 3 → DALL-E 2 → Pollinations.ai (free, no key required).
    """
    import urllib.request
    import urllib.parse
    from openai import BadRequestError

    client = OpenAI(api_key=settings.openai_api_key)
    _DALL_E = [
        ("gpt-image-2",    {"size": "1024x1024", "quality": "auto"}),
        ("gpt-image-1",    {"size": "1024x1024", "quality": "auto"}),
        ("dall-e-3",       {"size": "1024x1024", "quality": "standard"}),
        ("dall-e-2",       {"size": "1024x1024"}),
    ]
    dalle_unavailable = 0
    for model, extra in _DALL_E:
        try:
            response = client.images.generate(model=model, prompt=prompt, n=1, **extra)
            img_data = response.data[0]
            revised = getattr(img_data, "revised_prompt", None) or prompt
            b64_direct = getattr(img_data, "b64_json", None)
            if b64_direct:
                b64 = b64_direct
            else:
                url = img_data.url or ""
                with urllib.request.urlopen(url, timeout=30) as resp:
                    img_bytes = resp.read()
                b64 = base64.b64encode(img_bytes).decode()
            return f"data:image/png;base64,{b64}", revised, model
        except BadRequestError as exc:
            if getattr(exc, "code", None) == "invalid_value" and "does not exist" in str(exc):
                logger.warning("DALL-E model %s not available on this account.", model)
                dalle_unavailable += 1
                continue
            raise
        except Exception as exc:
            logger.warning("Image generation failed with %s: %s", model, exc)
            raise

    # DALL-E not available - fall back to Pollinations.ai (free, no API key)
    logger.info("DALL-E unavailable; falling back to Pollinations.ai.")
    encoded = urllib.parse.quote(prompt)
    poll_url = (
        f"https://image.pollinations.ai/prompt/{encoded}"
        f"?width=1024&height=1024&nologo=true&enhance=true"
    )
    with urllib.request.urlopen(poll_url, timeout=90) as resp:
        img_bytes = resp.read()
    b64 = base64.b64encode(img_bytes).decode()
    return f"data:image/png;base64,{b64}", prompt, "stable-diffusion"

_SYSTEM_PROMPT = (
    "You are MemoLink, a context-aware AI knowledge assistant and research companion. "
    "You have access to the user's personal notes and should use them as your primary source. "
    "You also have access to the user's Gmail account — when email context appears below you MUST "
    "use it to answer questions about emails. NEVER say you cannot access email — MemoLink has "
    "native Gmail integration and can search, read, display emails, AND send replies directly in the chat. "
    "When asked to reply to someone, MemoLink will send it and you will be told whether it succeeded. "
    "Always be thorough, well-structured, and grounded in the actual content of the notes. "
    "Format every substantive response using rich markdown: "
    "## headings for major sections, ### for subsections, **bold** for key terms, "
    "bullet or numbered lists, and tables where data is tabular. "
    "Never respond with a wall of plain text. "
    "Cite note sources (e.g. 'According to your Requirements Analysis note...') where relevant. "
    "Only be brief for genuinely trivial one-line questions; for everything else, go deep.\n\n"

    "RESEARCH AWARENESS:\n"
    "- When a question touches on facts, cite where the information comes from\n"
    "- If a note makes a claim without evidence, you may note [NEEDS CITATION]\n"
    "- Flag knowledge gaps when you notice the user's notes are missing important context\n"
    "- Distinguish clearly between 'your notes say X' and 'generally, X is true'\n\n"

    "SUMMARY RULE: When the user asks you to summarize their notes (or a specific note), "
    "produce a rich, detailed summary that covers every note fully. Structure it as:\n"
    "1. A ## section per note (titled with the note's name)\n"
    "2. Under each section: purpose/goal, key details, important decisions or constraints, "
    "and any specific data (tables, endpoints, schema, requirements) present in the note\n"
    "3. A final ## Key Themes & Connections section that synthesises patterns across all notes\n"
    "Do not flatten everything into one generic paragraph. "
    "A good summary should let the user see the full substance of their notes without re-reading them.\n\n"

    "NOTE EDITING RULE: When the user explicitly asks you to format, improve, rewrite, "
    "proofread, restructure, or edit a note or piece of text, return the complete revised "
    "content inside <note_edit> XML tags. "
    "Format the revised content as a well-structured document: "
    "use # for the document title, ## for major sections, ### for subsections, "
    "**bold** for key terms, bullet lists (- item) or numbered lists for enumerations, "
    "and markdown tables (| col | col |) for structured data where appropriate. "
    "The output should read like a professional Word document, not a wall of plain text. "
    "If you can identify exactly which note is being edited from the context "
    "(look for [NOTE <id>: <title>] references), include the note_id attribute: "
    "<note_edit note_id=\"42\">...full revised content...</note_edit>. "
    "If the note id is unknown, omit the attribute: "
    "<note_edit>...full revised content...</note_edit>. "
    "You may add a brief explanation before or after the tags. "
    "IMPORTANT: Only use <note_edit> tags when the user is explicitly requesting a note edit. "
    "Never use them for regular questions or answers.\n\n"

    "TICKET CREATION RULE: When the user asks you to create, generate, or propose tickets, "
    "issues, tasks, or user stories from their notes, produce a comprehensive, well-structured "
    "ticket list. For EACH ticket include ALL of the following fields:\n"
    "- **Title** - a clear, actionable title (verb + noun, e.g. 'Implement user registration endpoint')\n"
    "- **Type** - Feature / Bug / Chore / Spike / Documentation\n"
    "- **Priority** - Critical / High / Medium / Low (justify based on the notes)\n"
    "- **Epic / Category** - the feature area it belongs to\n"
    "- **Description** - 2–4 sentences explaining what needs to be done and why\n"
    "- **Acceptance Criteria** - a numbered checklist of specific, testable conditions that "
    "define 'done' (minimum 3 criteria per ticket)\n"
    "- **Technical Notes** - any implementation hints, constraints, or dependencies mentioned "
    "in the notes (e.g. specific endpoints, models, libraries, or architecture requirements)\n"
    "- **Dependencies** - list any other tickets this one depends on or blocks, if applicable\n"
    "Group tickets under clear ## Epic headings. "
    "Extract as many tickets as the notes actually justify - do not artificially shorten the list. "
    "Use the full content of the notes as your source; do not invent requirements not present."
)


def _is_image(filename: str, mime: str) -> bool:
    ext = filename.lower().rsplit(".", 1)[-1]
    return ext in IMAGE_EXTS or (bool(mime) and mime.startswith("image/"))


class ChatService(IChatService):
    def __init__(
        self,
        db: Optional[Session] = None,
        embedding_service: Optional[EmbeddingService] = None,
        conv_repo: Optional[IConversationRepository] = None,
        note_repo: Optional[INoteRepository] = None,
        log_service=None,
        user_api_key_repo=None,
        graph_repo=None,
        eval_service=None,
        email_record_repo=None,
        email_service=None,
    ):
        if conv_repo is not None and note_repo is not None:
            self.repo_conv: IConversationRepository = conv_repo
            self.repo_notes: INoteRepository = note_repo
        else:
            if db is None:
                raise ValueError("Either repos or db must be provided.")
            self.repo_conv = ConversationRepository(db)
            self.repo_notes = NoteRepository(db)

        self.embedding = embedding_service or EmbeddingService()
        self._log = log_service
        self._user_api_key_repo = user_api_key_repo
        self._graph_repo = graph_repo
        self._email_record_repo = email_record_repo
        self._email_service = email_service
        self._eval = eval_service

    def _syslog(self, level: str, message: str, details: dict, user_id: int | None = None):
        if self._log is None:
            return
        try:
            getattr(self._log, level.lower())("chat", message, details, user_id)
        except Exception:
            pass

    def _resolve_user_keys(self, user_id: int | None) -> dict:
        if not user_id or not self._user_api_key_repo:
            return {}
        try:
            return self._user_api_key_repo.get_all_decrypted(user_id)
        except Exception:
            return {}

    def _build_chat_context(self, dto: ChatRequestDTO):
        """Prepare conversation id, OpenAI messages list, and sources for a chat request."""
        user_text = (dto.prompt or "").strip()

        if dto.conversation_id is None:
            conv = self.repo_conv.create_conversation(dto.user_id, user_text[:50], workspace_id=getattr(dto, "workspace_id", None))
            conversation_id = conv.id
        else:
            conversation_id = dto.conversation_id

        self.repo_conv.add_message(conversation_id, "user", user_text)

        history = self.repo_conv.get_messages_paginated(conversation_id, limit=50, before_id=None)
        message_history = [{"role": m.role, "content": _strip_base64_images(m.content)} for m in reversed(history)]

        ws_filter = None if getattr(dto, "cross_workspace", False) else getattr(dto, "workspace_id", None)

        # Always fetch all workspace notes so meta-queries ("summarize my notes") work correctly.
        # For large workspaces (> 20 notes) also run vector search for the most relevant full content.
        all_notes = self.repo_notes.get_for_user(dto.user_id, ws_filter) if dto.user_id else []

        sources: List[ChatAnswerSource] = []
        rag_blocks: List[str] = []
        top_notes_for_confidence: list = []

        if len(all_notes) <= 20:
            # Small workspace - include every note in full (up to 1 500 chars each)
            top_notes_for_confidence = list(all_notes)
            for n in all_notes:
                sources.append(ChatAnswerSource(note_id=n.id, title=n.title, snippet=n.content[:200] + "..."))
                plain = _strip_base64_images(_HTML_TAG.sub(" ", n.content)).strip()
                rag_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{plain[:1500]}")
        else:
            # Large workspace - note directory + vector-search for top relevant notes
            note_dir = "\n".join(f"- [NOTE {n.id}] {n.title or 'Untitled'}" for n in all_notes)
            rag_blocks.append(f"[NOTE DIRECTORY - {len(all_notes)} notes]\n{note_dir}")

            try:
                query_vec = self.embedding.embed_text(user_text)
                top_notes = self.repo_notes.search_by_vector(query_vec, top_k=dto.top_k, workspace_id=ws_filter)
            except Exception:
                top_notes = all_notes[:dto.top_k]

            if not top_notes:
                top_notes = all_notes[:dto.top_k]

            top_notes_for_confidence = list(top_notes)

            for n in top_notes:
                sources.append(ChatAnswerSource(note_id=n.id, title=n.title, snippet=n.content[:200] + "..."))
                plain = _strip_base64_images(_HTML_TAG.sub(" ", n.content)).strip()
                rag_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{plain}")

            # Graph-enhanced RAG: find notes connected to the vector results via shared entities
            if self._graph_repo and top_notes and ws_filter is not None:
                try:
                    seed_ids = [n.id for n in top_notes]
                    related_ids = self._graph_repo.get_related_note_ids(
                        user_id=dto.user_id,
                        workspace_id=ws_filter,
                        seed_note_ids=seed_ids,
                        limit=3,
                    )
                    top_ids = set(seed_ids)
                    for nid in related_ids:
                        if nid in top_ids:
                            continue
                        note = self.repo_notes.get_by_id(nid)
                        if not note:
                            continue
                        top_ids.add(nid)
                        sources.append(ChatAnswerSource(note_id=note.id, title=note.title, snippet=note.content[:200] + "..."))
                        plain = _strip_base64_images(_HTML_TAG.sub(" ", note.content)).strip()
                        rag_blocks.append(f"[NOTE {note.id}: {note.title or 'Untitled'} - related via MemoGraph]\n{plain}")
                except Exception:
                    pass  # graph enhancement is best-effort; never break chat

        system_msgs = [{"role": "system", "content": _SYSTEM_PROMPT}]
        if rag_blocks:
            system_msgs.append({"role": "system", "content": "--- USER NOTES CONTEXT ---\n" + "\n\n".join(rag_blocks)})

        # Email compose/reply — detect intent and build draft tag (never let AI decide to send)
        _compose_keywords = {"send email", "email to", "send to", "compose", "write email", "send a message"}
        _reply_keywords = {"reply", "respond", "write back", "email back"}
        _asks_compose = any(kw in user_text.lower() for kw in _compose_keywords)
        _asks_reply = any(kw in user_text.lower() for kw in _reply_keywords)
        _email_draft_prefill: str | None = None
        if (_asks_compose or _asks_reply) and self._email_service and dto.user_id:
            try:
                import re as _re
                # Recipient: after "to", "reply to", "email to", etc.
                _to_match = _re.search(
                    r"(?:reply to|respond to|send(?: an? email)? to|email to|email)\s+([^\s,]+)",
                    user_text, _re.I
                )
                # Body hint: after "saying/say/about/regarding/on/regarding/with details"
                _body_match = _re.search(
                    r"(?:saying|just say|say|about|regarding|on|with details of|with details about|with info about)\s+(.+)$",
                    user_text, _re.I | _re.S
                )
                if _to_match and _body_match:
                    recipient_hint = (_to_match.group(2) or _to_match.group(1) or "").strip().lower().rstrip(".,")
                    topic = _body_match.group(1).strip().strip('"\'')
                    is_reply = _asks_reply and not _asks_compose

                    if is_reply:
                        # Search Gmail for a thread to reply to
                        candidate = self._email_service.live_search_sync(dto.user_id, recipient_hint, top_k=1)
                        if candidate:
                            em = candidate[0]
                            sender = em.get("sender", "")
                            to_addr = sender.split("<")[-1].strip(">").strip() if "<" in sender else sender
                            subj = em.get("subject", "")
                            subject = subj if subj.lower().startswith("re:") else f"Re: {subj}"
                            mid = em.get("id", "")
                            tid = em.get("thread_id", "")
                        else:
                            to_addr, subject, mid, tid = recipient_hint, f"Re: {topic}", "", ""
                    else:
                        # New email — recipient is likely an email address or name
                        to_addr = recipient_hint if "@" in recipient_hint else f"{recipient_hint}@gmail.com"
                        subject = topic.replace('"', "'").capitalize()
                        mid, tid = "", ""

                    # Search notes for topic content to prefill body
                    body_text = topic  # default: use the topic itself
                    if hasattr(self, "repo_notes") and self.repo_notes and dto.user_id:
                        try:
                            _stop_note = {"the", "a", "an", "of", "in", "on", "for", "and", "or",
                                          "details", "info", "information", "about", "detail"}
                            _kw = " ".join(w for w in topic.split() if w.lower() not in _stop_note and len(w) > 2)
                            if _kw:
                                _notes = self.repo_notes.search_hybrid(dto.user_id, _kw, top_k=1)
                                if _notes:
                                    body_text = _notes[0].content[:2000]
                        except Exception:
                            pass

                    body_safe = body_text.replace('"', "'").replace("\n", "\\n")
                    subj_safe = subject.replace('"', "'")
                    draft_tag = (
                        f'<email_draft to="{to_addr}" subject="{subj_safe}" '
                        f'body="{body_safe}" message_id="{mid}" thread_id="{tid}"></email_draft>'
                    )
                    action = "reply" if is_reply else "email"
                    _email_draft_prefill = (
                        f"Here's your draft {action} — review it and click **Send** to deliver, "
                        f"or click **Edit** to adjust the message first.\n\n{draft_tag}"
                    )
            except Exception:
                pass  # Fall through to normal email RAG

        # Email RAG — live Gmail search when user asks about email
        _email_keywords = {"email", "gmail", "inbox", "message", "attachment", "mail", "sent", "received"}
        _asks_about_email = any(kw in user_text.lower() for kw in _email_keywords)
        print(f"[EMAIL_RAG] asks={_asks_about_email} uid={dto.user_id} has_svc={self._email_service is not None}", flush=True)
        if _asks_about_email and dto.user_id and user_text:
            email_blocks: list[str] = []
            no_account = False
            try:
                if self._email_service:
                    # Check if email account is connected first
                    has_account = False
                    try:
                        from memolink_backend.core.encryption import decrypt_text as _dt
                        tokens = self._email_service.account_repo.get_decrypted_tokens(dto.user_id)
                        has_account = tokens is not None
                        print(f"[EMAIL_RAG] tokens={'yes' if tokens else 'None'} has_account={has_account}", flush=True)
                    except Exception as _e:
                        print(f"[EMAIL_RAG] get_tokens raised: {_e}", flush=True)

                    if not has_account:
                        no_account = True
                    else:
                        # Build a smart Gmail search query using Gmail operators where applicable
                        lower = user_text.lower()
                        operators: list[str] = []

                        # Words consumed by operators — excluded from keyword query
                        _consumed: set[str] = set()

                        _att_words = {"attachment", "attached", "attachments", "file", "files",
                                      "document", "documents", "pdf", "docx", "xlsx", "pptx",
                                      "zip", "image", "photo", "photos"}
                        if any(w in lower for w in _att_words):
                            operators.append("has:attachment")
                            _consumed |= _att_words

                        _unread_words = {"unread", "unseen"}
                        if any(w in lower for w in _unread_words):
                            operators.append("is:unread")
                            _consumed |= _unread_words

                        _sent_words = {"sent", "outbox"}
                        if any(w in lower for w in _sent_words):
                            operators.append("in:sent")
                            _consumed |= _sent_words

                        # Build keyword portion — drop stop words and operator-consumed words
                        # Strip punctuation first so quoted phrases don't leak into the query
                        import re as _re
                        _stop = {"can", "you", "check", "my", "about", "the", "an", "a", "is", "in",
                                 "for", "and", "or", "with", "from", "me", "please", "i", "have", "any",
                                 "email", "gmail", "inbox", "mail", "show", "get", "find", "search",
                                 "tell", "what", "do", "did", "does", "are", "was", "were", "that",
                                 "new", "all", "some", "there", "see", "look"}
                        keywords = " ".join(
                            clean for w in user_text.split()
                            if (clean := _re.sub(r"[^\w]", "", w)) and
                               clean.lower() not in _stop and
                               clean.lower() not in _consumed and
                               len(clean) > 2
                        )
                        gm_query = " ".join(operators + ([keywords] if keywords.strip() else []))
                        if not gm_query.strip():
                            gm_query = user_text

                        live = self._email_service.live_search_sync(dto.user_id, gm_query, top_k=3)
                        for em in live:
                            att_list = em.get("attachments", [])
                            att_str = ""
                            if att_list:
                                from urllib.parse import quote as _q
                                att_parts = []
                                for a in att_list:
                                    size_str = f" ({round(a['size']/1024,1)} KB)" if a.get('size') else ""
                                    dl_url = f"/api/email/attachment/{em['id']}/{a['attachment_id']}?filename={_q(a['filename'], safe='')}"
                                    # Pre-formatted markdown link — AI must output it exactly as-is
                                    att_parts.append(f"- [{a['filename']}{size_str}]({dl_url})")
                                att_str = "\nAttachments (copy these markdown links exactly, do not change them):\n" + "\n".join(att_parts)
                            email_blocks.append(
                                f"[EMAIL]\nSubject: {em['subject']}\nFrom: {em['sender']}\n"
                                f"Date: {em['date']}{att_str}\nBody:\n{em['body'][:1000]}"
                            )
                elif self._email_record_repo:
                    # Fallback: search already-synced records
                    total = self._email_record_repo.count_for_user(dto.user_id)
                    if total == 0:
                        no_account = True
                    else:
                        hits = []
                        try:
                            q_vec = self.embedding.embed_text(user_text)
                            hits = self._email_record_repo.search_by_vector(q_vec, user_id=dto.user_id, top_k=3)
                        except Exception:
                            pass
                        if not hits:
                            hits = self._email_record_repo.keyword_search(dto.user_id, user_text, top_k=3)
                        for em in hits:
                            date_str = em.email_date.strftime("%d %b %Y") if em.email_date else ""
                            sender = f"{em.sender_name} <{em.sender_email}>" if em.sender_name else em.sender_email
                            email_blocks.append(
                                f"[EMAIL]\nSubject: {em.subject}\nFrom: {sender}\n"
                                f"Date: {date_str}\nBody:\n{(em.body_text or em.snippet or '')[:1500]}"
                            )
            except Exception:
                pass

            if email_blocks:
                system_msgs.append({"role": "system", "content": (
                    "GMAIL SEARCH RESULTS — you MUST base your answer on these emails. "
                    "Do NOT say you cannot access email. "
                    "For each email list the subject, sender, and date. "
                    "For attachments, copy the markdown links EXACTLY as they appear below — do not change or replace them. "
                    "Tell the user they can click the attachment links to download files.\n\n"
                    "--- EMAILS FOUND ---\n"
                    + "\n\n".join(email_blocks)
                )})
            elif no_account:
                system_msgs.append({"role": "system", "content": (
                    "GMAIL NOT CONNECTED — MemoLink has Gmail integration but the user has not "
                    "connected their account yet. Tell them: go to Settings → Email → Connect Gmail. "
                    "Do NOT say you cannot access email as a general limitation — "
                    "once connected, MemoLink searches Gmail in real time."
                )})
            else:
                system_msgs.append({"role": "system", "content": (
                    "GMAIL SEARCHED — no emails matched the query. "
                    "Tell the user: Gmail was searched but no matching email was found. "
                    "Suggest trying different keywords or checking Gmail directly. "
                    "Do NOT say you cannot access email — MemoLink did search Gmail, just found no results."
                )})

        if getattr(dto, "web_search", False) and user_text:
            web_block = brave_search(user_text, count=8)
            if web_block:
                system_msgs.append({"role": "system", "content": _WEB_SEARCH_SYSTEM_MSG})
                system_msgs.append({"role": "system", "content": web_block})
            else:
                system_msgs.append({"role": "system", "content": _WEB_SEARCH_EMPTY_MSG})

        # Confidence instruction as the LAST system message - model sees it most clearly here
        system_msgs.append({"role": "system", "content": _CONFIDENCE_SYSTEM_MSG})

        # Pre-compute a deterministic confidence fallback so the badge always shows
        pre_conf_level, pre_conf_reason = _pre_confidence(all_notes, top_notes_for_confidence)

        return conversation_id, system_msgs + message_history, sources, pre_conf_level, pre_conf_reason, _email_draft_prefill

    def _handle_improve_note_stream(self, dto: ChatRequestDTO, note_name: str, conversation_id: int) -> Iterator[str]:
        workspace_id = getattr(dto, "workspace_id", None)
        note = self.repo_notes.find_by_title_for_user(dto.user_id, note_name, workspace_id)

        if not note:
            msg = f'I couldn\'t find a note matching **"{note_name}"**. Please check the title and try again.\n\nAvailable notes can be found in your sidebar.'
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", msg)
            yield f"data: {json.dumps({'t': msg})}\n\n"
            yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id})}\n\n"
            return

        yield f"data: {json.dumps({'close_note': note.id})}\n\n"
        yield f"data: {json.dumps({'improving_note': note.title})}\n\n"

        plain = _HTML_TAG.sub(" ", note.content or "").strip()
        improve_messages = [
            {"role": "system", "content": (
                "You are a document formatting expert. Improve the structure, formatting, and clarity of the given note. "
                "Rules: use proper HTML tags (h2, h3 for headings, p for paragraphs, ul/ol/li for lists, "
                "<strong> for key terms, <em> for emphasis, <table> for tabular data). "
                "Do NOT change the meaning, remove content, or add new information. "
                "Return ONLY the improved HTML - no markdown fences, no doctype, no html/body tags, no commentary."
            )},
            {"role": "user", "content": f"Note title: {note.title}\n\nContent:\n{plain[:5000]}"},
        ]

        user_keys = self._resolve_user_keys(dto.user_id)
        chain = _build_fallback_chain(dto.model or settings.openai_chat_model)
        improved_html: str | None = None
        for attempt in chain:
            try:
                completion = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt, messages=improve_messages,
                    **_completion_kwargs(attempt),
                )
                improved_html = (completion.choices[0].message.content or "").strip()
                break
            except Exception:
                continue

        if not improved_html:
            msg = "⚠ Failed to improve the note - all AI models are currently unavailable."
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", msg)
            yield f"data: {json.dumps({'t': msg})}\n\n"
            yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id})}\n\n"
            return

        self.repo_notes.update_note(note.id, None, improved_html)
        self._syslog("info", f"Note '{note.title}' improved and auto-saved via chat", {"note_id": note.id, "title": note.title}, dto.user_id)

        response = (
            f"✅ Done! I've improved and saved **{note.title}** automatically.\n\n"
            f"[[NOTE_LINK:{note.id}:{note.title}]]\n\n"
            "**What was improved:**\n"
            "- Heading structure and visual hierarchy\n"
            "- Paragraph and list formatting\n"
            "- Key terms and readability"
        )
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", response)
        yield f"data: {json.dumps({'replace': response})}\n\n"
        yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id})}\n\n"

    def ask(self, dto: ChatRequestDTO) -> ChatResponseDTO:
        user_text = (dto.prompt or "").strip()
        if not user_text:
            return ChatResponseDTO(answer="I didn't receive any message.", sources=[])

        model = dto.model or settings.openai_chat_model
        user_keys = self._resolve_user_keys(dto.user_id)

        # AutoPilot: route to the best model for this prompt
        model, routing_reason = autopilot_route(
            prompt=user_text,
            selected_model=model,
            default_model=settings.openai_chat_model,
            gemini_key=settings.gemini_api_key,
            deepseek_key=settings.deepseek_api_key,
            openai_key=settings.openai_api_key,
        )

        conversation_id, messages, sources, pre_conf_level, pre_conf_reason, email_draft_prefill = self._build_chat_context(dto)

        # Email draft — return immediately without calling the LLM
        if email_draft_prefill:
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", email_draft_prefill)
            return ChatResponseDTO(answer=email_draft_prefill, sources=[], message_id=assistant_msg.id)

        if _is_image_request(user_text):
            prompt = _extract_image_prompt(user_text)
            try:
                data_url, revised, img_model = _generate_image(prompt)
                answer = f"![Generated image]({data_url})\n\n*{revised}*"
            except Exception as exc:
                answer = f"⚠ Image generation failed: {exc}"
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model=img_model)
            return ChatResponseDTO(answer=answer, sources=[], message_id=assistant_msg.id)

        # Proactive size guard — re-route oversized requests off low-TPM OpenAI models.
        _rm, _large_reason = _reroute_large_request(model, _estimate_tokens(messages), settings.gemini_api_key, settings.openai_chat_model)
        if _large_reason:
            model = _rm
            routing_reason = _large_reason

        chain = _build_fallback_chain(model)
        used_model = model
        answer: Optional[str] = None
        last_error = ""

        for attempt in chain:
            try:
                completion = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt,
                    messages=messages,
                    **_completion_kwargs(attempt),
                )
                answer = completion.choices[0].message.content
                used_model = attempt
                if attempt != model:
                    self._syslog("warning", f"Fell back from {model} → {attempt} (success)", {"original": model, "fallback": attempt}, dto.user_id)
                break
            except Exception as e:
                last_error = str(e)
                logger.warning("Model %s failed: %s", attempt, e)
                if attempt != model:
                    self._syslog("warning", f"Fallback {attempt} also failed - trying next", {"model": attempt, "error": last_error}, dto.user_id)
                else:
                    self._syslog("warning", f"{model} failed - starting fallback chain {chain[1:]}", {"model": model, "error": last_error, "chain": chain[1:]}, dto.user_id)

        if answer is None:
            self._syslog("error", f"All models exhausted {chain} - returning error to user", {"chain": chain, "last_error": last_error}, dto.user_id)
            answer = f"⚠ All available AI models are currently unavailable. Please try again later.\n\n*Last error: {last_error}*"

        clean_answer, conf_level, conf_reason = _parse_confidence(answer)
        final_conf = conf_level or pre_conf_level
        final_reason = conf_reason or pre_conf_reason
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", clean_answer, model=used_model, confidence=final_conf, confidence_reason=final_reason)
        return ChatResponseDTO(answer=clean_answer, sources=sources, message_id=assistant_msg.id, routing_reason=routing_reason)

    def ask_stream(self, dto: ChatRequestDTO) -> Iterator[str]:
        """Yield SSE-formatted chunks. Each event is JSON: {"t":"<token>"} or {"done":true,"id":<int>}."""
        user_text = (dto.prompt or "").strip()
        if not user_text:
            yield f"data: {json.dumps({'t': 'I did not receive any message.'})}\n\n"
            yield f"data: {json.dumps({'done': True, 'id': None})}\n\n"
            return

        model = dto.model or settings.openai_chat_model
        user_keys = self._resolve_user_keys(dto.user_id)

        # AutoPilot: route to the best model for this prompt
        model, routing_reason = autopilot_route(
            prompt=user_text,
            selected_model=model,
            default_model=settings.openai_chat_model,
            gemini_key=settings.gemini_api_key,
            deepseek_key=settings.deepseek_api_key,
            openai_key=settings.openai_api_key,
        )

        t_total = time.perf_counter()
        t_ctx = time.perf_counter()
        conversation_id, messages, sources, pre_conf_level, pre_conf_reason, email_draft_prefill = self._build_chat_context(dto)
        ctx_ms = int((time.perf_counter() - t_ctx) * 1000)

        # Email draft — bypass LLM entirely; stream the pre-built draft card
        if email_draft_prefill:
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", email_draft_prefill)
            for chunk in email_draft_prefill:
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id, 'model': 'memolink'})}\n\n"
            return

        note_name = _extract_improve_note_name(user_text)
        if note_name:
            yield from self._handle_improve_note_stream(dto, note_name, conversation_id)
            return

        if _is_image_request(user_text):
            yield f"data: {json.dumps({'image_generating': True})}\n\n"
            prompt = _extract_image_prompt(user_text)
            img_model = "stable-diffusion"
            try:
                data_url, revised, img_model = _generate_image(prompt)
                answer = f"![Generated image]({data_url})\n\n*{revised}*"
            except Exception as exc:
                answer = f"⚠ Image generation failed: {exc}"
            yield f"data: {json.dumps({'replace': answer})}\n\n"
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model=img_model)
            yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id, 'model': img_model})}\n\n"
            return

        # Proactive size guard: a large RAG context can 429 on low-TPM OpenAI
        # models before the fallback even runs — re-route to Gemini up front.
        est_tokens = _estimate_tokens(messages)
        _rm, _large_reason = _reroute_large_request(model, est_tokens, settings.gemini_api_key, settings.openai_chat_model)
        if _large_reason:
            self._syslog("info", f"Re-routed {model} → {_rm} ({est_tokens} est. tokens) to avoid TPM limit",
                         {"from": model, "to": _rm, "est_tokens": est_tokens}, dto.user_id)
            model = _rm
            routing_reason = _large_reason

        chain = _build_fallback_chain(model)
        full_answer = ""
        used_model = model
        succeeded = False
        last_error = ""
        first_token_ms: int | None = None
        llm_ms: int | None = None
        fallback_attempts = 0

        for attempt in chain:
            try:
                t_llm = time.perf_counter()
                stream = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt,
                    messages=messages,
                    stream=True,
                    **_completion_kwargs(attempt),
                )
                if attempt != model:
                    self._syslog("warning", f"Fell back from {model} → {attempt} (stream)", {"original": model, "fallback": attempt}, dto.user_id)
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        if first_token_ms is None:
                            first_token_ms = int((time.perf_counter() - t_llm) * 1000)
                        full_answer += delta
                        yield f"data: {json.dumps({'t': delta})}\n\n"
                used_model = attempt
                llm_ms = int((time.perf_counter() - t_llm) * 1000)
                succeeded = True
                break
            except Exception as e:
                fallback_attempts += 1
                last_error = str(e)
                logger.warning("Model %s failed (stream): %s", attempt, e)
                if attempt != model:
                    self._syslog("warning", f"Fallback {attempt} also failed (stream) - trying next", {"model": attempt, "error": last_error}, dto.user_id)
                else:
                    self._syslog("warning", f"{model} failed (stream) - starting fallback chain {chain[1:]}", {"model": model, "error": last_error, "chain": chain[1:]}, dto.user_id)

        if not succeeded:
            self._syslog("error", f"All models exhausted {chain} (stream) - returning error to user", {"chain": chain, "last_error": last_error}, dto.user_id)
            full_answer = f"⚠ All available AI models are currently unavailable. Please try again later.\n\n*Last error: {last_error}*"
            yield f"data: {json.dumps({'t': full_answer})}\n\n"

        clean_answer, conf_level, conf_reason = _parse_confidence(full_answer)
        final_conf = conf_level or pre_conf_level
        final_reason = conf_reason or pre_conf_reason
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", clean_answer, model=used_model, confidence=final_conf, confidence_reason=final_reason)
        yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id, 'model': used_model, 'confidence': final_conf, 'confidence_reason': final_reason, 'routing_reason': routing_reason})}\n\n"

        # ── Evaluation analytics (safe, gated, never breaks chat) ──────────────
        if self._eval is not None:
            try:
                total_ms = int((time.perf_counter() - t_total) * 1000)
                stream_ms = (llm_ms - first_token_ms) if (llm_ms is not None and first_token_ms is not None) else None
                src_ids = [s.note_id for s in (sources or []) if getattr(s, "note_id", None) is not None]
                self._eval.record_ai_metrics(
                    user_id=dto.user_id,
                    feature_name="rag_chat",
                    data={
                        "conversation_id": conversation_id,
                        "message_id": assistant_msg.id,
                        "prompt_length_chars": len(user_text),
                        "prompt_length_words": len(user_text.split()),
                        "answer_length_chars": len(clean_answer),
                        "answer_length_words": len(clean_answer.split()),
                        "selected_model": dto.model or settings.openai_chat_model,
                        "actual_model_used": used_model,
                        "autopilot_used": bool(routing_reason),
                        "autopilot_reason": routing_reason,
                        "fallback_used": used_model != model,
                        "fallback_attempt_count": fallback_attempts,
                        "web_search_enabled": bool(getattr(dto, "web_search", False)),
                        "graph_rag_enabled": self._graph_repo is not None,
                        "top_k_requested": getattr(dto, "top_k", None),
                        "retrieved_note_count": len(src_ids),
                        "citation_count": len(src_ids),
                        "source_note_ids": src_ids[:50],
                        "confidence_level": final_conf,
                        "confidence_reason": final_reason,
                        "confidence_method": "llm" if conf_level else "fallback",
                        "first_token_latency_ms": first_token_ms,
                        "total_response_time_ms": total_ms,
                        "stream_duration_ms": stream_ms,
                        "retrieval_time_ms": ctx_ms,
                        "llm_time_ms": llm_ms,
                    },
                )
                # Auto-track core workflow tasks from the real action
                self._eval.mark_task(dto.user_id, "ask_rag_question", "Ask a question based on the note", "rag_chat")
                if len(src_ids) > 0:
                    self._eval.mark_task(dto.user_id, "check_citation", "Review the source citation", "rag_chat")
            except Exception:
                pass  # analytics must never break chat

    async def handle_file_upload(
        self,
        conversation_id: int,
        prompt: str,
        files: List[UploadFile],
    ) -> ChatResponseDTO:
        prompt = prompt.strip() or "Please analyse the attached file(s) in detail."
        content_blocks: list = [{"type": "text", "text": prompt}]
        attachments: List[ChatAttachmentDTO] = []

        for file in files:
            filename = file.filename or "file"
            mime = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            file_bytes = await file.read()

            attachments.append(ChatAttachmentDTO(filename=filename, content_type=mime, size=len(file_bytes)))

            if _is_image(filename, mime):
                b64 = base64.b64encode(file_bytes).decode()
                content_blocks.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
            elif filename.lower().endswith(".pdf"):
                uploaded = client.files.create(file=(filename, file_bytes, mime), purpose="vision")
                content_blocks.append({"type": "file", "file": {"file_id": uploaded.id}})
            else:
                extracted = extract_text_local(file_bytes, filename)
                content_blocks.append({"type": "text", "text": f"FILE: {filename}\n\n{extracted}"})

        attachment_label = "Attached: " + ", ".join(a.filename for a in attachments)
        self.repo_conv.add_message(conversation_id, "user", f"{attachment_label}\n\n{prompt}")

        openai_client = OpenAI(api_key=settings.openai_api_key)
        completion = openai_client.chat.completions.create(
            model=settings.openai_chat_model,
            messages=[
                {"role": "system", "content": "You are MemoLink. Analyse all attached files and answer the prompt."},
                {"role": "user", "content": content_blocks},
            ],
        )
        answer = completion.choices[0].message.content
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model=settings.openai_chat_model)

        return ChatResponseDTO(answer=answer, sources=[], attachments=attachments, message_id=assistant_msg.id)
