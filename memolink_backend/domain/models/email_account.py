from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, func
from memolink_backend.core.db import Base


class EmailAccount(Base):
    __tablename__ = "email_accounts"
    # DB migration required to support multiple accounts per user:
    # ALTER TABLE email_accounts DROP CONSTRAINT IF EXISTS email_accounts_user_id_key;
    # ALTER TABLE email_accounts ADD CONSTRAINT uq_email_accounts_user_email UNIQUE (user_id, email_address);
    __table_args__ = (UniqueConstraint("user_id", "email_address", name="uq_email_accounts_user_email"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(50), nullable=False, default="google")
    email_address = Column(String(255), nullable=False)
    encrypted_access_token = Column(Text, nullable=False)
    encrypted_refresh_token = Column(Text, nullable=False)
    token_expiry = Column(DateTime(timezone=True), nullable=True)
    connected_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
