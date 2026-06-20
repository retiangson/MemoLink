import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from memolink_backend.core.config import settings
from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/connectors", tags=["connectors"])

GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_SCOPES = "repo read:user"
ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize"
ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token"
ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"
ATLASSIAN_SCOPES = "offline_access read:jira-work write:jira-work read:jira-user"
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_PROFILE_URL = "https://api.spotify.com/v1/me"
SPOTIFY_SCOPES = (
    "user-read-email user-read-private user-read-playback-state "
    "user-modify-playback-state user-read-currently-playing streaming "
    "playlist-read-private playlist-read-collaborative user-library-read"
)


class GitHubConnectorBody(BaseModel):
    owner: str | None = None
    repo: str | None = None
    base_url: str | None = None
    branch: str | None = None


class JiraConnectorBody(BaseModel):
    project_key: str | None = None
    issue_type: str | None = None


class SpotifyPlayBody(BaseModel):
    uri: str | None = None
    uris: list[str] | None = None
    context_uri: str | None = None
    device_id: str | None = None
    shuffle: bool | None = None
    repeat_mode: str | None = None
    position_ms: int | None = None


def _sign_state(user_id: int) -> str:
    payload = json.dumps({"uid": user_id, "ts": int(time.time())})
    sig = hmac.new(settings.jwt_secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def _verify_state(state: str) -> int:
    try:
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        payload_str, sig = decoded.rsplit("|", 1)
        expected = hmac.new(settings.jwt_secret_key.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("invalid signature")
        data = json.loads(payload_str)
        if int(time.time()) - data["ts"] > 600:
            raise ValueError("state expired")
        return int(data["uid"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")


def _spotify_redirect_uri() -> str:
    # Spotify no longer accepts "localhost" redirect URIs for newly-created apps.
    # Normalize stale local env values so local development keeps working after
    # the developer allowlists the equivalent loopback IP URI in Spotify.
    return settings.spotify_redirect_uri.replace("://localhost:", "://127.0.0.1:")


@router.get("")
def list_connectors(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"connectors": c.connectors().list_connectors(user_id)}


@router.put("/github")
def save_github_connector(
    body: GitHubConnectorBody,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        c.connectors().save_github_settings(
            user_id=user_id,
            owner=body.owner,
            repo=body.repo,
            base_url=body.base_url,
            branch=body.branch,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True}


@router.get("/github/connect-url")
def get_github_connect_url(user_id: int = Depends(get_current_user)):
    if not settings.github_client_id or not settings.github_redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="GitHub OAuth is not fully configured — GITHUB_CLIENT_ID and GITHUB_REDIRECT_URI must be set",
        )
    state = _sign_state(user_id)
    url = (
        f"{GITHUB_AUTH_URL}"
        f"?client_id={quote(settings.github_client_id, safe='')}"
        f"&redirect_uri={quote(settings.github_redirect_uri, safe='')}"
        f"&scope={quote(GITHUB_SCOPES, safe='')}"
        f"&state={quote(state, safe='')}"
    )
    return {"url": url}


@router.get("/github/callback")
async def github_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    c: RequestContainer = Depends(get_request_container),
):
    frontend = settings.frontend_url.rstrip("/")
    if error:
        msg = error_description or error
        return RedirectResponse(url=f"{frontend}?github_error={quote(msg, safe='')}")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing GitHub OAuth code or state.")

    user_id = _verify_state(state)

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": settings.github_redirect_uri,
                "state": state,
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange GitHub OAuth code for an access token.")

    token_data = token_resp.json()
    access_token = (token_data.get("access_token") or "").strip()
    if not access_token:
        raise HTTPException(status_code=400, detail="GitHub did not return an access token.")

    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            GITHUB_USER_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
    if user_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="GitHub OAuth token could not access the GitHub user profile.")

    profile = user_resp.json()
    account_label = (profile.get("login") or profile.get("name") or "").strip() or None
    c.connectors().save_github_oauth(
        user_id=user_id,
        token=access_token,
        account_label=account_label,
    )
    return RedirectResponse(url=f"{frontend}?github_connected=1")


@router.delete("/github")
def delete_github_connector(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    if not c.connectors().delete_github(user_id):
        raise HTTPException(status_code=404, detail="GitHub connector not configured")
    return {"ok": True}


@router.put("/jira")
def save_jira_connector(
    body: JiraConnectorBody,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        c.connectors().save_jira_settings(
            user_id=user_id,
            project_key=body.project_key,
            issue_type=body.issue_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True}


@router.get("/jira/connect-url")
def get_jira_connect_url(user_id: int = Depends(get_current_user)):
    if not settings.jira_client_id or not settings.jira_redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="Jira OAuth is not fully configured — JIRA_CLIENT_ID and JIRA_REDIRECT_URI must be set",
        )
    state = _sign_state(user_id)
    url = (
        f"{ATLASSIAN_AUTH_URL}"
        f"?audience=api.atlassian.com"
        f"&client_id={quote(settings.jira_client_id, safe='')}"
        f"&scope={quote(ATLASSIAN_SCOPES, safe='')}"
        f"&redirect_uri={quote(settings.jira_redirect_uri, safe='')}"
        f"&state={quote(state, safe='')}"
        f"&response_type=code"
        f"&prompt=consent"
    )
    return {"url": url}


@router.get("/jira/callback")
async def jira_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    c: RequestContainer = Depends(get_request_container),
):
    frontend = settings.frontend_url.rstrip("/")
    if error:
        msg = error_description or error
        return RedirectResponse(url=f"{frontend}?jira_error={quote(msg, safe='')}")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing Jira OAuth code or state.")

    user_id = _verify_state(state)

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            ATLASSIAN_TOKEN_URL,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            json={
                "grant_type": "authorization_code",
                "client_id": settings.jira_client_id,
                "client_secret": settings.jira_client_secret,
                "code": code,
                "redirect_uri": settings.jira_redirect_uri,
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange Jira OAuth code for an access token.")

    token_data = token_resp.json()
    access_token = (token_data.get("access_token") or "").strip()
    refresh_token = (token_data.get("refresh_token") or "").strip() or None
    expires_in = int(token_data.get("expires_in") or 3600)
    if not access_token:
        raise HTTPException(status_code=400, detail="Jira OAuth did not return an access token.")

    async with httpx.AsyncClient() as client:
        resources_resp = await client.get(
            ATLASSIAN_RESOURCES_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if resources_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Jira OAuth token could not list accessible Atlassian resources.")

    resources = resources_resp.json()
    site = next(
        (
            item
            for item in resources
            if "read:jira-work" in (item.get("scopes") or [])
            or "write:jira-work" in (item.get("scopes") or [])
        ),
        None,
    )
    if not site:
        raise HTTPException(status_code=400, detail="No Jira Cloud site is accessible with this Atlassian account.")

    c.connectors().save_jira_oauth(
        user_id=user_id,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expiry=datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc),
        site_name=(site.get("name") or "").strip() or None,
        site_url=(site.get("url") or "").strip(),
        cloud_id=(site.get("id") or "").strip(),
    )
    return RedirectResponse(url=f"{frontend}?jira_connected=1")


@router.delete("/jira")
def delete_jira_connector(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    if not c.connectors().delete_jira(user_id):
        raise HTTPException(status_code=404, detail="Jira connector not configured")
    return {"ok": True}


@router.get("/spotify/connect-url")
def get_spotify_connect_url(user_id: int = Depends(get_current_user)):
    redirect_uri = _spotify_redirect_uri()
    if not settings.spotify_client_id or not redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="Spotify OAuth is not fully configured — SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI must be set",
        )
    state = _sign_state(user_id)
    url = (
        f"{SPOTIFY_AUTH_URL}"
        f"?client_id={quote(settings.spotify_client_id, safe='')}"
        f"&response_type=code"
        f"&redirect_uri={quote(redirect_uri, safe='')}"
        f"&scope={quote(SPOTIFY_SCOPES, safe='')}"
        f"&state={quote(state, safe='')}"
        f"&show_dialog=true"
    )
    return {"url": url, "redirect_uri": redirect_uri}


@router.get("/spotify/debug-config")
def spotify_debug_config():
    return {
        "spotify_client_id": settings.spotify_client_id[:8] + "..." if settings.spotify_client_id else "(not set)",
        "spotify_redirect_uri": _spotify_redirect_uri(),
        "raw_spotify_redirect_uri": settings.spotify_redirect_uri,
    }


@router.get("/spotify/callback")
async def spotify_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    c: RequestContainer = Depends(get_request_container),
):
    frontend = settings.frontend_url.rstrip("/")
    if error:
        return RedirectResponse(url=f"{frontend}?spotify_error={quote(error, safe='')}")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing Spotify OAuth code or state.")

    user_id = _verify_state(state)

    if not settings.spotify_client_id or not settings.spotify_client_secret:
        raise HTTPException(status_code=503, detail="Spotify OAuth is not fully configured on the server.")

    redirect_uri = _spotify_redirect_uri()
    basic = base64.b64encode(f"{settings.spotify_client_id}:{settings.spotify_client_secret}".encode()).decode()
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            SPOTIFY_TOKEN_URL,
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange Spotify OAuth code for tokens.")

    token_data = token_resp.json()
    access_token = (token_data.get("access_token") or "").strip()
    refresh_token = (token_data.get("refresh_token") or "").strip() or None
    expires_in = int(token_data.get("expires_in") or 3600)
    if not access_token:
        raise HTTPException(status_code=400, detail="Spotify did not return an access token.")

    async with httpx.AsyncClient() as client:
        profile_resp = await client.get(
            SPOTIFY_PROFILE_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if profile_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Spotify OAuth token could not access your profile.")

    profile = profile_resp.json()
    account_label = (profile.get("display_name") or profile.get("email") or profile.get("id") or "").strip()
    profile_url = ((profile.get("external_urls") or {}).get("spotify") or "").strip()
    c.connectors().save_spotify_oauth(
        user_id=user_id,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expiry=datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc),
        account_label=account_label or None,
        profile_url=profile_url or None,
        scope=(token_data.get("scope") or "").strip(),
    )
    return RedirectResponse(url=f"{frontend}?spotify_connected=1")


@router.delete("/spotify")
def delete_spotify_connector(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    if not c.connectors().delete_spotify(user_id):
        raise HTTPException(status_code=404, detail="Spotify connector not configured")
    return {"ok": True}


@router.post("/spotify/playback/{action}")
async def control_spotify_playback(
    action: str,
    body: SpotifyPlayBody | None = None,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.connectors().control_spotify_playback(
            user_id,
            action,
            uri=body.uri if body else None,
            uris=body.uris if body else None,
            context_uri=body.context_uri if body else None,
            device_id=body.device_id if body else None,
            shuffle=body.shuffle if body else None,
            repeat_mode=body.repeat_mode if body else None,
            position_ms=body.position_ms if body else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/spotify/library")
async def spotify_library(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.connectors().get_spotify_library(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/spotify/search")
async def spotify_search(
    q: str = Query(..., min_length=1),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.connectors().search_spotify(user_id, q)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/spotify/playlists/{playlist_id}/tracks")
async def spotify_playlist_tracks(
    playlist_id: str,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.connectors().get_spotify_playlist_tracks(user_id, playlist_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/spotify/player-token")
async def spotify_player_token(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        access_token = await c.connectors().get_spotify_access_token(user_id)
        return {"access_token": access_token}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
