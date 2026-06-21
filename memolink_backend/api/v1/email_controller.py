import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

import boto3
import httpx
from botocore.config import Config
from botocore.exceptions import ClientError
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer
from fastapi.responses import RedirectResponse, Response

from memolink_backend.core.config import settings
from memolink_backend.core.security import get_current_user, verify_token
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/email", tags=["email"])

# Gmail hard-caps a sent message at ~25 MB once MIME-encoded; base64 inflates
# raw bytes by ~37%, so keep the raw attachment total comfortably under that.
_MAX_ATTACHMENT_TOTAL_BYTES = 18 * 1024 * 1024


def _s3():
    kwargs = {
        "region_name": settings.aws_region,
        "config": Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    }
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        if settings.aws_session_token:
            kwargs["aws_session_token"] = settings.aws_session_token
    return boto3.client("s3", **kwargs)


def _download_attachments(attachments_meta: list[dict]) -> list[dict]:
    """Download each {key, filename, content_type} from S3 and return the
    same dicts with raw bytes under "data", enforcing a total size cap so a
    single send can't build an oversized Gmail message."""
    if not attachments_meta:
        return []
    s3 = _s3()
    total = 0
    out: list[dict] = []
    for meta in attachments_meta:
        key = meta.get("key")
        if not key:
            continue
        try:
            obj = s3.get_object(Bucket=settings.s3_upload_bucket, Key=key)
            data = obj["Body"].read()
        except ClientError as exc:
            raise HTTPException(status_code=502, detail=f"Could not read attachment '{meta.get('filename', key)}': {exc}")
        total += len(data)
        if total > _MAX_ATTACHMENT_TOTAL_BYTES:
            raise HTTPException(
                status_code=422,
                detail=f"Attachments exceed the {_MAX_ATTACHMENT_TOTAL_BYTES // (1024 * 1024)} MB total limit per email.",
            )
        out.append({
            "filename": meta.get("filename") or key.split("/")[-1],
            "content_type": meta.get("content_type"),
            "data": data,
        })
    return out


