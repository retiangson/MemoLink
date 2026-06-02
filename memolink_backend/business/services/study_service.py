"""
Study Mode Service
==================

Turns a user's notes and conversation history into structured study materials.

FEATURES
--------
1. Flashcards
   GPT generates question-answer pairs from one note or all workspace notes.
   Returned as a JSON array so the frontend can render flippable cards.

2. Exam Review
   GPT produces a structured review covering key concepts, definitions,
   important facts, likely exam questions, and focus topics.
   Supports filtering to specific notes or covering the full workspace.

3. Study Plan
   Given a number of days and an optional goal, GPT analyses all workspace
   notes and returns a day-by-day schedule with focus topics and tasks.

4. Weak Topics
   Scans the user's recent conversation messages to identify topics they
   repeatedly ask about or struggle with. GPT returns each topic with a
   simple explanation and study tip.

5. Summary Levels
   Returns a note summary at three levels of detail:
   - short    → 3–5 bullet-point key takeaways
   - medium   → 2–3 paragraph concise summary
   - detailed → full structured summary with headings

COST NOTES
----------
- Flashcards (1 note):  1 GPT call
- Flashcards (all):     1 GPT call (content truncated if large)
- Exam Review:          1 GPT call
- Study Plan:           1 GPT call
- Weak Topics:          1 GPT call
- Summary:              1 GPT call
"""

import json
import re
from typing import List, Optional
from openai import OpenAI
from sqlalchemy import text

