import base64
import hashlib
from cryptography.fernet import Fernet
from memolink_backend.core.config import settings


def _get_fernet() -> Fernet:
    raw = settings.encryption_key if settings.encryption_key else settings.jwt_secret_key
    key_bytes = hashlib.sha256(raw.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt_text(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_text(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()
