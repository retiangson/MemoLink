from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from memolink_backend.core.config import settings

SPOTIFY_REQUIRED_SCOPES = {
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "streaming",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
}


CONNECTOR_CATALOG = [
    {
        "id": "email",
        "label": "Email",
        "kind": "oauth",
        "description": "Sync Gmail, turn emails into notes, and create reminders from deadlines.",
    },
    {
        "id": "teams",
        "label": "Teams",
        "kind": "oauth",
        "description": "Read work chats, reply, and save conversations back into your knowledge base.",
    },
    {
        "id": "github",
        "label": "GitHub",
        "kind": "oauth",
        "description": "Work with repos, branches, issues, pull requests, comments, merges, and development branches from chat.",
    },
    {
        "id": "jira",
        "label": "Jira",
        "kind": "oauth",
        "description": "Check tickets, create work items, update issues, comment on them, and move them through workflow from chat.",
    },
    {
        "id": "spotify",
        "label": "Spotify",
        "kind": "oauth",
        "description": "Control Spotify playback and show your music workspace inside MemoLink.",
    },
]


class ConnectorsService:
    def __init__(self, email_repo, teams_repo, connector_repo, github_service, jira_service):
        self._email_repo = email_repo
        self._teams_repo = teams_repo
        self._connector_repo = connector_repo
        self._github = github_service
        self._jira = jira_service

    def list_connectors(self, user_id: int) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        email_row = self._email_repo.get_by_user_id(user_id)
        teams_row = self._teams_repo.get_by_user_id(user_id)
        github_status = self._github.status(user_id)
        jira_status = self._jira.status(user_id)
        spotify_status = self.status_spotify(user_id)
        for item in CONNECTOR_CATALOG:
            connector = dict(item)
            if item["id"] == "email":
                connector["connected"] = bool(email_row)
                connector["summary"] = email_row.email_address if email_row else None
            elif item["id"] == "teams":
                connector["connected"] = bool(teams_row)
                connector["summary"] = teams_row.email if teams_row else None
            elif item["id"] == "github":
                connector["connected"] = bool(github_status.get("configured"))
                connector["summary"] = github_status.get("default_repo") or github_status.get("account_label")
                connector["config"] = github_status
            elif item["id"] == "jira":
                connector["connected"] = bool(jira_status.get("configured"))
                connector["summary"] = jira_status.get("default_project_key") or jira_status.get("account_label")
                connector["config"] = jira_status
            elif item["id"] == "spotify":
                connector["connected"] = bool(spotify_status.get("configured"))
                connector["summary"] = spotify_status.get("account_label")
                connector["config"] = spotify_status
            result.append(connector)
        return result

    def status_spotify(self, user_id: int) -> dict[str, Any]:
        meta = self._connector_repo.get_metadata(user_id, "spotify")
        if not meta:
            return {"configured": False}
        return {
            "configured": True,
            "account_label": meta.get("account_label"),
            "profile_url": (meta.get("config") or {}).get("profile_url"),
            "missing_scopes": sorted(
                SPOTIFY_REQUIRED_SCOPES
                - set(str((meta.get("config") or {}).get("scope") or "").split())
            )
            if (meta.get("config") or {}).get("scope")
            else [],
        }

    def save_spotify_oauth(
        self,
        *,
        user_id: int,
        access_token: str,
        refresh_token: str | None,
        token_expiry,
        account_label: str | None,
        profile_url: str | None,
        scope: str | None = None,
    ):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="spotify",
            secret=access_token,
            display_name="Spotify",
            account_label=(account_label or "").strip() or None,
            config={
                "profile_url": (profile_url or "").strip() or None,
                "scope": (scope or "").strip(),
            },
            refresh_secret=(refresh_token or "").strip() or None,
            token_expiry=token_expiry,
        )

    def delete_spotify(self, user_id: int) -> bool:
        return self._connector_repo.delete_by_user_and_type(user_id, "spotify")

    async def get_spotify_access_token(self, user_id: int) -> str:
        existing = self._connector_repo.get_decrypted_config(user_id, "spotify")
        if not existing:
            raise ValueError("Spotify is not connected. Connect Spotify in Settings -> Connectors.")

        token_expiry = existing.get("token_expiry")
        if isinstance(token_expiry, datetime):
            expiry = token_expiry if token_expiry.tzinfo else token_expiry.replace(tzinfo=timezone.utc)
            if expiry.timestamp() - datetime.now(timezone.utc).timestamp() > 60:
                return existing["secret"]
        elif existing.get("secret"):
            return existing["secret"]

        refresh_token = existing.get("refresh_secret")
        if not refresh_token:
            raise ValueError("Spotify refresh token is missing. Reconnect Spotify.")
        if not settings.spotify_client_id or not settings.spotify_client_secret:
            raise ValueError("Spotify OAuth is not fully configured on the server.")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://accounts.spotify.com/api/token",
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                auth=(settings.spotify_client_id, settings.spotify_client_secret),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if response.status_code != 200:
            raise ValueError("Failed to refresh Spotify OAuth token. Reconnect Spotify.")

        data = response.json()
        access_token = (data.get("access_token") or "").strip()
        if not access_token:
            raise ValueError("Spotify refresh did not return an access token.")

        config = existing.get("config") or {}
        self._connector_repo.upsert(
            user_id=user_id,
            connector_type="spotify",
            secret=access_token,
            display_name="Spotify",
            account_label=existing.get("account_label"),
            config=config,
            refresh_secret=(data.get("refresh_token") or refresh_token),
            token_expiry=datetime.fromtimestamp(
                datetime.now(timezone.utc).timestamp() + int(data.get("expires_in") or 3600),
                tz=timezone.utc,
            ),
        )
        return access_token

    async def _spotify_request(
        self,
        user_id: int,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        access_token = await self.get_spotify_access_token(user_id)
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
        if response.status_code in (200, 202, 204):
            if response.status_code == 204 or not response.text:
                return {"ok": True}
            try:
                return response.json()
            except ValueError:
                return {"ok": True}
        detail = self._spotify_error_detail(response)
        if response.status_code == 403:
            if "premium" in detail.lower():
                raise ValueError("Spotify playback requires a Spotify Premium account.")
            if "scope" in detail.lower() or "permission" in detail.lower():
                raise ValueError("Spotify needs updated permissions. Disconnect Spotify, reconnect it, and approve the requested scopes.")
            raise ValueError(f"Spotify rejected this request: {detail}")
        if response.status_code == 404:
            raise ValueError("Spotify has no active playback device. Open the Spotify tab or Spotify app, then try again.")
        if response.status_code == 401:
            raise ValueError("Spotify authorization expired. Reconnect Spotify.")
        raise ValueError(detail)

    @staticmethod
    def _spotify_error_detail(response: httpx.Response) -> str:
        try:
            data = response.json()
        except Exception:
            return response.text[:300] if response.text else "Spotify request failed."
        error = data.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("reason")
            status = error.get("status")
            if message and status:
                return f"{message} ({status})"
            if message:
                return str(message)
        if isinstance(error, str):
            return error
        return str(data)[:300]

    @staticmethod
    def _spotify_image(images: list[dict[str, Any]] | None) -> str | None:
        if not images:
            return None
        return (images[0] or {}).get("url")

    @staticmethod
    def _spotify_track(item: dict[str, Any]) -> dict[str, Any] | None:
        track = item.get("track") if "track" in item else item
        if not track or track.get("type") != "track":
            return None
        artists = ", ".join(a.get("name", "") for a in track.get("artists", []) if a.get("name"))
        album = track.get("album") or {}
        return {
            "id": track.get("id"),
            "uri": track.get("uri"),
            "name": track.get("name") or "Unknown track",
            "artist": artists or "Unknown artist",
            "album": album.get("name") or "",
            "image_url": ConnectorsService._spotify_image(album.get("images")),
            "duration_ms": track.get("duration_ms") or 0,
            "external_url": (track.get("external_urls") or {}).get("spotify"),
        }

    @staticmethod
    def _spotify_playlist(item: dict[str, Any]) -> dict[str, Any]:
        owner = item.get("owner") or {}
        tracks = item.get("tracks") or {}
        return {
            "id": item.get("id"),
            "uri": item.get("uri"),
            "name": item.get("name") or "Untitled playlist",
            "owner": owner.get("display_name") or owner.get("id") or "",
            "image_url": ConnectorsService._spotify_image(item.get("images")),
            "track_count": tracks.get("total") or 0,
            "external_url": (item.get("external_urls") or {}).get("spotify"),
        }

    async def get_spotify_library(self, user_id: int) -> dict[str, Any]:
        playlists = await self._spotify_request(
            user_id,
            "GET",
            "https://api.spotify.com/v1/me/playlists",
            params={"limit": 30},
        )
        saved_tracks = await self._spotify_request(
            user_id,
            "GET",
            "https://api.spotify.com/v1/me/tracks",
            params={"limit": 30},
        )
        return {
            "playlists": [self._spotify_playlist(item) for item in playlists.get("items", []) if item],
            "tracks": [
                track
                for track in (self._spotify_track(item) for item in saved_tracks.get("items", []))
                if track
            ],
        }

    async def get_spotify_playlist_tracks(self, user_id: int, playlist_id: str) -> dict[str, Any]:
        if not playlist_id.strip():
            raise ValueError("Spotify playlist id is required.")
        data = await self._spotify_request(
            user_id,
            "GET",
            f"https://api.spotify.com/v1/playlists/{playlist_id.strip()}/tracks",
            params={"limit": 50, "additional_types": "track"},
        )
        return {
            "tracks": [
                track
                for track in (self._spotify_track(item) for item in data.get("items", []))
                if track
            ],
            "total": data.get("total") or 0,
        }

    async def get_spotify_devices(self, user_id: int) -> list[dict[str, Any]]:
        data = await self._spotify_request(
            user_id,
            "GET",
            "https://api.spotify.com/v1/me/player/devices",
        )
        return data.get("devices", []) if isinstance(data, dict) else []

    async def _resolve_spotify_device_id(self, user_id: int, requested_device_id: str | None) -> str | None:
        if requested_device_id:
            return requested_device_id
        devices = await self.get_spotify_devices(user_id)
        controllable = [d for d in devices if d.get("id") and not d.get("is_restricted")]
        active = next((d for d in controllable if d.get("is_active")), None)
        fallback = active or (controllable[0] if controllable else None)
        return fallback.get("id") if fallback else None

    async def _activate_spotify_device(self, user_id: int, device_id: str | None) -> None:
        if not device_id:
            return
        await self._spotify_request(
            user_id,
            "PUT",
            "https://api.spotify.com/v1/me/player",
            json_body={"device_ids": [device_id], "play": False},
        )

    async def search_spotify(self, user_id: int, query: str) -> dict[str, Any]:
        data = await self._spotify_request(
            user_id,
            "GET",
            "https://api.spotify.com/v1/search",
            params={"q": query.strip(), "type": "track,playlist", "limit": 10},
        )
        tracks = data.get("tracks") or {}
        playlists = data.get("playlists") or {}
        return {
            "tracks": [
                track
                for track in (self._spotify_track(item) for item in tracks.get("items", []))
                if track
            ],
            "playlists": [self._spotify_playlist(item) for item in playlists.get("items", []) if item],
        }

    async def control_spotify_playback(
        self,
        user_id: int,
        action: str,
        *,
        uri: str | None = None,
        uris: list[str] | None = None,
        context_uri: str | None = None,
        device_id: str | None = None,
        shuffle: bool | None = None,
        repeat_mode: str | None = None,
        position_ms: int | None = None,
    ) -> dict[str, Any]:
        action_map = {
            "previous": ("POST", "https://api.spotify.com/v1/me/player/previous"),
            "play": ("PUT", "https://api.spotify.com/v1/me/player/play"),
            "pause": ("PUT", "https://api.spotify.com/v1/me/player/pause"),
            "stop": ("PUT", "https://api.spotify.com/v1/me/player/pause"),
            "next": ("POST", "https://api.spotify.com/v1/me/player/next"),
            "shuffle": ("PUT", "https://api.spotify.com/v1/me/player/shuffle"),
            "repeat": ("PUT", "https://api.spotify.com/v1/me/player/repeat"),
            "seek": ("PUT", "https://api.spotify.com/v1/me/player/seek"),
        }
        if action not in action_map:
            raise ValueError("Unsupported Spotify playback action.")

        method, url = action_map[action]
        target_device_id = await self._resolve_spotify_device_id(user_id, device_id)
        if target_device_id:
            await self._activate_spotify_device(user_id, target_device_id)
        body: dict[str, Any] | None = None
        if action == "play":
            if context_uri and uri:
                body = {"context_uri": context_uri, "offset": {"uri": uri}}
            elif context_uri:
                body = {"context_uri": context_uri}
            elif uris:
                body = {"uris": uris[:100]}
            elif uri:
                body = {"uris": [uri]}
        elif action == "shuffle":
            params = {
                "state": bool(shuffle),
                **({"device_id": target_device_id} if target_device_id else {}),
            }
            await self._spotify_request(user_id, method, url, params=params)
            return {"ok": True}
        elif action == "repeat":
            if repeat_mode not in ("off", "context", "track"):
                raise ValueError("Unsupported Spotify repeat mode.")
            params = {
                "state": repeat_mode,
                **({"device_id": target_device_id} if target_device_id else {}),
            }
            await self._spotify_request(user_id, method, url, params=params)
            return {"ok": True}
        elif action == "seek":
            if position_ms is None or position_ms < 0:
                raise ValueError("A valid seek position is required.")
            params = {
                "position_ms": int(position_ms),
                **({"device_id": target_device_id} if target_device_id else {}),
            }
            await self._spotify_request(user_id, method, url, params=params)
            return {"ok": True}

        params = {"device_id": target_device_id} if target_device_id else None
        await self._spotify_request(user_id, method, url, params=params, json_body=body)
        return {"ok": True}

    def save_github_oauth(
        self,
        *,
        user_id: int,
        token: str,
        account_label: str | None,
        base_url: str | None = None,
    ):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="github",
            secret=token,
            display_name="GitHub",
            account_label=(account_label or "").strip() or None,
            base_url=(base_url or "").strip() or None,
            config={},
        )

    def save_github_settings(
        self,
        *,
        user_id: int,
        owner: str | None = None,
        repo: str | None = None,
        base_url: str | None = None,
        branch: str | None = None,
    ):
        existing = self._connector_repo.get_decrypted_config(user_id, "github")
        if not existing:
            raise ValueError("Connect GitHub before saving repository settings.")

        prior_config = dict(existing.get("config") or {})
        owner_value = None if owner is None else owner.strip()
        repo_value = None if repo is None else repo.strip()
        if owner_value is None and repo_value is None:
            resolved_owner = str(prior_config.get("owner") or "")
            resolved_repo = str(prior_config.get("repo") or "")
        else:
            if bool(owner_value) != bool(repo_value):
                raise ValueError("GitHub owner and repository must be provided together.")
            resolved_owner = owner_value or ""
            resolved_repo = repo_value or ""
        branch_value = prior_config.get("default_branch") if branch is None else ((branch or "").strip() or None)
        base_url_value = existing.get("base_url") if base_url is None else ((base_url or "").strip() or None)
        merged_config = {
            "owner": resolved_owner,
            "repo": resolved_repo,
            "default_branch": branch_value,
        }
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="github",
            secret=existing["secret"],
            display_name="GitHub",
            account_label=existing.get("account_label"),
            base_url=base_url_value,
            config=merged_config,
        )

    def delete_github(self, user_id: int) -> bool:
        return self._connector_repo.delete_by_user_and_type(user_id, "github")

    def save_jira_oauth(
        self,
        *,
        user_id: int,
        access_token: str,
        refresh_token: str | None,
        token_expiry,
        site_name: str | None,
        site_url: str,
        cloud_id: str,
    ):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="jira",
            secret=access_token,
            display_name="Jira",
            account_label=(site_name or "").strip() or None,
            base_url=f"https://api.atlassian.com/ex/jira/{cloud_id.strip()}",
            config={
                "auth_type": "oauth",
                "site_name": (site_name or "").strip() or None,
                "site_url": site_url.strip().rstrip("/"),
                "cloud_id": cloud_id.strip(),
                "project_key": "",
                "issue_type": "Task",
            },
            refresh_secret=(refresh_token or "").strip() or None,
            token_expiry=token_expiry,
        )

    def save_jira_settings(
        self,
        *,
        user_id: int,
        project_key: str | None = None,
        issue_type: str | None = None,
    ):
        existing = self._connector_repo.get_decrypted_config(user_id, "jira")
        if not existing:
            raise ValueError("Connect Jira before saving project settings.")

        prior_config = dict(existing.get("config") or {})
        resolved_project_key = str(prior_config.get("project_key") or "")
        if project_key is not None:
            resolved_project_key = project_key.strip()
        resolved_issue_type = str(prior_config.get("issue_type") or "Task")
        if issue_type is not None:
            resolved_issue_type = issue_type.strip() or "Task"

        merged_config = dict(prior_config)
        merged_config["project_key"] = resolved_project_key
        merged_config["issue_type"] = resolved_issue_type

        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="jira",
            secret=existing["secret"],
            display_name="Jira",
            account_label=existing.get("account_label"),
            base_url=existing.get("base_url"),
            config=merged_config,
            refresh_secret=existing.get("refresh_secret"),
            token_expiry=existing.get("token_expiry"),
        )

    def save_jira(
        self,
        *,
        user_id: int,
        site_url: str,
        email: str,
        token: str,
        project_key: str,
        issue_type: str | None = None,
    ):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="jira",
            secret=token,
            display_name="Jira",
            account_label=email.strip(),
            base_url=site_url.strip().rstrip("/"),
            config={
                "auth_type": "token",
                "project_key": project_key.strip(),
                "issue_type": (issue_type or "").strip() or "Task",
                "site_url": site_url.strip().rstrip("/"),
            },
        )

    def delete_jira(self, user_id: int) -> bool:
        return self._connector_repo.delete_by_user_and_type(user_id, "jira")
