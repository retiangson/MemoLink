from typing import Protocol, Optional
from memolink_backend.domain.models.user_model import User


class IUserRepository(Protocol):
    def get_by_email(self, email: str) -> Optional[User]: ...
    def create(self, email: str, hashed_password: str) -> User: ...
