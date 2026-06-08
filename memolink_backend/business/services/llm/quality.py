"""Quality-check helpers for long-form LLM outputs."""

from __future__ import annotations

import logging
from datetime import date as _date

from .prompts import QUALITY_PROMPT

logger = logging.getLogger(__name__)


def quality_check(
    draft: str,
    checklist: list[str],
    user_message: str,
    client,
    model: str,
    note_context: str = "",
) -> str:
    """Run an optional clean-up pass over a draft, or return it unchanged."""
    if not draft or not draft.strip():
        return draft
    try:
        today = _date.today().strftime("%d %B %Y")
        checklist_text = "\n".join(f"- {c}" for c in checklist) if checklist else "- Completeness\n- Accuracy\n- No placeholders"
        user_content = f"User request: {user_message}\n\nToday's date: {today}\n\n"
        if note_context:
            user_content += f"User's notes (use these to fix generic/placeholder content):\n{note_context[:6000]}\n\n"
        user_content += f"Quality checklist:\n{checklist_text}\n\nDraft answer:\n{draft}"

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": QUALITY_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.1,
            max_tokens=12000,
        )
        result = (resp.choices[0].message.content or "").strip()
        return result if result else draft
    except Exception as exc:
        logger.debug("Smart engine quality check failed (non-fatal): %s", exc)
        return draft
