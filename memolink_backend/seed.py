"""Run once to seed initial data. Safe to re-run - skips existing records."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from memolink_backend.core.db import Base, engine, SessionLocal
from memolink_backend.core.security import hash_password

import memolink_backend.domain.models.user_model      # noqa: F401
import memolink_backend.domain.models.note             # noqa: F401
import memolink_backend.domain.models.embedding        # noqa: F401
import memolink_backend.domain.models.conversation     # noqa: F401
import memolink_backend.domain.models.message          # noqa: F401

from memolink_backend.domain.models.user_model import User

SEED_USERS = [
    {"email": "admin@memolink.com", "password": "W0rdP@ss"},
]


def run():
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()

    Base.metadata.create_all(bind=engine)
    print("Tables created (or already exist).")

    db = SessionLocal()
    try:
        for u in SEED_USERS:
            exists = db.query(User).filter(User.email == u["email"]).first()
            if exists:
                print(f"  skip  {u['email']} (already exists)")
            else:
                db.add(User(email=u["email"], password=hash_password(u["password"])))
                db.commit()
                print(f"  added {u['email']}")
    finally:
        db.close()

    print("Seed complete.")


if __name__ == "__main__":
    run()
