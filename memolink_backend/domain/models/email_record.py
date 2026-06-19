from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Float, Boolean, func
from memolink_backend.core.db import Base


class EmailRecord(Base):
    __tablename__ = "email_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    gmail_message_id = Column(String(255), nullable=False, index=True)
    subject = Column(Text, nullable=False, default="(no subject)")
    sender_name = Column(String(255), nullable=True)
    sender_email = Column(String(255), nullable=False)
    snippet = Column(Text, nullable=True)
    body_text = Column(Text, nullable=True)
    importance_score = Column(Float, nullable=False, default=3.0)  # 1-5 GPT score
    is_read = Column(Boolean, nullable=False, default=False)
    email_date = Column(DateTime(timezone=True), nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())
    note_appended = Column(Boolean, nullable=False, default=False)  # True once appended to Email Digest
    gmail_thread_id = Column(String(255), nullable=True)  # For threading replies
    # DB migration: ALTER TABLE email_records ADD COLUMN IF NOT EXISTS email_account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL;
    email_account_id = Column(Integer, ForeignKey("email_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    is_pinned = Column(Boolean, nullable=False, default=False)
    pinned_at = Column(DateTime(timezone=True), nullable=True)
