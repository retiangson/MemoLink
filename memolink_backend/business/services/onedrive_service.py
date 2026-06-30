from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

import httpx

from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.onedrive_account_repository import OneDriveAccountRepository

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_AUTH_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
MS_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
MS_GRAPH_ME = "https://graph.microsoft.com/v1.0/me"
DEFAULT_TENANT = "common"
OFFICE_CLIENT_ID = "4765445b-32c6-49b0-83e6-1d93765276ca"
MEMOLINK_CALLBACK_PATH = "/api/admin/books/onedrive/callback"

ONEDRIVE_SCOPES = "Files.ReadWrite.All User.Read offline_access"

SUPPORTED_EXTENSIONS = {
    ".pdf", ".epub", ".pptx",
    ".mp3", ".m4a", ".m4b", ".aac", ".wav", ".ogg",
    ".txt", ".srt", ".vtt", ".cbz", ".cbr", ".mobi",
    ".mp4", ".webm", ".mov", ".m4v",
}
# Legacy binary .ppt is intentionally excluded — python-pptx (used by the reader and
# note extraction) cannot parse it, matching the existing rejection in file_extractor.py.


class OneDriveServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class OneDriveService:
    def __init__(self, account_repo: OneDriveAccountRepository):
        self._repo = account_repo

    # ── OAuth ────────────────────────────────────────────────────────────────

    def _oauth_settings(self) -> tuple[str, str, str, str]:
        client_id = (settings.microsoft_client_id or "").strip()
        client_secret = (settings.microsoft_client_secret or "").strip()
        redirect_uri = (settings.microsoft_redirect_uri or "").strip()
        tenant = (settings.microsoft_tenant_id or "").strip() or DEFAULT_TENANT

        if not client_id or not redirect_uri:
            raise OneDriveServiceError(503, "Microsoft OneDrive OAuth is not configured — set MICROSOFT_CLIENT_ID and MICROSOFT_REDIRECT_URI")
        if client_id.lower() == OFFICE_CLIENT_ID:
            raise OneDriveServiceError(503, "Microsoft OneDrive OAuth is using the Microsoft 365 Office client ID. Configure MemoLink's own Azure app registration client ID.")
        if "m365.cloud.microsoft" in redirect_uri.lower():
            raise OneDriveServiceError(503, "Microsoft OneDrive OAuth redirect URI points to Microsoft 365. It must point to MemoLink's OneDrive callback endpoint.")
        if MEMOLINK_CALLBACK_PATH not in redirect_uri:
            raise OneDriveServiceError(503, f"Microsoft OneDrive OAuth redirect URI must end with {MEMOLINK_CALLBACK_PATH}")

        return client_id, client_secret, redirect_uri, tenant

    def get_auth_url(self, state: str) -> str:
        client_id, _, redirect_uri, tenant = self._oauth_settings()
        return (
            MS_AUTH_URL.format(tenant=tenant)
            + f"?client_id={quote(client_id)}"
            + "&response_type=code"
            + f"&redirect_uri={quote(redirect_uri, safe='')}"
            + f"&scope={quote(ONEDRIVE_SCOPES, safe='')}"
            + "&response_mode=query"
            + "&prompt=consent"
            + f"&state={quote(state, safe='')}"
        )

    async def handle_callback(self, admin_user_id: int, code: str) -> dict:
        client_id, client_secret, redirect_uri, tenant = self._oauth_settings()
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                MS_TOKEN_URL.format(tenant=tenant),
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                    "scope": ONEDRIVE_SCOPES,
                },
            )
        if token_resp.status_code != 200:
            raise OneDriveServiceError(400, "Failed to exchange OneDrive OAuth code for tokens")

        token_data = token_resp.json()
        access_token = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token", "")
        expires_in = token_data.get("expires_in", 3600)
        expiry = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)
        if not access_token or not refresh_token:
            raise OneDriveServiceError(400, "Microsoft did not return OneDrive access and refresh tokens")

        async with httpx.AsyncClient() as client:
            me_resp = await client.get(MS_GRAPH_ME, headers={"Authorization": f"Bearer {access_token}"})
        if me_resp.status_code != 200:
            raise OneDriveServiceError(400, "OneDrive OAuth token could not access Microsoft Graph /me")
        me = me_resp.json()

        self._repo.upsert(
            user_id=admin_user_id,
            ms_user_id=me.get("id", ""),
            display_name=me.get("displayName", ""),
            email=me.get("mail") or me.get("userPrincipalName", ""),
            access_token=access_token,
            refresh_token=refresh_token,
            token_expiry=expiry,
        )
        return {"display_name": me.get("displayName", ""), "email": me.get("mail") or me.get("userPrincipalName", "")}

    def get_status(self, admin_user_id: int) -> dict:
        row = self._repo.get_by_user_id(admin_user_id)
        if not row:
            return {"connected": False}
        return {"connected": True, "display_name": row.display_name, "email": row.email}

    def disconnect(self, admin_user_id: int) -> bool:
        return self._repo.delete_by_user_id(admin_user_id)

    # ── Token refresh ────────────────────────────────────────────────────────

    async def _get_valid_access_token(self, *, for_admin_user_id: Optional[int] = None) -> str:
        tokens = (
            self._repo.get_decrypted_tokens(for_admin_user_id)
            if for_admin_user_id is not None
            else self._repo.get_decrypted_tokens_any()
        )
        if not tokens:
            raise OneDriveServiceError(503, "No OneDrive account is connected. An admin must connect OneDrive first.")

        expiry: Optional[datetime] = tokens.get("token_expiry")
        now = datetime.now(tz=timezone.utc)
        if expiry and (expiry - now).total_seconds() > 120:
            return tokens["access_token"]

        client_id, client_secret, _, tenant = self._oauth_settings()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                MS_TOKEN_URL.format(tenant=tenant),
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": tokens["refresh_token"],
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": ONEDRIVE_SCOPES,
                },
            )
        if resp.status_code != 200:
            try:
                err_body = resp.json()
                err_reason = err_body.get("error_description") or err_body.get("error") or resp.text[:300]
            except Exception:
                err_reason = resp.text[:300]
            logger.error(
                "OneDrive token refresh failed for user_id=%s (HTTP %s): %s",
                tokens.get("user_id"), resp.status_code, err_reason,
            )
            raise OneDriveServiceError(401, "Failed to refresh OneDrive access token — reconnect OneDrive in admin settings")

        token_data = resp.json()
        access_token = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token", tokens["refresh_token"])
        expires_in = token_data.get("expires_in", 3600)
        expiry_dt = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)
        if not access_token:
            logger.error("OneDrive token refresh for user_id=%s returned HTTP 200 with no access_token", tokens.get("user_id"))
            raise OneDriveServiceError(401, "OneDrive token refresh returned no access token")

        self._repo.upsert(
            user_id=tokens["user_id"],
            ms_user_id=tokens["ms_user_id"],
            display_name=tokens["display_name"],
            email=tokens["email"],
            access_token=access_token,
            refresh_token=refresh_token,
            token_expiry=expiry_dt,
        )
        return access_token

    # ── Graph file operations ───────────────────────────────────────────────

    async def list_folder_files(self, *, admin_user_id: int) -> list[dict]:
        """List supported files under the configured Books folder, including nested folders."""
        token = await self._get_valid_access_token(for_admin_user_id=admin_user_id)
        path = self._children_path()
        return await self._list_supported_files_recursive(token=token, children_path=path)

    # ── Paginated listing (one Graph call per invocation) ───────────────────
    # Uses Microsoft Graph's delta query, which enumerates the entire folder
    # subtree (recursively, files and folders) in large server-paginated batches
    # instead of one /children call per folder. This replaces the old per-folder
    # breadth-first walk, which needed one Graph round trip per folder (10k+ for
    # a large library) and was the main source of slow/timing-out syncs.
    # Lets a caller (e.g. the desktop app's sync loop) drive an arbitrarily long
    # walk by repeatedly resuming from an opaque cursor wrapping Graph's own
    # @odata.nextLink, instead of one request having to walk the entire tree
    # before returning.

    async def list_folder_files_page(self, *, admin_user_id: int, cursor: Optional[str]) -> tuple[list[dict], Optional[str]]:
        token = await self._get_valid_access_token(for_admin_user_id=admin_user_id)

        if cursor:
            state = self._decode_cursor(cursor)
            url = state["url"]
            params = None
        else:
            url = f"{GRAPH_BASE}{self._delta_root_path()}"
            params = {"$select": "id,name,file,folder,size,webUrl,lastModifiedDateTime,parentReference,deleted"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
            except httpx.TimeoutException as exc:
                raise OneDriveServiceError(504, "Microsoft Graph timed out listing the OneDrive folder page.") from exc
        if resp.status_code != 200:
            raise OneDriveServiceError(resp.status_code, f"Microsoft Graph error listing OneDrive folder: {resp.text[:300]}")

        data = resp.json()
        files: list[dict] = []
        for item in data.get("value", []):
            if "deleted" in item or "folder" in item or "file" not in item:
                continue
            file = self._supported_file_from_item(item)
            if file:
                files.append(file)

        # A page ending in @odata.nextLink means more pages remain in this delta
        # walk; a page ending in @odata.deltaLink means the walk is complete (that
        # link is also a resumable token for a future incremental sync, not used yet).
        next_link = data.get("@odata.nextLink")
        done = next_link is None
        return files, (None if done else self._encode_cursor({"url": next_link}))

    def _delta_root_path(self) -> str:
        if settings.onedrive_books_folder_id:
            return f"/me/drive/items/{settings.onedrive_books_folder_id}/delta"
        if settings.onedrive_books_folder_path:
            path = settings.onedrive_books_folder_path.strip("/")
            return f"/me/drive/root:/{quote(path)}:/delta"
        return "/me/drive/root/delta"

    def _encode_cursor(self, state: dict) -> str:
        import base64
        return base64.urlsafe_b64encode(json.dumps(state).encode()).decode()

    def _decode_cursor(self, cursor: str) -> dict:
        import base64
        try:
            state = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        except Exception as exc:
            raise OneDriveServiceError(400, "Invalid or expired sync cursor") from exc
        # The cursor round-trips through the caller; reject anything whose "url" doesn't
        # point back at Graph so a tampered cursor can't make this server send the
        # OneDrive bearer token to an attacker-controlled host (SSRF).
        url = state.get("url")
        if url is not None and not str(url).startswith(GRAPH_BASE):
            raise OneDriveServiceError(400, "Invalid or expired sync cursor")
        return state

    async def _list_supported_files_recursive(self, *, token: str, children_path: str) -> list[dict]:
        files: list[dict] = []
        pending_paths = [children_path]
        visited_folder_ids: set[str] = set()

        async with httpx.AsyncClient(timeout=30.0) as client:
            while pending_paths:
                path = pending_paths.pop()
                items = await self._list_children(client=client, token=token, children_path=path)

                for item in items:
                    if "folder" in item:
                        item_id = item.get("id")
                        if item_id and item_id not in visited_folder_ids:
                            visited_folder_ids.add(item_id)
                            pending_paths.append(f"/me/drive/items/{item_id}/children")
                        continue

                    if "file" not in item:
                        continue

                    file = self._supported_file_from_item(item)
                    if file:
                        files.append(file)

        return files

    async def _list_children(self, *, client: httpx.AsyncClient, token: str, children_path: str) -> list[dict]:
        url = f"{GRAPH_BASE}{children_path}"
        params = {"$select": "id,name,file,folder,size,webUrl,lastModifiedDateTime,parentReference"}
        items: list[dict] = []
        while url:
            try:
                resp = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {token}"},
                    params=params,
                )
            except httpx.TimeoutException as exc:
                raise OneDriveServiceError(504, "Microsoft Graph timed out listing the OneDrive folder. Try again, or narrow ONEDRIVE_BOOKS_FOLDER_PATH/ID to a smaller folder.") from exc
            if resp.status_code != 200:
                raise OneDriveServiceError(resp.status_code, f"Microsoft Graph error listing OneDrive folder: {resp.text[:300]}")

            data = resp.json()
            items.extend(data.get("value", []))
            url = data.get("@odata.nextLink")
            params = None

        return items

    def _supported_file_from_item(self, item: dict) -> Optional[dict]:
        name = item.get("name", "")
        ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
        if ext not in SUPPORTED_EXTENSIONS:
            return None

        return {
            "drive_id": (item.get("parentReference") or {}).get("driveId", ""),
            "item_id": item.get("id"),
            "name": name,
            "extension": ext,
            "mime_type": (item.get("file") or {}).get("mimeType"),
            "size": item.get("size"),
            "web_url": item.get("webUrl"),
            "last_modified": item.get("lastModifiedDateTime"),
        }

    def _children_path(self) -> str:
        if settings.onedrive_books_folder_id:
            return f"/me/drive/items/{settings.onedrive_books_folder_id}/children"
        if settings.onedrive_books_folder_path:
            path = settings.onedrive_books_folder_path.strip("/")
            return f"/me/drive/root:/{quote(path)}:/children"
        return "/me/drive/root/children"

    async def get_file_download_url(self, *, drive_id: str, item_id: str) -> str:
        """Return a pre-authenticated short-lived CDN URL for direct client download.
        Avoids proxying file bytes through the backend (critical on Lambda where the
        response payload is capped at 6 MB)."""
        token = await self._get_valid_access_token()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}",
                headers={"Authorization": f"Bearer {token}"},
                params={"$select": "@microsoft.graph.downloadUrl"},
            )
        if resp.status_code != 200:
            raise OneDriveServiceError(resp.status_code, f"Failed to get download URL from OneDrive: {resp.status_code}")
        url = resp.json().get("@microsoft.graph.downloadUrl")
        if not url:
            raise OneDriveServiceError(502, "OneDrive did not return a download URL for this file")
        return url

    async def download_file_bytes(self, *, drive_id: str, item_id: str) -> bytes:
        """Download a file's full content from OneDrive into memory.
        Only safe for small files or non-Lambda deployments — Lambda caps responses
        at 6 MB. Prefer get_file_download_url() for user-facing file delivery."""
        token = await self._get_valid_access_token()
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/content",
                headers={"Authorization": f"Bearer {token}"},
                follow_redirects=True,
            )
        if resp.status_code != 200:
            raise OneDriveServiceError(resp.status_code, f"Failed to download file from OneDrive: {resp.status_code}")
        return resp.content

    async def delete_file(self, *, drive_id: str, item_id: str) -> None:
        """Delete a specific OneDrive item after an incomplete MemoLink upload flow."""
        token = await self._get_valid_access_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code != 204:
            raise OneDriveServiceError(resp.status_code, "Could not clean up the incomplete OneDrive upload")

    async def upload_source_bytes(self, *, file_name: str, content: bytes, mime_type: Optional[str]) -> dict:
        """Upload an original note source to MemoLink's OneDrive area."""
        return await self._upload_original_bytes(
            folder_name="MemoLink Sources",
            file_name=file_name,
            content=content,
            mime_type=mime_type,
        )

    async def upload_book_bytes(self, *, file_name: str, content: bytes, mime_type: Optional[str]) -> dict:
        """Upload an admin-selected book once and return safe OneDrive metadata."""
        return await self._upload_original_bytes(
            folder_name="MemoLink Books Uploads",
            file_name=file_name,
            content=content,
            mime_type=mime_type,
        )

    async def _upload_original_bytes(
        self,
        *,
        folder_name: str,
        file_name: str,
        content: bytes,
        mime_type: Optional[str],
    ) -> dict:
        """Upload request-scoped bytes without persisting them inside MemoLink.

        Bytes are request-scoped and never persisted by MemoLink. A unique OneDrive name
        prevents accidental replacement of an existing original.
        """
        token = await self._get_valid_access_token()
        safe_name = "".join(ch if ch.isalnum() or ch in " ._-()" else "_" for ch in file_name).strip() or "source"
        stored_name = f"{uuid.uuid4().hex[:12]}_{safe_name}"
        async with httpx.AsyncClient(timeout=120.0) as client:
            folder_resp = await client.get(
                f"{GRAPH_BASE}/me/drive/root:/{quote(folder_name)}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if folder_resp.status_code == 404:
                folder_resp = await client.post(
                    f"{GRAPH_BASE}/me/drive/root/children",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json={"name": folder_name, "folder": {}, "@microsoft.graph.conflictBehavior": "fail"},
                )
                if folder_resp.status_code == 409:
                    # Another concurrent upload may have created the folder between
                    # the GET and POST. Resolve the folder again instead of failing.
                    folder_resp = await client.get(
                        f"{GRAPH_BASE}/me/drive/root:/{quote(folder_name)}",
                        headers={"Authorization": f"Bearer {token}"},
                    )
            if folder_resp.status_code not in (200, 201):
                raise OneDriveServiceError(folder_resp.status_code, "Could not prepare the OneDrive source folder")

            upload_resp = await client.put(
                f"{GRAPH_BASE}/me/drive/root:/{quote(folder_name)}/{quote(stored_name)}:/content",
                headers={"Authorization": f"Bearer {token}", "Content-Type": mime_type or "application/octet-stream"},
                content=content,
            )
        if upload_resp.status_code not in (200, 201):
            raise OneDriveServiceError(upload_resp.status_code, f"OneDrive upload failed: {upload_resp.text[:300]}")
        item = upload_resp.json()
        drive_id = (item.get("parentReference") or {}).get("driveId", "")
        item_id = item.get("id", "")
        if not drive_id or not item_id:
            raise OneDriveServiceError(502, "OneDrive upload returned incomplete source metadata")
        return {
            "drive_id": drive_id,
            "item_id": item_id,
            "web_url": item.get("webUrl"),
            "etag": item.get("eTag"),
            "name": item.get("name", stored_name),
            "size": item.get("size", len(content)),
            "mime_type": (item.get("file") or {}).get("mimeType") or mime_type,
            "last_modified": item.get("lastModifiedDateTime"),
        }
