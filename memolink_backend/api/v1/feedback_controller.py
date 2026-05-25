import smtplib
import logging
import email.mime.text
import email.mime.multipart
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings
from memolink_backend.core.db import get_db

router = APIRouter(prefix="/feedback", tags=["feedback"])
logger = logging.getLogger(__name__)

_TYPE_LABELS = {"bug": "Bug Report", "suggestion": "Suggestion"}


class FeedbackRequest(BaseModel):
    type: str   # "bug" | "suggestion"
    title: str
    message: str


@router.post("")
def submit_feedback(req: FeedbackRequest, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    label = _TYPE_LABELS.get(req.type, req.type.capitalize())
    logger.info("[Feedback] %s from user #%s: %s — %s", label, user_id, req.title[:100], req.message[:300])

    # Get user email for storage
    user_row = db.execute(text("SELECT email FROM users WHERE id = :uid"), {"uid": user_id}).fetchone()
    user_email = user_row[0] if user_row else None

    # Save to DB
    db.execute(
        text("INSERT INTO feedback (user_id, user_email, type, title, message) VALUES (:uid, :email, :type, :title, :msg)"),
        {"uid": user_id, "email": user_email, "type": req.type, "title": req.title, "msg": req.message},
    )
    db.commit()

    # Send email if SMTP configured
    if settings.smtp_host and settings.smtp_user and settings.smtp_password:
        try:
            from_addr = settings.smtp_from or settings.smtp_user
            msg = email.mime.multipart.MIMEMultipart()
            msg["Subject"] = f"[MemoLink] {label} — {req.title}"
            msg["From"] = from_addr
            msg["To"] = from_addr
            body = f"Type: {label}\nUser: {user_email} (#{user_id})\nTitle: {req.title}\n\n--- Description ---\n{req.message}"
            msg.attach(email.mime.text.MIMEText(body, "plain"))
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg)
        except Exception as exc:
            logger.warning("[Feedback] Email send failed: %s", exc)

    return {"ok": True}
