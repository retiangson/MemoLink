import base64
import json
import re
import time
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime

import httpx
from openai import OpenAI

from memolink_backend.core.config import settings
from memolink_backend.core.encryption import encrypt_text, decrypt_text
from memolink_backend.domain.repositories.email_account_repository import EmailAccountRepository
from memolink_backend.domain.repositories.email_record_repository import EmailRecordRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.business.services.embedding_service import EmbeddingService

GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _strip_html(html: str) -> str:
    text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _decode_body(part: dict) -> str:
    data = part.get("body", {}).get("data", "")
    if not data:
        return ""
    try:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_body(payload: dict) -> str:
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        return _decode_body(payload)
    if mime == "text/html":
        return _strip_html(_decode_body(payload))
    for part in payload.get("parts", []):
        text = _extract_body(part)
        if text:
            return text
    return ""


def _extract_attachments(payload: dict) -> list[dict]:
    """Return list of {filename, attachment_id, size} for all file parts."""
    parts = payload.get("parts", [])
    results = []
    for part in parts:
        filename = part.get("filename", "")
        body = part.get("body", {})
        attachment_id = body.get("attachmentId")
        if filename and attachment_id:
            results.append({
                "filename": filename,
                "attachment_id": attachment_id,
                "size": body.get("size", 0),
                "mime_type": part.get("mimeType", ""),
            })
        # Recurse into nested parts
        results.extend(_extract_attachments(part))
    return results


def _get_header(headers: list, name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


async def _refresh_token(refresh_token: str) -> tuple[str, datetime]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
    data = resp.json()
    access_token = data["access_token"]
    expires_in = data.get("expires_in", 3600)
    expiry = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)
    return access_token, expiry


async def _get_valid_token(account_repo: EmailAccountRepository, user_id: int) -> str:
    tokens = account_repo.get_decrypted_tokens(user_id)
    if not tokens:
        raise ValueError("No email account connected")
    expiry = tokens.get("token_expiry")
    if expiry and datetime.now(tz=timezone.utc) >= expiry:
        new_token, new_expiry = await _refresh_token(tokens["refresh_token"])
        account_repo.upsert(
            user_id=user_id,
            email_address=tokens["email"],
            access_token=new_token,
            refresh_token=tokens["refresh_token"],
            token_expiry=new_expiry,
        )
        return new_token
    return tokens["access_token"]


def _score_emails_with_gpt(emails: list[dict]) -> list[float]:
    if not emails:
        return []
    items = "\n".join(
        f"{i+1}. From: {e['sender']} | Subject: {e['subject']} | Preview: {e['snippet'][:120]}"
        for i, e in enumerate(emails)
    )
    prompt = (
        "You are an email importance classifier. Rate each email's importance from 1 (spam/newsletter) "
        "to 5 (urgent/action required). Consider: sender relevance, subject urgency, action words.\n\n"
        f"Emails:\n{items}\n\n"
        "Respond with ONLY a JSON array of numbers, e.g. [4, 2, 5, 1, 3]. One number per email."
    )
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=200,
        )
        content = resp.choices[0].message.content.strip()
        scores = json.loads(re.search(r"\[.*?\]", content, re.DOTALL).group())
        if len(scores) == len(emails):
            return [float(max(1, min(5, s))) for s in scores]
    except Exception:
        pass
    return [3.0] * len(emails)


