from dataclasses import dataclass, field
from typing import List, Iterator, Optional
from fastapi import UploadFile
from sqlalchemy.orm import Session
from openai import OpenAI, RateLimitError, APIStatusError
from datetime import date, timedelta
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
# Strips body_b64 attributes from draft tags so large note bodies don't bloat conversation history
_EMAIL_DRAFT_BODY = re.compile(r'\s+body_b64="[^"]*"', re.IGNORECASE)
_WHATSAPP_DRAFT_BODY = re.compile(r'\s+body_b64="[^"]*"', re.IGNORECASE)
# "find/search/check an email about X" -> structured clickable list, not GPT prose.
# Distinct from compose ("send"/"write"/"draft") and reply ("reply"/"respond") verbs, so it
# never collides with the email_draft direct-response branch.
_EMAIL_SEARCH_LIST_RE = re.compile(
    r"\b(find|search(?:\s+for)?|look\s*for|look\s*up|locate|check|show\s+me|show|see\s+if|"
    r"do\s+i\s+have|is\s+there|got\s+any)\b.{0,40}\b(email|emails|gmail|mail)\b",
    re.IGNORECASE,
)


def _has_email_search_list_intent(text: str) -> bool:
    return bool(_EMAIL_SEARCH_LIST_RE.search(text or ""))


_EMAIL_SEARCH_STOP_WORDS = {
    "can", "you", "check", "my", "about", "the", "an", "a", "is", "in",
    "for", "and", "or", "with", "from", "me", "please", "i", "have", "any",
    "email", "emails", "gmail", "inbox", "mail", "show", "get", "find", "search",
    "tell", "what", "do", "did", "does", "are", "was", "were", "that",
    "new", "all", "some", "there", "see", "look", "person", "subject", "content",
}


_EMAIL_ADDR_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

# Single-word affirmative/negative openers used by the short-message fallback heuristic
# (see _is_followup logic in _build_route_plan).
_FOLLOWUP_OPENERS = frozenset({
    "yes", "yeah", "yep", "yup", "no", "nope", "nah",
    "ok", "okay", "sure", "right", "correct", "exactly",
    "indeed", "definitely", "agreed", "perfect", "great",
})
# Spoken-filler words that may precede an opener ("uh, yes that's it").
_FOLLOWUP_FILLER = frozenset({"uh", "um", "hmm", "er", "well", "oh"})

