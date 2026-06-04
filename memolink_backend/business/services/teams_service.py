import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.teams_account_repository import TeamsAccountRepository

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


class TeamsService:
    def __init__(self, account_repo: TeamsAccountRepository):
        self._repo = account_repo

    # ── Token management ──────────────────────────────────────────────────────

    async def _refresh_if_needed(self, user_id: int) -> Optional[str]:
        data = self._repo.get_decrypted_tokens(user_id)
        if not data:
            return None

        expiry: Optional[datetime] = data["token_expiry"]
        now = datetime.now(tz=timezone.utc)
        if expiry and (expiry - now).total_seconds() > 120:
            return data["access_token"]

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://login.microsoftonline.com/{settings.teams_tenant_id or 'common'}/oauth2/v2.0/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": data["refresh_token"],
                    "client_id": settings.teams_client_id,
                    "client_secret": settings.teams_client_secret,
                    "scope": "https://graph.microsoft.com/.default offline_access",
                },
            )
        if resp.status_code != 200:
            return None

        token_data = resp.json()
        access_token = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token", data["refresh_token"])
        expires_in = token_data.get("expires_in", 3600)
        expiry_dt = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)

        self._repo.upsert(
            user_id=user_id,
            teams_user_id=data["teams_user_id"],
            display_name=data["display_name"],
            email=data["email"],
            access_token=access_token,
            refresh_token=refresh_token,
            token_expiry=expiry_dt,
        )
        return access_token

    async def _get(self, user_id: int, path: str, params: dict = None) -> Optional[dict]:
        token = await self._refresh_if_needed(user_id)
        if not token:
            return None
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GRAPH_BASE}{path}",
                headers={"Authorization": f"Bearer {token}"},
                params=params or {},
            )
        return resp.json() if resp.status_code == 200 else None

    async def _post(self, user_id: int, path: str, body: dict) -> Optional[dict]:
        token = await self._refresh_if_needed(user_id)
        if not token:
            return None
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{GRAPH_BASE}{path}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
            )
        if resp.status_code not in (200, 201):
            import logging
            logging.getLogger(__name__).warning("Teams POST %s → %s: %s", path, resp.status_code, resp.text[:300])
            return None
        return resp.json()

    # ── Public API ────────────────────────────────────────────────────────────

    def get_status(self, user_id: int) -> dict:
        row = self._repo.get_by_user_id(user_id)
        if not row:
            return {"connected": False}
        return {
            "connected": True,
            "display_name": row.display_name,
            "email": row.email,
        }

    def disconnect(self, user_id: int) -> bool:
        return self._repo.delete_by_user_id(user_id)

    async def list_chats(self, user_id: int) -> list:
        data = await self._get(user_id, "/me/chats", {"$expand": "members", "$top": "20"})
        if not data:
            return []
        chats = []
        for c in data.get("value", []):
            members = [
                m.get("displayName", "") for m in c.get("members", [])
                if m.get("displayName")
            ]
            chats.append({
                "id": c.get("id"),
                "topic": c.get("topic") or ", ".join(members) or "Chat",
                "chatType": c.get("chatType", "oneOnOne"),
                "members": members,
                "lastMessagePreview": (c.get("lastMessagePreview") or {}).get("body", {}).get("content", ""),
            })
        return chats

    async def get_messages(self, user_id: int, chat_id: str, limit: int = 20) -> list:
        data = await self._get(user_id, f"/me/chats/{chat_id}/messages", {"$top": str(limit)})
        if not data:
            return []
        messages = []
        for m in reversed(data.get("value", [])):
            body = m.get("body", {})
            content = body.get("content", "")
            content_type = body.get("contentType", "text")
            if content_type == "html":
                import re
                content = re.sub(r"<[^>]+>", "", content).strip()
            if not content:
                continue
            messages.append({
                "id": m.get("id"),
                "from": (m.get("from") or {}).get("user", {}).get("displayName", "Unknown"),
                "content": content,
                "createdDateTime": m.get("createdDateTime", ""),
                "messageType": m.get("messageType", "message"),
            })
        return messages

    async def send_message(self, user_id: int, chat_id: str, text: str) -> bool:
        result = await self._post(user_id, f"/chats/{chat_id}/messages", {
            "body": {"content": text, "contentType": "text"}
        })
        return result is not None

    async def messages_to_note_content(self, user_id: int, chat_id: str, topic: str) -> dict:
        messages = await self.get_messages(user_id, chat_id, limit=50)
        if not messages:
            return {"title": topic, "content": "<p>No messages found.</p>"}
        lines = [f"<p><strong>{m['from']}:</strong> {m['content']}</p>" for m in messages]
        return {
            "title": f"Teams: {topic}",
            "content": "".join(lines),
        }
