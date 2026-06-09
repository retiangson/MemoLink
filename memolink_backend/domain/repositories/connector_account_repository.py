from __future__ import annotations

import json
from typing import Any, Optional
from datetime import datetime

from sqlalchemy.orm import Session

from memolink_backend.core.encryption import decrypt_text, encrypt_text
from memolink_backend.domain.models.connector_account import ConnectorAccount


class ConnectorAccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_user_and_type(self, user_id: int, connector_type: str) -> Optional[ConnectorAccount]:
        return (
            self.db.query(ConnectorAccount)
            .filter(
                ConnectorAccount.user_id == user_id,
                ConnectorAccount.connector_type == connector_type,
            )
            .first()
        )

    def upsert(
        self,
        *,
        user_id: int,
        connector_type: str,
        secret: str,
        display_name: str,
        account_label: str | None = None,
        base_url: str | None = None,
        config: dict[str, Any] | None = None,
        refresh_secret: str | None = None,
        token_expiry: datetime | None = None,
    ) -> ConnectorAccount:
        row = self.get_by_user_and_type(user_id, connector_type)
        config_json = json.dumps(config or {}, ensure_ascii=True) if config is not None else None
        if row:
            row.display_name = display_name
            row.account_label = account_label
            row.base_url = base_url
            row.config_json = config_json
            row.encrypted_secret = encrypt_text(secret)
            row.encrypted_refresh_secret = encrypt_text(refresh_secret) if refresh_secret else None
            row.token_expiry = token_expiry
        else:
            row = ConnectorAccount(
                user_id=user_id,
                connector_type=connector_type,
                display_name=display_name,
                account_label=account_label,
                base_url=base_url,
                config_json=config_json,
                encrypted_secret=encrypt_text(secret),
                encrypted_refresh_secret=encrypt_text(refresh_secret) if refresh_secret else None,
                token_expiry=token_expiry,
            )
            self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_decrypted_config(self, user_id: int, connector_type: str) -> Optional[dict[str, Any]]:
        row = self.get_by_user_and_type(user_id, connector_type)
        if not row:
            return None
        try:
            config = json.loads(row.config_json) if row.config_json else {}
        except Exception:
            config = {}
        return {
            "connector_type": row.connector_type,
            "display_name": row.display_name,
            "account_label": row.account_label,
            "base_url": row.base_url,
            "secret": decrypt_text(row.encrypted_secret),
            "refresh_secret": decrypt_text(row.encrypted_refresh_secret) if row.encrypted_refresh_secret else None,
            "token_expiry": row.token_expiry,
            "config": config,
        }

    def get_metadata(self, user_id: int, connector_type: str) -> Optional[dict[str, Any]]:
        row = self.get_by_user_and_type(user_id, connector_type)
        if not row:
            return None
        try:
            config = json.loads(row.config_json) if row.config_json else {}
        except Exception:
            config = {}
        return {
            "display_name": row.display_name,
            "account_label": row.account_label,
            "base_url": row.base_url,
            "config": config,
        }

    def delete_by_user_and_type(self, user_id: int, connector_type: str) -> bool:
        deleted = (
            self.db.query(ConnectorAccount)
            .filter(
                ConnectorAccount.user_id == user_id,
                ConnectorAccount.connector_type == connector_type,
            )
            .delete()
        )
        self.db.commit()
        return deleted > 0
