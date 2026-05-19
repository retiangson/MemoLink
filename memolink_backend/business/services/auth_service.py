from typing import Optional
from sqlalchemy.orm import Session

from memolink_backend.domain.repositories.user_repository import UserRepository
from memolink_backend.domain.interfaces.i_user_repository import IUserRepository
from memolink_backend.contracts.auth_dtos import RegisterDTO, LoginDTO, TokenResponse
from memolink_backend.business.interfaces.i_auth_service import IAuthService
from memolink_backend.core.security import hash_password, verify_password, create_access_token


class AuthService(IAuthService):
    def __init__(self, db: Optional[Session] = None, user_repo: Optional[IUserRepository] = None):
        if user_repo is not None:
            self.repo: IUserRepository = user_repo
        else:
            if db is None:
                raise ValueError("Either db or user_repo must be provided.")
            self.repo = UserRepository(db)

    def register(self, dto: RegisterDTO) -> TokenResponse:
        if self.repo.get_by_email(dto.email):
            raise ValueError("Email already registered")
        hashed = hash_password(dto.password)
        user = self.repo.create(dto.email, hashed)
        token = create_access_token(user.id, user.email)
        return TokenResponse(access_token=token, id=user.id, email=user.email)

    def login(self, dto: LoginDTO) -> TokenResponse:
        user = self.repo.get_by_email(dto.email)
        if not user or not verify_password(dto.password, user.password):
            raise ValueError("Invalid email or password")
        token = create_access_token(user.id, user.email)
        return TokenResponse(access_token=token, id=user.id, email=user.email)
