import asyncio
import base64
import html
import json
import re
from email.utils import parseaddr, parsedate_to_datetime
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders

import bleach
from bleach.css_sanitizer import CSSSanitizer
import httpx
from openai import OpenAI

from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.email_account_repository import EmailAccountRepository
from memolink_backend.domain.repositories.email_record_repository import EmailRecordRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.reminder_repository import ReminderRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.services.gmail_connector import GmailConnector


def _strip_html(html: str) -> str:
    text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# Gmail's API computes "snippet" server-side from the raw message, and for some
# badly-structured marketing/HTML emails it leaks raw <style> block content (CSS rules,
# @media queries) straight into the preview text. Real preview text always comes first,
# so once a CSS selector/at-rule shows up we just cut the rest off rather than show noise.
_CSS_NOISE_START_RE = re.compile(r"(?:[.#][\w-]+(?:[.#:][\w-]+)*\s*\{|@media\b|@import\b|#outlook\s+a\s*\{)")


def _clean_snippet(snippet: str) -> str:
    if not snippet or "{" not in snippet:
        return snippet
    match = _CSS_NOISE_START_RE.search(snippet)
    if not match:
        return snippet
    cut = snippet[: match.start()].rstrip(" .,;:-")
    return cut if len(cut) >= 8 else snippet


_ALLOWED_HTML_TAGS = [
    "p", "br", "div", "span", "b", "i", "u", "strong", "em", "s", "strike",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
    "a", "img", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "hr", "pre", "code", "font", "sub", "sup", "small", "center",
]

_ALLOWED_HTML_ATTRS = {
    "*": ["style", "class", "align", "valign", "width", "height", "border", "bgcolor", "color"],
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "title", "width", "height"],
    "font": ["face", "size", "color"],
    "table": ["cellpadding", "cellspacing"],
}

_ALLOWED_HTML_PROTOCOLS = ["http", "https", "mailto", "cid"]

_CSS_SANITIZER = CSSSanitizer(
    allowed_css_properties=[
        "color", "background-color", "font-size", "font-weight", "font-style",
        "font-family", "text-align", "text-decoration", "padding", "margin",
        "border", "border-collapse", "width", "height", "line-height",
        "vertical-align", "white-space", "display",
    ]
)


