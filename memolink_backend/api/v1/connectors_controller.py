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


class GitHubConnectorBody(BaseModel):
    owner: str | None = None
    repo: str | None = None
    base_url: str | None = None
    branch: str | None = None


class JiraConnectorBody(BaseModel):
    project_key: str | None = None
    issue_type: str | None = None


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
