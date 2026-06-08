from __future__ import annotations

import json
import logging
import re
from typing import Iterator, Optional

from sqlalchemy.orm import Session

from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.services.llm.client_factory import canonical_model, get_client
from memolink_backend.utils.academic_search import search_papers, format_papers_context
from memolink_backend.utils.web_search import brave_search

# Phrases that indicate the user is asking about their notes rather than a topic.
_META_PHRASES = frozenset(
    ["gap", "gaps", "my notes", "my note", "notes", "missing", "summarize",
     "summary", "find", "review", "overview", "analyse", "analyze", "what do i have"]
)
_FILE_EXT_RE = re.compile(r"\.(pdf|docx?|pptx?|txt|md)\s*$", re.IGNORECASE)
_LEADING_NUM_RE = re.compile(r"^\d+[\s.]+")  # strips leading "2 " or "1. " from filenames

logger = logging.getLogger(__name__)

_HTML_TAG = re.compile(r"<[^>]+>")
_BASE64_IMG_MD = re.compile(r"!\[[^\]]*\]\(data:[^)]{20,}\)", re.IGNORECASE)

_RESEARCH_SYSTEM = """You are MemoLink Research, an advanced AI research assistant with access to the user's personal knowledge base, live web results, and academic literature.

Produce a comprehensive, well-structured research report. Use ALL provided context sources.

REQUIRED OUTPUT FORMAT - use exactly this structure (markdown headings):

## Research Summary
2–3 sentence overview answering the core question.

## Key Findings

### From Your Notes
Bullet points of insights from the user's own notes. Cite as [NOTE: title].
If no relevant notes: "No relevant notes found on this topic."

### From Web & Academic Sources
Bullet points from web search and academic papers. Be specific.

## Knowledge Gaps in Your Notes
Concrete things missing from the user's notes on this topic.
Format each as: **Gap:** [what is missing] → *Suggested: [what to read/search/explore]*
If none: "Your notes appear comprehensive for this topic."

## Contradictions & Tensions
Anything where sources contradict each other or contradict the user's notes.
If none: "No significant contradictions found."

## Academic References
Numbered list of relevant papers from the academic search context only.
Format: **[N]. [Title]** - [Authors] ([Year]) · [N citations]
Include DOI or PDF link if available. Add one-sentence relevance note.
If no papers provided: omit this section.

## Suggested Follow-up Research
3–5 specific actionable questions or topics the user should explore next.

---
RULES:
- Cite user notes as [NOTE: exact title]
- Mark unverified claims with [UNVERIFIED]
- Only cite papers that appear in the provided academic context - never hallucinate references
- Be specific and actionable, not generic
- Prefer depth over breadth"""


def _strip_base64(text: str) -> str:
    return _BASE64_IMG_MD.sub("[image]", text)


def _plain(html: str) -> str:
    return _strip_base64(_HTML_TAG.sub(" ", html)).strip()


def _clean_title(title: str) -> str:
    """Remove file extension and leading numbering from an imported note title."""
    title = _FILE_EXT_RE.sub("", title)
    title = _LEADING_NUM_RE.sub("", title)
    return title.strip()


def _academic_query(prompt: str, note_titles: list[str]) -> str:
    """
    Derive a useful Semantic Scholar search query.
    When the prompt is a meta-question (e.g. 'find gaps in my notes') use the
    first note title cleaned of file extensions and leading numbers.
    A single academic paper title is already an ideal search term.
    Always caps the query at 150 chars to stay within URL limits.
    """
    words = prompt.lower().split()
    is_meta = any(w in _META_PHRASES for w in words) or len(prompt) < 60
    if is_meta and note_titles:
        return _clean_title(note_titles[0])[:150]
    return prompt[:150]


