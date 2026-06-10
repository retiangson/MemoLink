"""Fernet-based encryption for Core Memory notes.

Uses CORE_MEMORY_ENCRYPTION_KEY (separate from the general encryption_key)
so that core memory secrets can be rotated independently.
Falls back to jwt_secret_key if the dedicated key is not configured.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from memolink_backend.core.config import settings


def _get_fernet() -> Fernet:
    raw = settings.core_memory_encryption_key or settings.jwt_secret_key
    key_bytes = hashlib.sha256(raw.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt_memory(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_memory(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()
