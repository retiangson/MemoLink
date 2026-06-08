"""Context-engine layer for preparing chat prompts and message context."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from memolink_backend.core.config import settings
from memolink_backend.utils.academic_search import format_papers_context, search_papers

from .academic import build_dynamic_academic_queries
from .messages import build_primary_system_prompt, get_mode_prompt, get_mode_settings


@dataclass
class PreparedContext:
    messages: list[dict[str, Any]]
    mode_name: str
    mode_settings: dict[str, Any]
    primary_prompt: str
    paper_context: str = ""


class ContextEngine:
    mode_name = "general_chat"

    def prepare(
        self,
        *,
        messages: list[dict[str, Any]],
        user_text: str,
        smart_analysis: dict | None,
        today: date | None = None,
    ) -> PreparedContext:
        mode_prompt = get_mode_prompt(self.mode_name)
        optimized_task = (smart_analysis or {}).get("optimized_task", "")
        primary_prompt = build_primary_system_prompt(
            mode_prompt=mode_prompt,
            original_message=user_text,
            optimized_task=optimized_task,
            today=today,
        )
        prepared_messages = [dict(message) for message in messages]
        if prepared_messages and prepared_messages[0].get("role") == "system":
            prepared_messages[0]["content"] = primary_prompt
        else:
            prepared_messages.insert(0, {"role": "system", "content": primary_prompt})

        paper_context = self._build_paper_context(
            user_text=user_text,
            smart_analysis=smart_analysis,
            messages=prepared_messages,
        )
        if paper_context:
            insert_at = next(
                (
                    i for i, message in enumerate(prepared_messages)
                    if message.get("role") == "system" and "USER NOTES CONTEXT" in message.get("content", "")
                ),
                0,
            )
            prepared_messages.insert(insert_at + 1, {"role": "system", "content": paper_context})

        return PreparedContext(
            messages=prepared_messages,
            mode_name=self.mode_name,
            mode_settings=get_mode_settings(self.mode_name),
            primary_prompt=primary_prompt,
            paper_context=paper_context,
        )

    def _build_paper_context(
        self,
        *,
        user_text: str,
        smart_analysis: dict | None,
        messages: list[dict[str, Any]],
    ) -> str:
        return ""


class AcademicWriterContextEngine(ContextEngine):
    mode_name = "academic_writer"

    def _build_paper_context(
        self,
        *,
        user_text: str,
        smart_analysis: dict | None,
        messages: list[dict[str, Any]],
    ) -> str:
        note_titles: list[str] = []
        for message in messages:
            content = message.get("content", "")
            if message.get("role") != "system" or "USER NOTES CONTEXT" not in content:
                continue
            for line in content.splitlines():
                if line.startswith("[NOTE ") and ": " in line:
                    title = line.split(": ", 1)[1].rstrip("]").strip()
                    if len(title) > 4:
                        note_titles.append(title[:80])

        queries = build_dynamic_academic_queries(user_text, smart_analysis, note_titles[:4])
        papers: list[dict[str, Any]] = []
        seen_titles: set[str] = set()
        for query in queries[:2]:
            try:
                batch = search_papers(query[:150], limit=6, api_key=settings.semantic_scholar_api_key)
            except Exception:
                continue
            for paper in batch:
                key = (paper.get("title") or "").lower()[:60]
                if key and key not in seen_titles:
                    seen_titles.add(key)
                    papers.append(paper)

        if not papers:
            return ""
        return (
            "--- ACADEMIC SOURCES ---\n"
            "Real published papers retrieved for this research topic. "
            "Read each abstract before citing it and only use papers that are directly relevant.\n\n"
            + format_papers_context(papers[:10])
        )


def build_context_engine(mode_name: str) -> ContextEngine:
    if mode_name == "academic_writer":
        return AcademicWriterContextEngine()
    return ContextEngine()