class ResearchService:
    def __init__(
        self,
        db: Optional[Session] = None,
        embedding_service: Optional[EmbeddingService] = None,
        conv_repo=None,
        note_repo=None,
    ):
        if conv_repo is not None and note_repo is not None:
            self.repo_conv = conv_repo
            self.repo_notes = note_repo
        else:
            if db is None:
                raise ValueError("Either repos or db must be provided.")
            self.repo_conv = ConversationRepository(db)
            self.repo_notes = NoteRepository(db)
        self.embedding = embedding_service or EmbeddingService()

    # ── helpers ──────────────────────────────────────────────────────────────

    def _step(self, label: str) -> str:
        return f"data: {json.dumps({'tool_call': 'research', 'label': label})}\n\n"

    def _step_done(self) -> str:
        return f"data: {json.dumps({'tool_result': 'research', 'ok': True})}\n\n"

    def _event(self, payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    # ── main stream ───────────────────────────────────────────────────────────

    def research_stream(
        self,
        user_id: int,
        conversation_id: int,
        prompt: str,
        workspace_id: Optional[int],
        model: Optional[str],
    ) -> Iterator[str]:
        model = canonical_model(model or settings.openai_chat_model)
        if model.startswith("gemini-") and not settings.gemini_api_key:
            model = settings.openai_chat_model
        elif model.startswith("deepseek-") and not settings.deepseek_api_key:
            model = settings.openai_chat_model
        client = get_client(model)

        # Persist user message
        self.repo_conv.add_message(conversation_id, "user", prompt)

        # ── Step 1: search notes ─────────────────────────────────────────────
        yield self._step("Searching your notes")
        all_notes = self.repo_notes.get_for_user(user_id, workspace_id) if user_id else []
        note_blocks: list[str] = []

        if all_notes:
            try:
                query_vec = self.embedding.embed_text(prompt)
                top_notes = self.repo_notes.search_hybrid(prompt, query_vec, top_k=10, workspace_id=workspace_id)
            except Exception:
                top_notes = all_notes[:10]

            for n in top_notes:
                note_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{_plain(n.content)[:2000]}")

        yield self._step_done()

        # ── Step 2: web search ────────────────────────────────────────────────
        web_context = ""
        if settings.brave_search_api_key:
            yield self._step("Searching the web")
            web_context = brave_search(prompt) or ""
            yield self._step_done()

        # ── Step 3: academic papers ───────────────────────────────────────────
        yield self._step("Finding academic papers")
        note_titles = [b.split("\n")[0].lstrip("[NOTE ").split(":")[1].rstrip("]").strip()
                       for b in note_blocks if "\n" in b]
        acad_query = _academic_query(prompt, note_titles)
        papers = search_papers(acad_query, limit=5, api_key=settings.semantic_scholar_api_key)
        paper_context = format_papers_context(papers)
        yield self._step_done()

        # ── Step 4: synthesise ────────────────────────────────────────────────
        yield self._step("Synthesising research report")

        context_sections: list[str] = []
        if note_blocks:
            context_sections.append("--- USER NOTES ---\n" + "\n\n".join(note_blocks))
        if web_context:
            context_sections.append(web_context)
        if paper_context:
            context_sections.append(paper_context)

        messages = [
            {"role": "system", "content": _RESEARCH_SYSTEM},
            *([{"role": "system", "content": "\n\n".join(context_sections)}] if context_sections else []),
            {"role": "user", "content": prompt},
        ]

        full_answer = ""
        first_token = True
        try:
            stream = client.chat.completions.create(model=model, messages=messages, stream=True)
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if not delta:
                    continue
                if first_token:
                    first_token = False
                    # Close the "Synthesising" step visually before content flows
                    yield self._step_done()
                full_answer += delta
                yield self._event({"t": delta})
        except Exception as exc:
            if first_token:
                yield self._step_done()
            err = f"\n\n⚠ Research failed: {exc}"
            full_answer += err
            yield self._event({"t": err})

        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", full_answer, model=model)
        yield self._event({"done": True, "id": assistant_msg.id, "model": model})
