from __future__ import annotations

import json
import logging
import re
from typing import Any

from openai import OpenAI

from memolink_backend.core.config import settings
from memolink_backend.utils.file_extractor import transcribe_audio_detailed

logger = logging.getLogger(__name__)


class TranscriptionService:
    def transcribe_upload(
        self,
        *,
        file_bytes: bytes,
        filename: str,
        language: str | None = None,
        backend: str = "auto",
        mode: str = "default",
        prompt_context: str | None = None,
    ) -> dict[str, Any]:
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "webm"
        result = transcribe_audio_detailed(
            file_bytes,
            filename,
            ext,
            language,
            backend=backend,
            mode=mode,
            prompt_context=prompt_context,
        )
        text = str(result["text"])
        return {
            "text": text,
            "cleaned_text": self._cleanup_chunk(text, mode=mode),
            "service_used": result["service_used"],
            "fallback_used": bool(result.get("fallback_used")),
            "mode": mode,
            "backend_requested": backend,
        }

    def finalize_lecture(self, transcript_text: str, *, language: str | None = None) -> dict[str, Any]:
        clean = self._cleanup_lecture_transcript(transcript_text)
        if not clean:
            return {
                "cleaned_transcript": "",
                "summary": "",
                "action_items": [],
                "key_topics": [],
                "title_suggestion": "Lecture Notes",
            }

        prompt = (
            "You are a lecture note cleanup assistant. "
            "Return ONLY valid JSON with these keys: "
            "title_suggestion (string), summary (string), action_items (array of strings), key_topics (array of strings), "
            "cleaned_transcript (string). "
            "Keep the transcript faithful to the recording, just improve punctuation, paragraphing, and obvious filler. "
            "Do not invent facts. If there are no action items, return an empty array."
        )
        user = (
            f"Language hint: {language or 'auto'}\n\n"
            f"Transcript:\n{clean[:18000]}"
        )
        try:
            client = OpenAI(api_key=settings.openai_api_key)
            resp = client.chat.completions.create(
                model=settings.openai_chat_model,
                temperature=0.2,
                max_tokens=2200,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_object"},
            )
            raw = (resp.choices[0].message.content or "").strip()
            data = json.loads(raw)
        except Exception as exc:
            logger.warning("Lecture transcript cleanup/summary generation failed, using raw transcript: %s", exc)
            data = {}

        cleaned_transcript = self._cleanup_lecture_transcript(str(data.get("cleaned_transcript") or clean))
        summary = self._cleanup_spacing(str(data.get("summary") or ""))
        action_items = [
            self._cleanup_spacing(str(item))
            for item in (data.get("action_items") or [])
            if str(item).strip()
        ]
        key_topics = [
            self._cleanup_spacing(str(item))
            for item in (data.get("key_topics") or [])
            if str(item).strip()
        ]
        title_suggestion = self._cleanup_spacing(str(data.get("title_suggestion") or "Lecture Notes")) or "Lecture Notes"
        return {
            "cleaned_transcript": cleaned_transcript,
            "summary": summary,
            "action_items": action_items,
            "key_topics": key_topics,
            "title_suggestion": title_suggestion,
        }

    def _cleanup_chunk(self, text: str, *, mode: str) -> str:
        base = self._cleanup_spacing(text)
        if mode != "lecture":
            return base
        return re.sub(r"(?<!\n)\n(?!\n)", " ", base)

    def _cleanup_lecture_transcript(self, text: str) -> str:
        normalized = self._cleanup_spacing(text)
        if not normalized:
            return ""
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", normalized) if p.strip()]
        return "\n\n".join(paragraphs)

    def _cleanup_spacing(self, text: str) -> str:
        if not text:
            return ""
        cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
        cleaned = re.sub(r"[ \t]+", " ", cleaned)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned.strip()