class EmailService:
    def __init__(
        self,
        account_repo: EmailAccountRepository,
        record_repo: EmailRecordRepository,
        note_repo: NoteRepository | None = None,
        embedding_service: EmbeddingService | None = None,
    ):
        self.account_repo = account_repo
        self.record_repo = record_repo
        self.note_repo = note_repo
        self.embedding_service = embedding_service

    async def sync(self, user_id: int, max_results: int = 25) -> dict:
        access_token = await _get_valid_token(self.account_repo, user_id)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient() as client:
            list_resp = await client.get(
                f"{GMAIL_API}/messages",
                headers=headers,
                params={
                    "maxResults": max_results,
                    "q": "is:unread OR is:important -category:promotions -category:social",
                },
            )
        if list_resp.status_code != 200:
            raise ValueError(f"Gmail API error: {list_resp.status_code}")

        message_ids = [m["id"] for m in list_resp.json().get("messages", [])]
        new_ids = [mid for mid in message_ids if not self.record_repo.exists(user_id, mid)]
        if not new_ids:
            return {"synced": 0, "skipped": len(message_ids)}

        # Fetch full messages
        raw_emails = []
        async with httpx.AsyncClient() as client:
            for mid in new_ids:
                resp = await client.get(
                    f"{GMAIL_API}/messages/{mid}",
                    headers=headers,
                    params={"format": "full"},
                )
                if resp.status_code == 200:
                    raw_emails.append((mid, resp.json()))

        # Parse emails
        parsed = []
        for mid, msg in raw_emails:
            hdrs = msg.get("payload", {}).get("headers", [])
            subject = _get_header(hdrs, "Subject") or "(no subject)"
            from_raw = _get_header(hdrs, "From")
            sender_name, sender_email = parseaddr(from_raw)
            date_raw = _get_header(hdrs, "Date")
            try:
                email_date = parsedate_to_datetime(date_raw) if date_raw else None
            except Exception:
                email_date = None
            snippet = msg.get("snippet", "")
            body = _extract_body(msg.get("payload", {}))[:4000]
            is_read = "UNREAD" not in msg.get("labelIds", [])
            thread_id = msg.get("threadId")
            parsed.append({
                "mid": mid,
                "thread_id": thread_id,
                "subject": subject,
                "sender": f"{sender_name} <{sender_email}>" if sender_name else sender_email,
                "sender_name": sender_name or None,
                "sender_email": sender_email,
                "snippet": snippet,
                "body": body,
                "is_read": is_read,
                "email_date": email_date,
            })

        # Score importance in one GPT call
        scores = _score_emails_with_gpt(parsed)

        saved = 0
        for email, score in zip(parsed, scores):
            if score >= 3.0:
                record = self.record_repo.create(
                    user_id=user_id,
                    gmail_message_id=email["mid"],
                    gmail_thread_id=email.get("thread_id"),
                    subject=email["subject"],
                    sender_name=email["sender_name"],
                    sender_email=email["sender_email"],
                    snippet=email["snippet"],
                    body_text=email["body"],
                    importance_score=score,
                    is_read=email["is_read"],
                    email_date=email["email_date"],
                )
                saved += 1
                # Embed for RAG search in chat
                if self.embedding_service:
                    try:
                        embed_text = f"{email['subject']} {email['sender_email']} {email['snippet'] or ''} {email['body'][:1000]}"
                        vec = self.embedding_service.embed_text(embed_text)
                        self.record_repo.save_embedding(record.id, vec)
                    except Exception:
                        pass

        return {"synced": saved, "skipped": len(message_ids) - len(new_ids), "filtered": len(new_ids) - saved}

    def list_emails(self, user_id: int) -> list[dict]:
        rows = self.record_repo.list_by_user(user_id)
        return [
            {
                "id": r.id,
                "subject": r.subject,
                "sender_name": r.sender_name,
                "sender_email": r.sender_email,
                "snippet": r.snippet,
                "importance_score": r.importance_score,
                "is_read": r.is_read,
                "email_date": r.email_date.isoformat() if r.email_date else None,
            }
            for r in rows
        ]

    def get_email(self, user_id: int, record_id: int) -> dict | None:
        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return None
        return {
            "id": r.id,
            "subject": r.subject,
            "sender_name": r.sender_name,
            "sender_email": r.sender_email,
            "snippet": r.snippet,
            "body_text": r.body_text,
            "importance_score": r.importance_score,
            "is_read": r.is_read,
            "email_date": r.email_date.isoformat() if r.email_date else None,
            "gmail_thread_id": r.gmail_thread_id,
            "gmail_message_id": r.gmail_message_id,
        }

    async def send_reply(self, user_id: int, record_id: int, body: str) -> bool:
        from email.mime.text import MIMEText
        import base64 as _b64

        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return False
        access_token = await _get_valid_token(self.account_repo, user_id)

        msg = MIMEText(body, "plain", "utf-8")
        msg["To"] = r.sender_email
        msg["Subject"] = r.subject if r.subject.lower().startswith("re:") else f"Re: {r.subject}"
        msg["In-Reply-To"] = r.gmail_message_id
        msg["References"] = r.gmail_message_id

        raw = _b64.urlsafe_b64encode(msg.as_bytes()).decode()
        payload: dict = {"raw": raw}
        if r.gmail_thread_id:
            payload["threadId"] = r.gmail_thread_id

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{GMAIL_API}/messages/send",
                headers={"Authorization": f"Bearer {access_token}"},
                json=payload,
            )
        return resp.status_code == 200

    def build_note_content(self, user_id: int, record_id: int) -> dict | None:
        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return None
        sender = f"{r.sender_name} <{r.sender_email}>" if r.sender_name else r.sender_email
        date_str = r.email_date.strftime("%d %b %Y %H:%M") if r.email_date else ""
        content_lines = [
            f"<p><strong>From:</strong> {sender}</p>",
            f"<p><strong>Date:</strong> {date_str}</p>" if date_str else "",
            "<hr/>",
            f"<p>{(r.body_text or r.snippet or '').replace(chr(10), '</p><p>')}</p>",
        ]
        return {
            "title": r.subject,
            "content": "\n".join(line for line in content_lines if line),
        }

    def extract_reminder(self, user_id: int, record_id: int) -> dict | None:
        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return None
        prompt = (
            "Extract a reminder from this email. Return ONLY a JSON object with these fields:\n"
            "- text: short reminder title (max 80 chars)\n"
            "- description: one sentence summary (or null)\n"
            "- due_date: ISO date string YYYY-MM-DD if a deadline/date is mentioned, else null\n"
            "- due_time: HH:MM 24-hour time if mentioned, else null\n\n"
            f"Subject: {r.subject}\n"
            f"From: {r.sender_name or r.sender_email}\n"
            f"Body: {(r.body_text or r.snippet or '')[:1500]}"
        )
        try:
            client = OpenAI(api_key=settings.openai_api_key)
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=200,
            )
            content = resp.choices[0].message.content.strip()
            match = re.search(r"\{.*?\}", content, re.DOTALL)
            if match:
                data = json.loads(match.group())
                return {
                    "text": data.get("text") or r.subject,
                    "description": data.get("description"),
                    "due_date": data.get("due_date"),
                    "due_time": data.get("due_time"),
                }
        except Exception:
            pass
        return {"text": r.subject, "description": r.snippet, "due_date": None, "due_time": None}

    def _find_digest_note(self, user_id: int):
        """Return the existing Email Digest note for this user, or None."""
        if not self.note_repo:
            return None
        return (
            self.note_repo.db.query(__import__("memolink_backend.domain.models.note", fromlist=["Note"]).Note)
            .filter_by(user_id=user_id, title="Email Digest", source="email")
            .filter(__import__("memolink_backend.domain.models.note", fromlist=["Note"]).Note.deleted_at == None)
            .order_by(__import__("memolink_backend.domain.models.note", fromlist=["Note"]).Note.id.asc())
            .first()
        )

    def _format_email_block(self, r) -> str:
        sender = f"{r.sender_name} &lt;{r.sender_email}&gt;" if r.sender_name else r.sender_email
        date_str = r.email_date.strftime("%d %b %Y %H:%M") if r.email_date else ""
        score_label = "🔴 Urgent" if r.importance_score >= 4.5 else "🟠 Important" if r.importance_score >= 3.5 else "🔵 Notable"
        body = (r.body_text or r.snippet or "").replace("\n", "</p><p>")
        return (
            f'<hr/>'
            f'<p><strong>📧 {r.subject}</strong> <span style="color:#888">· {score_label}</span></p>'
            f'<p><small>From: {sender}{" · " + date_str if date_str else ""}</small></p>'
            f'<p>{body}</p>'
        )

    def live_search_sync(self, user_id: int, query: str, top_k: int = 3) -> list[dict]:
        """Synchronous Gmail search using httpx.Client — safe to call from any thread or sync context."""
        import httpx as _httpx
        import logging as _log
        _logger = _log.getLogger(__name__)

        # Fetch token from DB
        try:
            tokens = self.account_repo.get_decrypted_tokens(user_id)
        except Exception as exc:
            _logger.warning(f"[live_search] user={user_id} get_decrypted_tokens raised: {exc}")
            return []

        if not tokens:
            _logger.warning(f"[live_search] user={user_id} no tokens in DB")
            return []

        access_token = tokens.get("access_token", "")
        expiry = tokens.get("token_expiry")
        _logger.warning(
            f"[live_search] user={user_id} q={query!r} "
            f"token_len={len(access_token)} expired={bool(expiry and expiry <= datetime.now(tz=timezone.utc))}"
        )

        # Refresh if expired
        if expiry and expiry <= datetime.now(tz=timezone.utc):
            try:
                resp = _httpx.post(GOOGLE_TOKEN_URL, data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": tokens.get("refresh_token", ""),
                    "grant_type": "refresh_token",
                }, timeout=10.0)
                _logger.warning(f"[live_search] refresh status={resp.status_code} body={resp.text[:200]}")
                if resp.status_code == 200:
                    data = resp.json()
                    access_token = data["access_token"]
                    try:
                        new_expiry = datetime.fromtimestamp(
                            time.time() + data.get("expires_in", 3600), tz=timezone.utc
                        )
                        self.account_repo.upsert(
                            user_id=user_id,
                            email_address=tokens.get("email", ""),
                            access_token=access_token,
                            refresh_token=tokens.get("refresh_token", ""),
                            token_expiry=new_expiry,
                        )
                    except Exception:
                        pass
                else:
                    _logger.warning(f"[live_search] refresh failed — trying existing token anyway")
            except Exception as exc:
                _logger.warning(f"[live_search] refresh exception: {exc}")
                return []

        if not access_token:
            _logger.warning(f"[live_search] user={user_id} access_token empty after refresh attempt")
            return []

        headers = {"Authorization": f"Bearer {access_token}"}
        results: list[dict] = []

        try:
            with _httpx.Client(timeout=15.0) as client:
                list_resp = client.get(
                    f"{GMAIL_API}/messages",
                    headers=headers,
                    params={"maxResults": top_k * 2, "q": query},
                )
                import logging as _log
                _log.getLogger(__name__).warning(
                    f"[live_search] user={user_id} q={query!r} "
                    f"status={list_resp.status_code} "
                    f"body={list_resp.text[:300]}"
                )
                if list_resp.status_code != 200:
                    return []

                message_ids = [m["id"] for m in list_resp.json().get("messages", [])][:top_k * 2]
                if not message_ids:
                    return []

                for mid in message_ids:
                    resp = client.get(
                        f"{GMAIL_API}/messages/{mid}",
                        headers=headers,
                        params={"format": "full"},
                    )
                    if resp.status_code != 200:
                        continue
                    msg = resp.json()
                    hdrs = msg.get("payload", {}).get("headers", [])
                    subject = _get_header(hdrs, "Subject") or "(no subject)"
                    from_raw = _get_header(hdrs, "From")
                    sender_name, sender_email = parseaddr(from_raw)
                    date_raw = _get_header(hdrs, "Date")
                    try:
                        email_date = parsedate_to_datetime(date_raw) if date_raw else None
                    except Exception:
                        email_date = None
                    body = _extract_body(msg.get("payload", {}))[:3000]
                    attachments = _extract_attachments(msg.get("payload", {}))

                    # Save to email_records for future searches
                    if not self.record_repo.exists(user_id, mid):
                        try:
                            record = self.record_repo.create(
                                user_id=user_id,
                                gmail_message_id=mid,
                                gmail_thread_id=msg.get("threadId"),
                                subject=subject,
                                sender_name=sender_name or None,
                                sender_email=sender_email,
                                snippet=msg.get("snippet", ""),
                                body_text=body,
                                importance_score=3.0,
                                is_read="UNREAD" not in msg.get("labelIds", []),
                                email_date=email_date,
                            )
                            if self.embedding_service:
                                try:
                                    vec = self.embedding_service.embed_text(
                                        f"{subject} {sender_email} {msg.get('snippet', '')} {body[:1000]}"
                                    )
                                    self.record_repo.save_embedding(record.id, vec)
                                except Exception:
                                    pass
                        except Exception:
                            pass

                    results.append({
                        "id": mid,
                        "subject": subject,
                        "sender": f"{sender_name} <{sender_email}>" if sender_name else sender_email,
                        "date": email_date.strftime("%d %b %Y") if email_date else "",
                        "body": body,
                        "snippet": msg.get("snippet", ""),
                        "thread_id": msg.get("threadId"),
                        "attachments": attachments,
                    })
                    if len(results) >= top_k:
                        break
        except Exception:
            return []

        return results

    async def live_search(self, user_id: int, query: str, top_k: int = 3) -> list[dict]:
        """Search Gmail directly with a free-text query — no sync required.
        Returns the top matching emails as plain dicts ready for chat context.
        Also saves new results to email_records so they're available next time."""
        try:
            access_token = await _get_valid_token(self.account_repo, user_id)
        except Exception:
            return []

        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient() as client:
            list_resp = await client.get(
                f"{GMAIL_API}/messages",
                headers=headers,
                params={"maxResults": top_k * 2, "q": query},
            )
        if list_resp.status_code != 200:
            return []

        message_ids = [m["id"] for m in list_resp.json().get("messages", [])][:top_k * 2]
        if not message_ids:
            return []

        results = []
        async with httpx.AsyncClient() as client:
            for mid in message_ids:
                resp = await client.get(
                    f"{GMAIL_API}/messages/{mid}",
                    headers=headers,
                    params={"format": "full"},
                )
                if resp.status_code != 200:
                    continue
                msg = resp.json()
                hdrs = msg.get("payload", {}).get("headers", [])
                subject = _get_header(hdrs, "Subject") or "(no subject)"
                from_raw = _get_header(hdrs, "From")
                sender_name, sender_email = parseaddr(from_raw)
                date_raw = _get_header(hdrs, "Date")
                try:
                    email_date = parsedate_to_datetime(date_raw) if date_raw else None
                except Exception:
                    email_date = None
                snippet = msg.get("snippet", "")
                body = _extract_body(msg.get("payload", {}))[:3000]
                thread_id = msg.get("threadId")
                is_read = "UNREAD" not in msg.get("labelIds", [])
                attachments = _extract_attachments(msg.get("payload", {}))

                # Save to email_records if not already there, so it's searchable later
                if not self.record_repo.exists(user_id, mid):
                    try:
                        record = self.record_repo.create(
                            user_id=user_id,
                            gmail_message_id=mid,
                            gmail_thread_id=thread_id,
                            subject=subject,
                            sender_name=sender_name or None,
                            sender_email=sender_email,
                            snippet=snippet,
                            body_text=body,
                            importance_score=3.0,
                            is_read=is_read,
                            email_date=email_date,
                        )
                        if self.embedding_service:
                            try:
                                vec = self.embedding_service.embed_text(
                                    f"{subject} {sender_email} {snippet} {body[:1000]}"
                                )
                                self.record_repo.save_embedding(record.id, vec)
                            except Exception:
                                pass
                    except Exception:
                        pass

                results.append({
                    "id": mid,
                    "subject": subject,
                    "sender": f"{sender_name} <{sender_email}>" if sender_name else sender_email,
                    "date": email_date.strftime("%d %b %Y") if email_date else "",
                    "body": body,
                    "snippet": snippet,
                    "thread_id": thread_id,
                    "attachments": attachments,
                })
                if len(results) >= top_k:
                    break

        return results

    def backfill_embeddings(self, user_id: int) -> int:
        """Embed any existing email records that don't have a vector yet."""
        if not self.embedding_service:
            return 0
        unembedded = self.record_repo.list_without_embeddings(user_id)
        count = 0
        for r in unembedded:
            try:
                text = f"{r.subject} {r.sender_email} {r.snippet or ''} {(r.body_text or '')[:1000]}"
                vec = self.embedding_service.embed_text(text)
                self.record_repo.save_embedding(r.id, vec)
                count += 1
            except Exception:
                pass
        return count

    async def auto_process(self, user_id: int, db, workspace_id: int | None = None) -> dict:
        workspace_id = None  # Email items are always global - visible across all workspaces
        """Sync emails, append important ones to the Email Digest note, create reminders for deadlines."""
        from memolink_backend.domain.models.note import Note
        from memolink_backend.domain.models.reminder import Reminder
        from memolink_backend.contracts.note_dtos import NoteCreateDTO

        # 1 - sync new emails from Gmail
        sync_result = await self.sync(user_id)

        # 1b - backfill embeddings for records saved before embedding was added
        self.backfill_embeddings(user_id)

        # 2 - only process records not yet appended to the digest note
        important = self.record_repo.list_unappended(user_id)

        notes_added = 0
        reminders_created = 0

        if important and self.note_repo:
            # Find or create the Email Digest note
            digest = self._find_digest_note(user_id)

            if digest:
                # Append new email blocks to existing note
                new_blocks = "".join(self._format_email_block(r) for r in important)
                updated_content = (digest.content or "") + new_blocks
                self.note_repo.update_note(digest.id, title=None, content=updated_content)
                # Re-embed with updated content
                if self.embedding_service:
                    try:
                        vec = self.embedding_service.embed_text(
                            " ".join(r.subject for r in important)
                        )
                        self.note_repo.save_embedding(digest.id, vec)
                        db.commit()
                    except Exception:
                        pass
                self.record_repo.mark_appended([r.id for r in important])
                notes_added = len(important)
            else:
                # Create fresh Email Digest note
                header = '<h2>📧 Email Digest</h2><p><em>Important emails synced by MemoLink - updated automatically.</em></p>'
                content = header + "".join(self._format_email_block(r) for r in important)
                note = Note(user_id=user_id, title="Email Digest", content=content, source="email", workspace_id=workspace_id)
                db.add(note)
                db.flush()
                if self.embedding_service:
                    try:
                        vec = self.embedding_service.embed_text(
                            " ".join(r.subject for r in important)
                        )
                        self.note_repo.save_embedding(note.id, vec)
                    except Exception:
                        pass
                db.commit()
                self.record_repo.mark_appended([r.id for r in important])
                notes_added = len(important)

        # Create reminders for emails where GPT detects a deadline
        for r in important:
            data = self.extract_reminder(user_id, r.id)
            if data and data.get("due_date"):
                reminder = Reminder(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    text=data["text"],
                    description=data.get("description"),
                    type="ai",
                    done=False,
                    due_date=data["due_date"],
                    due_time=data.get("due_time"),
                    email_record_id=r.id,
                )
                db.add(reminder)
                reminders_created += 1
        if reminders_created:
            db.commit()

        return {
            "synced": sync_result.get("synced", 0),
            "notes_added": notes_added,
            "reminders_created": reminders_created,
            "filtered": sync_result.get("filtered", 0),
        }

    def reply_suggestions(self, user_id: int, record_id: int) -> list[str]:
        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return []

        # RAG: find notes relevant to this email
        note_context = ""
        if self.note_repo and self.embedding_service:
            try:
                query = f"{r.subject} {r.snippet or ''}"
                vec = self.embedding_service.embed_text(query)
                top_notes = self.note_repo.search_by_vector(vec, top_k=4)
                if top_notes:
                    import re as _re
                    _HTML = _re.compile(r"<[^>]+>")
                    blocks = [
                        f"[NOTE: {n.title or 'Untitled'}]\n{_HTML.sub(' ', n.content).strip()[:800]}"
                        for n in top_notes
                    ]
                    note_context = "\n\n".join(blocks)
            except Exception:
                pass

        sender = r.sender_name or r.sender_email
        body = (r.body_text or r.snippet or "")[:2000]

        context_section = f"\n\n--- RELEVANT NOTES FROM MY KNOWLEDGE BASE ---\n{note_context}" if note_context else ""

        prompt = (
            "You are a professional email assistant. Write 3 distinct reply options for this email.\n"
            "Each reply should be complete, polite, and ready to send.\n"
            "Vary the tone: one formal, one friendly, one brief.\n"
            "Use the knowledge base notes as context if relevant.\n"
            f"{context_section}\n\n"
            f"--- EMAIL ---\n"
            f"From: {sender}\n"
            f"Subject: {r.subject}\n"
            f"Body:\n{body}\n\n"
            "Return ONLY a JSON array of 3 strings, each being a complete reply. "
            'Example: ["Dear ...", "Hi ...", "Thanks ..."]'
        )

        try:
            client = OpenAI(api_key=settings.openai_api_key)
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                max_tokens=800,
            )
            content = resp.choices[0].message.content.strip()
            match = re.search(r"\[.*?\]", content, re.DOTALL)
            if match:
                replies = json.loads(match.group())
                if isinstance(replies, list) and len(replies) >= 1:
                    return [str(r) for r in replies[:3]]
        except Exception:
            pass
        return []
