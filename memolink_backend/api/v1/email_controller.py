import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer
from fastapi.responses import RedirectResponse, Response

from memolink_backend.core.config import settings
from memolink_backend.core.security import get_current_user, verify_token
from memolink_backend.contracts.note_dtos import NoteCreateDTO
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/email", tags=["email"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SCOPES = " ".join([
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
])


def _sign_state(user_id: int) -> str:
    payload = json.dumps({"uid": user_id, "ts": int(time.time())})
    sig = hmac.new(settings.jwt_secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    import base64
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


@router.get("/connect-url")
def get_connect_url(user_id: int = Depends(get_current_user)):
    if not settings.google_client_id or not settings.google_redirect_uri:
        raise HTTPException(status_code=503, detail="Google OAuth is not fully configured — GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI must be set")
    state = _sign_state(user_id)
    params = (
        f"?client_id={quote(settings.google_client_id, safe='')}"
        f"&redirect_uri={quote(settings.google_redirect_uri, safe='')}"
        f"&response_type=code"
        f"&scope={quote(SCOPES, safe='')}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
    )
    return {"url": GOOGLE_AUTH_URL + params}


@router.get("/callback")
async def oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    c: RequestContainer = Depends(get_request_container),
):
    # Google redirected back with an error (e.g. redirect_uri_mismatch, access_denied)
    if error:
        frontend = settings.frontend_url.rstrip("/")
        msg = error_description or error
        return RedirectResponse(url=f"{frontend}?email_error={quote(msg, safe='')}")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state parameter from Google")
    user_id = _verify_state(state)

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
        })
    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange OAuth code for tokens")

    token_data = token_resp.json()
    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token", "")
    expires_in = token_data.get("expires_in", 3600)
    expiry = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)

    # Fetch the user's Gmail address
    async with httpx.AsyncClient() as client:
        info_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    email_address = info_resp.json().get("email", "") if info_resp.status_code == 200 else ""

    c.domain.get_email_account_repository().upsert(
        user_id=user_id,
        email_address=email_address,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expiry=expiry,
    )

    return RedirectResponse(url=f"{settings.frontend_url}?email_connected=1")


