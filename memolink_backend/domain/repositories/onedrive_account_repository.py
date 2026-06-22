from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from memolink_backend.domain.models.onedrive_account import OneDriveAccount
from memolink_backend.core.encryption import encrypt_text, decrypt_text


class OneDriveAccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_user_id(self, user_id: int) -> Optional[OneDriveAccount]:
        return self.db.query(OneDriveAccount).filter(OneDriveAccount.user_id == user_id).first()

    def get_any_connected(self) -> Optional[OneDriveAccount]:
        """Books sync/reading is a single shared admin-connected OneDrive — return whichever
        admin connected it (most recently updated), so regular users can read/save books
        without ever holding Microsoft tokens themselves."""
        return self.db.query(OneDriveAccount).order_by(OneDriveAccount.updated_at.desc()).first()

    def upsert(
        self,
        user_id: int,
        ms_user_id: str,
        display_name: str,
        email: str,
        access_token: str,
        refresh_token: str,
        token_expiry: Optional[datetime] = None,
    ) -> OneDriveAccount:
        row = self.get_by_user_id(user_id)
        if row:
            row.ms_user_id = ms_user_id
            row.display_name = display_name
            row.email = email
            row.encrypted_access_token = encrypt_text(access_token)
            row.encrypted_refresh_token = encrypt_text(refresh_token)
            row.token_expiry = token_expiry
        else:
            row = OneDriveAccount(
                user_id=user_id,
                ms_user_id=ms_user_id,
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
        return self._decrypt(row)

    def get_decrypted_tokens_any(self) -> Optional[dict]:
        row = self.get_any_connected()
        if not row:
            return None
        return self._decrypt(row)

    @staticmethod
    def _decrypt(row: OneDriveAccount) -> dict:
        return {
            "user_id": row.user_id,
            "ms_user_id": row.ms_user_id,
            "display_name": row.display_name,
            "email": row.email,
            "access_token": decrypt_text(row.encrypted_access_token),
            "refresh_token": decrypt_text(row.encrypted_refresh_token),
            "token_expiry": row.token_expiry,
        }

    def delete_by_user_id(self, user_id: int) -> bool:
        deleted = self.db.query(OneDriveAccount).filter(OneDriveAccount.user_id == user_id).delete()
        self.db.commit()
        return deleted > 0