def _cleanup_attachments(attachments_meta: list[dict]) -> None:
    """Best-effort delete of the temporary S3 objects after a send attempt."""
    if not attachments_meta:
        return
    s3 = _s3()
    for meta in attachments_meta:
        key = meta.get("key")
        if not key:
            continue
        try:
            s3.delete_object(Bucket=settings.s3_upload_bucket, Key=key)
        except Exception:
            pass

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SCOPES = " ".join([
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
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
    granted_scope = token_data.get("scope", "")
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
        granted_scope=granted_scope,
    )

    return RedirectResponse(url=f"{settings.frontend_url}?email_connected=1")


@router.get("/status")
def email_status(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    from memolink_backend.business.services.calendar_connector import has_calendar_scope

    accounts = c.domain.get_email_account_repository().list_by_user(user_id)
    if not accounts:
        return {"connected": False, "accounts": []}
    return {
        "connected": True,
        "accounts": [
            {
                "id": a.id, "email": a.email_address, "provider": a.provider, "page_size": a.page_size,
                "display_name": a.display_name, "calendar_connected": has_calendar_scope(a.granted_scope),
            }
            for a in accounts
        ],
    }


@router.delete("/disconnect")
def disconnect_email(
    email_address: Optional[str] = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    repo = c.domain.get_email_account_repository()
    if email_address:
        repo.delete_by_email(user_id, email_address)
    else:
        repo.delete_by_user_id(user_id)
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
    email_account_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"emails": c.email().list_emails(user_id, email_account_id=email_account_id)}


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
    note_result = c.email().create_note_from_email(user_id, email_id)
    if not note_result:
        raise HTTPException(status_code=404, detail="Email not found")
    return note_result


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
    attachments_meta = body.get("attachments") or []
    attachments = _download_attachments(attachments_meta)
    try:
        sent = await c.email().send_reply(user_id, email_id, reply_body, attachments=attachments)
    finally:
        _cleanup_attachments(attachments_meta)
    if not sent:
        raise HTTPException(status_code=400, detail="Failed to send reply - check Gmail connection")
    return {"ok": True}


@router.post("/emails/{email_id}/reply-suggestions")
def reply_suggestions(
    email_id: int,
    body: dict | None = None,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    draft_hint = (body or {}).get("draft")
    replies = c.email().reply_suggestions(user_id, email_id, draft_hint=draft_hint)
    if replies is None or (isinstance(replies, list) and len(replies) == 0):
        raise HTTPException(status_code=404, detail="Email not found or could not generate replies")
    return {"replies": replies}


@router.post("/emails/{email_id}/to-reminder", status_code=201)
def email_to_reminder(
    email_id: int,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    reminder_result = c.email().create_reminder_from_email(user_id, email_id)
    if not reminder_result:
        raise HTTPException(status_code=404, detail="Email not found")
    return reminder_result


@router.post("/send-draft")
async def send_draft(
    payload: dict,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Send a confirmed email draft via Gmail. Called only after explicit user approval."""
    to = payload.get("to", "")
    subject = payload.get("subject", "")
    body = payload.get("body", "")
    thread_id = payload.get("thread_id", "")
    message_id = payload.get("message_id", "")
    email_account_id = payload.get("email_account_id")
    attachments_meta = payload.get("attachments") or []

    if not to or not body:
        raise HTTPException(status_code=400, detail="to and body are required")
    attachments = _download_attachments(attachments_meta)
    try:
        sent = await c.email().send_draft(
            user_id,
            to=to,
            subject=subject,
            body=body,
            thread_id=thread_id,
            message_id=message_id,
            email_account_id=email_account_id,
            attachments=attachments,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 403 if "connected" in detail.lower() else 502
        raise HTTPException(status_code=status_code, detail=detail)
    finally:
        _cleanup_attachments(attachments_meta)
    return {"ok": True, "gmail_message_id": sent.get("id")}


@router.post("/compose-suggest")
def compose_suggest(
    payload: dict,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    """Generate a full email body draft from a short topic description, for the New Mail compose tab."""
    to = payload.get("to", "")
    subject = payload.get("subject", "")
    topic = payload.get("topic", "")
    if not topic.strip():
        raise HTTPException(status_code=400, detail="topic is required")
    body = c.email().generate_compose_draft(user_id, to=to, subject=subject, topic=topic)
    if not body:
        raise HTTPException(status_code=502, detail="Could not generate a draft")
    return {"body": body}


@router.get("/browse")
async def browse_emails(
    folder: str = Query(..., pattern="^(inbox|outbox|drafts|trash|all)$"),
    email_account_id: int | None = Query(default=None),
    page_token: str | None = Query(default=None),
    page_size: int | None = Query(default=None, ge=5, le=100),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        result = await c.email().browse(
            user_id,
            folder=folder,
            email_account_id=email_account_id,
            page_token=page_token,
            page_size=page_size,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/{gmail_message_id}/archive")
async def archive_gmail_message(
    gmail_message_id: str,
    email_account_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.email().archive_email(
            user_id, gmail_message_id=gmail_message_id, email_account_id=email_account_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/{gmail_message_id}/trash")
async def trash_gmail_message(
    gmail_message_id: str,
    email_account_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.email().trash_email(
            user_id, gmail_message_id=gmail_message_id, email_account_id=email_account_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/{gmail_message_id}/pin")
async def pin_gmail_message(
    gmail_message_id: str,
    email_account_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return await c.email().pin_email(
            user_id, gmail_message_id=gmail_message_id, email_account_id=email_account_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/gmail/{gmail_message_id}/pin")
def unpin_gmail_message(
    gmail_message_id: str,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        return c.email().unpin_email(user_id, gmail_message_id=gmail_message_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/{gmail_message_id}/reply-suggestions")
async def gmail_reply_suggestions(
    gmail_message_id: str,
    body: dict | None = None,
    email_account_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    draft_hint = (body or {}).get("draft")
    try:
        replies = await c.email().gmail_reply_suggestions(
            user_id, gmail_message_id=gmail_message_id, email_account_id=email_account_id, draft_hint=draft_hint,
        )
        return {"replies": replies}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/{gmail_message_id}/send-reply")
async def gmail_send_reply(
    gmail_message_id: str,
    body: dict,
    email_account_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    reply_body = (body.get("body") or "").strip()
    if not reply_body:
        raise HTTPException(status_code=400, detail="Reply body cannot be empty")
    attachments_meta = body.get("attachments") or []
    attachments = _download_attachments(attachments_meta)
    try:
        sent = await c.email().gmail_send_reply(
            user_id, gmail_message_id=gmail_message_id, email_account_id=email_account_id, body=reply_body,
            attachments=attachments,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        _cleanup_attachments(attachments_meta)
    if not sent:
        raise HTTPException(status_code=400, detail="Failed to send reply - check Gmail connection")
    return {"ok": True}


@router.post("/gmail/{gmail_message_id}/to-note", status_code=201)
async def gmail_to_note(
    gmail_message_id: str,
    email_account_id: int | None = Query(default=None),
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        note_result = await c.email().email_to_note_by_gmail_id(
            user_id, gmail_message_id=gmail_message_id, email_account_id=email_account_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not note_result:
        raise HTTPException(status_code=404, detail="Email not found")
    return note_result


@router.put("/accounts/{account_id}/settings")
def update_account_settings(
    account_id: int,
    payload: dict,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    page_size = payload.get("page_size")
    display_name = payload.get("display_name")
    if page_size is None and display_name is None:
        raise HTTPException(status_code=400, detail="page_size or display_name is required")
    try:
        result: dict = {}
        if page_size is not None:
            result.update(c.email().update_account_page_size(user_id, account_id, int(page_size)))
        if display_name is not None:
            result.update(c.email().update_account_display_name(user_id, account_id, display_name))
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/attachment/{gmail_message_id}/{attachment_id}")
async def download_attachment(
    gmail_message_id: str,
    attachment_id: str,
    filename: str = Query("attachment"),
    token: Optional[str] = Query(None),
    email_account_id: Optional[int] = Query(None),
    disposition: str = Query("attachment"),
    c: RequestContainer = Depends(get_request_container),
    credentials=Depends(HTTPBearer(auto_error=False)),
):
    """Fetch a Gmail attachment and stream it to the browser as a download.
    Accepts JWT via ?token= query param (for direct browser links) or Authorization header.
    `disposition=inline` is used for cid: inline images rendered inside the email body.
    """
    if token:
        resolved_uid = verify_token(token)
    elif credentials and hasattr(credentials, "credentials"):
        resolved_uid = verify_token(credentials.credentials)
    else:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        file_bytes = await c.email().download_attachment(
            resolved_uid, gmail_message_id, attachment_id, email_account_id=email_account_id
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 403 if "connected" in detail.lower() else 502
        raise HTTPException(status_code=status_code, detail=detail)

    # Guess content type from filename extension
    import mimetypes
    mime, _ = mimetypes.guess_type(filename)
    content_type = mime or "application/octet-stream"

    safe_disposition = "inline" if disposition == "inline" else "attachment"
    safe_filename = quote(filename)
    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'{safe_disposition}; filename="{safe_filename}"'},
    )
