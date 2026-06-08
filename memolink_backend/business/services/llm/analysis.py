"""Request analysis helpers for LLM-powered MemoLink features."""

from __future__ import annotations

import json
import logging
import re

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


def analyse_request(user_text: str, client, model: str) -> dict:
    """Run the lightweight intent/mode analyser with a safe fallback."""
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": ANALYSER_PROMPT},
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
