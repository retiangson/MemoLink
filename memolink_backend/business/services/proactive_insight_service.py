"""
Proactive Insight Service
=========================

Analyses a user's notes and existing reminders to surface actionable alerts that
the user may have missed - without waiting for them to ask.

INSIGHT TYPES
-------------
missing_reminder   - Note mentions a specific deadline, due date, or scheduled event
                     but no reminder exists to track it.
                     Example: "You mentioned a submission date in 'Assignment Brief'
                     but no reminder exists yet."

incomplete_actions - Note contains clear action items, TODOs, or tasks that appear
                     unfinished and untracked.
                     Example: "Lecture 3 has 3 action items that still have no
                     corresponding reminders."

unreviewed_upload  - A recently uploaded file or recording has had no follow-up
                     activity (no reminders created, no conversations referencing it).
                     Example: "You uploaded a lecture recording 3 days ago but
                     haven't reviewed or summarised it yet."

urgency_signal     - Note contains language suggesting something is time-critical
                     ("ASAP", "urgent", "due tomorrow", "overdue", "deadline approaching").
                     Example: "Project Plan uses urgent language - you may want to
                     set a reminder."

ANALYSIS FLOW
-------------
1. Fetch all notes in the workspace (title + first 600 chars of plain text).
2. Detect unreviewed uploads using a rule-based filename/keyword check (free).
3. Send remaining notes to GPT-4o-mini in batches of 8 for the other three types.
   One GPT call per batch of 8 = ~4 calls for a 30-note workspace.
4. Clear existing non-dismissed insights, store new ones, return them.

COST
----
~$0.001 per scan for a typical 20-note workspace (all GPT-4o-mini, low token count).
Users trigger scans manually - no cost on regular page load.
"""

import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional
from openai import OpenAI

from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.proactive_insight_repository import ProactiveInsightRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository

logger = logging.getLogger(__name__)

_HTML_TAG = re.compile(r"<[^>]+>")
_UPLOAD_RE = re.compile(
    r"\.(m4a|mp3|mp4|wav|webm|mov|mkv|pdf|docx|pptx)\b"
    r"|(?:recording|lecture|transcript|upload|video|audio)\b",
    re.IGNORECASE,
)
_BATCH_SIZE = 8


def _plain(html: str) -> str:
    text = re.sub(r"<style[^>]*>.*?</style>", "", html or "", flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _analyse_batch(batch: list[dict]) -> list[dict]:
    """Send up to _BATCH_SIZE notes to GPT; return a flat list of insight dicts."""
    if not batch:
        return []

    items_text = "\n\n".join(
        f"NOTE {i + 1} (id={n['id']}, title={n['title']!r}):\n{n['text'][:600]}"
        for i, n in enumerate(batch)
    )

    prompt = (
        "You are a proactive study/work companion. Analyse each note below and identify "
        "specific, actionable insights the user may have missed.\n\n"
        "Look for:\n"
        "1. MISSING_REMINDER - a specific deadline, due date, exam, meeting, or scheduled "
        "   event is mentioned but no reminder was created for it.\n"
        "2. INCOMPLETE_ACTIONS - clear action items, TODOs, or tasks appear unfinished "
        "   and untracked (e.g. 'need to submit', 'must review', 'TODO:').\n"
        "3. URGENCY_SIGNAL - language signals the topic is time-critical or overdue "
        "   (e.g. 'ASAP', 'urgent', 'due tomorrow', 'overdue', 'deadline approaching').\n\n"
        "Return ONLY a JSON array - empty [] if nothing found:\n"
        "[\n"
        '  {"note_index": 1, "type": "missing_reminder|incomplete_actions|urgency_signal",\n'
        '   "title": "short alert title (max 80 chars)",\n'
        '   "description": "one sentence explanation (max 150 chars)",\n'
        '   "severity": "info|warning|urgent"}\n'
        "]\n\n"
        "Rules: max 2 insights per note; be specific, not generic; skip notes that look fine.\n\n"
        + items_text
    )

    try:
        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=800,
        )
        content = resp.choices[0].message.content.strip()
        match = re.search(r"\[.*\]", content, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
            if isinstance(parsed, list):
                return parsed
    except Exception as exc:
        logger.warning("Proactive insight generation failed: %s", exc)
    return []


class ProactiveInsightService:
    def __init__(
        self,
        insight_repo: ProactiveInsightRepository,
        note_repo: NoteRepository,
    ):
        self.insight_repo = insight_repo
        self.note_repo = note_repo

    def analyze(self, user_id: int, workspace_id: int, db) -> list[dict]:
        """
        Run a full proactive analysis for the workspace.
        Clears previous results, stores fresh insights, and returns them.
        """
        notes = self.note_repo.get_for_user(user_id, workspace_id)
        if not notes:
            return []

        self.insight_repo.clear_for_workspace(user_id, workspace_id)

        cutoff = datetime.now(timezone.utc) - timedelta(days=14)
        new_insights: list[dict] = []

        # ── Rule-based: unreviewed uploads ────────────────────────────────────
        for note in notes:
            title = note.title or ""
            if _UPLOAD_RE.search(title):
                created = note.created_at
                if created and created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                if created and created >= cutoff:
                    days_ago = (datetime.now(timezone.utc) - created).days
                    age_label = "today" if days_ago == 0 else f"{days_ago} day{'s' if days_ago > 1 else ''} ago"
                    new_insights.append({
                        "insight_type": "unreviewed_upload",
                        "title": f"Unreviewed upload: {title[:60]}",
                        "description": f"Uploaded {age_label} - consider adding a summary or setting a review reminder.",
                        "note_id": note.id,
                        "severity": "info",
                    })

        # ── GPT batch analysis: missing reminders, actions, urgency ──────────
        batch_data = [
            {"id": n.id, "title": n.title or "Untitled", "text": _plain(n.content or "")}
            for n in notes
        ]

        for start in range(0, len(batch_data), _BATCH_SIZE):
            batch = batch_data[start: start + _BATCH_SIZE]
            results = _analyse_batch(batch)

            for item in results:
                idx = item.get("note_index", 0) - 1
                if idx < 0 or idx >= len(batch):
                    continue
                note_id = batch[idx]["id"]
                new_insights.append({
                    "insight_type": item.get("type", "urgency_signal"),
                    "title": (item.get("title") or "")[:500],
                    "description": (item.get("description") or "")[:1000],
                    "note_id": note_id,
                    "severity": item.get("severity", "info"),
                })

        # ── Store and return ──────────────────────────────────────────────────
        for ins in new_insights:
            self.insight_repo.create(
                user_id=user_id,
                workspace_id=workspace_id,
                insight_type=ins["insight_type"],
                title=ins["title"],
                description=ins.get("description"),
                note_id=ins.get("note_id"),
                severity=ins["severity"],
            )
        db.commit()

        return self._serialize_list(
            self.insight_repo.list_active(user_id, workspace_id)
        )

    def get_insights(self, user_id: int, workspace_id: int) -> list[dict]:
        return self._serialize_list(
            self.insight_repo.list_active(user_id, workspace_id)
        )

    def dismiss(self, user_id: int, insight_id: int) -> bool:
        return self.insight_repo.dismiss(insight_id, user_id)

    @staticmethod
    def _serialize_list(rows) -> list[dict]:
        return [
            {
                "id": r.id,
                "insight_type": r.insight_type,
                "title": r.title,
                "description": r.description,
                "note_id": r.note_id,
                "severity": r.severity,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
