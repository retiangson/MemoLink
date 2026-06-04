import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from memolink_backend.core.config import settings
from memolink_backend.core.security import get_current_user
from memolink_backend.contracts.note_dtos import NoteCreateDTO
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/teams", tags=["teams"])

MS_AUTH_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
MS_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
MS_GRAPH_ME  = "https://graph.microsoft.com/v1.0/me"

SCOPES = " ".join([
    "https://graph.microsoft.com/Chat.ReadWrite",
    "https://graph.microsoft.com/ChannelMessage.ReadWrite",
    "https://graph.microsoft.com/User.Read",
    "offline_access",
])


def _sign_state(user_id: int) -> str:
    import base64
    payload = json.dumps({"uid": user_id, "ts": int(time.time())})
    sig = hmac.new(settings.jwt_secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def _verify_state(state: str) -> int:
    import base64
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



@router.get("/debug-config")
def debug_config():
    return {
        "teams_client_id": settings.teams_client_id[:8] + "..." if settings.teams_client_id else "(not set)",
        "teams_tenant_id": settings.teams_tenant_id or "(not set - will use common)",
        "teams_redirect_uri": settings.teams_redirect_uri,
    }


@router.get("/connect-url")
def get_connect_url(user_id: int = Depends(get_current_user)):
    if not settings.teams_client_id:
        raise HTTPException(status_code=503, detail="Teams OAuth is not configured on this server")
    state = _sign_state(user_id)
    tenant = settings.teams_tenant_id or "common"
    url = (
        MS_AUTH_URL.format(tenant=tenant)
        + f"?client_id={quote(settings.teams_client_id)}"
        + f"&response_type=code"
        + f"&redirect_uri={quote(settings.teams_redirect_uri, safe='')}"
        + f"&scope={quote(SCOPES, safe='')}"
        + f"&response_mode=query"
        + f"&state={quote(state, safe='')}"
    )
    return {"url": url}


@router.get("/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    c: RequestContainer = Depends(get_request_container),
):
    user_id = _verify_state(state)
    tenant = settings.teams_tenant_id or "common"

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            MS_TOKEN_URL.format(tenant=tenant),
            data={
                "code": code,
                "client_id": settings.teams_client_id,
                "client_secret": settings.teams_client_secret,
                "redirect_uri": settings.teams_redirect_uri,
                "grant_type": "authorization_code",
                "scope": SCOPES,
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange OAuth code for tokens")

    token_data = token_resp.json()
    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token", "")
    expires_in = token_data.get("expires_in", 3600)
    expiry = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)

    async with httpx.AsyncClient() as client:
        me_resp = await client.get(
            MS_GRAPH_ME,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    me = me_resp.json() if me_resp.status_code == 200 else {}

    c.domain.get_teams_account_repository().upsert(
        user_id=user_id,
        teams_user_id=me.get("id", ""),
        display_name=me.get("displayName", ""),
        email=me.get("mail") or me.get("userPrincipalName", ""),
        access_token=access_token,
        refresh_token=refresh_token,
        token_expiry=expiry,
    )

    return RedirectResponse(url=f"{settings.frontend_url}?teams_connected=1")


@router.get("/status")
def teams_status(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.teams().get_status(user_id)


@router.delete("/disconnect")
def disconnect_teams(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    c.teams().disconnect(user_id)
    return {"ok": True}


@router.get("/chats")
async def list_chats(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    chats = await c.teams().list_chats(user_id)
    return {"chats": chats}


@router.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    messages = await c.teams().get_messages(user_id, chat_id, limit=limit)
    return {"messages": messages}


@router.post("/chats/{chat_id}/send")
async def send_message(
    chat_id: str,
    body: dict,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message text cannot be empty")
    sent = await c.teams().send_message(user_id, chat_id, text)
    if not sent:
        raise HTTPException(status_code=400, detail="Failed to send message")
    return {"ok": True}


@router.post("/chats/{chat_id}/to-note", status_code=201)
async def chat_to_note(
    chat_id: str,
    body: dict,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    topic = (body.get("topic") or "Teams Chat").strip()
    workspace_id: int | None = body.get("workspace_id")
    note_data = await c.teams().messages_to_note_content(user_id, chat_id, topic)
    dto = NoteCreateDTO(
        user_id=user_id,
        title=note_data["title"],
        content=note_data["content"],
        source="teams",
        workspace_id=workspace_id,
    )
    note = c.notes().create_note(dto)
    return {"note_id": note.id, "title": note.title}
