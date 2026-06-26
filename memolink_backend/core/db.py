from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy import create_engine
from memolink_backend.core.config import settings


class Base(DeclarativeBase):
    pass


# QueuePool options (pool_size, max_overflow, pool_recycle) are only valid for
# PostgreSQL/MySQL — SQLite uses SingletonThreadPool which rejects them.
_is_postgres = settings.database_url.startswith(("postgresql", "postgres"))
_pool_kwargs = (
    {"pool_size": 10, "max_overflow": 20, "pool_recycle": 1800}
    if _is_postgres
    else {}
)

engine = create_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=True,
    **_pool_kwargs,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
