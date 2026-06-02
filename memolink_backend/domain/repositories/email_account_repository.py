from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from memolink_backend.domain.models.email_account import EmailAccount
from memolink_backend.core.encryption import encrypt_text, decrypt_text


class EmailAccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_user_id(self, user_id: int) -> Optional[EmailAccount]:
        return self.db.query(EmailAccount).filter(EmailAccount.user_id == user_id).first()

    def upsert(
        self,
        user_id: int,
        email_address: str,
        access_token: str,
        refresh_token: str,
        token_expiry: Optional[datetime] = None,
        provider: str = "google",
    ) -> EmailAccount:
        row = self.get_by_user_id(user_id)
        if row:
            row.email_address = email_address
            row.encrypted_access_token = encrypt_text(access_token)
            row.encrypted_refresh_token = encrypt_text(refresh_token)
            row.token_expiry = token_expiry
            row.provider = provider
        else:
            row = EmailAccount(
                user_id=user_id,
                provider=provider,
                email_address=email_address,
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
            "email": row.email_address,
            "access_token": decrypt_text(row.encrypted_access_token),
            "refresh_token": decrypt_text(row.encrypted_refresh_token),
            "token_expiry": row.token_expiry,
            "provider": row.provider,
        }

    def delete_by_user_id(self, user_id: int) -> bool:
        deleted = self.db.query(EmailAccount).filter(EmailAccount.user_id == user_id).delete()
        self.db.commit()
        return deleted > 0
