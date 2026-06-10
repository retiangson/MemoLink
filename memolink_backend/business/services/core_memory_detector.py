"""AI-powered detector that extracts useful persistent facts from user messages.

Blocked values (never stored): CVV/CVC, PIN, full passwords, API keys, access
tokens, private keys, seed phrases, OTPs, and recovery codes.

Allowed values: names, email addresses, physical addresses, partial card
references (last 4 digits only), project names, preferences, general context.
"""
from __future__ import annotations

import json
import logging
import re

from openai import OpenAI

from memolink_backend.core.config import settings

logger = logging.getLogger(__name__)

_STRUCTURED_MEMORY_FIELD_RE = re.compile(
    r"(?is)\b(address|birthdate|date of birth|phone number|mobile number|email|student id|student number)\s*:\s*(.+?)(?=(?:\b(?:address|birthdate|date of birth|phone number|mobile number|email|student id|student number)\s*:)|$)"
)

_DETECT_SYSTEM = """You are a privacy-aware memory extractor for an AI assistant.

Extract **only genuinely useful, long-term facts** from the user's message.
Return a JSON object: {"memories": [...]} where each item has:
  - "title": short label (max 60 chars)
  - "memory_type": one of: person | contact | project | card | credential | preference | general
  - "sensitivity_level": one of: low | medium | high
  - "plaintext_value": the actual value to store encrypted (null if not sensitive / not available)
  - "masked_display": safe display string, e.g. "Card ending ****1234" or the name itself
  - "searchable_metadata": safe plaintext for embeddings — NEVER include full card numbers, passwords, keys, tokens, or PINs

**BLOCK and never store** (return empty memories list if only these are present):
  - CVV, CVC, card security codes
  - PIN numbers
  - Passwords or passphrases
  - API keys, access tokens, bearer tokens
  - Private keys, seed phrases, recovery codes
  - One-time passwords (OTPs)

**Examples of GOOD memories:**
  - User mentions their name → {title: "User name", memory_type: "person", sensitivity_level: "low", plaintext_value: null, masked_display: "Alex Johnson", searchable_metadata: "name: Alex Johnson"}
  - User mentions a project → {title: "Current project", memory_type: "project", sensitivity_level: "low", plaintext_value: null, masked_display: "Project Phoenix - mobile app", searchable_metadata: "project: Project Phoenix mobile app"}
  - User mentions last 4 of card → {title: "Visa card", memory_type: "card", sensitivity_level: "medium", plaintext_value: "last4:1234 Visa", masked_display: "Visa card ending ****1234", searchable_metadata: "visa card last four 1234"}

Return {"memories": []} if nothing worth remembering is found.
Never invent or hallucinate facts not present in the message."""


class CoreMemoryDetector:
    def __init__(self) -> None:
        self._client = OpenAI(api_key=settings.openai_api_key)

    @staticmethod
    def _heuristic_structured_memories(user_message: str) -> list[dict]:
        if ":" not in user_message:
            return []

        found: list[dict] = []
        seen_titles: set[str] = set()
        for match in _STRUCTURED_MEMORY_FIELD_RE.finditer(user_message):
            raw_label = " ".join(match.group(1).strip().lower().split())
            raw_value = " ".join(match.group(2).strip().split()).strip(" ,;")
            if not raw_value:
                continue

            if raw_label == "address":
                title = "Address"
                payload = {
                    "title": title,
                    "memory_type": "contact",
                    "sensitivity_level": "low",
                    "plaintext_value": None,
                    "masked_display": raw_value,
                    "searchable_metadata": f"address {raw_value}",
                }
            elif raw_label in {"birthdate", "date of birth"}:
                title = "Birthdate"
                payload = {
                    "title": title,
                    "memory_type": "general",
                    "sensitivity_level": "low",
                    "plaintext_value": None,
                    "masked_display": raw_value,
                    "searchable_metadata": f"birthdate {raw_value}",
                }
            elif raw_label in {"phone number", "mobile number"}:
                title = "Phone Number"
                payload = {
                    "title": title,
                    "memory_type": "contact",
                    "sensitivity_level": "low",
                    "plaintext_value": None,
                    "masked_display": raw_value,
                    "searchable_metadata": f"phone number {raw_value}",
                }
            elif raw_label == "email":
                title = "Email Address"
                payload = {
                    "title": title,
                    "memory_type": "contact",
                    "sensitivity_level": "low",
                    "plaintext_value": None,
                    "masked_display": raw_value,
                    "searchable_metadata": f"email {raw_value}",
                }
            elif raw_label in {"student id", "student number"}:
                digits = "".join(ch for ch in raw_value if ch.isdigit())
                last4 = digits[-4:] if len(digits) >= 4 else digits
                title = "Student Number" if raw_label == "student number" else "Student ID"
                payload = {
                    "title": title,
                    "memory_type": "credential",
                    "sensitivity_level": "medium",
                    "plaintext_value": raw_value if len(digits) >= 6 else None,
                    "masked_display": f"{title} ending in {last4}" if last4 else raw_value,
                    "searchable_metadata": f"{title.lower()} ending in {last4}" if last4 else title.lower(),
                }
            else:
                continue

            if title in seen_titles:
                continue
            seen_titles.add(title)
            found.append(payload)

        return found

    def detect(self, user_message: str) -> list[dict]:
        """Return list of detected memory dicts (may be empty)."""
        if not user_message or len(user_message.strip()) < 10:
            return []
        heuristic = self._heuristic_structured_memories(user_message)
        if len(heuristic) >= 2:
            return heuristic
        try:
            resp = self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": _DETECT_SYSTEM},
                    {"role": "user", "content": user_message[:2000]},
                ],
                response_format={"type": "json_object"},
                max_tokens=800,
                temperature=0,
            )
            raw = resp.choices[0].message.content or "{}"
            data = json.loads(raw)
            memories = data.get("memories", [])
            if not isinstance(memories, list):
                memories = []
            llm_memories = [m for m in memories if isinstance(m, dict) and m.get("title")]
            if heuristic:
                existing_titles = {m.get("title") for m in heuristic}
                llm_memories = [m for m in llm_memories if m.get("title") not in existing_titles]
                return heuristic + llm_memories
            return llm_memories
        except Exception:
            logger.debug("CoreMemoryDetector.detect failed silently", exc_info=True)
            return heuristic
