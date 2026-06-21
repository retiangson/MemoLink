from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from memolink_backend.domain.models.email_account import EmailAccount
from memolink_backend.core.encryption import encrypt_text, decrypt_text


class EmailAccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_by_user(self, user_id: int) -> list[EmailAccount]:
        return self.db.query(EmailAccount).filter(EmailAccount.user_id == user_id).all()

    def get_by_user_id(self, user_id: int) -> Optional[EmailAccount]:
        """Return first account for user (backward compat for single-account code paths)."""
        return self.db.query(EmailAccount).filter(EmailAccount.user_id == user_id).first()

    def get_by_email(self, user_id: int, email_address: str) -> Optional[EmailAccount]:
        return self.db.query(EmailAccount).filter(
            EmailAccount.user_id == user_id,
            EmailAccount.email_address == email_address,
        ).first()

    def get_by_id(self, user_id: int, account_id: int) -> Optional[EmailAccount]:
        return self.db.query(EmailAccount).filter(
            EmailAccount.id == account_id,
            EmailAccount.user_id == user_id,
        ).first()

    def upsert(
        self,
        user_id: int,
        email_address: str,
        access_token: str,
        refresh_token: str,
        token_expiry: Optional[datetime] = None,
        provider: str = "google",
        granted_scope: Optional[str] = None,
    ) -> EmailAccount:
        row = self.get_by_email(user_id, email_address)
        if row:
            row.encrypted_access_token = encrypt_text(access_token)
            row.encrypted_refresh_token = encrypt_text(refresh_token)
            row.token_expiry = token_expiry
            row.provider = provider
            if granted_scope is not None:
                row.granted_scope = granted_scope
        else:
            row = EmailAccount(
                user_id=user_id,
                provider=provider,
                email_address=email_address,
                encrypted_access_token=encrypt_text(access_token),
                encrypted_refresh_token=encrypt_text(refresh_token),
                token_expiry=token_expiry,
                granted_scope=granted_scope,
            )
            self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_decrypted_tokens(self, user_id: int, email_account_id: int | None = None) -> Optional[dict]:
        if email_account_id:
            row = self.get_by_id(user_id, email_account_id)
        else:
            row = self.get_by_user_id(user_id)
        if not row:
            return None
        return {
            "email": row.email_address,
            "email_account_id": row.id,
            "access_token": decrypt_text(row.encrypted_access_token),
            "refresh_token": decrypt_text(row.encrypted_refresh_token),
            "token_expiry": row.token_expiry,
            "provider": row.provider,
        }

    def update_page_size(self, user_id: int, account_id: int, page_size: int) -> Optional[EmailAccount]:
        row = self.get_by_id(user_id, account_id)
        if not row:
            return None
        row.page_size = page_size
        self.db.commit()
        self.db.refresh(row)
        return row

    def update_display_name(self, user_id: int, account_id: int, display_name: Optional[str]) -> Optional[EmailAccount]:
        row = self.get_by_id(user_id, account_id)
        if not row:
            return None
        row.display_name = display_name
        self.db.commit()
        self.db.refresh(row)
        return row

    def delete_by_user_id(self, user_id: int) -> bool:
        deleted = self.db.query(EmailAccount).filter(EmailAccount.user_id == user_id).delete()
        self.db.commit()
        return deleted > 0

    def delete_by_email(self, user_id: int, email_address: str) -> bool:
        deleted = self.db.query(EmailAccount).filter(
            EmailAccount.user_id == user_id,
            EmailAccount.email_address == email_address,
        ).delete()
        self.db.commit()
        return deleted > 0
