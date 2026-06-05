from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from memolink_backend.domain.models.teams_account import TeamsAccount
from memolink_backend.core.encryption import encrypt_text, decrypt_text


class TeamsAccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_user_id(self, user_id: int) -> Optional[TeamsAccount]:
        return self.db.query(TeamsAccount).filter(TeamsAccount.user_id == user_id).first()

    def upsert(
        self,
        user_id: int,
        teams_user_id: str,
        display_name: str,
        email: str,
        access_token: str,
        refresh_token: str,
        token_expiry: Optional[datetime] = None,
    ) -> TeamsAccount:
        row = self.get_by_user_id(user_id)
        if row:
            row.teams_user_id = teams_user_id
            row.display_name = display_name
            row.email = email
            row.encrypted_access_token = encrypt_text(access_token)
            row.encrypted_refresh_token = encrypt_text(refresh_token)
            row.token_expiry = token_expiry
        else:
            row = TeamsAccount(
                user_id=user_id,
                teams_user_id=teams_user_id,
                display_name=display_name,
                email=email,
                encrypted_access_token=encrypt_text(access_token),
                encrypted_refresh_token=encrypt_text(refresh_token),
                token_expiry=token_expiry,
            )
            self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_decrypted_tokens(self, user_id: int) -> Optional[dict]:
        row = self.get_by_user_id(user_id)
        if not row:
            return None
        return {
            "teams_user_id": row.teams_user_id,
            "display_name": row.display_name,
            "email": row.email,
            "access_token": decrypt_text(row.encrypted_access_token),
            "refresh_token": decrypt_text(row.encrypted_refresh_token),
            "token_expiry": row.token_expiry,
        }

    def delete_by_user_id(self, user_id: int) -> bool:
        deleted = self.db.query(TeamsAccount).filter(TeamsAccount.user_id == user_id).delete()
        self.db.commit()
        return deleted > 0