from memolink_backend.core.config import settings
from memolink_backend.contracts.study_dtos import (
    FlashcardItem, FlashcardsResponse,
    DefinitionItem, ExamReviewResponse,
    StudyPlanDay, StudyPlanResponse,
    WeakTopic, WeakTopicsResponse,
    SummaryResponse,
)
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_html(html: str) -> str:
    text = re.sub(r"<style[^>]*>.*?</style>", "", html or "", flags=re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _gpt_json(prompt: str, system: str, max_tokens: int = 2000) -> dict | list:
    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content or "{}"
    return json.loads(raw)


def _build_notes_block(notes, max_chars: int = 12000) -> str:
    """Concatenate notes into a single context block, truncating if needed."""
    parts = []
    total = 0
    for n in notes:
        body = _strip_html(n.content or "")[:3000]
        chunk = f"### {n.title or 'Untitled'}\n{body}\n"
        if total + len(chunk) > max_chars:
            break
        parts.append(chunk)
        total += len(chunk)
    return "\n".join(parts)


# ── Service ───────────────────────────────────────────────────────────────────

class StudyService:
    def __init__(
        self,
        note_repo: NoteRepository,
        conv_repo: ConversationRepository,
        db,
    ):
        self._notes = note_repo
        self._convs = conv_repo
        self._db    = db

    # ── 1. Flashcards ──────────────────────────────────────────────────────────

    def generate_flashcards(
        self,
        user_id: int,
        workspace_id: int,
        note_id: Optional[int],
        count: int,
    ) -> FlashcardsResponse:
        if note_id:
            note = self._notes.get_by_id(note_id)
            notes = [note] if note else []
        else:
            notes = self._notes.get_for_user(user_id, workspace_id)

        if not notes:
            return FlashcardsResponse(cards=[], source_count=0)

        context = _build_notes_block(notes)
        note_title = notes[0].title if len(notes) == 1 else None

        data = _gpt_json(
            prompt=f"Notes:\n{context}",
            system=(
                f"You are a study assistant. Generate exactly {count} flashcard question-answer pairs "
                "from the provided notes. Focus on key concepts, definitions, important facts, dates, "
                "formulas, and testable information. Return JSON: "
                '{"cards": [{"question": "...", "answer": "..."}, ...]}'
            ),
            max_tokens=2500,
        )
        raw_cards = data.get("cards", [])
        cards = [FlashcardItem(question=c.get("question",""), answer=c.get("answer","")) for c in raw_cards if c.get("question")]
        return FlashcardsResponse(cards=cards, note_title=note_title, source_count=len(notes))

    # ── 2. Exam Review ─────────────────────────────────────────────────────────

    def generate_exam_review(
        self,
        user_id: int,
        workspace_id: int,
        note_ids: List[int],
    ) -> ExamReviewResponse:
        if note_ids:
            notes = [n for nid in note_ids if (n := self._notes.get_by_id(nid))]
        else:
            notes = self._notes.get_for_user(user_id, workspace_id)

        if not notes:
            return ExamReviewResponse(
                key_concepts=[], definitions=[], important_facts=[],
                likely_questions=[], focus_topics=[], overview="No notes found.",
            )

        context = _build_notes_block(notes, max_chars=14000)
        data = _gpt_json(
            prompt=f"Notes:\n{context}",
            system=(
                "You are an expert exam preparation assistant. Analyse the notes and return JSON:\n"
                '{"key_concepts": ["...", ...], '
                '"definitions": [{"term":"...","definition":"..."}, ...], '
                '"important_facts": ["...", ...], '
                '"likely_questions": ["...", ...], '
                '"focus_topics": ["...", ...], '
                '"overview": "2–3 sentence overview of the material"}'
            ),
            max_tokens=3000,
        )
        return ExamReviewResponse(
            key_concepts=data.get("key_concepts", []),
            definitions=[DefinitionItem(**d) for d in data.get("definitions", []) if "term" in d],
            important_facts=data.get("important_facts", []),
            likely_questions=data.get("likely_questions", []),
            focus_topics=data.get("focus_topics", []),
            overview=data.get("overview", ""),
        )

    # ── 3. Study Plan ──────────────────────────────────────────────────────────

    def generate_study_plan(
        self,
        user_id: int,
        workspace_id: int,
        days: int,
        goal: str,
    ) -> StudyPlanResponse:
        notes = self._notes.get_for_user(user_id, workspace_id)

        note_titles = [n.title or "Untitled" for n in notes[:30]]
        titles_block = "\n".join(f"- {t}" for t in note_titles)
        goal_line = f"Goal: {goal}" if goal else "No specific goal provided."

        data = _gpt_json(
            prompt=f"{goal_line}\nAvailable notes:\n{titles_block}",
            system=(
                f"You are a study planner. Create a {days}-day study plan for a student with the notes listed. "
                "Distribute topics logically across the days with increasing complexity. "
                "Return JSON:\n"
                '{"overall_goal": "...", "plan": [{"day": 1, "label": "Day 1", "focus": "...", '
                '"topics": ["..."], "tasks": ["..."], "note_titles": ["..."]}, ...]}'
            ),
            max_tokens=3000,
        )
        raw_plan = data.get("plan", [])
        plan_days = [
            StudyPlanDay(
                day=p.get("day", i + 1),
                label=p.get("label", f"Day {i+1}"),
                focus=p.get("focus", ""),
                topics=p.get("topics", []),
                tasks=p.get("tasks", []),
                note_titles=p.get("note_titles", []),
            )
            for i, p in enumerate(raw_plan)
        ]
        return StudyPlanResponse(
            overall_goal=data.get("overall_goal", goal or "Study plan"),
            plan=plan_days,
        )

    # ── 4. Weak Topics ─────────────────────────────────────────────────────────

    def detect_weak_topics(
        self,
        user_id: int,
        workspace_id: int,
    ) -> WeakTopicsResponse:
        # Fetch recent user-role messages from workspace conversations
        rows = self._db.execute(
            text("""
                SELECT m.content
                FROM messages m
                JOIN conversations c ON m.conversation_id = c.id
                WHERE c.user_id = :uid
                  AND c.workspace_id = :wid
                  AND c.deleted_at IS NULL
                  AND m.role = 'user'
                ORDER BY m.id DESC
                LIMIT 60
            """),
            {"uid": user_id, "wid": workspace_id},
        ).fetchall()

        if len(rows) < 5:
            return WeakTopicsResponse(
                topics=[],
                message="Not enough conversation history yet. Ask more questions in this workspace first.",
            )

        questions_block = "\n".join(f"- {r[0][:200]}" for r in rows)
        data = _gpt_json(
            prompt=f"User questions:\n{questions_block}",
            system=(
                "You are a learning analytics assistant. Identify topics the user repeatedly asks about "
                "or seems to struggle with based on their questions. Ignore unique one-off questions. "
                "Focus on recurring patterns and knowledge gaps. Return JSON:\n"
                '{"topics": [{"topic": "...", "frequency": 3, '
                '"simple_explanation": "Plain English explanation in 2–3 sentences.", '
                '"study_tip": "Concrete action to improve understanding."}, ...]}'
            ),
            max_tokens=2000,
        )
        topics = [
            WeakTopic(
                topic=t.get("topic",""),
                frequency=int(t.get("frequency", 1)),
                simple_explanation=t.get("simple_explanation",""),
                study_tip=t.get("study_tip",""),
            )
            for t in data.get("topics", [])
            if t.get("topic")
        ]
        topics.sort(key=lambda t: t.frequency, reverse=True)
        return WeakTopicsResponse(topics=topics)

    # ── 5. Summary Levels ──────────────────────────────────────────────────────

    def summarize_at_level(
        self,
        user_id: int,
        workspace_id: int,
        note_id: int,
        level: str,
    ) -> SummaryResponse:
        note = self._notes.get_by_id(note_id)
        if not note:
            return SummaryResponse(note_title="Unknown", level=level, summary="Note not found.")

        content = _strip_html(note.content or "")[:10000]

        if level == "short":
            system = (
                "You are a study assistant. Summarize the note into exactly 3–5 bullet-point key takeaways. "
                'Return JSON: {"summary": "brief intro sentence", "bullet_points": ["...", ...]}'
            )
        elif level == "detailed":
            system = (
                "You are a study assistant. Write a detailed structured summary of the note with sections, "
                "key concepts explained, and important details preserved. "
                'Return JSON: {"summary": "full detailed structured summary with sections", "bullet_points": null}'
            )
        else:  # medium
            system = (
                "You are a study assistant. Write a concise 2–3 paragraph summary covering all main ideas. "
                'Return JSON: {"summary": "2–3 paragraph summary", "bullet_points": null}'
            )

        data = _gpt_json(
            prompt=f"Note title: {note.title}\n\n{content}",
            system=system,
            max_tokens=1500,
        )
        return SummaryResponse(
            note_title=note.title or "Untitled",
            level=level,
            summary=data.get("summary", ""),
            bullet_points=data.get("bullet_points") or None,
        )