_HEAD_BLOCK_RE = re.compile(r"<head\b[^>]*>.*?</head>", re.DOTALL | re.IGNORECASE)
_STYLE_OR_SCRIPT_BLOCK_RE = re.compile(r"<(style|script)\b[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)


def _sanitize_email_html(raw_html: str) -> str:
    """Allowlist-sanitize a Gmail HTML body for safe rendering in the browser.
    cid: is kept as an allowed protocol so inline-image references survive for
    the frontend to rewrite to the attachment-download endpoint.

    bleach.clean(strip=True) removes disallowed TAGS but keeps their inner text —
    so a raw <style>/<head> block (not in the tag allowlist) would otherwise leak
    its CSS/meta text straight into the rendered body as literal visible text.
    Cut those out first so only real body content reaches bleach."""
    raw_html = _HEAD_BLOCK_RE.sub("", raw_html)
    raw_html = _STYLE_OR_SCRIPT_BLOCK_RE.sub("", raw_html)
    return bleach.clean(
        raw_html,
        tags=_ALLOWED_HTML_TAGS,
        attributes=_ALLOWED_HTML_ATTRS,
        protocols=_ALLOWED_HTML_PROTOCOLS,
        css_sanitizer=_CSS_SANITIZER,
        strip=True,
        strip_comments=True,
    )


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


def _extract_body_html(payload: dict) -> str | None:
    """Return the raw (undecoded-for-sanitization) text/html body if the message has one."""
    mime = payload.get("mimeType", "")
    if mime == "text/html":
        return _decode_body(payload) or None
    for part in payload.get("parts", []):
        found = _extract_body_html(part)
        if found:
            return found
    return None


def _extract_sanitized_body_html(payload: dict) -> str | None:
    raw = _extract_body_html(payload)
    if not raw:
        return None
    try:
        return _sanitize_email_html(raw)
    except Exception:
        return None


def _extract_attachments(payload: dict) -> list[dict]:
    """Return list of {filename, attachment_id, size, mime_type, content_id, is_inline} for all file parts."""
    parts = payload.get("parts", [])
    results = []
    for part in parts:
        filename = part.get("filename", "")
        body = part.get("body", {})
        attachment_id = body.get("attachmentId")
        if filename and attachment_id:
            part_headers = part.get("headers", [])
            raw_content_id = _get_header(part_headers, "Content-ID")
            content_id = raw_content_id.strip("<>") if raw_content_id else None
            disposition = _get_header(part_headers, "Content-Disposition")
            results.append({
                "filename": filename,
                "attachment_id": attachment_id,
                "size": body.get("size", 0),
                "mime_type": part.get("mimeType", ""),
                "content_id": content_id,
                "is_inline": bool(content_id) or "inline" in disposition.lower(),
            })
        # Recurse into nested parts
        results.extend(_extract_attachments(part))
    return results


def _get_header(headers: list, name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def _parse_gmail_message(msg: dict) -> dict:
    """Extract the common fields (subject/sender/date/body) from a raw Gmail API message dict."""
    hdrs = msg.get("payload", {}).get("headers", [])
    subject = _get_header(hdrs, "Subject") or "(no subject)"
    from_raw = _get_header(hdrs, "From")
    sender_name, sender_email = parseaddr(from_raw)
    date_raw = _get_header(hdrs, "Date")
    try:
        email_date = parsedate_to_datetime(date_raw) if date_raw else None
    except Exception:
        email_date = None
    return {
        "subject": subject,
        "sender_name": sender_name or None,
        "sender_email": sender_email,
        "email_date": email_date,
        "snippet": msg.get("snippet", ""),
        "body": _extract_body(msg.get("payload", {}))[:3000],
        "body_html": _extract_sanitized_body_html(msg.get("payload", {})),
        "attachments": _extract_attachments(msg.get("payload", {})),
        "thread_id": msg.get("threadId"),
        "is_read": "UNREAD" not in msg.get("labelIds", []),
        "rfc_message_id": _get_header(hdrs, "Message-ID") or None,
    }


_BROWSE_TOKEN_START = "__START__"


def _encode_composite_token(token_map: dict[int, str | None]) -> str | None:
    if not token_map:
        return None
    payload = json.dumps(token_map)
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_composite_token(token: str | None, account_ids: list[int]) -> dict[int, str | None]:
    decoded: dict = {}
    if token:
        try:
            decoded = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        except Exception:
            decoded = {}
    decoded = {int(k): v for k, v in decoded.items()}
    return {aid: decoded.get(aid, _BROWSE_TOKEN_START) for aid in account_ids}


def _batch_extract_reminders(emails: list[dict]) -> list[dict | None]:
    """Extract reminders from multiple emails in a single GPT call."""
    if not emails:
        return []
    items_text = "\n".join(
        f"{i+1}. Subject: {e['subject']}\n   From: {e['sender']}\n   Snippet: {(e.get('snippet') or '')[:200]}"
        for i, e in enumerate(emails)
    )
    prompt = (
        "For each email below, extract a reminder if it has a deadline or requires action.\n"
        "Return ONLY a JSON array with one object per email:\n"
        '{"text": "title max 80 chars or null", "description": "one sentence or null", '
        '"due_date": "YYYY-MM-DD or null", "due_time": "HH:MM or null"}\n\n'
        f"Emails:\n{items_text}\n\n"
        f"Return exactly {len(emails)} objects. Use null for all fields if the email needs no action."
    )
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=600,
        )
        content = resp.choices[0].message.content.strip()
        match = re.search(r"\[.*\]", content, re.DOTALL)
        if match:
            results = json.loads(match.group(), strict=False)
            if isinstance(results, list) and len(results) == len(emails):
                return [r if r.get("text") else None for r in results]
    except Exception:
        pass
    return [None] * len(emails)


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
        scores = json.loads(re.search(r"\[.*\]", content, re.DOTALL).group())
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
        reminder_repo: ReminderRepository | None = None,
        note_repo: NoteRepository | None = None,
        embedding_service: EmbeddingService | None = None,
        gmail_connector: GmailConnector | None = None,
    ):
        self.account_repo = account_repo
        self.record_repo = record_repo
        self.reminder_repo = reminder_repo
        self.note_repo = note_repo
        self.embedding_service = embedding_service
        self.gmail = gmail_connector or GmailConnector(account_repo)

    async def sync(self, user_id: int, email_account_id: int | None = None, max_results: int = 25) -> dict:
        message_ids = await self.gmail.list_messages(
            user_id,
            query="is:unread OR is:important -category:promotions -category:social",
            max_results=max_results,
            email_account_id=email_account_id,
        )
        new_ids = [mid for mid in message_ids if not self.record_repo.exists(user_id, mid)]
        if not new_ids:
            return {"synced": 0, "skipped": len(message_ids)}

        # Fetch full messages
        raw_emails = []
        for mid in new_ids:
            msg = await self.gmail.get_message(user_id, mid, format="full", email_account_id=email_account_id)
            if msg:
                raw_emails.append((mid, msg))

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
            snippet = _clean_snippet(msg.get("snippet", ""))
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
                    email_account_id=email_account_id,
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

    def list_emails(self, user_id: int, email_account_id: int | None = None) -> list[dict]:
        if email_account_id:
            rows = self.record_repo.list_by_account(user_id, email_account_id)
        else:
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
                "email_account_id": r.email_account_id,
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

    def _build_mime_message(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        message_id: str | None = None,
        attachments: list[dict] | None = None,
    ):
        is_html = bool(re.search(r"<(p|br|ul|ol|li|h[1-6]|strong|em|div)\b", body, re.I))
        if is_html:
            plain = re.sub(r"<br\s*/?>|</p>|</li>|</h[1-6]>", "\n", body, flags=re.I)
            plain = re.sub(r"<[^>]+>", "", plain)
            plain = html.unescape(plain).strip()
            body_part = MIMEMultipart("alternative")
            body_part.attach(MIMEText(plain, "plain", "utf-8"))
            body_part.attach(MIMEText(body, "html", "utf-8"))
        else:
            body_part = MIMEText(body, "plain", "utf-8")

        if attachments:
            msg = MIMEMultipart("mixed")
            msg.attach(body_part)
            for att in attachments:
                ctype = att.get("content_type") or "application/octet-stream"
                if "/" not in ctype:
                    ctype = "application/octet-stream"
                maintype, subtype = ctype.split("/", 1)
                part = MIMEBase(maintype, subtype)
                part.set_payload(att["data"])
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=att["filename"])
                msg.attach(part)
        else:
            msg = body_part

        msg["To"] = to
        msg["Subject"] = subject
        if message_id:
            # In-Reply-To/References must be the RFC822 Message-ID header
            # (e.g. "<abc@mail.gmail.com>"), not Gmail's internal message id.
            mid = message_id if message_id.startswith("<") else f"<{message_id}>"
            msg["In-Reply-To"] = mid
            msg["References"] = mid
        return msg

    def _build_reply_chain_body(
        self,
        body: str,
        *,
        sender_name: str | None,
        sender_email: str,
        email_date,
        original_body: str,
    ) -> str:
        """Append a quoted copy of the original message below the user's reply
        so the sent email reads as a proper chain in any mail client."""
        who = f"{sender_name} &lt;{html.escape(sender_email)}&gt;" if sender_name else html.escape(sender_email)
        when = email_date.strftime("%a, %b %d, %Y at %I:%M %p") if email_date else ""
        header_line = f"On {when}, {who} wrote:" if when else f"{who} wrote:"

        is_html_body = bool(re.search(r"<(p|br|ul|ol|li|h[1-6]|strong|em|div)\b", body, re.I))
        reply_html = body if is_html_body else f"<p>{html.escape(body).replace(chr(10), '<br>')}</p>"

        quoted_lines = "<br>".join(html.escape(line) for line in (original_body or "").splitlines()) or "&nbsp;"
        return (
            f"{reply_html}"
            f'<br><div class="gmail_quote">{header_line}'
            f'<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;color:#666">'
            f"{quoted_lines}</blockquote></div>"
        )

    async def send_draft(
        self,
        user_id: int,
        *,
        to: str,
        subject: str,
        body: str,
        thread_id: str | None = None,
        message_id: str | None = None,
        email_account_id: int | None = None,
        attachments: list[dict] | None = None,
    ) -> dict:
        msg = self._build_mime_message(
            to=to,
            subject=subject,
            body=body,
            message_id=message_id,
            attachments=attachments,
        )
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        return await self.gmail.send_message(
            user_id,
            raw_message=raw,
            thread_id=thread_id or None,
            email_account_id=email_account_id,
        )

    async def send_reply(self, user_id: int, record_id: int, body: str, attachments: list[dict] | None = None) -> bool:
        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return False
        reply_subject = r.subject if r.subject.lower().startswith("re:") else f"Re: {r.subject}"

        # The local record only stores Gmail's internal message id, not the
        # RFC822 Message-ID header needed for In-Reply-To/References — fetch
        # it live from Gmail (best-effort; threading still works via thread_id
        # if this fails).
        rfc_message_id = None
        try:
            msg = await self.gmail.get_message(user_id, r.gmail_message_id, format="full", email_account_id=r.email_account_id)
            if msg:
                rfc_message_id = _get_header(msg.get("payload", {}).get("headers", []), "Message-ID") or None
        except Exception:
            pass

        full_body = self._build_reply_chain_body(
            body,
            sender_name=r.sender_name,
            sender_email=r.sender_email,
            email_date=r.email_date,
            original_body=r.body_text or r.snippet or "",
        )
        try:
            await self.send_draft(
                user_id,
                to=r.sender_email,
                subject=reply_subject,
                body=full_body,
                thread_id=r.gmail_thread_id,
                message_id=rfc_message_id,
                email_account_id=r.email_account_id,
                attachments=attachments,
            )
            return True
        except Exception:
            return False

    async def gmail_reply_suggestions(self, user_id: int, *, gmail_message_id: str, email_account_id: int | None = None, draft_hint: str | None = None) -> list[str]:
        msg = await self.gmail.get_message(user_id, gmail_message_id, format="full", email_account_id=email_account_id)
        if not msg:
            raise ValueError("Email not found")
        parsed = _parse_gmail_message(msg)
        return self._generate_reply_suggestions(
            user_id,
            subject=parsed["subject"],
            sender_name=parsed["sender_name"],
            sender_email=parsed["sender_email"],
            body=parsed["body"] or parsed["snippet"],
            draft_hint=draft_hint,
        )

    async def gmail_send_reply(self, user_id: int, *, gmail_message_id: str, email_account_id: int | None = None, body: str, attachments: list[dict] | None = None) -> bool:
        msg = await self.gmail.get_message(user_id, gmail_message_id, format="full", email_account_id=email_account_id)
        if not msg:
            raise ValueError("Email not found")
        parsed = _parse_gmail_message(msg)
        reply_subject = parsed["subject"] if parsed["subject"].lower().startswith("re:") else f"Re: {parsed['subject']}"
        full_body = self._build_reply_chain_body(
            body,
            sender_name=parsed["sender_name"],
            sender_email=parsed["sender_email"],
            email_date=parsed["email_date"],
            original_body=parsed["body"],
        )
        try:
            await self.send_draft(
                user_id,
                to=parsed["sender_email"],
                subject=reply_subject,
                body=full_body,
                thread_id=parsed["thread_id"],
                message_id=parsed["rfc_message_id"],
                email_account_id=email_account_id,
                attachments=attachments,
            )
            return True
        except Exception:
            return False

    async def email_to_note_by_gmail_id(self, user_id: int, *, gmail_message_id: str, email_account_id: int | None = None) -> dict | None:
        if not self.note_repo:
            raise ValueError("Note repository not configured")
        msg = await self.gmail.get_message(user_id, gmail_message_id, format="full", email_account_id=email_account_id)
        if not msg:
            return None
        parsed = _parse_gmail_message(msg)
        note_data = self._build_note_content(
            subject=parsed["subject"],
            sender_name=parsed["sender_name"],
            sender_email=parsed["sender_email"],
            email_date=parsed["email_date"],
            body_text=parsed["body"] or parsed["snippet"],
        )
        note = self.note_repo.create_note(user_id, note_data["title"], note_data["content"], "email")
        if self.embedding_service:
            try:
                vec = self.embedding_service.embed_text(f"{note.title or ''} {note_data['content'][:1500]}")
                self.note_repo.save_embedding(note.id, vec)
            except Exception:
                pass
        self.note_repo.db.commit()
        self.note_repo.db.refresh(note)
        return {"note_id": note.id, "title": note.title}

    def _build_note_content(self, *, subject: str, sender_name: str | None, sender_email: str, email_date, body_text: str) -> dict:
        sender = f"{sender_name} <{sender_email}>" if sender_name else sender_email
        date_str = email_date.strftime("%d %b %Y %H:%M") if email_date else ""
        content_lines = [
            f"<p><strong>From:</strong> {sender}</p>",
            f"<p><strong>Date:</strong> {date_str}</p>" if date_str else "",
            "<hr/>",
            f"<p>{(body_text or '').replace(chr(10), '</p><p>')}</p>",
        ]
        return {
            "title": subject,
            "content": "\n".join(line for line in content_lines if line),
        }

    def build_note_content(self, user_id: int, record_id: int) -> dict | None:
        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return None
        return self._build_note_content(
            subject=r.subject, sender_name=r.sender_name, sender_email=r.sender_email,
            email_date=r.email_date, body_text=r.body_text or r.snippet or "",
        )

    def create_note_from_email(self, user_id: int, record_id: int) -> dict | None:
        if not self.note_repo:
            raise ValueError("Note repository not configured")
        note_data = self.build_note_content(user_id, record_id)
        if not note_data:
            return None
        note = self.note_repo.create_note(user_id, note_data["title"], note_data["content"], "email")
        if self.embedding_service:
            try:
                vec = self.embedding_service.embed_text(f"{note.title or ''} {note_data['content'][:1500]}")
                self.note_repo.save_embedding(note.id, vec)
            except Exception:
                pass
        self.note_repo.db.commit()
        self.note_repo.db.refresh(note)
        return {"note_id": note.id, "title": note.title}

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
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if match:
                data = json.loads(match.group(), strict=False)
                return {
                    "text": data.get("text") or r.subject,
                    "description": data.get("description"),
                    "due_date": data.get("due_date"),
                    "due_time": data.get("due_time"),
                }
        except Exception:
            pass
        return {"text": r.subject, "description": r.snippet, "due_date": None, "due_time": None}

    def create_reminder_from_email(self, user_id: int, record_id: int) -> dict | None:
        if not self.reminder_repo:
            raise ValueError("Reminder repository not configured")
        record = self.record_repo.get_by_id(user_id, record_id)
        if not record:
            return None
        data = self.extract_reminder(user_id, record_id)
        if not data:
            return None
        reminder = self.reminder_repo.create_reminder(
            user_id=user_id,
            text=data["text"],
            description=data.get("description"),
            reminder_type="ai",
            due_date=data.get("due_date"),
            due_time=data.get("due_time"),
            email_record_id=record.id,
        )
        return {
            "reminder_id": reminder.id,
            "text": reminder.text,
            "due_date": reminder.due_date,
            "due_time": reminder.due_time,
        }

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

    def _save_email_record_if_new(
        self,
        *,
        user_id: int,
        gmail_message_id: str,
        gmail_thread_id: str | None,
        subject: str,
        sender_name: str | None,
        sender_email: str,
        snippet: str,
        body_text: str,
        is_read: bool,
        email_date,
        importance_score: float = 3.0,
    ) -> None:
        if self.record_repo.exists(user_id, gmail_message_id):
            return
        record = self.record_repo.create(
            user_id=user_id,
            gmail_message_id=gmail_message_id,
            gmail_thread_id=gmail_thread_id,
            subject=subject,
            sender_name=sender_name,
            sender_email=sender_email,
            snippet=snippet,
            body_text=body_text,
            importance_score=importance_score,
            is_read=is_read,
            email_date=email_date,
        )
        if self.embedding_service:
            try:
                vec = self.embedding_service.embed_text(
                    f"{subject} {sender_email} {snippet} {body_text[:1000]}"
                )
                self.record_repo.save_embedding(record.id, vec)
            except Exception:
                pass

    def _build_live_search_result(self, user_id: int, gmail_message_id: str, msg: dict) -> dict:
        hdrs = msg.get("payload", {}).get("headers", [])
        subject = _get_header(hdrs, "Subject") or "(no subject)"
        from_raw = _get_header(hdrs, "From")
        sender_name, sender_email = parseaddr(from_raw)
        date_raw = _get_header(hdrs, "Date")
        try:
            email_date = parsedate_to_datetime(date_raw) if date_raw else None
        except Exception:
            email_date = None
        snippet = _clean_snippet(msg.get("snippet", ""))
        body = _extract_body(msg.get("payload", {}))[:3000]
        body_html = _extract_sanitized_body_html(msg.get("payload", {}))
        thread_id = msg.get("threadId")
        is_read = "UNREAD" not in msg.get("labelIds", [])
        attachments = _extract_attachments(msg.get("payload", {}))

        try:
            self._save_email_record_if_new(
                user_id=user_id,
                gmail_message_id=gmail_message_id,
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
        except Exception:
            pass

        return {
            "id": gmail_message_id,
            "subject": subject,
            "sender": f"{sender_name} <{sender_email}>" if sender_name else sender_email,
            "date": email_date.strftime("%d %b %Y") if email_date else "",
            "body": body,
            "body_html": body_html,
            "snippet": snippet,
            "thread_id": thread_id,
            "attachments": attachments,
        }

    def live_search_sync(self, user_id: int, query: str, top_k: int = 3) -> list[dict]:
        """Synchronous Gmail search using httpx.Client — safe to call from any thread or sync context."""
        import logging as _log
        _logger = _log.getLogger(__name__)
        try:
            message_ids = self.gmail.list_messages_sync(user_id, query=query, max_results=top_k * 2)
        except Exception as exc:
            _logger.warning(f"[live_search] user={user_id} q={query!r} list failed: {exc}")
            return []
        if not message_ids:
            return []

        results: list[dict] = []
        for mid in message_ids:
            try:
                msg = self.gmail.get_message_sync(user_id, mid, format="full")
            except Exception as exc:
                _logger.warning(f"[live_search] user={user_id} message={mid} fetch failed: {exc}")
                continue
            if not msg:
                continue
            results.append(self._build_live_search_result(user_id, mid, msg))
            if len(results) >= top_k:
                break

        return results

    def search_for_chat_sync(self, user_id: int, query: str, top_k: int = 10) -> list[dict]:
        """Cross-account Gmail search returning full browse-result-shaped dicts (matching
        BrowseEmailResult on the frontend), so a chat-found email can be opened directly
        in a tab with no extra round-trip. Synchronous — safe to call from chat_service's
        sync route-planning path."""
        import logging as _log
        _logger = _log.getLogger(__name__)
        accounts = self.account_repo.list_by_user(user_id)
        if not accounts:
            return []

        results: list[dict] = []
        for account in accounts:
            try:
                message_ids = self.gmail.list_messages_sync(
                    user_id, query=query, max_results=top_k, email_account_id=account.id,
                )
            except Exception as exc:
                _logger.warning(f"[search_for_chat] user={user_id} account={account.id} q={query!r} list failed: {exc}")
                continue
            for mid in message_ids:
                try:
                    msg = self.gmail.get_message_sync(user_id, mid, format="full", email_account_id=account.id)
                except Exception as exc:
                    _logger.warning(f"[search_for_chat] user={user_id} message={mid} fetch failed: {exc}")
                    continue
                if not msg:
                    continue
                results.append(self._build_browse_result(
                    user_id, mid, msg, email_account_id=account.id, email_address=account.email_address,
                ))

        results.sort(key=lambda e: e["email_date"] or "", reverse=True)
        return results[:top_k]

    async def download_attachment(
        self, user_id: int, gmail_message_id: str, attachment_id: str, email_account_id: int | None = None
    ) -> bytes:
        return await self.gmail.download_attachment(
            user_id,
            gmail_message_id=gmail_message_id,
            attachment_id=attachment_id,
            email_account_id=email_account_id,
        )

    async def live_search(self, user_id: int, query: str, top_k: int = 3) -> list[dict]:
        """Search Gmail directly with a free-text query — no sync required.
        Returns the top matching emails as plain dicts ready for chat context.
        Also saves new results to email_records so they're available next time."""
        try:
            message_ids = await self.gmail.list_messages(user_id, query=query, max_results=top_k * 2)
        except Exception:
            return []
        if not message_ids:
            return []

        results = []
        for mid in message_ids:
            msg = await self.gmail.get_message(user_id, mid, format="full")
            if not msg:
                continue
            results.append(self._build_live_search_result(user_id, mid, msg))
            if len(results) >= top_k:
                break

        return results

    def _build_browse_result(
        self,
        user_id: int,
        gmail_message_id: str,
        msg: dict,
        *,
        email_account_id: int,
        email_address: str,
    ) -> dict:
        hdrs = msg.get("payload", {}).get("headers", [])
        subject = _get_header(hdrs, "Subject") or "(no subject)"
        from_raw = _get_header(hdrs, "From")
        sender_name, sender_email = parseaddr(from_raw)
        date_raw = _get_header(hdrs, "Date")
        try:
            email_date = parsedate_to_datetime(date_raw) if date_raw else None
        except Exception:
            email_date = None
        snippet = _clean_snippet(msg.get("snippet", ""))
        body = _extract_body(msg.get("payload", {}))[:3000]
        body_html = _extract_sanitized_body_html(msg.get("payload", {}))
        thread_id = msg.get("threadId")
        is_read = "UNREAD" not in msg.get("labelIds", [])
        attachments = _extract_attachments(msg.get("payload", {}))

        local_row = self.record_repo.get_by_gmail_message_id(user_id, gmail_message_id)

        return {
            "id": local_row.id if local_row else None,
            "gmail_message_id": gmail_message_id,
            "gmail_thread_id": thread_id,
            "subject": subject,
            "sender_name": sender_name or None,
            "sender_email": sender_email,
            "snippet": snippet,
            "body_text": body,
            "body_html": body_html,
            "attachments": attachments,
            "importance_score": local_row.importance_score if local_row else 3.0,
            "is_read": is_read,
            "email_date": email_date.isoformat() if email_date else None,
            "email_account_id": email_account_id,
            "email_address": email_address,
            "is_pinned": bool(local_row.is_pinned) if local_row else False,
        }

    async def browse(
        self,
        user_id: int,
        *,
        folder: str,
        email_account_id: int | None = None,
        page_token: str | None = None,
        page_size: int | None = None,
    ) -> dict:
        if folder not in ("inbox", "outbox", "drafts", "trash", "all"):
            raise ValueError("folder must be one of inbox, outbox, drafts, trash, all")

        if folder == "all":
            accounts = self.account_repo.list_by_user(user_id)
            if not accounts:
                return {"emails": [], "next_page_token": None}
            account_ids = [a.id for a in accounts]
            token_map = _decode_composite_token(page_token, account_ids)
            all_emails: list[dict] = []
            next_token_map: dict[int, str | None] = {}
            for account in accounts:
                current_token = token_map.get(account.id)
                if current_token is None:
                    next_token_map[account.id] = None
                    continue
                fetch_token = None if current_token == _BROWSE_TOKEN_START else current_token
                size = page_size or account.page_size
                page = await self.gmail.list_messages_page(
                    user_id,
                    query="in:inbox",
                    max_results=size,
                    page_token=fetch_token,
                    email_account_id=account.id,
                )
                msgs = await asyncio.gather(*[
                    self.gmail.get_message(user_id, mid, format="full", email_account_id=account.id)
                    for mid in page["ids"]
                ])
                for mid, msg in zip(page["ids"], msgs):
                    if msg:
                        all_emails.append(self._build_browse_result(
                            user_id, mid, msg, email_account_id=account.id, email_address=account.email_address,
                        ))
                next_token_map[account.id] = page["next_page_token"]
            all_emails.sort(key=lambda e: e["email_date"] or "", reverse=True)
            return {"emails": all_emails, "next_page_token": _encode_composite_token(next_token_map)}

        if not email_account_id:
            raise ValueError("email_account_id is required for inbox/outbox/drafts/trash folders")
        account = self.account_repo.get_by_id(user_id, email_account_id)
        if not account:
            raise ValueError("Email account not found")
        query = {
            "inbox": "in:inbox",
            "outbox": "in:sent",
            "drafts": "in:drafts",
            "trash": "in:trash",
        }[folder]
        size = page_size or account.page_size
        page = await self.gmail.list_messages_page(
            user_id, query=query, max_results=size, page_token=page_token, email_account_id=email_account_id,
        )
        msgs = await asyncio.gather(*[
            self.gmail.get_message(user_id, mid, format="full", email_account_id=email_account_id)
            for mid in page["ids"]
        ])
        emails = [
            self._build_browse_result(
                user_id, mid, msg, email_account_id=email_account_id, email_address=account.email_address,
            )
            for mid, msg in zip(page["ids"], msgs) if msg
        ]
        return {"emails": emails, "next_page_token": page["next_page_token"]}

    async def archive_email(self, user_id: int, *, gmail_message_id: str, email_account_id: int | None = None) -> dict:
        await self.gmail.modify_message(
            user_id,
            gmail_message_id=gmail_message_id,
            remove_label_ids=["INBOX"],
            email_account_id=email_account_id,
        )
        return {"ok": True}

    async def trash_email(self, user_id: int, *, gmail_message_id: str, email_account_id: int | None = None) -> dict:
        await self.gmail.trash_message(
            user_id,
            gmail_message_id=gmail_message_id,
            email_account_id=email_account_id,
        )
        return {"ok": True}

    async def pin_email(self, user_id: int, *, gmail_message_id: str, email_account_id: int | None = None) -> dict:
        local_row = self.record_repo.get_by_gmail_message_id(user_id, gmail_message_id)
        if not local_row:
            msg = await self.gmail.get_message(user_id, gmail_message_id, format="full", email_account_id=email_account_id)
            if not msg:
                raise ValueError("Email not found")
            hdrs = msg.get("payload", {}).get("headers", [])
            subject = _get_header(hdrs, "Subject") or "(no subject)"
            from_raw = _get_header(hdrs, "From")
            sender_name, sender_email = parseaddr(from_raw)
            date_raw = _get_header(hdrs, "Date")
            try:
                email_date = parsedate_to_datetime(date_raw) if date_raw else None
            except Exception:
                email_date = None
            snippet = _clean_snippet(msg.get("snippet", ""))
            body = _extract_body(msg.get("payload", {}))[:3000]
            thread_id = msg.get("threadId")
            is_read = "UNREAD" not in msg.get("labelIds", [])
            local_row = self.record_repo.create(
                user_id=user_id,
                email_account_id=email_account_id,
                gmail_message_id=gmail_message_id,
                gmail_thread_id=thread_id,
                subject=subject,
                sender_name=sender_name or None,
                sender_email=sender_email,
                snippet=snippet,
                body_text=body,
                importance_score=3.0,
                is_read=is_read,
                email_date=email_date,
                note_appended=True,
            )
        updated = self.record_repo.set_pinned(user_id, local_row.id, True)
        return {"id": updated.id, "is_pinned": updated.is_pinned}

    def unpin_email(self, user_id: int, *, gmail_message_id: str) -> dict:
        local_row = self.record_repo.get_by_gmail_message_id(user_id, gmail_message_id)
        if not local_row:
            raise ValueError("Email not found locally")
        updated = self.record_repo.set_pinned(user_id, local_row.id, False)
        return {"id": updated.id, "is_pinned": updated.is_pinned}

    def update_account_page_size(self, user_id: int, account_id: int, page_size: int) -> dict:
        clamped = max(5, min(100, page_size))
        updated = self.account_repo.update_page_size(user_id, account_id, clamped)
        if not updated:
            raise ValueError("Email account not found")
        return {"id": updated.id, "page_size": updated.page_size}

    def update_account_display_name(self, user_id: int, account_id: int, display_name: str | None) -> dict:
        cleaned = display_name.strip() if display_name else None
        updated = self.account_repo.update_display_name(user_id, account_id, cleaned or None)
        if not updated:
            raise ValueError("Email account not found")
        return {"id": updated.id, "display_name": updated.display_name}

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
        """Sync all connected email accounts, update Email Digest note, create reminders for deadlines."""
        from memolink_backend.domain.models.note import Note

        # 1 - sync all connected accounts
        accounts = self.account_repo.list_by_user(user_id)
        if not accounts:
            raise ValueError("No email account connected")

        total_synced = 0
        total_filtered = 0
        for account in accounts:
            result = await self.sync(user_id, email_account_id=account.id)
            total_synced += result.get("synced", 0)
            total_filtered += result.get("filtered", 0)

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

        # Batch extract reminders for all important emails in ONE GPT call (much faster)
        if important and self.reminder_repo:
            email_dicts = [
                {"subject": r.subject, "sender": r.sender_name or r.sender_email, "snippet": r.snippet or ""}
                for r in important
            ]
            reminder_data = _batch_extract_reminders(email_dicts)
            for r, data in zip(important, reminder_data):
                if data and data.get("due_date"):
                    self.reminder_repo.create_reminder(
                        user_id=user_id,
                        workspace_id=workspace_id,
                        text=data["text"],
                        description=data.get("description"),
                        reminder_type="ai",
                        due_date=data["due_date"],
                        due_time=data.get("due_time"),
                        email_record_id=r.id,
                    )
                    reminders_created += 1

        return {
            "synced": total_synced,
            "notes_added": notes_added,
            "reminders_created": reminders_created,
            "filtered": total_filtered,
        }

    def reply_suggestions(self, user_id: int, record_id: int, draft_hint: str | None = None) -> list[str]:
        r = self.record_repo.get_by_id(user_id, record_id)
        if not r:
            return []
        return self._generate_reply_suggestions(
            user_id, subject=r.subject, sender_name=r.sender_name, sender_email=r.sender_email,
            body=r.body_text or r.snippet or "", draft_hint=draft_hint,
        )

    def _generate_reply_suggestions(
        self, user_id: int, *, subject: str, sender_name: str | None, sender_email: str, body: str,
        draft_hint: str | None = None,
    ) -> list[str]:
        # If the user's draft names a specific note (bracket syntax or a fuzzy
        # title match), use that note's full content as the primary source of
        # truth — same lookup pattern as generate_compose_draft.
        referenced_note = None
        if self.note_repo and draft_hint:
            bracket_match = re.search(r"\[([^\[\]]+)\]", draft_hint)
            candidates = [bracket_match.group(1).strip()] if bracket_match else []
            candidates.append(draft_hint.strip())
            for name in candidates:
                if not name:
                    continue
                try:
                    found = self.note_repo.find_by_title_for_user(user_id, name)
                except Exception:
                    found = None
                if found:
                    referenced_note = found
                    break

        note_context = ""
        if referenced_note:
            plain = re.sub(r"<[^>]+>", " ", referenced_note.content or "").strip()
            note_context = f"[NOTE: {referenced_note.title}]\n{plain[:4000]}"
        elif self.note_repo and self.embedding_service:
            try:
                query = f"{subject} {(draft_hint or '')[:200]} {body[:200]}"
                vec = self.embedding_service.embed_text(query)
                top_notes = self.note_repo.search_hybrid(
                    query,
                    vec,
                    top_k=4,
                    user_id=user_id,
                )
                if top_notes:
                    blocks = [
                        f"[NOTE: {n.title or 'Untitled'}]\n{re.sub(r'<[^>]+>', ' ', n.content).strip()[:800]}"
                        for n in top_notes
                    ]
                    note_context = "\n\n".join(blocks)
            except Exception:
                pass

        sender = sender_name or sender_email
        body = body[:2000]

        if note_context:
            context_label = "REFERENCED NOTE" if referenced_note else "RELEVANT NOTES FROM MY KNOWLEDGE BASE"
            context_section = f"\n\n--- {context_label} ---\n{note_context}"
        else:
            context_section = ""

        note_instruction = (
            "The user referenced a specific note above — use it as the primary source of truth for the reply content.\n"
            if referenced_note else
            "Use the knowledge base notes as context if relevant.\n"
        )

        hint_section = ""
        if draft_hint and draft_hint.strip():
            hint_section = (
                "\n\nThe user has already started drafting a reply (or jotted down the idea/points "
                "they want to make). Treat the text below as the seed of what they want to say, and "
                "build all 3 reply options around that intent (fixing grammar, expanding it, adapting "
                "tone) rather than ignoring it:\n"
                f"--- USER'S DRAFT / IDEA ---\n{draft_hint.strip()[:1500]}"
            )

        prompt = (
            "You are a professional email assistant. Write 3 distinct reply options for this email.\n"
            "Each reply should be complete, polite, and ready to send.\n"
            "Vary the tone: one formal, one friendly, one brief.\n"
            f"{note_instruction}"
            f"{context_section}"
            f"{hint_section}\n\n"
            f"--- EMAIL ---\n"
            f"From: {sender}\n"
            f"Subject: {subject}\n"
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
            match = re.search(r"\[.*\]", content, re.DOTALL)
            if match:
                replies = json.loads(match.group(), strict=False)
                if isinstance(replies, list) and len(replies) >= 1:
                    return [str(r) for r in replies[:3]]
        except Exception:
            pass
        return []

    def generate_compose_draft(self, user_id: int, *, to: str, subject: str, topic: str) -> str:
        # If the topic names a specific note (e.g. "send a summary of [Project Plan]" or just
        # "Project Plan"), use that note's full content as the primary source of truth instead
        # of falling back to generic semantic RAG search.
        referenced_note = None
        if self.note_repo:
            bracket_match = re.search(r"\[([^\[\]]+)\]", topic)
            candidates = [bracket_match.group(1).strip()] if bracket_match else []
            candidates.append(topic.strip())
            for name in candidates:
                if not name:
                    continue
                try:
                    found = self.note_repo.find_by_title_for_user(user_id, name)
                except Exception:
                    found = None
                if found:
                    referenced_note = found
                    break

        note_context = ""
        if referenced_note:
            plain = re.sub(r"<[^>]+>", " ", referenced_note.content or "").strip()
            note_context = f"[NOTE: {referenced_note.title}]\n{plain[:4000]}"
        elif self.note_repo and self.embedding_service:
            try:
                query = f"{subject} {topic[:200]}"
                vec = self.embedding_service.embed_text(query)
                top_notes = self.note_repo.search_hybrid(query, vec, top_k=4, user_id=user_id)
                if top_notes:
                    blocks = [
                        f"[NOTE: {n.title or 'Untitled'}]\n{re.sub(r'<[^>]+>', ' ', n.content).strip()[:800]}"
                        for n in top_notes
                    ]
                    note_context = "\n\n".join(blocks)
            except Exception:
                pass

        if note_context:
            context_label = "REFERENCED NOTE" if referenced_note else "RELEVANT NOTES FROM MY KNOWLEDGE BASE"
            context_section = f"\n\n--- {context_label} ---\n{note_context}"
        else:
            context_section = ""

        note_instruction = (
            "The user referenced a specific note above — use it as the primary source of truth "
            "for the email content (e.g. summarize it if the request asks for a summary).\n"
            if referenced_note else
            "Use the knowledge base notes as context if relevant.\n"
        )

        prompt = (
            "You are a professional email assistant. Write a complete, ready-to-send email body "
            "for a brand new email (not a reply).\n"
            f"{note_instruction}"
            f"{context_section}\n\n"
            f"To: {to or '(recipient)'}\n"
            f"Subject: {subject or '(no subject)'}\n"
            f"What the email is about: {topic[:1000]}\n\n"
            "Return ONLY the email body text: a short greeting, 1-3 concise paragraphs, and a "
            "polite closing line. No subject line, no markdown formatting, no placeholder brackets "
            "like [Your Name]."
        )

        try:
            client = OpenAI(api_key=settings.openai_api_key)
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                max_tokens=600,
            )
            return resp.choices[0].message.content.strip()
        except Exception:
            return ""
