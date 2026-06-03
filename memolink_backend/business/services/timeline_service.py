"""
Meeting / Lecture Timeline Service
===================================

Analyses a transcript note and produces a structured timeline:

  • Chapters     - major topic sections with estimated timestamps
  • Action Items - tasks, assignments, and follow-ups with who is responsible
  • Important Moments - key statements, decisions, warnings, deadlines, notable quotes
  • Summary      - 3–5 sentence overview of the entire recording

TIMESTAMP ESTIMATION
--------------------
Accurate word-level timestamps require the original audio file.  Since
MemoLink stores only the transcript text after transcription, timestamps
are estimated from word position:

    seconds = (word_index / total_words) × estimated_duration_seconds

Estimated duration = word_count / WORDS_PER_MINUTE (default 130 wpm for lectures).
For a 45-minute lecture (~5850 words) the error is typically ±30–90 seconds -
precise enough for navigation.  Deepgram and Whisper both return
speaking-rate-aware segments, so the 130 wpm assumption is a close fit for
academic content.

COST
----
One GPT-4o-mini call per generation (cached on subsequent reads).
Re-generation is possible via POST /timeline/generate/{note_id}?regenerate=true.
"""

import json
import re
from typing import Optional

from openai import OpenAI

from memolink_backend.core.config import settings
from memolink_backend.contracts.timeline_dtos import (
    TimelineResponse, TimelineChapter, TimelineActionItem, TimelineImportantMoment,
)
from memolink_backend.domain.repositories.timeline_repository import TimelineRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository

_WORDS_PER_MINUTE = 130   # average lecture/meeting speaking rate


def _strip_html(html: str) -> str:
    text = re.sub(r"<style[^>]*>.*?</style>", "", html or "", flags=re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _fmt_timestamp(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


class TimelineService:
    def __init__(self, timeline_repo: TimelineRepository, note_repo: NoteRepository):
        self._timeline = timeline_repo
        self._notes    = note_repo

    # ── Public API ────────────────────────────────────────────────────────────

    def get(self, note_id: int) -> Optional[TimelineResponse]:
        """Return cached timeline if one exists, else None."""
        row = self._timeline.get_by_note(note_id)
        if not row:
            return None
        return self._to_dto(row, note_id, exists=True)

    def generate(self, user_id: int, note_id: int) -> TimelineResponse:
        """Generate (or regenerate) the timeline for a note. Returns the result."""
        note = self._notes.get_by_id(note_id)
        if not note:
            raise ValueError(f"Note {note_id} not found")

        text = _strip_html(note.content or "")
        if not text.strip():
            raise ValueError("Note has no text content to analyse")

        words = text.split()
        word_count = len(words)
        estimated_duration = max(30, round(word_count / _WORDS_PER_MINUTE * 60))

        # Call GPT
        client = OpenAI(api_key=settings.openai_api_key)
        system = (
            "You are a meeting/lecture analysis assistant. "
            f"The transcript has approximately {word_count} words. "
            f"Assume an average speaking rate of {_WORDS_PER_MINUTE} words per minute - "
            f"estimated total duration: {_fmt_timestamp(estimated_duration)}.\n\n"
            "Analyse the transcript and return ONLY valid JSON (no markdown fences):\n"
            "{\n"
            '  "summary": "3–5 sentence overview",\n'
            '  "estimated_duration_seconds": ' + str(estimated_duration) + ",\n"
            '  "word_count": ' + str(word_count) + ",\n"
            '  "chapters": [\n'
            '    {"timestamp":"MM:SS","seconds":0,"title":"...","summary":"1–2 sentences","key_phrase":"exact first 8 words of this section"}\n'
            "  ],\n"
            '  "action_items": [\n'
            '    {"timestamp":"MM:SS","seconds":0,"text":"...","assignee":"who is responsible or null","key_phrase":"exact words near this item"}\n'
            "  ],\n"
            '  "important_moments": [\n'
            '    {"timestamp":"MM:SS","seconds":0,"text":"exact or near-exact quote","type":"decision|warning|key_point|deadline|question","key_phrase":"exact words"}\n'
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            "- timestamps must match seconds proportionally: seconds = (word_position / word_count) × estimated_duration\n"
            "- key_phrase must be the EXACT first 6–10 words from the transcript at that location - used for text search\n"
            "- aim for 3–8 chapters, up to 10 action items, up to 10 important moments\n"
            "- use 'HH:MM:SS' format if duration exceeds 1 hour, else 'MM:SS'\n"
            "- if the transcript has no clear action items or moments, return empty arrays"
        )

        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": f"Transcript:\n{text[:14000]}"},
            ],
            max_tokens=3000,
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)

        row = self._timeline.upsert(
            note_id=note_id,
            user_id=user_id,
            summary=data.get("summary", ""),
            chapters=data.get("chapters", []),
            action_items=data.get("action_items", []),
            important_moments=data.get("important_moments", []),
            estimated_duration_seconds=data.get("estimated_duration_seconds", estimated_duration),
            word_count=data.get("word_count", word_count),
        )
        return self._to_dto(row, note_id, exists=False)

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _to_dto(row, note_id: int, exists: bool) -> TimelineResponse:
        chapters = [
            TimelineChapter(
                timestamp=c.get("timestamp", "00:00"),
                seconds=int(c.get("seconds", 0)),
                title=c.get("title", ""),
                summary=c.get("summary", ""),
                key_phrase=c.get("key_phrase", ""),
            )
            for c in (row.chapters or [])
        ]
        action_items = [
            TimelineActionItem(
                timestamp=a.get("timestamp", "00:00"),
                seconds=int(a.get("seconds", 0)),
                text=a.get("text", ""),
                assignee=a.get("assignee") or None,
                key_phrase=a.get("key_phrase", ""),
            )
            for a in (row.action_items or [])
        ]
        important_moments = [
            TimelineImportantMoment(
                timestamp=m.get("timestamp", "00:00"),
                seconds=int(m.get("seconds", 0)),
                text=m.get("text", ""),
                type=m.get("type", "key_point"),
                key_phrase=m.get("key_phrase", ""),
            )
            for m in (row.important_moments or [])
        ]
        return TimelineResponse(
            note_id=note_id,
            summary=row.summary or "",
            chapters=chapters,
            action_items=action_items,
            important_moments=important_moments,
            estimated_duration_seconds=row.estimated_duration_seconds,
            word_count=row.word_count,
            exists=exists,
        )
