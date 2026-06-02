from typing import Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.user_api_key import UserApiKey
from memolink_backend.core.encryption import encrypt_text, decrypt_text


class UserApiKeyRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_all_metadata(self, user_id: int) -> list[dict]:
        """Return provider list without exposing raw keys."""
        rows = (
            self.db.query(UserApiKey)
            .filter(UserApiKey.user_id == user_id)
            .order_by(UserApiKey.created_at.asc())
            .all()
        )
        return [
            {"id": r.id, "name": r.provider, "base_url": r.base_url, "model": r.model}
            for r in rows
        ]

    def get_all_decrypted(self, user_id: int) -> dict[str, dict]:
        """Return {model_id: {key, base_url}} for use by ChatService."""
        rows = self.db.query(UserApiKey).filter(UserApiKey.user_id == user_id).all()
        result: dict[str, dict] = {}
        for row in rows:
            if not row.model:
                continue
            try:
                result[row.model] = {
                    "key": decrypt_text(row.encrypted_key),
                    "base_url": row.base_url,
                }
            except Exception:
                pass
        return result

    def get_all_decrypted_with_names(self, user_id: int) -> dict[str, dict]:
        """Return {model_id: {key, base_url, name}} — includes user-defined provider name for labelling."""
        rows = self.db.query(UserApiKey).filter(UserApiKey.user_id == user_id).all()
        result: dict[str, dict] = {}
        for row in rows:
            if not row.model:
                continue
            try:
                result[row.model] = {
                    "key": decrypt_text(row.encrypted_key),
                    "base_url": row.base_url,
                    "name": row.provider,
                }
            except Exception:
                pass
        return result

    def name_exists(self, user_id: int, name: str, exclude_id: Optional[int] = None) -> bool:
        q = self.db.query(UserApiKey).filter(
            UserApiKey.user_id == user_id,
            UserApiKey.provider == name,
        )
        if exclude_id is not None:
            q = q.filter(UserApiKey.id != exclude_id)
        return q.first() is not None

    def create(self, user_id: int, name: str, plain_key: str, base_url: Optional[str], model: str) -> UserApiKey:
        row = UserApiKey(
            user_id=user_id,
            provider=name,
            encrypted_key=encrypt_text(plain_key),
            base_url=base_url or None,
            model=model,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def update_by_id(
        self,
        user_id: int,
        record_id: int,
        name: Optional[str] = None,
        plain_key: Optional[str] = None,
        base_url: Optional[str] = None,
        clear_base_url: bool = False,
        model: Optional[str] = None,
    ) -> bool:
        row = self.db.query(UserApiKey).filter(
            UserApiKey.id == record_id,
            UserApiKey.user_id == user_id,
        ).first()
        if not row:
            return False
        if name is not None:
            row.provider = name
        if plain_key is not None:
            row.encrypted_key = encrypt_text(plain_key)
        if clear_base_url:
            row.base_url = None
        elif base_url is not None:
            row.base_url = base_url
        if model is not None:
            row.model = model
        self.db.commit()
        return True

    def delete_by_id(self, user_id: int, record_id: int) -> bool:
        deleted = self.db.query(UserApiKey).filter(
            UserApiKey.id == record_id,
            UserApiKey.user_id == user_id,
        ).delete()
        self.db.commit()
        return deleted > 0
