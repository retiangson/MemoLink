from __future__ import annotations

import base64
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.email_account_repository import EmailAccountRepository

GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Shared, process-lifetime client so concurrent/sequential Gmail API calls reuse
# pooled keep-alive connections instead of paying a fresh TLS handshake each time.
_async_client: httpx.AsyncClient | None = None


def _get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            timeout=30.0,
        )
    return _async_client


class GmailConnector:
    def __init__(self, account_repo: EmailAccountRepository):
        self.account_repo = account_repo

    def _get_tokens_or_raise(self, user_id: int, email_account_id: int | None = None) -> dict:
        tokens = self.account_repo.get_decrypted_tokens(user_id, email_account_id=email_account_id)
        if not tokens:
            raise ValueError("No email account connected")
        return tokens

    def _persist_refreshed_token(self, user_id: int, tokens: dict, access_token: str, expiry: datetime) -> None:
        self.account_repo.upsert(
            user_id=user_id,
            email_address=tokens["email"],
            access_token=access_token,
            refresh_token=tokens["refresh_token"],
            token_expiry=expiry,
        )

    async def get_valid_access_token(self, user_id: int, email_account_id: int | None = None) -> str:
        tokens = self._get_tokens_or_raise(user_id, email_account_id)
        expiry = tokens.get("token_expiry")
        if expiry and datetime.now(tz=timezone.utc) >= expiry:
            refresh_token = tokens.get("refresh_token", "")
            new_token, new_expiry = await self.refresh_access_token(refresh_token)
            self._persist_refreshed_token(user_id, tokens, new_token, new_expiry)
            return new_token
        return tokens["access_token"]

    def get_valid_access_token_sync(self, user_id: int, email_account_id: int | None = None) -> str:
        tokens = self._get_tokens_or_raise(user_id, email_account_id)
        expiry = tokens.get("token_expiry")
        if expiry and datetime.now(tz=timezone.utc) >= expiry:
            refresh_token = tokens.get("refresh_token", "")
            new_token, new_expiry = self.refresh_access_token_sync(refresh_token)
            self._persist_refreshed_token(user_id, tokens, new_token, new_expiry)
            return new_token
        return tokens["access_token"]

    async def refresh_access_token(self, refresh_token: str) -> tuple[str, datetime]:
        client = _get_async_client()
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        access_token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        expiry = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)
        return access_token, expiry

    def refresh_access_token_sync(self, refresh_token: str) -> tuple[str, datetime]:
        with httpx.Client() as client:
            resp = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
        resp.raise_for_status()
        data = resp.json()
        access_token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        expiry = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)
        return access_token, expiry

    async def list_messages(self, user_id: int, *, query: str, max_results: int, email_account_id: int | None = None) -> list[str]:
        access_token = await self.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.get(
            f"{GMAIL_API}/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"maxResults": max_results, "q": query},
        )
        if resp.status_code != 200:
            raise ValueError(f"Gmail API error: {resp.status_code}")
        return [item["id"] for item in resp.json().get("messages", [])]

    def list_messages_sync(self, user_id: int, *, query: str, max_results: int, email_account_id: int | None = None) -> list[str]:
        access_token = self.get_valid_access_token_sync(user_id, email_account_id)
        with httpx.Client() as client:
            resp = client.get(
                f"{GMAIL_API}/messages",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"maxResults": max_results, "q": query},
            )
        if resp.status_code != 200:
            raise ValueError(f"Gmail API error: {resp.status_code}")
        return [item["id"] for item in resp.json().get("messages", [])]

    async def get_message(self, user_id: int, gmail_message_id: str, *, format: str = "full", email_account_id: int | None = None) -> dict | None:
        access_token = await self.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.get(
            f"{GMAIL_API}/messages/{gmail_message_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"format": format},
        )
        if resp.status_code != 200:
            return None
        return resp.json()

    def get_message_sync(self, user_id: int, gmail_message_id: str, *, format: str = "full", email_account_id: int | None = None) -> dict | None:
        access_token = self.get_valid_access_token_sync(user_id, email_account_id)
        with httpx.Client() as client:
            resp = client.get(
                f"{GMAIL_API}/messages/{gmail_message_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"format": format},
            )
        if resp.status_code != 200:
            return None
        return resp.json()

    async def send_message(
        self,
        user_id: int,
        *,
        raw_message: str,
        thread_id: Optional[str] = None,
        email_account_id: int | None = None,
    ) -> dict:
        access_token = await self.get_valid_access_token(user_id, email_account_id)
        payload: dict = {"raw": raw_message}
        if thread_id:
            payload["threadId"] = thread_id
        client = _get_async_client()
        resp = await client.post(
            f"{GMAIL_API}/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            json=payload,
        )
        if resp.status_code not in (200, 201):
            raise ValueError(f"Gmail send failed: {resp.text[:200]}")
        return resp.json()

    async def list_messages_page(
        self,
        user_id: int,
        *,
        query: str,
        max_results: int,
        page_token: str | None = None,
        email_account_id: int | None = None,
    ) -> dict:
        access_token = await self.get_valid_access_token(user_id, email_account_id)
        params: dict = {"maxResults": max_results, "q": query}
        if page_token:
            params["pageToken"] = page_token
        client = _get_async_client()
        resp = await client.get(
            f"{GMAIL_API}/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        if resp.status_code != 200:
            raise ValueError(f"Gmail API error: {resp.status_code}")
        data = resp.json()
        return {
            "ids": [item["id"] for item in data.get("messages", [])],
            "next_page_token": data.get("nextPageToken"),
        }

    async def modify_message(
        self,
        user_id: int,
        *,
        gmail_message_id: str,
        add_label_ids: list[str] | None = None,
        remove_label_ids: list[str] | None = None,
        email_account_id: int | None = None,
    ) -> dict:
        access_token = await self.get_valid_access_token(user_id, email_account_id)
        payload: dict = {}
        if add_label_ids:
            payload["addLabelIds"] = add_label_ids
        if remove_label_ids:
            payload["removeLabelIds"] = remove_label_ids
        client = _get_async_client()
        resp = await client.post(
            f"{GMAIL_API}/messages/{gmail_message_id}/modify",
            headers={"Authorization": f"Bearer {access_token}"},
            json=payload,
        )
        if resp.status_code != 200:
            raise ValueError(f"Gmail API error: {resp.status_code}")
        return resp.json()

    async def trash_message(
        self,
        user_id: int,
        *,
        gmail_message_id: str,
        email_account_id: int | None = None,
    ) -> dict:
        access_token = await self.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.post(
            f"{GMAIL_API}/messages/{gmail_message_id}/trash",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            raise ValueError(f"Gmail API error: {resp.status_code}")
        return resp.json()

    async def download_attachment(
        self,
        user_id: int,
        *,
        gmail_message_id: str,
        attachment_id: str,
        email_account_id: int | None = None,
    ) -> bytes:
        access_token = await self.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.get(
            f"{GMAIL_API}/messages/{gmail_message_id}/attachments/{attachment_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            raise ValueError(f"Gmail API returned {resp.status_code}: {resp.text[:200]}")
        data = resp.json().get("data", "")
        return base64.urlsafe_b64decode(data + "==")