@router.get("/status")
def email_status(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    row = c.domain.get_email_account_repository().get_by_user_id(user_id)
    if not row:
        return {"connected": False, "email": None}
    return {"connected": True, "email": row.email_address, "provider": row.provider}


@router.delete("/disconnect")
def disconnect_email(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    c.domain.get_email_account_repository().delete_by_user_id(user_id)
    c.domain.get_email_record_repository().delete_all_by_user(user_id)
    return {"ok": True}


@router.post("/sync")
async def sync_emails(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        result = await c.email().sync(user_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/auto-process")
async def auto_process(
    workspace_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        result = await c.email().auto_process(user_id, c.domain.get_db(), workspace_id=workspace_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/emails")
def list_emails(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"emails": c.email().list_emails(user_id)}


@router.get("/emails/{email_id}")
def get_email(
    email_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    email = c.email().get_email(user_id, email_id)
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email


@router.delete("/emails/{email_id}")
def delete_email(
    email_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    deleted = c.domain.get_email_record_repository().delete_by_id(user_id, email_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Email not found")
    return {"ok": True}


@router.post("/emails/{email_id}/to-note", status_code=201)
def email_to_note(
    email_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    note_data = c.email().build_note_content(user_id, email_id)
    if not note_data:
        raise HTTPException(status_code=404, detail="Email not found")
    dto = NoteCreateDTO(
        user_id=user_id,
        title=note_data["title"],
        content=note_data["content"],
        source="email",
    )
    note = c.notes().create_note(dto)
    return {"note_id": note.id, "title": note.title}


@router.post("/emails/{email_id}/send-reply")
async def send_reply(
    email_id: int,
    body: dict,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    reply_body = (body.get("body") or "").strip()
    if not reply_body:
        raise HTTPException(status_code=400, detail="Reply body cannot be empty")
    sent = await c.email().send_reply(user_id, email_id, reply_body)
    if not sent:
        raise HTTPException(status_code=400, detail="Failed to send reply - check Gmail connection")
    return {"ok": True}


@router.get("/emails/{email_id}/reply-suggestions")
def reply_suggestions(
    email_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    replies = c.email().reply_suggestions(user_id, email_id)
    if replies is None or (isinstance(replies, list) and len(replies) == 0):
        raise HTTPException(status_code=404, detail="Email not found or could not generate replies")
    return {"replies": replies}


@router.post("/emails/{email_id}/to-reminder", status_code=201)
def email_to_reminder(
    email_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    data = c.email().extract_reminder(user_id, email_id)
    if not data:
        raise HTTPException(status_code=404, detail="Email not found")
    db = c.domain.get_db()
    reminder = Reminder(
        user_id=user_id,
        text=data["text"],
        description=data.get("description"),
        type="ai",
        done=False,
        due_date=data.get("due_date"),
        due_time=data.get("due_time"),
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return {
        "reminder_id": reminder.id,
        "text": reminder.text,
        "due_date": reminder.due_date,
        "due_time": reminder.due_time,
    }


@router.post("/send-draft")
async def send_draft(
    payload: dict,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Send a confirmed email draft via Gmail. Called only after explicit user approval."""
    from email.mime.text import MIMEText
    import base64 as _b64

    to = payload.get("to", "")
    subject = payload.get("subject", "")
    body = payload.get("body", "")
    thread_id = payload.get("thread_id", "")
    message_id = payload.get("message_id", "")

    if not to or not body:
        raise HTTPException(status_code=400, detail="to and body are required")

    account_repo = c.domain.get_email_account_repository()
    tokens = account_repo.get_decrypted_tokens(user_id)
    if not tokens:
        raise HTTPException(status_code=403, detail="Gmail not connected")

    access_token = tokens.get("access_token", "")
    expiry = tokens.get("token_expiry")
    if expiry and datetime.now(tz=timezone.utc) >= expiry:
        async with httpx.AsyncClient() as client:
            ref = await client.post(GOOGLE_TOKEN_URL, data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": tokens.get("refresh_token", ""),
                "grant_type": "refresh_token",
            })
        if ref.status_code == 200:
            access_token = ref.json().get("access_token", access_token)

    msg = MIMEText(body, "plain", "utf-8")
    msg["To"] = to
    msg["Subject"] = subject
    if message_id:
        msg["In-Reply-To"] = message_id
        msg["References"] = message_id

    raw = _b64.urlsafe_b64encode(msg.as_bytes()).decode()
    gmail_payload: dict = {"raw": raw}
    if thread_id:
        gmail_payload["threadId"] = thread_id

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://www.googleapis.com/gmail/v1/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            json=gmail_payload,
        )

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Gmail send failed: {resp.text[:200]}")

    return {"ok": True, "gmail_message_id": resp.json().get("id")}


@router.get("/attachment/{gmail_message_id}/{attachment_id}")
async def download_attachment(
    gmail_message_id: str,
    attachment_id: str,
    filename: str = Query("attachment"),
    token: Optional[str] = Query(None),
    c: RequestContainer = Depends(get_request_container),
    credentials=Depends(HTTPBearer(auto_error=False)),
):
    """Fetch a Gmail attachment and stream it to the browser as a download.
    Accepts JWT via ?token= query param (for direct browser links) or Authorization header.
    """
    if token:
        resolved_uid = verify_token(token)
    elif credentials and hasattr(credentials, "credentials"):
        resolved_uid = verify_token(credentials.credentials)
    else:
        raise HTTPException(status_code=401, detail="Not authenticated")

    account_repo = c.domain.get_email_account_repository()
    tokens = account_repo.get_decrypted_tokens(resolved_uid)
    if not tokens:
        raise HTTPException(status_code=403, detail="Gmail not connected")

    access_token = tokens.get("access_token", "")
    expiry = tokens.get("token_expiry")

    # Refresh token if expired
    if expiry and datetime.now(tz=timezone.utc) >= expiry:
        async with httpx.AsyncClient() as client:
            ref = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": tokens.get("refresh_token", ""),
                "grant_type": "refresh_token",
            })
        if ref.status_code == 200:
            access_token = ref.json().get("access_token", access_token)

    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://www.googleapis.com/gmail/v1/users/me/messages/{gmail_message_id}/attachments/{attachment_id}",
            headers=headers,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail API returned {resp.status_code}: {resp.text[:200]}"
        )

    data = resp.json().get("data", "")
    file_bytes = base64.urlsafe_b64decode(data + "==")

    # Guess content type from filename extension
    import mimetypes
    mime, _ = mimetypes.guess_type(filename)
    content_type = mime or "application/octet-stream"

    safe_filename = quote(filename)
    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )
