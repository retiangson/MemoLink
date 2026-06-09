from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func

from memolink_backend.core.db import Base


class ConnectorAccount(Base):
    __tablename__ = "connector_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    connector_type = Column(String(50), nullable=False)
    display_name = Column(String(100), nullable=False, default="")
    account_label = Column(String(255), nullable=True)
    encrypted_secret = Column(Text, nullable=False)
    base_url = Column(Text, nullable=True)
    config_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "connector_type", name="uq_connector_accounts_user_type"),
    )
