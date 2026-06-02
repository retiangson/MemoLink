from typing import List, Iterator, Optional
from fastapi import UploadFile
from sqlalchemy.orm import Session
from openai import OpenAI, RateLimitError, APIStatusError
import json
import logging
import re
import base64
import mimetypes

from memolink_backend.core.config import settings

logger = logging.getLogger(__name__)
_HTML_TAG = re.compile(r"<[^>]+>")
# Matches markdown images with base64 data URLs — e.g. ![...](data:image/png;base64,...)
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

    # DALL-E not available — fall back to Pollinations.ai (free, no API key)
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
    "- **Title** — a clear, actionable title (verb + noun, e.g. 'Implement user registration endpoint')\n"
    "- **Type** — Feature / Bug / Chore / Spike / Documentation\n"
    "- **Priority** — Critical / High / Medium / Low (justify based on the notes)\n"
    "- **Epic / Category** — the feature area it belongs to\n"
    "- **Description** — 2–4 sentences explaining what needs to be done and why\n"
    "- **Acceptance Criteria** — a numbered checklist of specific, testable conditions that "
    "define 'done' (minimum 3 criteria per ticket)\n"
    "- **Technical Notes** — any implementation hints, constraints, or dependencies mentioned "
    "in the notes (e.g. specific endpoints, models, libraries, or architecture requirements)\n"
    "- **Dependencies** — list any other tickets this one depends on or blocks, if applicable\n"
    "Group tickets under clear ## Epic headings. "
    "Extract as many tickets as the notes actually justify — do not artificially shorten the list. "
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

        if len(all_notes) <= 20:
            # Small workspace — include every note in full (up to 1 500 chars each)
            for n in all_notes:
                sources.append(ChatAnswerSource(note_id=n.id, title=n.title, snippet=n.content[:200] + "..."))
                plain = _strip_base64_images(_HTML_TAG.sub(" ", n.content)).strip()
                rag_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{plain[:1500]}")
        else:
            # Large workspace — note directory + vector-search for top relevant notes
            note_dir = "\n".join(f"- [NOTE {n.id}] {n.title or 'Untitled'}" for n in all_notes)
            rag_blocks.append(f"[NOTE DIRECTORY — {len(all_notes)} notes]\n{note_dir}")

            try:
                query_vec = self.embedding.embed_text(user_text)
                top_notes = self.repo_notes.search_by_vector(query_vec, top_k=dto.top_k, workspace_id=ws_filter)
            except Exception:
                top_notes = all_notes[:dto.top_k]

            if not top_notes:
                top_notes = all_notes[:dto.top_k]

            for n in top_notes:
                sources.append(ChatAnswerSource(note_id=n.id, title=n.title, snippet=n.content[:200] + "..."))
                plain = _strip_base64_images(_HTML_TAG.sub(" ", n.content)).strip()
                rag_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{plain}")

        system_msgs = [{"role": "system", "content": _SYSTEM_PROMPT}]
        if rag_blocks:
            system_msgs.append({"role": "system", "content": "--- USER NOTES CONTEXT ---\n" + "\n\n".join(rag_blocks)})

        if getattr(dto, "web_search", False) and user_text:
            web_block = brave_search(user_text)
            if web_block:
                system_msgs.append({"role": "system", "content": web_block})

        return conversation_id, system_msgs + message_history, sources

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
                "Return ONLY the improved HTML — no markdown fences, no doctype, no html/body tags, no commentary."
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
                )
                improved_html = (completion.choices[0].message.content or "").strip()
                break
            except Exception:
                continue

        if not improved_html:
            msg = "⚠ Failed to improve the note — all AI models are currently unavailable."
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
        conversation_id, messages, sources = self._build_chat_context(dto)

        if _is_image_request(user_text):
            prompt = _extract_image_prompt(user_text)
            try:
                data_url, revised, img_model = _generate_image(prompt)
                answer = f"![Generated image]({data_url})\n\n*{revised}*"
            except Exception as exc:
                answer = f"⚠ Image generation failed: {exc}"
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model=img_model)
            return ChatResponseDTO(answer=answer, sources=[], message_id=assistant_msg.id)

        chain = _build_fallback_chain(model)
        used_model = model
        answer: Optional[str] = None
        last_error = ""

        for attempt in chain:
            try:
                completion = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt,
                    messages=messages,
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
                    self._syslog("warning", f"Fallback {attempt} also failed — trying next", {"model": attempt, "error": last_error}, dto.user_id)
                else:
                    self._syslog("warning", f"{model} failed — starting fallback chain {chain[1:]}", {"model": model, "error": last_error, "chain": chain[1:]}, dto.user_id)

        if answer is None:
            self._syslog("error", f"All models exhausted {chain} — returning error to user", {"chain": chain, "last_error": last_error}, dto.user_id)
            answer = f"⚠ All available AI models are currently unavailable. Please try again later.\n\n*Last error: {last_error}*"

        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model=used_model)
        return ChatResponseDTO(answer=answer, sources=sources, message_id=assistant_msg.id)

    def ask_stream(self, dto: ChatRequestDTO) -> Iterator[str]:
        """Yield SSE-formatted chunks. Each event is JSON: {"t":"<token>"} or {"done":true,"id":<int>}."""
        user_text = (dto.prompt or "").strip()
        if not user_text:
            yield f"data: {json.dumps({'t': 'I did not receive any message.'})}\n\n"
            yield f"data: {json.dumps({'done': True, 'id': None})}\n\n"
            return

        model = dto.model or settings.openai_chat_model
        user_keys = self._resolve_user_keys(dto.user_id)
        conversation_id, messages, _ = self._build_chat_context(dto)

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

        chain = _build_fallback_chain(model)
        full_answer = ""
        used_model = model
        succeeded = False
        last_error = ""

        for attempt in chain:
            try:
                stream = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt,
                    messages=messages,
                    stream=True,
                )
                if attempt != model:
                    self._syslog("warning", f"Fell back from {model} → {attempt} (stream)", {"original": model, "fallback": attempt}, dto.user_id)
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        full_answer += delta
                        yield f"data: {json.dumps({'t': delta})}\n\n"
                used_model = attempt
                succeeded = True
                break
            except Exception as e:
                last_error = str(e)
                logger.warning("Model %s failed (stream): %s", attempt, e)
                if attempt != model:
                    self._syslog("warning", f"Fallback {attempt} also failed (stream) — trying next", {"model": attempt, "error": last_error}, dto.user_id)
                else:
                    self._syslog("warning", f"{model} failed (stream) — starting fallback chain {chain[1:]}", {"model": model, "error": last_error, "chain": chain[1:]}, dto.user_id)

        if not succeeded:
            self._syslog("error", f"All models exhausted {chain} (stream) — returning error to user", {"chain": chain, "last_error": last_error}, dto.user_id)
            full_answer = f"⚠ All available AI models are currently unavailable. Please try again later.\n\n*Last error: {last_error}*"
            yield f"data: {json.dumps({'t': full_answer})}\n\n"

        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", full_answer, model=used_model)
        yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id, 'model': used_model})}\n\n"

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
