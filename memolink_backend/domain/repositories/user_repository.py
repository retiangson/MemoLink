from typing import Optional, List
from sqlalchemy.orm import Session
from memolink_backend.domain.models.user_model import User


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def create(self, email: str, hashed_password: str) -> User:
        user = User(email=email, password=hashed_password)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def update_password(self, user_id: int, hashed_password: str) -> None:
        self.db.query(User).filter(User.id == user_id).update({"password": hashed_password})
        self.db.commit()

    def list_all(self) -> List[User]:
        return self.db.query(User).order_by(User.id).all()

    def set_admin_status(self, user_id: int, is_admin: bool) -> None:
        self.db.query(User).filter(User.id == user_id).update({"is_admin": is_admin})
        self.db.commit()

    def set_access_level(self, user_id: int, level: str) -> None:
        self.db.query(User).filter(User.id == user_id).update({"access_level": level})
        self.db.commit()
