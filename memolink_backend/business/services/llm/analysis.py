"""Request analysis helpers for LLM-powered MemoLink features."""

from __future__ import annotations

import json
import logging
import re
from collections import deque

from .prompts import ANALYSER_PROMPT, MODES

logger = logging.getLogger(__name__)

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def default_analysis() -> dict:
    return {
        "intent": "general question",
        "mode": "general_chat",
        "needs_retrieval": True,
        "needs_web": False,
        "needs_clarification": False,
        "clarifying_question": None,
        "optimized_task": "",
        "retrieval_queries": [],
        "required_context_types": [],
        "output_format": "detailed answer",
        "quality_checks": [],
    }


def analyse_request(user_text: str, client, model: str, history: list[dict] | None = None) -> dict:
    """Run the lightweight intent/mode analyser with a safe fallback.

    Pass recent conversation turns via `history` so the analyser can resolve
    referential messages ("how about X?", "what best between them?") without
    incorrectly triggering needs_clarification.
    """
    try:
        # Include up to the last 6 user/assistant turns (trimmed) so the analyser
        # has enough context to understand pronouns and follow-up references.
        # Exclude the final user turn — it's the same text as user_text and would
        # be duplicated. Use a deque to avoid materialising the full history list.
        context_turns: list[dict] = []
        if history:
            bucket: deque[dict] = deque(maxlen=6)
            for m in history:
                role = m.get("role")
                if role not in ("user", "assistant"):
                    continue
                # Skip the last user message to avoid duplicating user_text below.
                if role == "user" and (m.get("content") or "").strip() == user_text.strip():
                    continue
                bucket.append(m)
            for m in bucket:
                raw_content = (m.get("content") or "")
                content = raw_content[:300] + ("…" if len(raw_content) > 300 else "")
                context_turns.append({"role": m["role"], "content": content})

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": ANALYSER_PROMPT},
                *context_turns,
                {"role": "user", "content": user_text},
            ],
            temperature=0,
            max_tokens=600,
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S).strip()
        match = _JSON_RE.search(raw)
        if match:
            raw = match.group(0)
        data = json.loads(raw)
        if data.get("mode") not in MODES:
            data["mode"] = "general_chat"
        return data
    except Exception as exc:
        logger.debug("Smart engine analyser failed (non-fatal): %s", exc)
        return default_analysis()
