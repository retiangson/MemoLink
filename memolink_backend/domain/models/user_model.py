from sqlalchemy import Column, Integer, String, Boolean
from memolink_backend.core.db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    is_admin = Column(Boolean, nullable=False, server_default="false")
    access_level = Column(String, nullable=False, server_default="regular")
