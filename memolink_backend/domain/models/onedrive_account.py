from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from memolink_backend.core.db import Base


class OneDriveAccount(Base):
    __tablename__ = "onedrive_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    ms_user_id = Column(String(255), nullable=False, default="")
    display_name = Column(String(255), nullable=False, default="")
    email = Column(String(255), nullable=False, default="")
    encrypted_access_token = Column(Text, nullable=False)
    encrypted_refresh_token = Column(Text, nullable=False)
    token_expiry = Column(DateTime(timezone=True), nullable=True)
    connected_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
