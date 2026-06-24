"""Core Memory service — manages encrypted persistent memory notes.

Security contract:
  - encrypted_content is NEVER sent to the LLM or included in API responses
    unless the vault is unlocked via a valid 10-minute unlock_token.
  - searchable_content / masked_content are safe for embedding and display.
  - Unlock tokens are short-lived JWTs (10 min), verified on every reveal call.
  - Cross-user access is blocked at the repository query level.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
import json

import jwt
from fastapi import HTTPException
import re

from memolink_backend.business.services.core_memory_detector import CoreMemoryDetector
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.contracts.core_memory_dtos import (
    CoreMemoryCreateDTO,
    CoreMemoryResponseDTO,
    CoreMemoryUnlockResponse,
    CoreMemoryUpdateDTO,
)
from memolink_backend.core.config import settings
from memolink_backend.core.core_memory_encryption import decrypt_memory, encrypt_memory
from memolink_backend.core.security import verify_password
from memolink_backend.domain.interfaces.i_note_repository import INoteRepository
from memolink_backend.domain.interfaces.i_user_repository import IUserRepository

logger = logging.getLogger(__name__)

_UNLOCK_PURPOSE = "core_memory_unlock"
_UNLOCK_MINUTES = 10

_BLOCKED_TYPES = {"cvv", "cvc", "pin", "password", "api_key", "token", "private_key", "seed_phrase", "otp", "recovery_code"}
_CORE_MEMORY_SEARCH_STOP_WORDS = {
    "a", "an", "and", "at", "bank", "card", "do", "for", "give", "have", "i", "id", "is", "it",
    "key", "me", "my", "number", "of", "please", "reveal", "secret", "show", "tell", "the", "to",
    "token", "what", "whats", "with",
}
_DISCLOSURE_QUERY_RE = re.compile(
    r"\b(?:what(?:'s|\s+is)?|show|tell|give|reveal|display|find|remember)\b.{0,30}\bmy\b",
    re.IGNORECASE,
)
_LONG_DIGIT_RE = re.compile(r"\b\d(?:[\d\s-]{4,}\d)\b")
_LONG_TOKEN_RE = re.compile(r"\b[A-Za-z0-9_-]{16,}\b")
_EMAIL_RE = re.compile(r"\b([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b")
_FIRST_N_RE = re.compile(r"\bfirst\s+(\d{1,2})\s+(digit|digits|character|characters|char|chars|letter|letters)\b", re.IGNORECASE)
_LAST_N_RE = re.compile(r"\b(?:last|final)\s+(\d{1,2})\s+(digit|digits|character|characters|char|chars|letter|letters)\b", re.IGNORECASE)
_RELATION_NAME_RE = re.compile(
    r"\bwhat(?:'s|\s+is)?\s+my\s+(mother|father|mom|mum|brother|sister|wife|husband|spouse|partner|girlfriend|boyfriend|advisor|supervisor|teacher|lecturer)(?:'s)?\s+(?:first|last|middle|full\s+)?name\b",
    re.IGNORECASE,
)
_FAVORITE_RE = re.compile(
    r"\b(?:what(?:'s|\s+is)?|what\s+about|how\s+about|do\s+you\s+know)\s+my\s+favorite\s+([a-z0-9][a-z0-9\s-]{1,40})\b",
    re.IGNORECASE,
)
_PERSONAL_SUBJECT_RE = re.compile(
    r"\bwhat(?:'s|\s+is| are)?\s+my\s+(student id|student number|email(?: address)?|phone(?: number)?|mobile(?: number)?|address|birthday|date of birth|home town|hometown|university|school|company|job title|occupation|account number|card number)\b",
    re.IGNORECASE,
)
_PERSONAL_SLICE_RE = re.compile(
    r"\b(?:what(?:'s|\s+is| are)?|show|tell|give|reveal|find)\b.*\b(?:first|last|final)\s+\d{1,2}\s+(?:digit|digits|character|characters|char|chars|letter|letters)\s+of\s+my\s+"
    r"(student id|student number|email(?: address)?|phone(?: number)?|mobile(?: number)?|address|birthday|date of birth|home town|hometown|university|school|company|job title|occupation|account number|card number)\b",
    re.IGNORECASE,
)


class CoreMemoryService:
    def __init__(
        self,
        note_repo: INoteRepository,
        user_repo: Optional[IUserRepository],
        embedding_service: EmbeddingService,
    ) -> None:
        self._notes = note_repo
        self._users = user_repo
        self._embedding = embedding_service
        self._detector = CoreMemoryDetector()

    @staticmethod
    def _normalize_text(value: str | None) -> str:
        if not value:
            return ""
        return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in value).split())

    @classmethod
    def _tokenize_query(cls, text: str | None) -> list[str]:
        normalized = cls._normalize_text(text)
        if not normalized:
            return []
        seen: set[str] = set()
        tokens: list[str] = []
        for token in normalized.split():
            if len(token) < 3 or token in _CORE_MEMORY_SEARCH_STOP_WORDS or token in seen:
                continue
            seen.add(token)
            tokens.append(token)
        return tokens

    @staticmethod
    def _mask_long_digit_sequences(text: str) -> str:
        def repl(match: re.Match[str]) -> str:
            raw = match.group(0)
            digits = "".join(ch for ch in raw if ch.isdigit())
            if len(digits) < 6:
                return raw
            return f"****{digits[-4:]}"

        return _LONG_DIGIT_RE.sub(repl, text)

    @staticmethod
    def _mask_email_addresses(text: str) -> str:
        def repl(match: re.Match[str]) -> str:
            domain = match.group(2)
            return f"email ending in @{domain}"

        return _EMAIL_RE.sub(repl, text)

    @classmethod
    def _sanitize_searchable_text(
        cls,
        *,
        title: str,
        masked_display: str | None,
        searchable_metadata: str | None,
        plaintext_value: str | None,
        memory_type: str | None,
    ) -> str:
        raw = (searchable_metadata or masked_display or title or "").strip()
        masked = (masked_display or "").strip()
        plaintext = (plaintext_value or "").strip()

        if plaintext and raw:
            raw = raw.replace(plaintext, masked or title)
            raw = raw.replace(plaintext.lower(), masked or title)

        raw = cls._mask_email_addresses(raw)
        raw = cls._mask_long_digit_sequences(raw)
        raw = _LONG_TOKEN_RE.sub("secure reference", raw)
        raw = re.sub(r"\s{2,}", " ", raw).strip(" ,:-")

        parts = [title.strip()]
        if memory_type and memory_type not in title.lower():
            parts.append(memory_type.replace("_", " "))
        if masked:
            parts.append(cls._mask_email_addresses(cls._mask_long_digit_sequences(masked)))
        if raw:
            parts.append(raw)

        safe = " | ".join(part for part in parts if part).strip()
        return safe[:500]

    def _score_memory_match(self, query_text: str, note) -> float:
        normalized_query = self._normalize_text(query_text)
        if not normalized_query:
            return 0.0
        query_terms = self._tokenize_query(query_text)
        title = self._normalize_text(getattr(note, "title", None))
        masked = self._normalize_text(getattr(note, "masked_content", None))
        searchable = self._normalize_text(getattr(note, "searchable_content", None))
        combined = " ".join(part for part in (title, masked, searchable) if part)
        if not combined:
            return 0.0

        score = 0.0
        if title and title in normalized_query:
            score += 5.0
        if title and normalized_query in title:
            score += 6.0
        if searchable and normalized_query in searchable:
            score += 4.0
        if masked and normalized_query in masked:
            score += 3.0

        title_hits = sum(1 for token in query_terms if token in title)
        searchable_hits = sum(1 for token in query_terms if token in searchable)
        masked_hits = sum(1 for token in query_terms if token in masked)
        score += title_hits * 2.5
        score += searchable_hits * 1.75
        score += masked_hits * 1.25

        if query_terms:
            coverage = (title_hits + searchable_hits + masked_hits) / max(len(query_terms), 1)
            score += coverage
        return score

    def _targeted_memories_for_query(self, memories: list, query_text: str) -> tuple[list, bool]:
        query = query_text or ""
        target_terms: list[str] = []

        favorite_match = _FAVORITE_RE.search(query)
        if favorite_match:
            target_terms = self._tokenize_query(favorite_match.group(1))
        else:
            relation_match = _RELATION_NAME_RE.search(query)
            if relation_match:
                target_terms = self._tokenize_query(relation_match.group(1))
            else:
                personal_match = _PERSONAL_SUBJECT_RE.search(query) or _PERSONAL_SLICE_RE.search(query)
                if personal_match:
                    target_terms = self._tokenize_query(personal_match.group(1))

        if not target_terms:
            return memories, False

        targeted: list = []
        for note in memories:
            combined = " ".join(
                part for part in (
                    self._normalize_text(getattr(note, "title", None)),
                    self._normalize_text(getattr(note, "masked_content", None)),
                    self._normalize_text(getattr(note, "searchable_content", None)),
                ) if part
            )
            if all(term in combined for term in target_terms):
                targeted.append(note)
        return targeted, True

    @staticmethod
    def _information_score(*values: str | None) -> int:
        score = 0
        for value in values:
            if not value:
                continue
            cleaned = value.strip()
            if not cleaned:
                continue
            score += len(cleaned)
            score += len(cleaned.split()) * 8
        return score

    @staticmethod
    def _looks_like_explicit_memory_query(query_text: str) -> bool:
        query = (query_text or "").strip()
        if not query:
            return False
        lower = query.lower()
        return any(
            pattern.search(query)
            for pattern in (
                _DISCLOSURE_QUERY_RE,
                _RELATION_NAME_RE,
                _FAVORITE_RE,
                _PERSONAL_SUBJECT_RE,
                _PERSONAL_SLICE_RE,
            )
        ) or "who am i" in lower

    @staticmethod
    def _title_case_label(text: str) -> str:
        return " ".join(part.capitalize() for part in text.strip().split())

    def infer_missing_memory(self, query_text: str) -> dict | None:
        query = (query_text or "").strip()
        lower = query.lower()
        if not query:
            return None

        match = _RELATION_NAME_RE.search(query)
        if match:
            relation = match.group(1).strip().lower()
            relation_label = self._title_case_label(relation)
            return {
                "title": f"{relation_label} name",
                "memory_type": "person",
                "sensitivity_level": "low",
                "prompt_question": f"I don't know your {relation}'s name yet. What is your {relation}'s name?",
                "confirmation_subject": f"your {relation}'s name",
                "expects": "name",
            }

        match = _FAVORITE_RE.search(query)
        if match:
            thing = " ".join(match.group(1).strip().split())
            thing_label = self._title_case_label(thing)
            return {
                "title": f"Favorite {thing_label}",
                "memory_type": "preference",
                "sensitivity_level": "low",
                "prompt_question": f"I don't know your favorite {thing} yet. What is your favorite {thing}?",
                "confirmation_subject": f"your favorite {thing}",
                "expects": "value",
            }

        if "what is my name" in lower or "who am i" in lower or "what's my name" in lower:
            return {
                "title": "User name",
                "memory_type": "person",
                "sensitivity_level": "low",
                "prompt_question": "I don't know your full name yet. What is your full name?",
                "confirmation_subject": "your name",
                "expects": "name",
            }

        match = _PERSONAL_SUBJECT_RE.search(query)
        if match:
            subject = " ".join(match.group(1).strip().split())
            title = self._title_case_label(subject)
            lower_subject = subject.lower()
            memory_type = "credential" if any(token in lower_subject for token in ("id", "number", "card", "account")) else "contact" if any(token in lower_subject for token in ("email", "phone", "mobile", "address")) else "general"
            sensitivity = "medium" if memory_type == "credential" else "low"
            return {
                "title": title,
                "memory_type": memory_type,
                "sensitivity_level": sensitivity,
                "prompt_question": f"I don't know {subject} yet. What is {subject}?",
                "confirmation_subject": f"your {subject}",
                "expects": "value",
            }
        return None

    @staticmethod
    def memory_prompt_marker(spec: dict) -> str:
        safe = {
            "title": spec.get("title"),
            "memory_type": spec.get("memory_type"),
            "sensitivity_level": spec.get("sensitivity_level"),
            "confirmation_subject": spec.get("confirmation_subject"),
            "expects": spec.get("expects"),
        }
        return f"<!--MEMORY_PROMPT:{json.dumps(safe, separators=(',', ':'))}-->"

    @staticmethod
    def _normalize_memory_answer_text(answer_text: str, spec: dict) -> str:
        value = (answer_text or "").strip()
        value = re.sub(r"^[\s\"'`]+|[\s\"'`]+$", "", value)
        value = re.sub(r"^(?:it is|it's|its|they are|they're|the answer is)\s+", "", value, flags=re.IGNORECASE)
        confirmation_subject = (spec.get("confirmation_subject") or "").lower()
        if confirmation_subject:
            escaped = re.escape(confirmation_subject)
            value = re.sub(rf"^(?:my|the)?\s*{escaped}\s+(?:is|are)\s+", "", value, flags=re.IGNORECASE)
        if spec.get("expects") == "name":
            value = re.sub(r"^(?:his|her|their)\s+name\s+is\s+", "", value, flags=re.IGNORECASE)
        return value.strip(" .,!?:;")

    def save_memory_from_spec(
        self,
        *,
        user_id: int,
        workspace_id: int | None,
        spec: dict,
        answer_text: str,
    ) -> dict | None:
        return self.store_prompted_memory_answer(
            user_id=user_id,
            workspace_id=workspace_id,
            spec=spec,
            answer_text=answer_text,
        )

    def store_prompted_memory_answer(
        self,
        *,
        user_id: int,
        workspace_id: int | None,
        spec: dict,
        answer_text: str,
    ) -> dict | None:
        value = self._normalize_memory_answer_text(answer_text, spec)
        if not value:
            return None

        title = str(spec.get("title") or "").strip()
        if not title:
            return None
        memory_type = str(spec.get("memory_type") or "general").strip().lower()
        sensitivity = str(spec.get("sensitivity_level") or "low").strip().lower()
        subject = str(spec.get("confirmation_subject") or title.lower()).strip()

        digits = self._digits_only(value)
        is_sensitive_numeric = memory_type == "credential" and len(digits) >= 6
        plaintext_value = value if is_sensitive_numeric else None
        masked_display = value
        searchable_metadata = f"{subject} {value}".strip()
        if is_sensitive_numeric:
            last4 = digits[-4:] if len(digits) >= 4 else digits
            masked_display = f"{self._title_case_label(subject)} ending in {last4}"
            searchable_metadata = f"{subject} ending in {last4}".strip()

        existing = self._notes.get_core_memory_by_title(user_id, title, workspace_id)
        if existing:
            updated = self._notes.update_core_memory(
                note_id=existing.id,
                title=title,
                memory_type=memory_type,
                sensitivity_level=sensitivity,
                masked_content=masked_display,
                searchable_content=self._sanitize_searchable_text(
                    title=title,
                    masked_display=masked_display,
                    searchable_metadata=searchable_metadata,
                    plaintext_value=plaintext_value,
                    memory_type=memory_type,
                ),
            )
            note = updated or existing
        else:
            note = self._notes.create_core_memory(
                user_id=user_id,
                title=title,
                content=masked_display,
                memory_type=memory_type,
                sensitivity_level=sensitivity,
                encrypted_content=encrypt_memory(plaintext_value) if plaintext_value else None,
                masked_content=masked_display,
                searchable_content=self._sanitize_searchable_text(
                    title=title,
                    masked_display=masked_display,
                    searchable_metadata=searchable_metadata,
                    plaintext_value=plaintext_value,
                    memory_type=memory_type,
                ),
                memory_source="ai_detected",
                memory_confidence=0.95,
                memory_created_by="prompted_memory",
                workspace_id=workspace_id,
            )

        try:
            vec = self._embedding.embed_text(f"{note.title}\n{note.searchable_content or ''}")
            self._notes.save_embedding(note.id, vec)
        except Exception as exc:
            logger.warning("Failed to embed prompted core memory %s: %s", note.id, exc)

        return {
            "note": note,
            "display_value": masked_display,
            "subject": subject,
            "stored_plaintext": plaintext_value is not None,
        }

    def _should_upgrade_existing_memory(
        self,
        existing,
        *,
        title: str,
        masked_display: str,
        searchable_metadata: str,
        sensitivity_level: str,
        memory_type: str,
    ) -> bool:
        existing_score = self._information_score(
            getattr(existing, "title", None),
            getattr(existing, "masked_content", None),
            getattr(existing, "searchable_content", None),
        )
        candidate_score = self._information_score(title, masked_display, searchable_metadata)

        if candidate_score > existing_score + 8:
            return True

        existing_masked = (getattr(existing, "masked_content", None) or "").strip()
        if masked_display and masked_display.strip() and len(masked_display.split()) > len(existing_masked.split()):
            return True

        if (
            sensitivity_level
            and getattr(existing, "sensitivity_level", None) in (None, "", "low")
            and sensitivity_level != getattr(existing, "sensitivity_level", None)
        ):
            return True

        if (
            memory_type
            and getattr(existing, "memory_type", None) in (None, "", "general")
            and memory_type != getattr(existing, "memory_type", None)
        ):
            return True

        return False

    def find_relevant_memory(self, user_id: int, workspace_id: int | None, query_text: str):
        if not query_text.strip():
            return None
        if not self._looks_like_explicit_memory_query(query_text):
            return None

        memories = self._notes.get_core_memories(user_id, workspace_id)
        if not memories:
            return None

        targeted_memories, had_specific_target = self._targeted_memories_for_query(memories, query_text)
        if had_specific_target and not targeted_memories:
            return None
        memories = targeted_memories or memories

        scored = sorted(
            ((self._score_memory_match(query_text, note), note) for note in memories),
            key=lambda item: item[0],
            reverse=True,
        )
        best_score, best_note = scored[0]
        if best_score < 3.0:
            return None
        return best_note

    @staticmethod
    def _name_tokens(value: str | None) -> list[str]:
        if not value:
            return []
        return [token for token in value.strip().split() if token]

    @staticmethod
    def _subject_phrase(note) -> str:
        title = (getattr(note, "title", None) or "memory").strip()
        lower = title.lower()
        replacements = (
            ("user ", "your "),
            ("mother ", "your mother's "),
            ("father ", "your father's "),
            ("mum ", "your mum's "),
            ("mom ", "your mom's "),
            ("student ", "your student "),
            ("email ", "your email "),
            ("phone ", "your phone "),
        )
        for old, new in replacements:
            if lower.startswith(old):
                return new + title[len(old):].strip().lower()
        if lower.startswith("my "):
            return "your " + title[3:].strip().lower()
        return f"your {title.lower()}"

    @staticmethod
    def _name_owner_phrase(note) -> str:
        title = (getattr(note, "title", None) or "").strip().lower()
        if title == "user name" or title == "name":
            return "your"
        if title.endswith(" name"):
            title = title[:-5].strip()
        if title.startswith("mother"):
            return "your mother's"
        if title.startswith("father"):
            return "your father's"
        if title.startswith("mum"):
            return "your mum's"
        if title.startswith("mom"):
            return "your mom's"
        if title.startswith("my "):
            return f"your {title[3:].strip()}'s"
        if title:
            return f"your {title}'s"
        return "your"

    @staticmethod
    def _digits_only(value: str) -> str:
        return "".join(ch for ch in value if ch.isdigit())

    @staticmethod
    def _letters_only(value: str) -> str:
        return "".join(ch for ch in value if ch.isalpha())

    @staticmethod
    def _initials(tokens: list[str]) -> str:
        return "".join(token[0].upper() for token in tokens if token)

    def format_memory_answer(
        self,
        *,
        query_text: str,
        note,
        revealed_value: str | None = None,
    ) -> str:
        value = (revealed_value or getattr(note, "masked_content", None) or getattr(note, "title", None) or "").strip()
        title = (getattr(note, "title", None) or "Core Memory").strip()
        memory_type = (getattr(note, "memory_type", None) or "").strip().lower()
        query = query_text.lower()
        subject = self._subject_phrase(note)
        name_tokens = self._name_tokens(value)
        digits = self._digits_only(value)
        letters = self._letters_only(value)
        email_match = _EMAIL_RE.search(value)

        is_name_memory = memory_type == "person" and "name" in title.lower()
        if is_name_memory and value:
            owner = self._name_owner_phrase(note)
            if "first name" in query or "given name" in query:
                if name_tokens:
                    return f"{owner.capitalize()} first name is {name_tokens[0]}."
            if "last name" in query or "surname" in query or "family name" in query:
                if len(name_tokens) >= 2:
                    return f"{owner.capitalize()} last name is {name_tokens[-1]}."
                return "I only have a single name stored for you right now."
            if "middle name" in query or "middle names" in query:
                if len(name_tokens) >= 3:
                    return f"{owner.capitalize()} middle name is {' '.join(name_tokens[1:-1])}."
                return "I do not have a separate middle name stored for you."
            if "initial" in query:
                initials = self._initials(name_tokens)
                if initials:
                    return f"{owner.capitalize()} initials are {initials}."
            if "full name" in query or "complete name" in query:
                return f"{owner.capitalize()} full name is {value}."
            if "what is my name" in query or "who am i" in query:
                return f"{owner.capitalize()} name is {value}."
            return f"You told me {owner} name is {value}."

        first_n = _FIRST_N_RE.search(query)
        if first_n:
            count = int(first_n.group(1))
            unit = first_n.group(2).lower()
            if "digit" in unit and digits:
                return f"The first {count} digits of {subject} are {digits[:count]}."
            if ("character" in unit or "char" in unit) and value:
                return f"The first {count} characters of {subject} are {value[:count]}."
            if "letter" in unit and letters:
                return f"The first {count} letters of {subject} are {letters[:count]}."

        last_n = _LAST_N_RE.search(query)
        if last_n:
            count = int(last_n.group(1))
            unit = last_n.group(2).lower()
            if "digit" in unit and digits:
                return f"The last {count} digits of {subject} are {digits[-count:]}."
            if ("character" in unit or "char" in unit) and value:
                return f"The last {count} characters of {subject} are {value[-count:]}."
            if "letter" in unit and letters:
                return f"The last {count} letters of {subject} are {letters[-count:]}."

        if email_match:
            local_part, domain = email_match.group(1), email_match.group(2)
            if "domain" in query:
                return f"The domain for {subject} is {domain}."
            if "username" in query or "local part" in query:
                return f"The username for {subject} is {local_part}."

        if "initial" in query and name_tokens:
            initials = self._initials(name_tokens)
            if initials:
                return f"{subject.capitalize()} initials are {initials}."

        if getattr(note, "is_encrypted", False) and revealed_value:
            return f"{subject.capitalize()} is: `{value}`"

        if memory_type == "person":
            return f"You told me {subject} is {value}."

        return f"{subject.capitalize()} is {value}."

    # ── Unlock / lock ─────────────────────────────────────────────────────────

    def unlock(self, user_id: int, password: str) -> CoreMemoryUnlockResponse:
        if self._users is None:
            raise HTTPException(status_code=500, detail="User repository not available")
        user = self._users.get_by_id(user_id)
        if not user or not verify_password(password, user.password):
            raise HTTPException(status_code=401, detail="Incorrect password")
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_UNLOCK_MINUTES)
        payload = {
            "sub": str(user_id),
            "purpose": _UNLOCK_PURPOSE,
            "exp": expires_at,
        }
        token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
        return CoreMemoryUnlockResponse(unlock_token=token, expires_at=expires_at)

    def _verify_unlock_token(self, token: str, user_id: int) -> None:
        try:
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Vault token expired — please unlock again")
        except (jwt.InvalidTokenError, KeyError):
            raise HTTPException(status_code=401, detail="Invalid vault token")
        if payload.get("purpose") != _UNLOCK_PURPOSE:
            raise HTTPException(status_code=401, detail="Invalid vault token")
        if int(payload["sub"]) != user_id:
            raise HTTPException(status_code=403, detail="Token user mismatch")

    # ── List ──────────────────────────────────────────────────────────────────

    def list_memories(self, user_id: int, workspace_id: Optional[int]) -> list[CoreMemoryResponseDTO]:
        memories = self._notes.get_core_memories(user_id, workspace_id)
        return [CoreMemoryResponseDTO.model_validate(m) for m in memories]

    # ── Create ────────────────────────────────────────────────────────────────

    def create_memory(self, user_id: int, dto: CoreMemoryCreateDTO) -> CoreMemoryResponseDTO:
        encrypted = encrypt_memory(dto.plaintext_value) if dto.plaintext_value else None
        masked = dto.masked_display or dto.title
        searchable = self._sanitize_searchable_text(
            title=dto.title,
            masked_display=masked,
            searchable_metadata=dto.searchable_metadata,
            plaintext_value=dto.plaintext_value,
            memory_type=dto.memory_type,
        )
        note = self._notes.create_core_memory(
            user_id=user_id,
            title=dto.title,
            content=masked,
            memory_type=dto.memory_type,
            sensitivity_level=dto.sensitivity_level,
            encrypted_content=encrypted,
            masked_content=masked,
            searchable_content=searchable,
            memory_source="manual",
            memory_confidence=1.0,
            memory_created_by="user",
            workspace_id=dto.workspace_id,
        )
        try:
            vec = self._embedding.embed_text(f"{dto.title}\n{searchable}")
            self._notes.save_embedding(note.id, vec)
        except Exception as exc:
            logger.warning("Failed to embed core memory %s: %s", note.id, exc)
        return CoreMemoryResponseDTO.model_validate(note)

    # ── Update ────────────────────────────────────────────────────────────────

    def update_memory(self, user_id: int, memory_id: int, dto: CoreMemoryUpdateDTO) -> CoreMemoryResponseDTO:
        note = self._notes.get_core_memory_by_id(memory_id, user_id)
        if not note:
            raise HTTPException(status_code=404, detail="Core memory not found")
        masked = dto.masked_display if dto.masked_display is not None else note.masked_content
        searchable = self._sanitize_searchable_text(
            title=dto.title or note.title or "",
            masked_display=masked,
            searchable_metadata=dto.searchable_metadata,
            plaintext_value=None,
            memory_type=dto.memory_type or note.memory_type,
        )
        updated = self._notes.update_core_memory(
            note_id=memory_id,
            title=dto.title,
            memory_type=dto.memory_type,
            sensitivity_level=dto.sensitivity_level,
            masked_content=masked,
            searchable_content=searchable,
        )
        if updated and searchable:
            try:
                vec = self._embedding.embed_text(f"{updated.title}\n{searchable}")
                self._notes.save_embedding(updated.id, vec)
            except Exception as exc:
                logger.warning("Failed to re-embed updated core memory %s: %s", updated.id, exc)
        return CoreMemoryResponseDTO.model_validate(updated or note)

    # ── Delete ────────────────────────────────────────────────────────────────

    def delete_memory(self, user_id: int, memory_id: int) -> bool:
        note = self._notes.get_core_memory_by_id(memory_id, user_id)
        if not note:
            raise HTTPException(status_code=404, detail="Core memory not found")
        return self._notes.delete_note(memory_id)

    # ── Reveal (decrypt) ──────────────────────────────────────────────────────

    def reveal_memory(self, user_id: int, memory_id: int, unlock_token: str) -> str:
        self._verify_unlock_token(unlock_token, user_id)
        note = self._notes.get_core_memory_by_id(memory_id, user_id)
        if not note:
            raise HTTPException(status_code=404, detail="Core memory not found")
        if not note.is_encrypted or not note.encrypted_content:
            return note.masked_content or note.title or ""
        try:
            plaintext = decrypt_memory(note.encrypted_content)
        except Exception as exc:
            logger.exception("Failed to decrypt core memory %s", memory_id)
            raise HTTPException(status_code=500, detail="Decryption failed — encryption key may have changed") from exc
        self._notes.touch_memory_last_used(memory_id)
        return plaintext

    # ── RAG context builder ───────────────────────────────────────────────────

    def build_rag_context(
        self,
        user_id: int,
        workspace_id: Optional[int],
        query_text: str,
        query_vector: list[float],
    ) -> str:
        """Return a safe context block from core memories for RAG injection.
        Never includes encrypted_content — only searchable_content / masked_content.
        """
        memories = self._notes.get_core_memories(user_id, workspace_id)
        if not memories:
            return ""
        # Simple relevance: include all memories (typically small set)
        lines: list[str] = []
        for m in memories[:20]:
            display = m.masked_content or m.title or ""
            searchable = m.searchable_content or ""
            mtype = m.memory_type or "general"
            lines.append(f"[MEMORY: {m.title} ({mtype})]\n{display}\n{searchable}".strip())
            self._notes.touch_memory_last_used(m.id)
        return "--- USER CORE MEMORY ---\n" + "\n\n".join(lines)

    # ── AI detection (fire-and-forget from chat service) ─────────────────────

    def detect_and_store(self, user_id: int, workspace_id: Optional[int], user_message: str) -> int:
        """Detect and persist useful facts from a user message. Returns count saved."""
        detected = self._detector.detect(user_message)
        if not detected:
            return 0
        saved = 0
        for item in detected:
            try:
                title = (item.get("title") or "").strip()[:200]
                mtype = (item.get("memory_type") or "general").lower()
                if not title or mtype in _BLOCKED_TYPES:
                    continue
                existing = self._notes.get_core_memory_by_title(user_id, title, workspace_id)
                plaintext = item.get("plaintext_value")
                masked = (item.get("masked_display") or title).strip()
                searchable = self._sanitize_searchable_text(
                    title=title,
                    masked_display=masked,
                    searchable_metadata=item.get("searchable_metadata"),
                    plaintext_value=plaintext,
                    memory_type=mtype,
                )
                sensitivity = (item.get("sensitivity_level") or "low").lower()
                if existing:
                    if self._should_upgrade_existing_memory(
                        existing,
                        title=title,
                        masked_display=masked,
                        searchable_metadata=searchable,
                        sensitivity_level=sensitivity,
                        memory_type=mtype,
                    ):
                        updated = self._notes.update_core_memory(
                            note_id=existing.id,
                            title=title,
                            memory_type=mtype,
                            sensitivity_level=sensitivity,
                            masked_content=masked,
                            searchable_content=searchable,
                        )
                        if updated:
                            try:
                                vec = self._embedding.embed_text(f"{updated.title}\n{searchable}")
                                self._notes.save_embedding(updated.id, vec)
                            except Exception as exc:
                                logger.warning("Failed to re-embed upgraded auto-detected memory %s: %s", updated.id, exc)
                            saved += 1
                    continue
                encrypted = encrypt_memory(plaintext) if plaintext else None
                note = self._notes.create_core_memory(
                    user_id=user_id,
                    title=title,
                    content=masked,
                    memory_type=mtype,
                    sensitivity_level=sensitivity,
                    encrypted_content=encrypted,
                    masked_content=masked,
                    searchable_content=searchable,
                    memory_source="ai_detected",
                    memory_confidence=0.85,
                    memory_created_by="gpt-4o-mini",
                    workspace_id=workspace_id,
                )
                try:
                    vec = self._embedding.embed_text(f"{title}\n{searchable}")
                    self._notes.save_embedding(note.id, vec)
                except Exception as exc:
                    logger.warning("Failed to embed auto-detected memory %s: %s", note.id, exc)
                saved += 1
            except Exception:
                logger.debug("CoreMemoryService.detect_and_store item failed", exc_info=True)
        return saved