# Matches complete affirmative/negative follow-up messages so the smart analyser does not
# wrongly return needs_clarification=True when the user is merely confirming a prior answer.
# Optional leading filler ("uh,", "um,") is accepted.  re.VERBOSE is used for readability.
_FOLLOWUP_RE = re.compile(
    r"""
    ^
    (?:(?:uh+|um+|hmm+|er+|well|oh)[,.]?\s+)*   # optional filler opener
    (?:
        yes | yeah | yep | yup
        | no  | nope | nah
        | ok  | okay | sure
        | right | correct | exactly
        | indeed | definitely | agreed
        | perfect | great
        | sounds \s+ good
        | go \s+ ahead | proceed | continue
        | that '? s? \s* (?:right|correct|it|what \s+ i \s+ (?:mean|meant)|the \s+ one)
        | that \s+ one
        | got \s+ it
        | i \s+ see
        | understood
        | makes? \s+ sense
        | thanks?
    )
    \W* $
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _build_gmail_search_query(user_text: str) -> str:
    """Builds a Gmail-API-compatible `q` string from free text, mapping common phrasing
    onto Gmail search operators and dropping stop words. Shared by the chat email-RAG
    block and the chat email-search-list direct-response branch."""
    lower = user_text.lower()
    operators: list[str] = []
    consumed: set[str] = set()
    text_for_keywords = user_text

    # Literal email addresses (e.g. "check email from talk2tutu@gmail.com") must become a
    # precise from:/to: operator — the generic [^\w] cleanup below would otherwise strip
    # "@" and "." and mangle the address into something Gmail can never match.
    for match in _EMAIL_ADDR_RE.finditer(user_text):
        addr = match.group(0)
        preceding = user_text[max(0, match.start() - 12):match.start()].lower()
        direction = "to" if re.search(r"\bto\s*$", preceding) else "from"
        operators.append(f"{direction}:{addr}")
        text_for_keywords = text_for_keywords.replace(addr, "")

    att_words = {"attachment", "attached", "attachments", "file", "files",
                 "document", "documents", "pdf", "docx", "xlsx", "pptx",
                 "zip", "image", "photo", "photos"}
    if any(w in lower for w in att_words):
        operators.append("has:attachment")
        consumed |= att_words

    unread_words = {"unread", "unseen"}
    if any(w in lower for w in unread_words):
        operators.append("is:unread")
        consumed |= unread_words

    sent_words = {"sent", "outbox"}
    if any(w in lower for w in sent_words):
        operators.append("in:sent")
        consumed |= sent_words

    keywords = " ".join(
        clean for w in text_for_keywords.split()
        if (clean := re.sub(r"[^\w]", "", w)) and
           clean.lower() not in _EMAIL_SEARCH_STOP_WORDS and
           clean.lower() not in consumed and
           len(clean) > 2
    )
    gm_query = " ".join(operators + ([keywords] if keywords.strip() else []))
    return gm_query.strip() or user_text


def _strip_base64_images(text: str) -> str:
    """Replace embedded base64 images with a short placeholder to prevent token overflow.
    Also strips draft body_b64 attributes from conversation history."""
    text = _BASE64_IMG_MD.sub(r'[generated image: \1]', text)
    text = _BASE64_IMG_HTML.sub('[embedded image]', text)
    text = _EMAIL_DRAFT_BODY.sub('', text)
    text = _WHATSAPP_DRAFT_BODY.sub('', text)
    return text


def _dedupe_sources(sources: list) -> list:
    """Keep the first occurrence of each note_id, preserving order."""
    seen: set = set()
    deduped = []
    for s in sources or []:
        if s.note_id in seen:
            continue
        seen.add(s.note_id)
        deduped.append(s)
    return deduped


from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.reminder_repository import ReminderRepository
from memolink_backend.domain.repositories.book_repository import BookRepository
from memolink_backend.domain.interfaces.i_conversation_repository import IConversationRepository
from memolink_backend.domain.interfaces.i_note_repository import INoteRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.interfaces.i_chat_service import IChatService
from memolink_backend.business.services.action_agent import ActionAgentRunner, decide_action_agent
from memolink_backend.business.services.core_memory_service import CoreMemoryService
from memolink_backend.utils.file_extractor import extract_text_local
from memolink_backend.utils.web_search import brave_search
from memolink_backend.utils.academic_search import (
    extract_cited_papers,
    format_paper_as_note,
    format_papers_context,
    paper_title_key,
    search_papers,
)
from memolink_backend.contracts.chat_dtos import (
    ChatResponseDTO, ChatAnswerSource, ChatRequestDTO, ChatAttachmentDTO,
    ChatEmailResultDTO, ChatEmailAttachmentDTO,
)
from memolink_backend.contracts.chat_stream_dtos import (
    ImageGeneratingEvent,
    MessageCompleteEvent,
    MessageDeltaEvent,
    MessageReplaceEvent,
    NoteCloseEvent,
    NoteImprovingEvent,
    sse_event,
)
from memolink_backend.business.services.autopilot_service import route as autopilot_route
from memolink_backend.business.services import smart_engine

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

_GENERIC_WEB_SEARCH_PHRASES = (
    "search online",
    "search the internet",
    "search the web",
    "search web",
    "look it up",
    "check online",
    "search for it",
    "latest news",
    "latest updates",
    "current news",
    "current updates",
    "real time",
    "realtime",
    "web search",
)
_GENERIC_WEB_SEARCH_STOPWORDS = {
    "a", "an", "and", "any", "can", "could", "do", "for", "find", "get", "give", "i", "it",
    "latest", "look", "me", "news", "now", "of", "on", "online", "please", "recent", "search",
    "show", "tell", "that", "the", "this", "today", "updates", "up", "web", "what", "with", "you",
}
_WEB_SEARCH_FRESHNESS_CUES = (
    "latest", "recent", "current", "today", "now", "news", "real time", "realtime", "live",
)
_DIRECT_REMINDER_RE = re.compile(
    r"\b(?:create|set|add)\s+(?:me\s+)?(?:an?\s+)?reminder\b|\bremind me\b",
    re.IGNORECASE,
)
_DIRECT_REMINDER_PREFIX_RE = re.compile(
    r"^\s*(?:can|could|would|will)\s+you\s+|^\s*please\s+",
    re.IGNORECASE,
)
_DIRECT_REMINDER_LEAD_RE = re.compile(
    r"^\s*(?:create|set|add)\s+(?:me\s+)?(?:an?\s+)?reminder(?:\s+for\s+me)?(?:\s+to)?[\s,:-]*",
    re.IGNORECASE,
)
_REMIND_ME_LEAD_RE = re.compile(
    r"^\s*remind\s+me(?:\s+to)?[\s,:-]*",
    re.IGNORECASE,
)
_MEMORY_PROMPT_COMMENT_RE = re.compile(r"<!--MEMORY_PROMPT:(\{.*?\})-->", re.DOTALL)
_SAVE_TO_CORE_RE = re.compile(
    r"\b(?:save|remember|store|keep)\s+(?:that|this|it)\s+(?:to|in)?\s*(?:your\s+)?(?:core|core memory|memory)\b",
    re.IGNORECASE,
)
_ISO_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_TIME_12H_RE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", re.IGNORECASE)
_TIME_24H_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")
_RELATIVE_DATE_MARKERS = {
    "today": lambda today: today,
    "tomorrow": lambda today: today + timedelta(days=1),
}


@dataclass
class _ChatRoutePlan:
    conversation_id: int
    messages: list[dict]
    sources: list[ChatAnswerSource]
    pre_conf_level: str | None
    pre_conf_reason: str | None
    routing_reason: str | None
    workspace_filter: int | None
    decision: str = "llm_chat"
    direct_response: ChatResponseDTO | None = None
    note_name: str | None = None
    image_prompt: str | None = None
    smart_analysis: dict | None = None
    smart_mode_name: str = "general_chat"
    extra_completion_kwargs: dict = field(default_factory=dict)
    fetched_papers: list[dict] = field(default_factory=list)


def _is_generic_web_search_request(text: str) -> bool:
    lower = (text or "").lower().strip()
    if not lower:
        return False

    cleaned = lower
    for phrase in _GENERIC_WEB_SEARCH_PHRASES:
        cleaned = cleaned.replace(phrase, " ")
    cleaned = re.sub(r"[^a-z0-9\s]", " ", cleaned)
    tokens = [
        token for token in cleaned.split()
        if token not in _GENERIC_WEB_SEARCH_STOPWORDS and len(token) > 2 and not token.isdigit()
    ]
    has_search_cue = any(cue in lower for cue in _GENERIC_WEB_SEARCH_PHRASES + _WEB_SEARCH_FRESHNESS_CUES)
    return has_search_cue and not tokens


def _derive_web_search_query(user_text: str, message_history: list[dict]) -> str:
    current = (user_text or "").strip()
    if not current:
        return ""
    if not _is_generic_web_search_request(current):
        return current[:200]

    current_lower = current.lower()
    wants_freshness = any(cue in current_lower for cue in _WEB_SEARCH_FRESHNESS_CUES)

    for message in reversed(message_history[:-1]):
        if message.get("role") != "user":
            continue
        candidate = (message.get("content") or "").strip()
        if not candidate or _is_generic_web_search_request(candidate):
            continue
        if len(candidate) < 8:
            continue

        query = candidate
        if wants_freshness and not any(cue in candidate.lower() for cue in _WEB_SEARCH_FRESHNESS_CUES):
            query = f"{candidate} latest news"
        return query[:200]

    return current[:200]


def _is_direct_reminder_request(text: str) -> bool:
    return bool(_DIRECT_REMINDER_RE.search(text or ""))


def _normalize_reminder_time(text: str) -> str | None:
    if not text:
        return None

    match_12h = _TIME_12H_RE.search(text)
    if match_12h:
        hour = int(match_12h.group(1))
        minute = int(match_12h.group(2) or "00")
        meridiem = match_12h.group(3).lower()
        if meridiem == "pm" and hour != 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute:02d}"

    match_24h = _TIME_24H_RE.search(text)
    if match_24h:
        return f"{int(match_24h.group(1)):02d}:{int(match_24h.group(2)):02d}"

    return None


def _normalize_reminder_date(text: str, *, today: date) -> str | None:
    if not text:
        return None

    iso_match = _ISO_DATE_RE.search(text)
    if iso_match:
        return iso_match.group(1)

    lower = text.lower()
    for marker, resolver in _RELATIVE_DATE_MARKERS.items():
        if re.search(rf"\b{marker}\b", lower):
            return resolver(today).isoformat()
    return None


def _clean_reminder_title(text: str) -> str:
    title = text.strip()
    title = _DIRECT_REMINDER_PREFIX_RE.sub("", title)
    title = _DIRECT_REMINDER_LEAD_RE.sub("", title)
    title = _REMIND_ME_LEAD_RE.sub("", title)
    title = re.sub(r"\b(?:for|on)\s+\d{4}-\d{2}-\d{2}\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\b(?:today|tomorrow)\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\bat\s+(?:[01]?\d|2[0-3]):[0-5]\d\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(_ISO_DATE_RE, " ", title)
    title = re.sub(_TIME_24H_RE, " ", title)
    title = re.sub(_TIME_12H_RE, " ", title)
    title = re.sub(r"\b(?:i have|i need|there is|there's|to)\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"[.,!?]+$", "", title).strip(" ,:-")
    title = re.sub(r"\s{2,}", " ", title).strip()
    if not title:
        return ""
    return title[0].upper() + title[1:]


def _extract_direct_reminder_request(text: str, *, today: date) -> dict | None:
    if not _is_direct_reminder_request(text):
        return None

    due_date = _normalize_reminder_date(text, today=today)
    due_time = _normalize_reminder_time(text)
    title = _clean_reminder_title(text)
    if not title:
        return None

    description = title if title.lower() != text.strip().lower() else None
    return {
        "text": title,
        "description": description,
        "due_date": due_date,
        "due_time": due_time,
    }


def _format_direct_reminder_confirmation(title: str, due_date: str | None, due_time: str | None) -> str:
    due_parts = []
    if due_date:
        due_parts.append(f"for {due_date}")
    if due_time:
        due_parts.append(f"at {due_time}")
    due_text = f" {' '.join(due_parts)}" if due_parts else ""
    return f"Successfully added the reminder **{title}**{due_text}."


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
_GENERAL_IMPROVE_WRITING_RE = re.compile(
    r"^\s*(?:can|could|would|will)\s+you\s+make\s+this\s+better\b|^\s*(?:please\s+)?(?:improve|rewrite|polish|edit|clean[\s-]?up|fix|format)\s+(?:this|the following)\b",
    re.IGNORECASE,
)
_WHATSAPP_DIRECT_TO_RE = re.compile(
    r"\bto\s+(\+?\d[\d\s().-]{5,}\d|[0-9]+@s\.whatsapp\.net|[0-9-]+@g\.us)\b",
    re.IGNORECASE,
)
_WHATSAPP_CONTENT_BEFORE_RE = re.compile(
    r"^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?send\s+(.+?)\s+(?:using|via|through|on)\s+whatsapp\s+to\s+(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
_WHATSAPP_CONTENT_TO_RE = re.compile(
    r"^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?send\s+(.+?)\s+to\s+(.+?)\s+(?:using|via|through|on)\s+whatsapp\s*$",
    re.IGNORECASE | re.DOTALL,
)


def _extract_improve_note_name(text: str) -> str | None:
    t = text.strip()
    for pattern in (_IMPROVE_NOTE_RE, _MAKE_NAME_NOTE_BETTER_RE, _MAKE_NOTE_NAME_BETTER_RE):
        m = pattern.search(t)
        if m:
            return m.group(1).strip().strip('"\'')
    return None


def _looks_like_general_writing_improve_request(text: str) -> bool:
    return bool(_GENERAL_IMPROVE_WRITING_RE.search(text or ""))


def _extract_whatsapp_draft_intent(text: str) -> dict | None:
    lower = (text or "").lower()
    if "whatsapp" not in lower or not re.search(r"\b(send|message|share)\b", lower):
        return None

    for pattern in (_WHATSAPP_CONTENT_BEFORE_RE, _WHATSAPP_CONTENT_TO_RE):
        match = pattern.search(text)
        if match:
            return {
                "body_hint": match.group(1).strip().strip('"\'., '),
                "recipient": match.group(2).strip().strip('"\'., '),
            }

    recipient_match = _WHATSAPP_DIRECT_TO_RE.search(text)
    if not recipient_match:
        return None

    before = text[:recipient_match.start()].strip()
    before = re.sub(
        r"^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:send|message|share)\s+",
        "",
        before,
        flags=re.IGNORECASE,
    )
    before = re.sub(r"\s+(?:using|via|through|on)\s+whatsapp\s*$", "", before, flags=re.IGNORECASE).strip()
    return {"body_hint": before.strip('"\'., '), "recipient": recipient_match.group(1).strip()}


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
    "You are MemoLink, a smart AI companion. "
    "You have access to the user's notes and should use them as your primary source whenever they are relevant. "
    "You also have access to the user's Gmail account — when email context appears below you MUST "
    "use it to answer questions about emails. NEVER say you cannot access email — MemoLink has "
    "native Gmail integration and can search, read, display emails, AND send replies directly in the chat. "
    "When asked to reply to someone, MemoLink will send it and you will be told whether it succeeded. "
    "Always be thoughtful, capable, and grounded in the actual available context. "
    "Act like a smart, supportive collaborator who solves the user's real problem instead of giving shallow generic replies. "
    "Default to a strong first answer with enough substance to be useful immediately. "
    "Format every substantive response using rich markdown: "
    "## headings for major sections, ### for subsections, **bold** for key terms, "
    "bullet or numbered lists, and tables where data is tabular. "
    "Never respond with a wall of plain text. "
    "Cite note or source context where relevant. "
    "Only be brief for genuinely trivial one-line questions; for everything else, go deep. "
    "If the user asks for a full, complete, detailed, or thorough answer, honor that request explicitly rather than compressing it.\n\n"

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
        reminder_repo=None,
        action_agent=None,
        log_service=None,
        user_api_key_repo=None,
        graph_repo=None,
        eval_service=None,
        email_record_repo=None,
        email_service=None,
        core_memory_service=None,
        book_repo=None,
    ):
        if conv_repo is not None and note_repo is not None:
            self.repo_conv: IConversationRepository = conv_repo
            self.repo_notes: INoteRepository = note_repo
        else:
            if db is None:
                raise ValueError("Either repos or db must be provided.")
            self.repo_conv = ConversationRepository(db)
            self.repo_notes = NoteRepository(db)
        if reminder_repo is not None:
            self._reminders = reminder_repo
        else:
            self._reminders = ReminderRepository(db) if db is not None else None
        self._action_agent = action_agent or (
            ActionAgentRunner(
                conv_repo=self.repo_conv,
                note_repo=self.repo_notes,
                reminder_repo=self._reminders,
                embedding_service=embedding_service,
            )
            if self._reminders is not None
            else None
        )

        self.embedding = embedding_service or EmbeddingService()
        self._log = log_service
        self._user_api_key_repo = user_api_key_repo
        self._graph_repo = graph_repo
        self._email_record_repo = email_record_repo
        self._email_service = email_service
        self._eval = eval_service
        self._book_repo = book_repo or (BookRepository(db) if db is not None else None)
        self._core_memory = core_memory_service or CoreMemoryService(
            note_repo=self.repo_notes,
            user_repo=None,
            embedding_service=self.embedding,
        )

    def _syslog(self, level: str, message: str, details: dict, user_id: int | None = None):
        if self._log is None:
            return
        try:
            getattr(self._log, level.lower())("chat", message, details, user_id)
        except Exception as exc:
            logger.warning("Failed to write system log entry: %s", exc)

    def _resolve_user_keys(self, user_id: int | None) -> dict:
        if not user_id or not self._user_api_key_repo:
            return {}
        try:
            return self._user_api_key_repo.get_all_decrypted(user_id)
        except Exception as exc:
            logger.warning("Failed to resolve user API keys for user_id=%s: %s", user_id, exc)
            return {}

    def _persist_direct_response(
        self,
        conversation_id: int,
        answer: str,
        *,
        routing_reason: str | None,
        model: str = "memolink",
        sources: list[ChatAnswerSource] | None = None,
        email_results: list[ChatEmailResultDTO] | None = None,
    ) -> ChatResponseDTO:
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model=model)
        return ChatResponseDTO(
            answer=answer,
            sources=sources or [],
            email_results=email_results or [],
            message_id=assistant_msg.id,
            routing_reason=routing_reason,
        )

    def _build_email_search_list_response(
        self, *, dto: ChatRequestDTO, user_text: str, conversation_id: int,
    ) -> ChatResponseDTO:
        """Handles "find/search email for/about X" — returns a structured clickable list
        instead of GPT prose. Each result is shaped to match the frontend's BrowseEmailResult
        so clicking it opens the email in a tab with no extra fetch."""
        gm_query = _build_gmail_search_query(user_text)
        try:
            raw_results = self._email_service.search_for_chat_sync(dto.user_id, gm_query, top_k=10)
        except Exception:
            logger.exception("Email search-list direct response failed")
            raw_results = []

        email_results = [
            ChatEmailResultDTO(
                id=em.get("id"),
                gmail_message_id=em.get("gmail_message_id"),
                gmail_thread_id=em.get("gmail_thread_id"),
                subject=em.get("subject") or "(no subject)",
                sender_name=em.get("sender_name"),
                sender_email=em.get("sender_email") or "",
                snippet=em.get("snippet"),
                body_text=em.get("body_text"),
                body_html=em.get("body_html"),
                attachments=[ChatEmailAttachmentDTO(**a) for a in em.get("attachments", [])],
                importance_score=em.get("importance_score", 3.0),
                is_read=em.get("is_read", True),
                email_date=em.get("email_date"),
                email_account_id=em.get("email_account_id"),
                email_address=em.get("email_address"),
                is_pinned=em.get("is_pinned", False),
            )
            for em in raw_results
        ]

        if email_results:
            answer = f"Found {len(email_results)} email{'s' if len(email_results) != 1 else ''} matching your search. Click one to open it."
        else:
            answer = "I couldn't find any emails matching that search."

        return self._persist_direct_response(
            conversation_id,
            answer,
            routing_reason="Direct: email_search_list",
            email_results=email_results,
        )

    def _build_route_plan(
        self,
        *,
        dto: ChatRequestDTO,
        user_text: str,
        model: str,
        user_keys: dict,
        conversation_id: int,
        messages: list[dict],
        sources: list[ChatAnswerSource],
        pre_conf_level: str | None,
        pre_conf_reason: str | None,
        routing_reason: str | None,
        email_draft_prefill: str | None,
        whatsapp_draft_prefill: str | None,
        email_search_list_intent: bool = False,
    ) -> _ChatRoutePlan:
        plan = _ChatRoutePlan(
            conversation_id=conversation_id,
            messages=messages,
            sources=sources,
            pre_conf_level=pre_conf_level,
            pre_conf_reason=pre_conf_reason,
            routing_reason=routing_reason,
            workspace_filter=None if getattr(dto, "cross_workspace", False) else getattr(dto, "workspace_id", None),
        )

        clarification_question: str | None = None
        if getattr(dto, "smart_mode", True):
            try:
                analyser_client = _get_client(model, user_keys)
                plan.smart_analysis = smart_engine.analyse_request(user_text, analyser_client, model, history=messages)
                plan.smart_mode_name = plan.smart_analysis.get("mode", "general_chat")
                # Skip clarification for affirmative/follow-up messages.  Two-tier check:
                # 1. Full regex match — pure affirmatives with optional filler ("uh, yes").
                # 2. Opener + short message — catches "yes please do that" (≤ 6 tokens
                #    starting with an affirmative word) and filler-prefixed variants like
                #    "uh, yes that's it" (filler first word, affirmative second word).
                _stripped_text = user_text.strip()
                _text_words = _stripped_text.split()
                _w0 = _text_words[0].lower().rstrip(",.!?") if _text_words else ""
                _w1 = _text_words[1].lower().rstrip(",.!?") if len(_text_words) > 1 else ""
                _is_followup = bool(_FOLLOWUP_RE.match(_stripped_text)) or (
                    bool(_text_words)
                    and len(_text_words) <= 6
                    and (
                        _w0 in _FOLLOWUP_OPENERS
                        or (_w0 in _FOLLOWUP_FILLER and _w1 in _FOLLOWUP_OPENERS)
                    )
                )
                if not _is_followup and plan.smart_analysis.get("needs_clarification") and plan.smart_analysis.get("clarifying_question"):
                    clarification_question = str(plan.smart_analysis["clarifying_question"])
                else:
                    context_engine = smart_engine.build_context_engine(plan.smart_mode_name)
                    prepared_context = context_engine.prepare(
                        messages=plan.messages,
                        user_text=user_text,
                        smart_analysis=plan.smart_analysis,
                        today=date.today(),
                    )
                    plan.messages = prepared_context.messages
                    plan.fetched_papers = prepared_context.papers
                    plan.extra_completion_kwargs = {
                        "temperature": prepared_context.mode_settings["temperature"],
                        "max_tokens": prepared_context.mode_settings["max_tokens"],
                    }
                    plan.routing_reason = plan.routing_reason or f"Smart: {plan.smart_mode_name}"
                    self._syslog(
                        "info",
                        f"Smart engine: mode={plan.smart_mode_name} intent={plan.smart_analysis.get('intent', '')}",
                        {"mode": plan.smart_mode_name, "needs_retrieval": plan.smart_analysis.get("needs_retrieval")},
                        dto.user_id,
                    )
            except Exception as exc:
                logger.debug("Smart engine integration failed (non-fatal): %s", exc)
                plan.smart_analysis = None
                plan.smart_mode_name = "general_chat"
                plan.extra_completion_kwargs = {}
                plan.fetched_papers = []

        # Inject books catalog AFTER context engine so it is never overwritten.
        # Appended as the last system message so it is closest to the user turn.
        _books_msg = self._get_books_catalog_msg(user_query=user_text)
        if _books_msg:
            plan.messages = list(plan.messages) + [{"role": "system", "content": _books_msg}]
            self._syslog("info", "Books catalog injected into chat context", {}, dto.user_id)
        else:
            self._syslog("info", "Books catalog: skipped (no books or repo unavailable)", {}, dto.user_id)

        if whatsapp_draft_prefill:
            plan.decision = "direct_response"
            plan.direct_response = self._persist_direct_response(
                conversation_id,
                whatsapp_draft_prefill,
                routing_reason="Direct: whatsapp_draft",
            )
            return plan

        if email_draft_prefill:
            plan.decision = "direct_response"
            plan.direct_response = self._persist_direct_response(
                conversation_id,
                email_draft_prefill,
                routing_reason="Direct: email_draft",
            )
            return plan

        if email_search_list_intent and self._email_service and dto.user_id:
            plan.decision = "direct_response"
            plan.direct_response = self._build_email_search_list_response(
                dto=dto,
                user_text=user_text,
                conversation_id=conversation_id,
            )
            return plan

        prompted_memory = self._maybe_capture_prompted_memory_answer(
            dto=dto,
            conversation_id=conversation_id,
            user_text=user_text,
        )
        if prompted_memory:
            plan.decision = "direct_response"
            plan.direct_response = prompted_memory
            return plan

        saved_from_context = self._extract_memory_from_recent_exchange(
            dto=dto,
            conversation_id=conversation_id,
            user_text=user_text,
        )
        if saved_from_context:
            plan.decision = "direct_response"
            plan.direct_response = saved_from_context
            return plan

        direct_reminder = self._maybe_create_direct_reminder(
            dto=dto,
            conversation_id=conversation_id,
            user_text=user_text,
        )
        if direct_reminder:
            plan.decision = "direct_response"
            plan.direct_response = direct_reminder
            return plan

        core_memory_answer = self._maybe_answer_from_core_memory(
            dto=dto,
            conversation_id=conversation_id,
            user_text=user_text,
        )
        if core_memory_answer:
            plan.decision = "direct_response"
            plan.direct_response = core_memory_answer
            return plan

        note_name = _extract_improve_note_name(user_text)
        if note_name:
            plan.decision = "note_improve"
            plan.note_name = note_name
            plan.routing_reason = "Direct: note_improve"
            return plan

        if _is_image_request(user_text):
            plan.decision = "image"
            plan.image_prompt = _extract_image_prompt(user_text)
            plan.routing_reason = "Direct: image_generation"
            return plan

        if clarification_question is not None:
            plan.decision = "direct_response"
            plan.direct_response = self._persist_direct_response(
                conversation_id,
                clarification_question,
                routing_reason="Smart: clarification",
                model=model,
            )
            return plan

        action_agent_reason = self._should_use_action_agent(user_text, plan.smart_analysis)
        if action_agent_reason:
            plan.decision = "action_agent"
            plan.routing_reason = action_agent_reason
            return plan

        if plan.smart_analysis is not None and self._is_long_academic_request(user_text, plan.smart_analysis):
            plan.decision = "long_academic"
            plan.routing_reason = plan.routing_reason or "Smart: academic_writer"
            return plan

        return plan

    def _maybe_create_direct_reminder(
        self,
        *,
        dto: ChatRequestDTO,
        conversation_id: int,
        user_text: str,
    ) -> ChatResponseDTO | None:
        if self._reminders is None:
            return None

        reminder_payload = _extract_direct_reminder_request(user_text, today=date.today())
        if reminder_payload is None:
            return None

        reminder = self._reminders.create_reminder(
            user_id=dto.user_id,
            text=reminder_payload["text"],
            workspace_id=getattr(dto, "workspace_id", None),
            description=reminder_payload["description"],
            reminder_type="ai",
            due_date=reminder_payload["due_date"],
            due_time=reminder_payload["due_time"],
        )
        response = _format_direct_reminder_confirmation(
            reminder.text,
            reminder.due_date,
            reminder.due_time,
        )
        assistant_msg = self.repo_conv.add_message(
            conversation_id,
            "assistant",
            response,
            model="memolink",
        )
        return ChatResponseDTO(
            answer=response,
            sources=[],
            message_id=assistant_msg.id,
            routing_reason="Direct: reminder_create",
        )

    def _should_use_action_agent(self, user_text: str, smart_analysis: dict | None) -> str | None:
        if self._action_agent is None:
            return None
        decision = decide_action_agent(user_text, smart_analysis)
        return decision.reason if decision.should_handle else None

    def _maybe_answer_from_core_memory(
        self,
        *,
        dto: ChatRequestDTO,
        conversation_id: int,
        user_text: str,
    ) -> ChatResponseDTO | None:
        if not dto.user_id or self._core_memory is None:
            return None
        workspace_id = None if getattr(dto, "cross_workspace", False) else getattr(dto, "workspace_id", None)
        memory = self._core_memory.find_relevant_memory(dto.user_id, workspace_id, user_text)
        if memory is None:
            spec = self._core_memory.infer_missing_memory(user_text)
            if spec is None:
                return None
            answer = spec["prompt_question"] + "\n" + self._core_memory.memory_prompt_marker(spec)
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model="memolink")
            return ChatResponseDTO(
                answer=answer,
                sources=[],
                message_id=assistant_msg.id,
                routing_reason="Direct: core_memory_prompt_missing",
            )

        masked_value = getattr(memory, "masked_content", None) or getattr(memory, "title", None) or "the matching Core Memory entry"
        if getattr(memory, "is_encrypted", False):
            unlock_token = getattr(dto, "core_memory_unlock_token", None)
            if not unlock_token:
                answer = (
                    f"I found a matching Core Memory entry for **{memory.title or 'that item'}**, but it is locked. "
                    f"I can only show the masked value right now: **{masked_value}**.\n\n"
                    "Please unlock Core Memory and ask again if you want the full value revealed."
                )
                assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model="memolink")
                return ChatResponseDTO(
                    answer=answer,
                    sources=[ChatAnswerSource(note_id=memory.id, title=memory.title, snippet=masked_value[:200])],
                    message_id=assistant_msg.id,
                    routing_reason="Direct: core_memory_locked",
                )
            try:
                plaintext = self._core_memory.reveal_memory(dto.user_id, memory.id, unlock_token)
            except HTTPException:
                answer = (
                    f"I found a matching Core Memory entry for **{memory.title or 'that item'}**, but the vault token is missing or expired. "
                    f"Masked value: **{masked_value}**.\n\nPlease unlock Core Memory again, then ask once more."
                )
                assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model="memolink")
                return ChatResponseDTO(
                    answer=answer,
                    sources=[ChatAnswerSource(note_id=memory.id, title=memory.title, snippet=masked_value[:200])],
                    message_id=assistant_msg.id,
                    routing_reason="Direct: core_memory_unlock_required",
                )

            live_answer = self._core_memory.format_memory_answer(
                query_text=user_text,
                note=memory,
                revealed_value=plaintext,
            )
            persisted_answer = (
                f"I revealed your **{memory.title or 'Core Memory'}** after vault verification. "
                f"Masked value kept in history: **{masked_value}**."
            )
            assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", persisted_answer, model="memolink")
            return ChatResponseDTO(
                answer=live_answer,
                sources=[ChatAnswerSource(note_id=memory.id, title=memory.title, snippet=masked_value[:200])],
                    message_id=assistant_msg.id,
                    routing_reason="Direct: core_memory_reveal",
                )

        answer = self._core_memory.format_memory_answer(
            query_text=user_text,
            note=memory,
        )
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model="memolink")
        return ChatResponseDTO(
            answer=answer,
            sources=[ChatAnswerSource(note_id=memory.id, title=memory.title, snippet=masked_value[:200])],
            message_id=assistant_msg.id,
            routing_reason="Direct: core_memory_answer",
        )

    def _extract_pending_memory_spec(self, conversation_id: int, current_user_text: str) -> dict | None:
        recent = self.repo_conv.get_messages_paginated(conversation_id, limit=6, before_id=None)
        if len(recent) < 2:
            return None
        latest = recent[0]
        if latest.role != "user":
            return None
        if current_user_text.strip() != (latest.content or "").strip():
            return None
        if "?" in current_user_text and len(current_user_text.strip()) > 12:
            return None

        previous = recent[1]
        if previous.role != "assistant":
            return None
        match = _MEMORY_PROMPT_COMMENT_RE.search(previous.content or "")
        if not match:
            return None
        try:
            return json.loads(match.group(1))
        except Exception as exc:
            logger.debug("Failed to parse pending memory spec comment: %s", exc)
            return None

    def _maybe_capture_prompted_memory_answer(
        self,
        *,
        dto: ChatRequestDTO,
        conversation_id: int,
        user_text: str,
    ) -> ChatResponseDTO | None:
        if not dto.user_id or self._core_memory is None:
            return None
        spec = self._extract_pending_memory_spec(conversation_id, user_text)
        if spec is None:
            return None
        workspace_id = None if getattr(dto, "cross_workspace", False) else getattr(dto, "workspace_id", None)
        stored = self._core_memory.store_prompted_memory_answer(
            user_id=dto.user_id,
            workspace_id=workspace_id,
            spec=spec,
            answer_text=user_text,
        )
        if stored is None:
            return None

        answer = f"Okay, I'll remember that {stored['subject']} is {stored['display_value']}."
        if stored["stored_plaintext"]:
            answer = f"Okay, I'll remember that. I stored {stored['subject']} securely."
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model="memolink")
        return ChatResponseDTO(
            answer=answer,
            sources=[ChatAnswerSource(note_id=stored["note"].id, title=stored["note"].title, snippet=str(stored["display_value"])[:200])],
            message_id=assistant_msg.id,
            routing_reason="Direct: core_memory_learned",
        )

    def _extract_memory_from_recent_exchange(
        self,
        *,
        dto: ChatRequestDTO,
        conversation_id: int,
        user_text: str,
    ) -> ChatResponseDTO | None:
        if not dto.user_id or self._core_memory is None:
            return None
        if not _SAVE_TO_CORE_RE.search(user_text):
            return None

        recent = self.repo_conv.get_messages_paginated(conversation_id, limit=6, before_id=None)
        if len(recent) < 3:
            return None
        latest = recent[0]
        if latest.role != "user" or (latest.content or "").strip() != user_text.strip():
            return None
        previous_assistant = recent[1]
        previous_user = recent[2]
        if previous_assistant.role != "assistant" or previous_user.role != "user":
            return None

        spec = self._core_memory.infer_missing_memory(previous_user.content or "")
        if spec is None:
            return None
        workspace_id = None if getattr(dto, "cross_workspace", False) else getattr(dto, "workspace_id", None)
        stored = self._core_memory.save_memory_from_spec(
            user_id=dto.user_id,
            workspace_id=workspace_id,
            spec=spec,
            answer_text=previous_assistant.content or "",
        )
        if stored is None:
            return None

        answer = f"Okay, I saved {stored['subject']} to Core Memory."
        if stored["stored_plaintext"]:
            answer = f"Okay, I saved {stored['subject']} to Core Memory securely."
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer, model="memolink")
        return ChatResponseDTO(
            answer=answer,
            sources=[ChatAnswerSource(note_id=stored["note"].id, title=stored["note"].title, snippet=str(stored["display_value"])[:200])],
            message_id=assistant_msg.id,
            routing_reason="Direct: core_memory_saved_from_context",
        )

    def _run_completion_chain(
        self,
        primary_model: str,
        user_keys: dict,
        messages: list[dict],
        extra_kwargs: dict | None = None,
    ) -> tuple[str, str]:
        chosen_model, _ = _reroute_large_request(
            primary_model,
            _estimate_tokens(messages),
            settings.gemini_api_key,
            settings.openai_chat_model,
        )
        chain = _build_fallback_chain(chosen_model, user_keys)
        last_error = ""
        for attempt in chain:
            try:
                kwargs = {**_completion_kwargs(attempt), **(extra_kwargs or {})}
                completion = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt,
                    messages=messages,
                    **kwargs,
                )
                return (completion.choices[0].message.content or "").strip(), attempt
            except Exception as exc:
                last_error = str(exc)
                logger.warning("Long-form model %s failed: %s", attempt, exc)
        raise RuntimeError(last_error or "All completion attempts failed")

    def _is_long_academic_request(self, prompt: str, smart_analysis: dict | None) -> bool:
        if (smart_analysis or {}).get("mode") != "academic_writer":
            return False
        lower = prompt.lower()
        min_words, _ = smart_engine.parse_word_targets(prompt)
        strong_keywords = (
            "complete paper",
            "entire research paper",
            "full report",
            "final paper",
            "final submission",
            "fulfill all rubric",
            "fulfil all rubric",
            "assessment",
            "citations and references",
        )
        return min_words >= 3000 or any(k in lower for k in strong_keywords)

    def _long_academic_outline(self, prompt: str, min_words: int, max_words: int) -> list[dict]:
        target_total = max(min_words or 5000, 5000)
        if max_words:
            target_total = min(target_total + 800, max_words)
        prompt_lc = prompt.lower()
        if "literature review" in prompt_lc:
            sections = [
                ("Abstract", 300),
                ("Introduction", 650),
                ("Literature Review", 1700),
                ("Comparative Analysis and Synthesis", 1200),
                ("Implications and Gaps", 700),
                ("Conclusion", 400),
                ("References", 250),
            ]
        elif any(term in prompt_lc for term in ("proposal", "proposed", "research design", "methodology")):
            sections = [
                ("Abstract", 300),
                ("Introduction", 600),
                ("Background and Problem Statement", 850),
                ("Literature Review", 1200),
                ("Research Objectives and Questions", 500),
                ("Methodology and Approach", 1200),
                ("Expected Outcomes and Evaluation Plan", 700),
                ("Ethical Considerations", 450),
                ("Conclusion", 350),
                ("References", 250),
            ]
        else:
            sections = [
                ("Abstract", 300),
                ("Introduction", 650),
                ("Background and Literature Review", 1400),
                ("Main Analysis", 1200),
                ("Methodology or Approach", 900),
                ("Findings, Evaluation, or Critical Discussion", 900),
                ("Conclusion", 400),
                ("References", 250),
            ]
        scale = target_total / sum(words for _, words in sections)
        planned = []
        for heading, words in sections:
            planned.append({
                "heading": heading,
                "purpose": f"Write the {heading.lower()} section for the requested academic paper.",
                "target_words": int(words * scale),
            })
        return planned

    def _select_long_academic_notes(self, user_id: int, workspace_id: int | None, prompt: str, smart_analysis: dict | None) -> list:
        all_notes = self.repo_notes.get_for_user(user_id, workspace_id) if user_id else []
        if not all_notes:
            return []

        prompt_course_codes = {code.lower() for code in smart_engine.extract_course_codes(prompt)}
        rubric_hits = []
        for n in all_notes:
            hay = f"{n.title or ''}\n{_HTML_TAG.sub(' ', n.content or '')}".lower()
            if (
                any(key in hay for key in ("requirement", "requirements", "rubric", "assessment", "criteria", "marking guide", "brief"))
                or any(code in hay for code in prompt_course_codes)
            ):
                rubric_hits.append(n)

        queries = list((smart_analysis or {}).get("retrieval_queries", []) or [])
        queries += [
            prompt,
            "requirements rubric assessment criteria",
            "research design methodology literature review evaluation ethics",
        ]
        queries.extend(f"{code} rubric requirements" for code in list(prompt_course_codes)[:2])

        seen: set[int] = set()
        selected = []
        for note in rubric_hits:
            if note.id not in seen:
                seen.add(note.id)
                selected.append(note)

        for q in queries[:8]:
            try:
                q_vec = self.embedding.embed_text(q)
                hits = self.repo_notes.search_hybrid(
                    q,
                    q_vec,
                    top_k=8,
                    workspace_id=workspace_id,
                    user_id=user_id,
                )
                for note in hits:
                    if note.id not in seen:
                        seen.add(note.id)
                        selected.append(note)
            except Exception as exc:
                logger.warning("Query expansion search failed for %r: %s", q, exc)
                continue

        if not selected:
            return all_notes[:15]
        return selected[:18]

    def _notes_to_context(self, notes: list, per_note_chars: int = 2500, max_total_chars: int = 26000) -> str:
        parts: list[str] = []
        used = 0
        for note in notes:
            plain = _strip_base64_images(_HTML_TAG.sub(" ", note.content or "")).strip()
            block = f"[NOTE {note.id}: {note.title or 'Untitled'}]\n{plain[:per_note_chars]}"
            if used + len(block) > max_total_chars:
                break
            parts.append(block)
            used += len(block)
        return "\n\n".join(parts)

    def _plan_long_academic_sections(
        self,
        prompt: str,
        source_context: str,
        min_words: int,
        max_words: int,
        model: str,
        user_keys: dict,
    ) -> list[dict]:
        fallback = self._long_academic_outline(prompt, min_words, max_words)
        planner_system = (
            "You are planning a long academic paper from a rubric and project notes.\n"
            "Return ONLY valid JSON with this shape:\n"
            '{"title":"...","sections":[{"heading":"...","purpose":"...","target_words":800}]}\n'
            "Rules:\n"
            "- Produce 8 to 10 major sections.\n"
            "- Follow the rubric/requirements context if present.\n"
            "- Total target_words should fit inside the requested word-count range.\n"
            "- Prefer formal academic section headings.\n"
            "- Include References as the final section.\n"
            "- Do not include appendices."
        )
        planner_user = (
            f"User request:\n{prompt}\n\n"
            f"Requested minimum words: {min_words or 5000}\n"
            f"Requested maximum words: {max_words or 10000}\n\n"
            f"Available source context:\n{source_context[:18000]}"
        )
        try:
            raw, _ = self._run_completion_chain(
                model,
                user_keys,
                [{"role": "system", "content": planner_system}, {"role": "user", "content": planner_user}],
                {"temperature": 0.1, "max_tokens": 1800},
            )
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S).strip()
            data = json.loads(cleaned)
            sections = data.get("sections") or []
            if sections:
                return sections
        except Exception as exc:
            logger.warning("Long academic section planning failed, using fallback outline: %s", exc)
        return fallback

    def _render_long_academic_status(
        self,
        phase: str,
        *,
        section_idx: int | None = None,
        section_total: int | None = None,
        heading: str | None = None,
    ) -> str:
        lines = [
            "## Building your paper",
            "",
            f"**Status:** {phase}",
        ]
        if section_idx is not None and section_total is not None:
            lines.append(f"**Progress:** Section {section_idx} of {section_total}")
        if heading:
            lines.append(f"**Current section:** {heading}")
        lines.extend([
            "",
            "MemoLink is still working. This draft path gathers sources, plans the structure, writes each section, and then runs a final quality pass.",
        ])
        return "\n".join(lines)

    def _iter_long_academic_draft(
        self,
        prompt: str,
        user_id: int,
        workspace_id: int | None,
        smart_analysis: dict,
        model: str,
        user_keys: dict,
    ):
        yield {"type": "status", "content": self._render_long_academic_status("Collecting relevant notes and requirements")}

        min_words, max_words = smart_engine.parse_word_targets(prompt)
        selected_notes = self._select_long_academic_notes(user_id, workspace_id, prompt, smart_analysis)
        notes_context = self._notes_to_context(selected_notes)
        note_titles = [n.title or "" for n in selected_notes if getattr(n, "title", None)]

        yield {"type": "status", "content": self._render_long_academic_status("Searching supporting academic sources")}
        paper_queries = smart_engine.build_dynamic_academic_queries(prompt, smart_analysis, note_titles)
        papers: list[dict] = []
        seen_titles: set[str] = set()
        for query in paper_queries[:2]:
            try:
                batch = search_papers(
                    query[:150],
                    limit=6,
                    api_key=settings.semantic_scholar_api_key,
                    core_api_key=settings.core_api_key,
                    include_arxiv=True,
                )
                for paper in batch:
                    key = (paper.get("title") or "").lower()[:80]
                    if key and key not in seen_titles:
                        seen_titles.add(key)
                        papers.append(paper)
            except Exception as exc:
                logger.warning("Academic paper search failed for query %r: %s", query, exc)
                continue
        paper_context = format_papers_context(papers[:10]) if papers else ""

        combined_context = notes_context
        if paper_context:
            combined_context += "\n\n--- ACADEMIC SOURCES ---\n" + paper_context

        yield {"type": "status", "content": self._render_long_academic_status("Planning the paper structure from your brief and sources")}
        sections = self._plan_long_academic_sections(
            prompt=prompt,
            source_context=combined_context,
            min_words=min_words,
            max_words=max_words,
            model=model,
            user_keys=user_keys,
        )

        mode_prompt = smart_engine.get_mode_prompt("academic_writer")
        section_outputs: list[str] = []
        used_model = model
        section_total = len(sections)

        for idx, section in enumerate(sections, start=1):
            heading = str(section.get("heading") or f"Section {idx}").strip()
            purpose = str(section.get("purpose") or "").strip()
            target_words = int(section.get("target_words") or 700)
            yield {
                "type": "status",
                "content": self._render_long_academic_status(
                    "Drafting the next section",
                    section_idx=idx,
                    section_total=section_total,
                    heading=heading,
                ),
            }
            section_query = f"{heading}\n{purpose}\n{prompt}"
            section_notes = self._select_long_academic_notes(user_id, workspace_id, section_query, smart_analysis)[:8]
            section_context = self._notes_to_context(section_notes, per_note_chars=2200, max_total_chars=14000)
            section_user = (
                f"User request:\n{prompt}\n\n"
                f"Paper section to write: {heading}\n"
                f"Purpose: {purpose}\n"
                f"Target length: about {target_words} words.\n\n"
                "Write ONLY this section in polished academic prose.\n"
                "Do not write an outline. Do not include commentary about what you are doing.\n"
                "Use citations when supported by the provided notes or academic sources.\n"
                "If project-specific evidence is missing, add a precise [ADD NOTES] marker.\n"
                "Avoid repeating the exact same introduction in every section.\n\n"
                f"Section source context:\n{section_context}"
            )
            if paper_context:
                section_user += f"\n\nAcademic sources:\n{paper_context[:12000]}"
            drafted, used_model = self._run_completion_chain(
                model,
                user_keys,
                [
                    {"role": "system", "content": mode_prompt},
                    {"role": "user", "content": section_user},
                ],
                {"temperature": 0.2, "max_tokens": min(max(target_words * 2, 1200), 5000)},
            )
            section_outputs.append(drafted.strip())

        yield {"type": "status", "content": self._render_long_academic_status("Running the final quality and citation check")}
        title = smart_engine.build_dynamic_academic_title(prompt)
        draft = title + "\n\n".join(section_outputs)
        checklist = list((smart_analysis or {}).get("quality_checks", []))
        checklist += [
            "The response is a complete long-form paper, not a short scaffold",
            "The paper meaningfully attempts the requested word-count range",
        ]
        improved = smart_engine.quality_check(
            draft=draft,
            checklist=checklist,
            user_message=prompt,
            client=_get_client(used_model, user_keys),
            model=used_model,
            note_context=combined_context,
        )
        final_draft = improved or draft
        yield {"type": "result", "content": final_draft, "model": used_model, "papers": papers}

    def _generate_long_academic_draft(
        self,
        prompt: str,
        user_id: int,
        workspace_id: int | None,
        smart_analysis: dict,
        model: str,
        user_keys: dict,
    ) -> tuple[str, str]:
        final_content = ""
        used_model = model
        result_papers: list[dict] = []
        for item in self._iter_long_academic_draft(
            prompt=prompt,
            user_id=user_id,
            workspace_id=workspace_id,
            smart_analysis=smart_analysis,
            model=model,
            user_keys=user_keys,
        ):
            if item.get("type") == "result":
                final_content = str(item.get("content") or "")
                used_model = str(item.get("model") or model)
                result_papers = item.get("papers") or []
        if result_papers and user_id:
            try:
                self._save_cited_papers_as_notes(final_content, result_papers, user_id, workspace_id)
            except Exception as exc:
                logger.warning("Failed to save cited papers as notes: %s", exc)
        return (final_content, used_model)

    def _save_cited_papers_as_notes(
        self,
        draft: str,
        papers: list[dict],
        user_id: int,
        workspace_id: int | None,
    ) -> int:
        """Save papers that were actually cited in the draft as notes. Returns count saved."""
        cited = extract_cited_papers(draft, papers)
        if not cited:
            return 0
        existing_titles = {
            paper_title_key(n.title)
            for n in self.repo_notes.get_for_user(user_id, workspace_id)
        }
        saved = 0
        for paper in cited:
            title = (paper.get("title") or "").strip()
            title_key = paper_title_key(title)
            if not title or title_key in existing_titles:
                continue
            content = format_paper_as_note(paper)
            try:
                note = self.repo_notes.create_note(
                    user_id=user_id,
                    title=title,
                    content=content,
                    source="academic_search",
                    workspace_id=workspace_id,
                )
                # Embed the note for future RAG retrieval
                try:
                    vec = self.embedding.embed_text(f"{title}\n{paper.get('abstract', '')}")
                    self.repo_notes.save_embedding(note.id, vec)
                except Exception as exc:
                    logger.warning("Failed to embed cited-paper note %r: %s", title, exc)
                existing_titles.add(title_key)
                saved += 1
            except Exception as exc:
                logger.warning("Failed to save cited paper as note: %s", exc)
        return saved

    def _get_books_catalog_msg(self, user_query: str = "") -> Optional[str]:
        """Return a system message for available library books, or None.

        Fuzzy-ranks books against the user query so direct/near matches surface first.
        Splits output into a DIRECT MATCH section (score ≥ 0.3) and a general catalog.
        """
        if self._book_repo is None:
            logger.warning("Books catalog: book_repo is None — catalog skipped")
            return None
        try:
            books = self._book_repo.list_published(page_size=200)
            if not books:
                logger.info("Books catalog: no published books found")
                return None

            import difflib
            query_lower = (user_query or "").lower()
            query_words = [w for w in query_lower.split() if len(w) > 2]

            scored: list[tuple[float, object]] = []
            for b in books:
                title_lower = (b.title or "").lower()
                author_lower = (b.author or "").lower()
                combined = f"{title_lower} {author_lower}"
                seq = difflib.SequenceMatcher(None, query_lower, title_lower).ratio()
                overlap = sum(0.2 for w in query_words if w in combined)
                scored.append((seq + overlap, b))

            scored.sort(key=lambda x: x[0], reverse=True)
            logger.info("Books catalog: %d books scored; top score=%.2f", len(scored), scored[0][0] if scored else 0)

            def _safe_title(title: str) -> str:
                # Strip ] so it can't prematurely close the [[...]] token delimiter.
                return (title or "").replace("]", ")")

            def _book_line(b) -> str:
                # Pre-build the full token so the AI only needs to copy it, not construct it.
                author_part = f" by {b.author}" if b.author else ""
                ext = (b.file_extension or "").lstrip(".")
                token = f"[[BOOK_BORROW:{b.id}:{_safe_title(b.title)}]]"
                return f"- {token}{author_part} ({ext})"

            direct_matches = [(s, b) for s, b in scored if s >= 0.3]
            rest = [(s, b) for s, b in scored if s < 0.3][:15]  # cap general list

            sections: list[str] = []

            if direct_matches:
                match_lines = "\n".join(_book_line(b) for _, b in direct_matches[:5])
                sections.append(
                    "DIRECT BOOK MATCHES (highly relevant to this query):\n"
                    + match_lines
                    + "\n\nFor EVERY book listed above you MUST emit a [[BOOK_BORROW:ID:Title]] token "
                    "on its own line immediately after you first mention it — "
                    "whether you are recommending it, correcting a mistyped title, "
                    "suggesting it as a possible match, or simply confirming it exists."
                )

            if rest:
                rest_lines = "\n".join(_book_line(b) for _, b in rest)
                sections.append("OTHER AVAILABLE BOOKS:\n" + rest_lines)

            if not sections:
                return None

            catalog_body = "\n\n".join(sections)
            return (
                "--- MEMOLINK LIBRARY CATALOG ---\n"
                "Books available in the user's MemoLink library. "
                "Each entry already contains its ready-to-use token in [[BOOK_BORROW:ID:Title]] format.\n\n"
                + catalog_body
                + "\n\nTOKEN RULES (mandatory):\n"
                "• When you mention, recommend, suggest, or confirm any book from this catalog, "
                "copy its [[BOOK_BORROW:...]] token EXACTLY as shown and place it on its OWN LINE "
                "immediately after the sentence where you name the book.\n"
                "• Do NOT retype or reconstruct the token — copy it verbatim from the catalog line.\n"
                "• If the user typed a wrong/approximate title and you identify the correct book, "
                "still copy and emit that book's token.\n"
                "• Never embed the token inside a sentence or bullet point."
            )
        except Exception as exc:
            logger.warning("Could not load books catalog for chat context: %s", exc)
            return None

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
        suggested_web_query = _derive_web_search_query(user_text, message_history)

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
                top_notes = self.repo_notes.search_hybrid(
                    user_text,
                    query_vec,
                    top_k=dto.top_k,
                    workspace_id=ws_filter,
                    user_id=dto.user_id,
                )
            except Exception as exc:
                logger.warning("Vector/hybrid note search failed, falling back to recent notes: %s", exc)
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
                except Exception as exc:
                    logger.debug("MemoGraph enhancement failed (best-effort, chat continues): %s", exc)

        system_msgs = [{"role": "system", "content": _SYSTEM_PROMPT}]
        if rag_blocks:
            system_msgs.append({"role": "system", "content": "--- USER NOTES CONTEXT ---\n" + "\n\n".join(rag_blocks)})

        # Email compose/reply — detect intent and build draft tag (never let AI decide to send)
        _compose_keywords = {
            "send email", "send an email", "email to", "send to", "compose", "write email",
            "write an email", "send a message", "draft email", "draft an email",
            "shoot an email", "shoot email", "message to", "send message",
        }
        _reply_keywords = {
            "reply", "reply to", "respond", "respond to", "write back", "email back",
            "get back to", "follow up", "follow-up", "reply again", "send a reply",
        }
        _compose_patterns = (
            r"\bsend\b(?:\s+\w+){0,4}\s+\bemail\b",
            r"\bemail\b(?:\s+\w+){0,4}\s+\bto\b",
            r"\bsend\s+(?:this|that|it)\s+as\s+email\b",
            r"\bemail\s+(?:this|that|it)\s+to\b",
            r"\bshare\s+(?:this|that|it)\s+by\s+email\b",
        )
        _lower_user_text = user_text.lower()

        def _has_email_compose_intent(text: str) -> bool:
            _lower = (text or "").lower()
            return any(kw in _lower for kw in _compose_keywords) or any(re.search(pattern, _lower, re.I) for pattern in _compose_patterns)

        def _has_email_reply_intent(text: str) -> bool:
            _lower = (text or "").lower()
            if _looks_like_general_writing_improve_request(text):
                return False
            _reply_patterns = (
                r"^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?reply\b",
                r"^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?respond\b",
                r"^\s*(?:please\s+)?reply\s+to\b",
                r"^\s*(?:please\s+)?respond\s+to\b",
                r"^\s*(?:please\s+)?write\s+back\b",
                r"^\s*(?:please\s+)?email\s+back\b",
                r"^\s*(?:please\s+)?follow[- ]?up\b",
                r"\bsend\s+a\s+reply\b",
                r"\bdraft\s+(?:a\s+)?reply\b",
            )
            return any(re.search(pattern, _lower, re.I) for pattern in _reply_patterns)

        _asks_compose = _has_email_compose_intent(user_text)
        _asks_reply = _has_email_reply_intent(user_text)

        _recent_conversation = message_history[-8:]
        _previous_conversation = message_history[:-1]
        _recent_transcript = "\n\n".join(
            f"{m['role'].upper()}: {_strip_base64_images(m.get('content', ''))[:2000]}"
            for m in _recent_conversation
        )

        def _recent_substantive_assistant_message() -> str:
            for _msg in reversed(_previous_conversation):
                if _msg.get("role") != "assistant":
                    continue
                _content = _strip_base64_images(_msg.get("content", "")).strip()
                _content, _, _ = _parse_confidence(_content)
                _content = _content.strip()
                if not _content or "<email_draft" in _content:
                    continue
                _lower = _content.lower()
                if any(
                    cue in _lower
                    for cue in (
                        "what is the email address",
                        "what specific research content should be included",
                        "would you like to make any changes",
                        "before i send it",
                    )
                ):
                    continue
                if len(_content) < 60:
                    continue
                return _content[:15000]
            return ""

        _assistant_requested_email_details = any(
            m.get("role") == "assistant"
            and any(
                cue in (m.get("content", "")).lower()
                for cue in (
                    "email address",
                    "should be included in the email",
                    "make any changes to this email",
                    "before i send it",
                )
            )
            for m in _recent_conversation[-3:]
        )
        _current_is_bare_email = bool(re.fullmatch(r"[\w.\-+]+@[\w.\-]+\.\w+", user_text.strip(), re.I))
        _prior_email_request = next(
            (
                (m.get("content", "") or "").strip()
                for m in reversed(_previous_conversation)
                if m.get("role") == "user" and (
                    _has_email_compose_intent(m.get("content", "")) or _has_email_reply_intent(m.get("content", ""))
                )
            ),
            "",
        )
        if _current_is_bare_email and (_assistant_requested_email_details or bool(_prior_email_request)):
            _asks_compose = True

        _whatsapp_draft_prefill: str | None = None
        _whatsapp_intent = _extract_whatsapp_draft_intent(user_text)
        if _whatsapp_intent:
            try:
                import html as _html_mod

                recipient_hint = str(_whatsapp_intent.get("recipient") or "").strip()
                body_hint = str(_whatsapp_intent.get("body_hint") or "").strip()
                body_lower = body_hint.lower()
                body_text = body_hint

                if body_lower in {"my email", "my email address", "my gmail", "my gmail address"}:
                    email_address = ""
                    if self._email_service and dto.user_id:
                        account_repo = getattr(self._email_service, "account_repo", None)
                        if account_repo:
                            try:
                                tokens = account_repo.get_decrypted_tokens(dto.user_id)
                                email_address = str((tokens or {}).get("email") or "").strip()
                            except Exception as exc:
                                logger.debug("Failed to read decrypted email tokens for WhatsApp draft: %s", exc)
                                email_address = ""
                            if not email_address:
                                try:
                                    account = account_repo.get_by_user_id(dto.user_id)
                                    email_address = str(getattr(account, "email_address", "") or "").strip()
                                except Exception as exc:
                                    logger.debug("Failed to read email account for WhatsApp draft: %s", exc)
                                    email_address = ""
                    if not email_address:
                        _whatsapp_draft_prefill = (
                            "I can create that WhatsApp draft, but I could not find your connected email address. "
                            "Connect Gmail in Settings -> Email first, or tell me the exact email address to send."
                        )
                    else:
                        body_text = email_address

                if not _whatsapp_draft_prefill:
                    if not recipient_hint or not body_text:
                        raise ValueError("insufficient whatsapp intent")
                    body_b64 = base64.b64encode(body_text[:4000].encode()).decode()
                    to_safe = _html_mod.escape(recipient_hint, quote=True)
                    _whatsapp_draft_prefill = (
                        "Here's your WhatsApp draft — review it and click **Send** to deliver, "
                        "or edit it first.\n\n"
                        f'<whatsapp_draft to="{to_safe}" body_b64="{body_b64}"></whatsapp_draft>'
                    )
            except ValueError:
                pass  # insufficient intent info — not an error, just skip the draft
            except Exception as exc:
                logger.warning("WhatsApp draft prefill build failed: %s", exc)

        _email_draft_prefill: str | None = None
        if not _whatsapp_intent and (_asks_compose or _asks_reply) and self._email_service and dto.user_id:
            try:
                import re as _re
                import json as _json

                def _html_to_plain(html: str) -> str:
                    import re as _r
                    text = _r.sub(r"<br\s*/?>|</p>|</li>|</h[1-6]>", "\n", html, flags=_r.I)
                    text = _r.sub(r"<[^>]+>", "", text)
                    import html as _html_mod
                    text = _html_mod.unescape(text)
                    text = text.replace(" ", " ")
                    return _r.sub(r"\n{3,}", "\n\n", text).strip()

                # --- AI-based intent extraction ---
                # Build a note title list so the AI can pick the right one
                _note_titles: list[str] = []
                try:
                    _note_titles = [n.title for n in self.repo_notes.get_for_user(dto.user_id) if n.title]
                except Exception as exc:
                    logger.warning("Failed to fetch note titles for email intent extraction: %s", exc)

                _intent: dict = {}
                try:
                    _extract_prompt = (
                        "You are an email intent extractor. Given the user request below, return ONLY a valid JSON object with these fields:\n"
                        "  recipient   — the recipient name or email address (string, just the raw value the user said)\n"
                        "  note_name   — the title of the note to use as email body, or null if none mentioned\n"
                        "  subject     — a concise, appropriate email subject line\n"
                        "  is_reply    — true if the user wants to reply to an existing email, false for a new email\n"
                        "  style       — any style/tone instructions like 'make it nice', 'be formal', or null\n\n"
                        "Use recent conversation context to resolve follow-up messages like a bare email address, "
                        "or references such as 'that', 'it', or 'the research we generated'.\n"
                        "If the user wants to send previously generated content from this conversation, infer a suitable subject.\n\n"
                        f"Available note titles (match one if mentioned): {_note_titles}\n\n"
                        f"Recent conversation context:\n{_recent_transcript}\n\n"
                        f"User request: {user_text}\n\n"
                        "Return ONLY the JSON object, no explanation."
                    )
                    # Use the best available model — try the user's selected model first,
                    # then fall back through the same chain used for chat
                    _extract_chain = _build_fallback_chain(dto.model or settings.openai_chat_model, self._resolve_user_keys(dto.user_id))
                    _raw = ""
                    for _em in _extract_chain:
                        try:
                            _ec = _get_client(_em, self._resolve_user_keys(dto.user_id))
                            _er = _ec.chat.completions.create(
                                model=_em,
                                messages=[{"role": "user", "content": _extract_prompt}],
                                max_tokens=200,
                                temperature=0,
                            )
                            _raw = (_er.choices[0].message.content or "").strip()
                            break
                        except Exception:
                            continue
                    if _raw:
                        _raw = _re.sub(r"^```(?:json)?\s*|\s*```$", "", _raw, flags=_re.S).strip()
                        _intent = _json.loads(_raw)
                except Exception as exc:
                    logger.debug("AI email intent extraction failed, falling back to regex: %s", exc)

                # --- Populate fields from AI intent or regex fallback ---
                recipient_hint: str = ""
                topic: str = ""
                style_hint: str = ""
                is_reply: bool = _asks_reply and not _asks_compose

                if _intent.get("recipient"):
                    recipient_hint = str(_intent["recipient"]).strip().lower().rstrip(".,")
                    topic = str(_intent.get("note_name") or _intent.get("subject") or "").strip()
                    style_hint = str(_intent.get("style") or "").strip()
                    is_reply = bool(_intent.get("is_reply", is_reply))
                else:
                    # Regex fallback — covers all common phrasings
                    _to_match = _re.search(
                        r"(?:reply(?: again)? to|respond to|write back to|get back to|follow[- ]?up (?:with|to)|"
                        r"send(?: an?)?(?: email)?(?: message)? to|email to|email|message to|shoot(?: an? email)? to)\s+([^\s,@]+(?:@[^\s,]+)?)",
                        user_text, _re.I
                    )
                    # Priority 1: "the [name] from/in (my) note(s)"
                    _from_note_match = _re.search(
                        r"\bthe\s+(.+?)\s+(?:from|in)\s+(?:my\s+)?notes?\b",
                        user_text, _re.I
                    )
                    # Priority 2: "the [name] note" — e.g. "the Capstone Adviser note"
                    _bare_note_match = _re.search(
                        r"\bthe\s+(.+?)\s+notes?\b",
                        user_text, _re.I
                    )
                    # Priority 3: keyword body hint — "about X", "regarding X", trailing ", X"
                    _body_match = _re.search(
                        r"(?:saying|just say|say|about|regarding|on the topic of|"
                        r"with details (?:of|about|on)|with info (?:about|on)|"
                        r"telling (?:them|him|her) about|letting (?:them|him|her) know about|"
                        r"containing|with content|,)\s+(.+)$",
                        user_text, _re.I | _re.S
                    )
                    if _to_match:
                        recipient_hint = (_to_match.group(_to_match.lastindex) or "").strip().lower().rstrip(".,")
                    if _from_note_match:
                        topic = _from_note_match.group(1).strip().strip('"\'')
                    elif _bare_note_match:
                        topic = _bare_note_match.group(1).strip().strip('"\'')
                    elif _body_match:
                        topic = _body_match.group(1).strip().strip('"\'')

                    # When note was found via explicit reference AND body_match also captured
                    # something, that captured text is a style instruction, not the topic
                    if (_from_note_match or _bare_note_match) and _body_match:
                        style_hint = _body_match.group(1).strip().strip('"\'')

                if not recipient_hint and _current_is_bare_email and (_assistant_requested_email_details or _prior_email_request):
                    recipient_hint = user_text.strip().lower()

                _conversation_body_source = _recent_substantive_assistant_message()
                if not topic:
                    if _prior_email_request and any(term in _prior_email_request.lower() for term in ("research", "paper", "report", "assessment", "essay")):
                        topic = "the generated research"
                    elif _conversation_body_source:
                        topic = "the generated content from this conversation"

                if not recipient_hint or not topic:
                    raise ValueError("insufficient intent: need recipient and topic")

                if is_reply:
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
                        to_addr = recipient_hint if "@" in recipient_hint else f"{recipient_hint}@gmail.com"
                        subject = str(_intent.get("subject") or f"Re: {topic}").replace('"', "'")
                        mid, tid = "", ""
                else:
                    to_addr = recipient_hint if "@" in recipient_hint else f"{recipient_hint}@gmail.com"
                    subject = str(_intent.get("subject") or topic).replace('"', "'").strip()
                    mid, tid = "", ""

                # --- Find the matching note and build body ---
                # Use AI-extracted note_name if available, otherwise fall back to topic keywords
                note_name_hint = str(_intent.get("note_name") or topic).strip()
                body_text = f"Hi,\n\nI wanted to share some details about: {note_name_hint or topic}.\n\nPlease let me know if you have any questions."
                matched_note = False
                if note_name_hint and self.repo_notes and dto.user_id:
                    try:
                        _stop_note = {"the", "a", "an", "of", "in", "on", "for", "and", "or",
                                      "details", "info", "information", "about", "detail"}
                        _kw_words = [w.lower() for w in note_name_hint.split() if w.lower() not in _stop_note and len(w) > 2]
                        if _kw_words:
                            _all_notes = self.repo_notes.get_for_user(dto.user_id)
                            for _note in _all_notes:
                                title_lower = (_note.title or "").lower()
                                if sum(1 for w in _kw_words if w in title_lower) >= max(1, len(_kw_words) // 2):
                                    # Strip HTML, also drop leading nav/badge lines (short lines < 60 chars
                                    # at the top are usually navigation or icon badges, not real content)
                                    _full_plain = _html_to_plain(_note.content)
                                    _lines = _full_plain.splitlines()
                                    # Skip short header/nav lines at the top until we hit substantive content
                                    _skip = 0
                                    for _ln in _lines:
                                        if len(_ln.strip()) < 60 and _skip < 15:
                                            _skip += 1
                                        else:
                                            break
                                    _cleaned = "\n".join(_lines[_skip:]).strip()
                                    # No cap for direct send; AI-rewrite path is capped separately below
                                    raw_body = _cleaned or _full_plain

                                    # style_hint is set from AI extraction or regex fallback
                                    _style = style_hint
                                    if _style:
                                        # User asked for a specific style/tone — let AI rewrite accordingly
                                        try:
                                            _rewrite_chain = _build_fallback_chain(dto.model or settings.openai_chat_model)
                                            for _rm in _rewrite_chain:
                                                try:
                                                    _rr = _get_client(_rm).chat.completions.create(
                                                        model=_rm,
                                                        messages=[
                                                            {"role": "system", "content": (
                                                                "You are a professional email writer. "
                                                                "Rewrite the note content below as an email body following the style instruction. "
                                                                "Cover all key sections — do not collapse into one sentence. "
                                                                "Use paragraphs, bold headings, and bullet points where appropriate. "
                                                                "Do NOT include a subject line or sign-off — email body only."
                                                            )},
                                                            {"role": "user", "content": f"Style instruction: {_style}\n\nNote title: {_note.title}\n\nNote content:\n{raw_body[:10000]}"},
                                                        ],
                                                        max_tokens=1200,
                                                        temperature=0.4,
                                                    )
                                                    body_text = (_rr.choices[0].message.content or "").strip() or raw_body
                                                    break
                                                except Exception:
                                                    continue
                                        except Exception as exc:
                                            logger.debug("AI email body rewrite failed, using raw note body: %s", exc)
                                            body_text = raw_body
                                    else:
                                        # No style instruction — send the note content directly, no AI rewriting
                                        body_text = raw_body
                                    matched_note = True
                                    break
                    except Exception as exc:
                        logger.warning("Note-matching for email draft body failed: %s", exc)

                if not matched_note and _conversation_body_source:
                    body_text = _conversation_body_source

                import base64 as _b64
                # Cap at 15 000 chars — covers virtually any real note while keeping
                # the base64 blob a manageable size in the email and in storage
                body_b64 = _b64.b64encode(body_text[:15000].encode()).decode()
                subj_safe = subject.replace('"', "'")
                draft_tag = (
                    f'<email_draft to="{to_addr}" subject="{subj_safe}" '
                    f'body_b64="{body_b64}" message_id="{mid}" thread_id="{tid}"></email_draft>'
                )
                action = "reply" if is_reply else "email"
                _email_draft_prefill = (
                    f"Here's your draft {action} — review it and click **Send** to deliver, "
                    f"or click **Edit** to adjust the message first.\n\n{draft_tag}"
                )
            except Exception as exc:
                logger.warning("Email draft prefill build failed, falling through to normal email RAG: %s", exc)

        # Email RAG — live Gmail search when user asks about email
        _email_keywords = {"email", "gmail", "inbox", "message", "attachment", "mail", "sent", "received"}
        _asks_about_email = any(kw in user_text.lower() for kw in _email_keywords)
        # "find/search/look up an email" is handled as a structured clickable list further
        # down in _build_route_plan — skip the narrative RAG pass so GPT doesn't also
        # write prose about the same emails (and we don't hit Gmail twice).
        _email_search_list_intent = _has_email_search_list_intent(user_text)
        logger.debug("[EMAIL_RAG] asks=%s list_intent=%s uid=%s has_svc=%s", _asks_about_email, _email_search_list_intent, dto.user_id, self._email_service is not None)
        if _asks_about_email and not _email_search_list_intent and dto.user_id and user_text:
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
                    except Exception as _e:
                        logger.warning("[EMAIL_RAG] get_decrypted_tokens failed for user_id=%s: %s", dto.user_id, _e)

                    if not has_account:
                        no_account = True
                    else:
                        gm_query = _build_gmail_search_query(user_text)
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
                        except Exception as exc:
                            logger.warning("Email vector search failed, falling back to keyword search: %s", exc)
                        if not hits:
                            hits = self._email_record_repo.keyword_search(dto.user_id, user_text, top_k=3)
                        for em in hits:
                            date_str = em.email_date.strftime("%d %b %Y") if em.email_date else ""
                            sender = f"{em.sender_name} <{em.sender_email}>" if em.sender_name else em.sender_email
                            email_blocks.append(
                                f"[EMAIL]\nSubject: {em.subject}\nFrom: {sender}\n"
                                f"Date: {date_str}\nBody:\n{(em.body_text or em.snippet or '')[:1500]}"
                            )
            except Exception as exc:
                logger.warning("Email RAG lookup failed: %s", exc)

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
            web_query = (getattr(dto, "search_query_override", None) or "").strip() or suggested_web_query or user_text
            web_block = brave_search(web_query, count=8)
            if web_block:
                system_msgs.append({"role": "system", "content": _WEB_SEARCH_SYSTEM_MSG})
                system_msgs.append({"role": "system", "content": web_block})
            else:
                system_msgs.append({"role": "system", "content": _WEB_SEARCH_EMPTY_MSG})

        # Confidence instruction as the LAST system message - model sees it most clearly here
        system_msgs.append({"role": "system", "content": _CONFIDENCE_SYSTEM_MSG})

        # Pre-compute a deterministic confidence fallback so the badge always shows
        pre_conf_level, pre_conf_reason = _pre_confidence(all_notes, top_notes_for_confidence)

        return (
            conversation_id,
            system_msgs + message_history,
            sources,
            pre_conf_level,
            pre_conf_reason,
            _email_draft_prefill,
            _whatsapp_draft_prefill,
            suggested_web_query,
            _email_search_list_intent,
        )

    def _improve_note_request(self, dto: ChatRequestDTO, note_name: str, conversation_id: int) -> ChatResponseDTO:
        workspace_id = getattr(dto, "workspace_id", None)
        note = self.repo_notes.find_by_title_for_user(dto.user_id, note_name, workspace_id)

        if not note:
            msg = f'I couldn\'t find a note matching **"{note_name}"**. Please check the title and try again.\n\nAvailable notes can be found in your sidebar.'
            return self._persist_direct_response(
                conversation_id,
                msg,
                routing_reason="Direct: note_improve",
            )

        _IMPROVE_SYSTEM = (
            "You are a document formatting expert. Improve the structure, formatting, and clarity of the given note. "
            "Rules: use proper HTML tags (h2, h3 for headings, p for paragraphs, ul/ol/li for lists, "
            "<strong> for key terms, <em> for emphasis, <table> for tabular data). "
            "Do NOT change the meaning, remove content, or add new information. "
            "Return ONLY the improved HTML - no markdown fences, no doctype, no html/body tags, no commentary."
        )
        # 5 000 chars ≈ 1 250 input tokens; output of similar size stays well within
        # even the tightest per-model output budget (4 096 tokens ≈ 16 000 chars out).
        _CHUNK_LIMIT = 5000

        user_keys = self._resolve_user_keys(dto.user_id)
        chain = _build_fallback_chain(dto.model or settings.openai_chat_model)

        def _call_improve(content_chunk: str) -> str | None:
            for attempt in chain:
                try:
                    _kw = dict(_completion_kwargs(attempt))
                    _kw.setdefault("max_tokens", 8192)
                    completion = _get_client(attempt, user_keys).chat.completions.create(
                        model=attempt,
                        messages=[
                            {"role": "system", "content": _IMPROVE_SYSTEM},
                            {"role": "user", "content": f"Note title: {note.title}\n\nContent:\n{content_chunk}"},
                        ],
                        **_kw,
                    )
                    result = (completion.choices[0].message.content or "").strip()
                    return result or None
                except Exception as _exc:
                    self._syslog("warn", f"/improve chunk failed on {attempt}: {_exc}", {}, dto.user_id)
                    continue
            return None

        import re as _re
        raw_content = note.content or ""
        _raw_len = len(raw_content)
        self._syslog("info", f"/improve '{note.title}': raw_content={_raw_len} chars, CHUNK_LIMIT={_CHUNK_LIMIT}", {}, dto.user_id)

        if _raw_len <= _CHUNK_LIMIT:
            improved_html = _call_improve(raw_content)
        else:
            # Split on section boundaries — handles <hr>, <hr/>, <hr />, <h2>, <h3>
            _pieces = _re.split(r'(?=<hr\b[^>]*>|<h[23]\b)', raw_content, flags=_re.I)
            self._syslog("info", f"/improve split into {len(_pieces)} pieces", {}, dto.user_id)

            # Merge small pieces into chunks that fit _CHUNK_LIMIT
            _chunks: list[str] = []
            _buf = ""
            for _piece in _pieces:
                if len(_buf) + len(_piece) <= _CHUNK_LIMIT:
                    _buf += _piece
                else:
                    if _buf:
                        _chunks.append(_buf)
                    if len(_piece) > _CHUNK_LIMIT:
                        for _i in range(0, len(_piece), _CHUNK_LIMIT):
                            _chunks.append(_piece[_i:_i + _CHUNK_LIMIT])
                        _buf = ""
                    else:
                        _buf = _piece
            if _buf:
                _chunks.append(_buf)

            self._syslog("info", f"/improve merged into {len(_chunks)} chunks: {[len(c) for c in _chunks]}", {}, dto.user_id)

            _improved_parts: list[str] = []
            for _i, _chunk in enumerate(_chunks):
                _part = _call_improve(_chunk)
                if _part is None:
                    self._syslog("warn", f"/improve chunk {_i} failed — keeping original", {}, dto.user_id)
                _improved_parts.append(_part if _part else _chunk)

            improved_html = "\n".join(_improved_parts) if _improved_parts else None

        if not improved_html:
            msg = "⚠ Failed to improve the note — all AI models are currently unavailable."
            return self._persist_direct_response(
                conversation_id,
                msg,
                routing_reason="Direct: note_improve",
            )

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
        return ChatResponseDTO(
            answer=response,
            sources=[],
            message_id=assistant_msg.id,
            routing_reason="Direct: note_improve",
        )

    def _handle_improve_note_stream(self, dto: ChatRequestDTO, note_name: str, conversation_id: int) -> Iterator[str]:
        workspace_id = getattr(dto, "workspace_id", None)
        note = self.repo_notes.find_by_title_for_user(dto.user_id, note_name, workspace_id)
        if note:
            yield sse_event(NoteCloseEvent(note_id=note.id))
            yield sse_event(NoteImprovingEvent(title=note.title))

        result = self._improve_note_request(dto, note_name, conversation_id)
        yield sse_event(MessageReplaceEvent(content=result.answer))
        yield sse_event(
            MessageCompleteEvent(
                message_id=result.message_id,
                model="memolink",
                routing_reason=result.routing_reason,
            )
        )

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

        conversation_id, messages, sources, pre_conf_level, pre_conf_reason, email_draft_prefill, whatsapp_draft_prefill, suggested_web_query, email_search_list_intent = self._build_chat_context(dto)
        plan = self._build_route_plan(
            dto=dto,
            user_text=user_text,
            model=model,
            user_keys=user_keys,
            conversation_id=conversation_id,
            messages=messages,
            sources=sources,
            pre_conf_level=pre_conf_level,
            pre_conf_reason=pre_conf_reason,
            routing_reason=routing_reason,
            email_draft_prefill=email_draft_prefill,
            whatsapp_draft_prefill=whatsapp_draft_prefill,
            email_search_list_intent=email_search_list_intent,
        )

        if plan.direct_response:
            return plan.direct_response

        if plan.decision == "note_improve" and plan.note_name:
            return self._improve_note_request(dto, plan.note_name, plan.conversation_id)

        if plan.decision == "image" and plan.image_prompt:
            try:
                data_url, revised, img_model = _generate_image(plan.image_prompt)
                answer = f"![Generated image]({data_url})\n\n*{revised}*"
            except Exception as exc:
                logger.warning("Image generation failed for prompt %r: %s", plan.image_prompt, exc)
                img_model = "stable-diffusion"
                answer = f"⚠ Image generation failed: {exc}"
            assistant_msg = self.repo_conv.add_message(plan.conversation_id, "assistant", answer, model=img_model)
            return ChatResponseDTO(
                answer=answer,
                sources=[],
                message_id=assistant_msg.id,
                routing_reason=plan.routing_reason,
            )

        if plan.decision == "action_agent":
            return self._action_agent.ask(
                conversation_id=plan.conversation_id,
                prompt=user_text,
                user_id=dto.user_id,
                workspace_id=plan.workspace_filter,
                model=model,
                persist_user_message=False,
                routing_reason=plan.routing_reason,
                spotify_device_id=dto.spotify_device_id,
            )

        if plan.decision == "long_academic" and plan.smart_analysis is not None:
            try:
                answer, used_model = self._generate_long_academic_draft(
                    prompt=user_text,
                    user_id=dto.user_id,
                    workspace_id=plan.workspace_filter,
                    smart_analysis=plan.smart_analysis,
                    model=model,
                    user_keys=user_keys,
                )
                clean_answer, conf_level, conf_reason = _parse_confidence(answer)
                final_conf = conf_level or plan.pre_conf_level
                final_reason = conf_reason or plan.pre_conf_reason
                assistant_msg = self.repo_conv.add_message(
                    plan.conversation_id,
                    "assistant",
                    clean_answer,
                    model=used_model,
                    confidence=final_conf,
                    confidence_reason=final_reason,
                )
                return ChatResponseDTO(
                    answer=clean_answer,
                    sources=plan.sources,
                    message_id=assistant_msg.id,
                    routing_reason=plan.routing_reason,
                )
            except Exception as exc:
                logger.warning("Long academic draft path failed in ask(); falling back: %s", exc)

        # Proactive size guard — re-route oversized requests off low-TPM OpenAI models.
        _rm, _large_reason = _reroute_large_request(model, _estimate_tokens(plan.messages), settings.gemini_api_key, settings.openai_chat_model)
        if _large_reason:
            model = _rm
            plan.routing_reason = _large_reason

        chain = _build_fallback_chain(model)
        used_model = model
        answer: Optional[str] = None
        last_error = ""

        for attempt in chain:
            try:
                _call_kwargs = {**_completion_kwargs(attempt), **plan.extra_completion_kwargs}
                completion = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt,
                    messages=plan.messages,
                    **_call_kwargs,
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
        final_conf = conf_level or plan.pre_conf_level
        final_reason = conf_reason or plan.pre_conf_reason
        _dedup_sources = _dedupe_sources(plan.sources)
        assistant_msg = self.repo_conv.add_message(plan.conversation_id, "assistant", clean_answer, model=used_model, confidence=final_conf, confidence_reason=final_reason, source_note_ids=[s.model_dump() for s in _dedup_sources])
        return ChatResponseDTO(answer=clean_answer, sources=_dedup_sources, message_id=assistant_msg.id, routing_reason=plan.routing_reason)

    def ask_stream(self, dto: ChatRequestDTO) -> Iterator[str]:
        """Yield SSE-formatted chat stream events."""
        user_text = (dto.prompt or "").strip()
        if not user_text:
            yield sse_event(MessageDeltaEvent(text="I did not receive any message."))
            yield sse_event(MessageCompleteEvent(message_id=None))
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
        conversation_id, messages, sources, pre_conf_level, pre_conf_reason, email_draft_prefill, whatsapp_draft_prefill, suggested_web_query, email_search_list_intent = self._build_chat_context(dto)
        ctx_ms = int((time.perf_counter() - t_ctx) * 1000)
        plan = self._build_route_plan(
            dto=dto,
            user_text=user_text,
            model=model,
            user_keys=user_keys,
            conversation_id=conversation_id,
            messages=messages,
            sources=sources,
            pre_conf_level=pre_conf_level,
            pre_conf_reason=pre_conf_reason,
            routing_reason=routing_reason,
            email_draft_prefill=email_draft_prefill,
            whatsapp_draft_prefill=whatsapp_draft_prefill,
            email_search_list_intent=email_search_list_intent,
        )

        if plan.direct_response:
            yield sse_event(MessageReplaceEvent(content=plan.direct_response.answer))
            yield sse_event(
                MessageCompleteEvent(
                    message_id=plan.direct_response.message_id,
                    model="memolink",
                    routing_reason=plan.direct_response.routing_reason,
                    email_results=plan.direct_response.email_results,
                )
            )
            return

        if plan.decision == "note_improve" and plan.note_name:
            yield from self._handle_improve_note_stream(dto, plan.note_name, plan.conversation_id)
            return

        if plan.decision == "image" and plan.image_prompt:
            yield sse_event(ImageGeneratingEvent())
            img_model = "stable-diffusion"
            try:
                data_url, revised, img_model = _generate_image(plan.image_prompt)
                answer = f"![Generated image]({data_url})\n\n*{revised}*"
            except Exception as exc:
                logger.warning("Image generation failed for prompt %r: %s", plan.image_prompt, exc)
                answer = f"⚠ Image generation failed: {exc}"
            yield sse_event(MessageReplaceEvent(content=answer))
            assistant_msg = self.repo_conv.add_message(plan.conversation_id, "assistant", answer, model=img_model)
            yield sse_event(MessageCompleteEvent(message_id=assistant_msg.id, model=img_model, routing_reason=plan.routing_reason))
            return

        if plan.decision == "action_agent":
            yield from self._action_agent.ask_stream(
                conversation_id=plan.conversation_id,
                prompt=user_text,
                user_id=dto.user_id,
                workspace_id=plan.workspace_filter,
                model=model,
                persist_user_message=False,
                routing_reason=plan.routing_reason,
                spotify_device_id=dto.spotify_device_id,
            )
            return

        if plan.decision == "long_academic" and plan.smart_analysis is not None:
            try:
                long_answer = ""
                used_model = model
                _long_papers: list[dict] = []
                for item in self._iter_long_academic_draft(
                    prompt=user_text,
                    user_id=dto.user_id,
                    workspace_id=plan.workspace_filter,
                    smart_analysis=plan.smart_analysis,
                    model=model,
                    user_keys=user_keys,
                ):
                    if item.get("type") == "status":
                        yield sse_event(MessageReplaceEvent(content=str(item.get("content") or "")))
                    elif item.get("type") == "result":
                        long_answer = str(item.get("content") or "")
                        used_model = str(item.get("model") or model)
                        _long_papers = item.get("papers") or []
                if _long_papers and dto.user_id:
                    try:
                        self._save_cited_papers_as_notes(long_answer, _long_papers, dto.user_id, ws_filter)
                    except Exception as exc:
                        logger.warning("Failed to save cited papers as notes (long academic path): %s", exc)
                clean_answer, conf_level, conf_reason = _parse_confidence(long_answer)
                final_conf = conf_level or plan.pre_conf_level
                final_reason = conf_reason or plan.pre_conf_reason
                assistant_msg = self.repo_conv.add_message(
                    plan.conversation_id,
                    "assistant",
                    clean_answer,
                    model=used_model,
                    confidence=final_conf,
                    confidence_reason=final_reason,
                )
                yield sse_event(MessageReplaceEvent(content=clean_answer))
                yield sse_event(MessageCompleteEvent(
                    message_id=assistant_msg.id,
                    model=used_model,
                    confidence=final_conf,
                    confidence_reason=final_reason,
                    routing_reason=plan.routing_reason,
                ))
                return
            except Exception as exc:
                logger.warning("Long academic draft path failed in ask_stream(); falling back: %s", exc)

        # Proactive size guard: a large RAG context can 429 on low-TPM OpenAI
        # models before the fallback even runs — re-route to Gemini up front.
        est_tokens = _estimate_tokens(plan.messages)
        _rm, _large_reason = _reroute_large_request(model, est_tokens, settings.gemini_api_key, settings.openai_chat_model)
        if _large_reason:
            self._syslog("info", f"Re-routed {model} → {_rm} ({est_tokens} est. tokens) to avoid TPM limit",
                         {"from": model, "to": _rm, "est_tokens": est_tokens}, dto.user_id)
            model = _rm
            plan.routing_reason = _large_reason

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
                _call_kwargs = {**_completion_kwargs(attempt), **plan.extra_completion_kwargs}
                stream = _get_client(attempt, user_keys).chat.completions.create(
                    model=attempt,
                    messages=plan.messages,
                    stream=True,
                    **_call_kwargs,
                )
                if attempt != model:
                    self._syslog("warning", f"Fell back from {model} → {attempt} (stream)", {"original": model, "fallback": attempt}, dto.user_id)
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        if first_token_ms is None:
                            first_token_ms = int((time.perf_counter() - t_llm) * 1000)
                        full_answer += delta
                        yield sse_event(MessageDeltaEvent(text=delta))
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
            yield sse_event(MessageDeltaEvent(text=full_answer))

        # ── Smart quality check (academic/code modes only) ─────────────────────
        # Runs a silent review pass after streaming. If the answer improves,
        # a `replace` event is sent so the UI swaps in the better version.
        if (
            succeeded
            and plan.smart_analysis is not None
            and plan.smart_mode_name in smart_engine.QUALITY_CHECK_MODES
            and full_answer.strip()
        ):
            try:
                _qc_client = _get_client(used_model, user_keys)
                _checklist = plan.smart_analysis.get("quality_checks", [])
                # Academic mode: enforce citation and quality checks
                if plan.smart_mode_name == "academic_writer":
                    _forced = [
                        "No placeholder text or bracketed instructions remain in the output",
                        "No self-citations — '(StudentName, Year)' referring to this project are forbidden",
                        "Literature Review cites specific real papers with Author (Year) — from notes or ACADEMIC SOURCES",
                        "References list only real external papers from notes or ACADEMIC SOURCES",
                        "No invented quantitative data — mark as [Metric pending]",
                    ]
                    _checklist = _forced + [c for c in _checklist if c not in _forced]
                # Include both notes AND academic search papers in QC context
                _note_ctx = next((m["content"] for m in plan.messages if m.get("role") == "system" and "USER NOTES CONTEXT" in m.get("content", "")), "")
                _paper_ctx = next((m["content"] for m in plan.messages if m.get("role") == "system" and "ACADEMIC SOURCES" in m.get("content", "")), "")
                if _paper_ctx:
                    _note_ctx = _note_ctx + "\n\n" + _paper_ctx
                _improved = smart_engine.quality_check(full_answer, _checklist, user_text, _qc_client, used_model, note_context=_note_ctx)
                if _improved and _improved.strip() != full_answer.strip():
                    full_answer = _improved
                    yield sse_event(MessageReplaceEvent(content=_improved))
                    self._syslog("info", f"Smart quality check improved answer (mode={plan.smart_mode_name})",
                                 {"mode": plan.smart_mode_name}, dto.user_id)
            except Exception as _qe:
                logger.debug("Smart quality check failed (non-fatal): %s", _qe)

        # Auto-save cited academic papers as notes (academic mode, non-long path)
        if plan.smart_mode_name == "academic_writer" and plan.fetched_papers and dto.user_id:
            try:
                self._save_cited_papers_as_notes(full_answer, plan.fetched_papers, dto.user_id, plan.workspace_filter)
            except Exception as exc:
                logger.warning("Failed to save cited papers as notes (smart mode path): %s", exc)

        clean_answer, conf_level, conf_reason = _parse_confidence(full_answer)
        final_conf = conf_level or plan.pre_conf_level
        final_reason = conf_reason or plan.pre_conf_reason
        _dedup_sources = _dedupe_sources(plan.sources)
        assistant_msg = self.repo_conv.add_message(plan.conversation_id, "assistant", clean_answer, model=used_model, confidence=final_conf, confidence_reason=final_reason, source_note_ids=[s.model_dump() for s in _dedup_sources])

        # Suggest web search when notes had no relevant content and user didn't already enable it
        _suggest_web = (
            succeeded
            and final_conf in ("LOW", "UNSUPPORTED")
            and not getattr(dto, "web_search", False)
        )
        yield sse_event(MessageCompleteEvent(
            message_id=assistant_msg.id,
            model=used_model,
            confidence=final_conf,
            confidence_reason=final_reason,
            routing_reason=plan.routing_reason,
            suggest_web_search=_suggest_web,
            search_query_suggestion=suggested_web_query if _suggest_web else None,
            sources=_dedup_sources,
        ))

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
                        "autopilot_used": bool(plan.routing_reason),
                        "autopilot_reason": plan.routing_reason,
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
                # (check_citation is marked separately, only when the user actually
                # expands the Sources panel — see EvaluationService.mark_citation_viewed)
                self._eval.mark_task(dto.user_id, "ask_rag_question", "Ask a question based on the note", "rag_chat")
            except Exception as exc:
                logger.debug("Analytics tracking failed (non-fatal, chat continues): %s", exc)

        # Phase 2: AI-powered Core Memory detection (fire-and-forget, post-stream)
        if dto.user_id and user_text:
            try:
                from memolink_backend.business.services.core_memory_service import CoreMemoryService
                _cm_svc = CoreMemoryService(
                    note_repo=self.repo_notes,
                    user_repo=None,
                    embedding_service=self.embedding,
                )
                _cm_svc.detect_and_store(dto.user_id, plan.workspace_filter, user_text)
            except Exception as exc:
                logger.warning("Core memory detection failed: %s", exc)

    async def handle_file_upload(
        self,
        conversation_id: int,
        prompt: str,
        files: List[UploadFile],
        user_id: int | None = None,
    ) -> ChatResponseDTO:
        prompt = prompt.strip() or "Please analyse the attached file(s) in detail."
        attachments: List[ChatAttachmentDTO] = []
        file_content_blocks: list = []   # for the LLM user message
        extracted_texts: list[str] = []  # for smart engine analysis

        # ── 1. Extract file content ────────────────────────────────────────────
        for file in files:
            filename = file.filename or "file"
            mime = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            file_bytes = await file.read()
            attachments.append(ChatAttachmentDTO(filename=filename, content_type=mime, size=len(file_bytes)))
            if _is_image(filename, mime):
                b64 = base64.b64encode(file_bytes).decode()
                file_content_blocks.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
            else:
                extracted = extract_text_local(file_bytes, filename)
                file_content_blocks.append({"type": "text", "text": f"[ATTACHED FILE: {filename}]\n{extracted}"})
                extracted_texts.append(f"{filename}:\n{extracted[:1000]}")

        attachment_label = "Attached: " + ", ".join(a.filename for a in attachments)
        self.repo_conv.add_message(conversation_id, "user", f"{attachment_label}\n\n{prompt}")

        # ── 2. Load conversation history ───────────────────────────────────────
        history = self.repo_conv.get_messages_paginated(conversation_id, limit=30, before_id=None)
        # Exclude the just-added user message (last in history) — it will be sent as the file message
        message_history = [
            {"role": m.role, "content": _strip_base64_images(m.content)}
            for m in reversed(history)
        ][:-1]

        # ── 3. Smart engine — analyse first so retrieval queries inform RAG ──────
        _smart_analysis: dict | None = None
        _smart_mode = "general_chat"
        _extra_kwargs: dict = {}
        try:
            _se_client = _get_client(settings.openai_chat_model)
            _combined = prompt + "\n" + "\n".join(extracted_texts)
            _smart_analysis = smart_engine.analyse_request(_combined, _se_client, settings.openai_chat_model)
            _smart_mode = _smart_analysis.get("mode", "general_chat")
            _mode_settings = smart_engine.get_mode_settings(_smart_mode)
            _extra_kwargs = {"temperature": _mode_settings["temperature"], "max_tokens": _mode_settings["max_tokens"]}
        except Exception as exc:
            logger.warning("Smart engine analysis failed for file upload, using defaults: %s", exc)

        # ── 4. RAG — multi-query retrieval using smart engine's retrieval_queries ─
        rag_blocks: list[str] = []
        if user_id and self.repo_notes:
            try:
                all_notes = self.repo_notes.get_for_user(user_id)
                if len(all_notes) <= 20:
                    # Small workspace — include all notes in full (higher limit for academic tasks)
                    char_limit = 6000 if _smart_mode == "academic_writer" else 2000
                    for n in all_notes:
                        plain = _strip_base64_images(_HTML_TAG.sub(" ", n.content)).strip()
                        rag_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{plain[:char_limit]}")
                else:
                    # Large workspace — run multiple queries from smart engine for better coverage
                    retrieval_queries = (_smart_analysis or {}).get("retrieval_queries", []) if _smart_analysis else []
                    if not retrieval_queries:
                        retrieval_queries = [prompt + " " + " ".join(a.filename for a in attachments)]
                    # Always add a literature-specific query for academic tasks
                    if _smart_mode == "academic_writer":
                        retrieval_queries = list(retrieval_queries) + [
                            "academic papers literature review references citations",
                            "research findings methodology evaluation",
                        ]
                    seen_ids: set[int] = set()
                    top_notes: list = []
                    for q in retrieval_queries[:6]:  # max 6 queries
                        try:
                            q_vec = self.embedding.embed_text(q)
                            hits = self.repo_notes.search_hybrid(
                                q,
                                q_vec,
                                top_k=6,
                                workspace_id=dto.workspace_id,
                                user_id=user_id,
                            )
                            for n in hits:
                                if n.id not in seen_ids:
                                    seen_ids.add(n.id)
                                    top_notes.append(n)
                        except Exception as exc:
                            logger.warning("Query expansion search failed for %r (file upload): %s", q, exc)
                            continue
                    if not top_notes:
                        top_notes = all_notes[:12]
                    char_limit = 6000 if _smart_mode == "academic_writer" else 2000
                    for n in top_notes:
                        plain = _strip_base64_images(_HTML_TAG.sub(" ", n.content)).strip()
                        rag_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{plain[:char_limit]}")
            except Exception as exc:
                logger.warning("RAG note retrieval failed for file upload: %s", exc)

        # ── 4b. Academic paper search (academic_writer only) ──────────────────
        # Derives queries from note titles (topic-aware) and hardcoded RAG/AI defaults.
        _paper_system_block: str = ""
        _all_papers: list[dict] = []
        if _smart_mode == "academic_writer":
            try:
                # Derive queries from note titles — they reflect the actual research topic
                _title_queries: list[str] = []
                for _blk in rag_blocks[:8]:
                    _first = _blk.split("\n")[0]
                    if ": " in _first and _first.startswith("[NOTE"):
                        _ntitle = _first.split(": ", 1)[1].rstrip("]").strip()
                        # Skip generic/file-like titles
                        if len(_ntitle) > 8 and not _ntitle.lower().endswith((".pdf", ".docx")):
                            _title_queries.append(_ntitle[:80])
                _acad_queries = smart_engine.build_dynamic_academic_queries(prompt, _smart_analysis, _title_queries[:4])
                _seen_titles: set[str] = set()
                for _q in _acad_queries[:3]:
                    _batch = search_papers(
                        _q[:150],
                        limit=5,
                        api_key=settings.semantic_scholar_api_key,
                        core_api_key=settings.core_api_key,
                        include_arxiv=True,
                    )
                    for _p in _batch:
                        _t = (_p.get("title") or "").lower()[:60]
                        if _t and _t not in _seen_titles:
                            _seen_titles.add(_t)
                            _all_papers.append(_p)
                if _all_papers:
                    _paper_system_block = (
                        "--- ACADEMIC SOURCES ---\n"
                        "Real published papers. READ EACH ABSTRACT — only cite papers whose abstract "
                        "is directly relevant to AI, knowledge management, RAG, or the specific topic "
                        "you are writing about. Do NOT cite a paper just because it appears here.\n\n"
                        + format_papers_context(_all_papers[:12])
                    )
            except Exception as _ae:
                logger.debug("Academic paper search failed (non-fatal): %s", _ae)

        # ── 5. Build system messages ───────────────────────────────────────────
        mode_prompt = smart_engine.get_mode_prompt(_smart_mode) if _smart_analysis else _SYSTEM_PROMPT
        optimized = (_smart_analysis or {}).get("optimized_task", "") if _smart_analysis else ""
        primary_prompt = smart_engine.build_primary_system_prompt(
            mode_prompt=mode_prompt,
            original_message=prompt,
            optimized_task=optimized,
            today=date.today(),
        )
        system_msgs: list[dict] = [{"role": "system", "content": primary_prompt}]

        if rag_blocks:
            system_msgs.append({
                "role": "system",
                "content": (
                    "--- USER NOTES CONTEXT ---\n"
                    "These are the user's personal project notes. Use them as the PRIMARY SOURCE of "
                    "specific details, content, and evidence when writing the response.\n\n"
                    + "\n\n".join(rag_blocks)
                ),
            })

        if _paper_system_block:
            system_msgs.append({"role": "system", "content": _paper_system_block})

        # Extract word count constraint from user prompt
        import re as _re
        _wc_match = _re.search(r'(\d[\d,]*)\s*(?:k\b)?[\s\-–]*(?:word|words|w\b)', prompt, _re.IGNORECASE)
        _min_words = 0
        if _wc_match:
            _raw = _wc_match.group(1).replace(",", "")
            _min_words = int(_raw) * 1000 if "k" in prompt[_wc_match.start():_wc_match.end() + 2].lower() else int(_raw)
        # Also check "minimum of X" / "at least X"
        if not _min_words:
            _wc2 = _re.search(r'(?:minimum|min|at least)\s+(?:of\s+)?(\d[\d,]*)\s*(?:k\b)?', prompt, _re.IGNORECASE)
            if _wc2:
                _raw2 = _wc2.group(1).replace(",", "")
                _min_words = int(_raw2) * 1000 if "k" in prompt[_wc2.start():_wc2.end() + 2].lower() else int(_raw2)
        _wc_instruction = ""
        if _min_words >= 1000:
            _wc_instruction = (
                f"\nWORD COUNT REQUIREMENT: Write a MINIMUM of {_min_words:,} words across all sections. "
                "Every major section must be substantive — at least 3–5 full paragraphs of detailed analysis. "
                "Do not summarise where you can elaborate. Expand every point with explanation, evidence, and implications."
            )

        # Instruction: decide dynamically whether the attached file is rubric/brief or source material.
        file_role_instruction = (
            "ATTACHED FILE ROLE: If the attached file appears to be a rubric, marking guide, assignment brief, "
            "requirements sheet, or assessment instructions, use it as the controlling brief for structure and criteria. "
            "Otherwise, treat the attached file as substantive source material alongside the user's notes.\n"
            "USER NOTES = the primary source of project-specific details when they exist.\n"
            + _wc_instruction + "\n\n"
            "PROJECT-SPECIFIC CLAIMS must come from notes (system decisions, real data, sprint outcomes, evaluation results).\n"
            "GENERAL ACADEMIC CONTENT (methodology rationale, research context, ethics principles) can be written from knowledge.\n"
            "When notes have NO content for a project-specific claim, add:\n"
            "> 📝 **[ADD NOTES]** [describe what specific project content is needed]\n\n"
            "Never invent metrics or percentages. "
            "Date fields: use today's date. Never output [Pending]."
        )
        system_msgs.append({"role": "system", "content": file_role_instruction})

        # ── 6. Build full messages: system + history + current file message ────
        user_content: list = [{"type": "text", "text": prompt}] + file_content_blocks
        messages = system_msgs + message_history + [{"role": "user", "content": user_content}]

        # ── 7. Call model with fallback chain ──────────────────────────────────
        chain = _build_fallback_chain(settings.openai_chat_model)
        answer: str | None = None
        used_model = settings.openai_chat_model
        for attempt in chain:
            try:
                kw = {**_completion_kwargs(attempt), **_extra_kwargs}
                completion = _get_client(attempt).chat.completions.create(
                    model=attempt,
                    messages=messages,
                    **kw,
                )
                answer = completion.choices[0].message.content
                used_model = attempt
                break
            except Exception as exc:
                logger.warning("File upload model %s failed: %s", attempt, exc)
                continue

        if not answer:
            answer = "⚠ All AI models are currently unavailable. Please try again later."

        # ── 8. Quality check for academic/code modes ───────────────────────────
        if _smart_analysis and _smart_mode in smart_engine.QUALITY_CHECK_MODES and answer.strip():
            try:
                _qc_client = _get_client(used_model)
                # Include both notes AND academic search papers so the checker
                # knows which citations are valid and doesn't strip real ones.
                _note_ctx = "\n\n".join(rag_blocks)
                if _paper_system_block:
                    _note_ctx += "\n\n" + _paper_system_block
                _qc_checklist = _smart_analysis.get("quality_checks", [])
                if _smart_mode == "academic_writer":
                    _qc_forced = [
                        "No placeholder text or bracketed instructions remain",
                        "No self-citations — '(StudentName, Year)' referring to this project are forbidden",
                        "Literature Review cites specific real papers with Author (Year) — from notes or ACADEMIC SOURCES",
                        "References list only real external papers from notes or ACADEMIC SOURCES",
                        "No invented quantitative data — mark as [Metric pending]",
                    ]
                    _qc_checklist = _qc_forced + [c for c in _qc_checklist if c not in _qc_forced]
                _improved = smart_engine.quality_check(
                    answer,
                    _qc_checklist,
                    prompt,
                    _qc_client,
                    used_model,
                    note_context=_note_ctx,
                )
                if _improved and _improved.strip() != answer.strip():
                    answer = _improved
            except Exception as exc:
                logger.warning("Quality check failed for file-upload answer: %s", exc)

        # ── 9. Auto-save cited papers as notes (academic mode) ───────────────
        if _smart_mode == "academic_writer" and _all_papers and user_id:
            try:
                self._save_cited_papers_as_notes(answer, _all_papers, user_id, None)
            except Exception as exc:
                logger.warning("Failed to save cited papers as notes (file upload path): %s", exc)

        # ── 10. Save and return ────────────────────────────────────────────────
        clean_answer, _, _ = _parse_confidence(answer)
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", clean_answer, model=used_model)
        return ChatResponseDTO(answer=clean_answer, sources=[], attachments=attachments, message_id=assistant_msg.id)
