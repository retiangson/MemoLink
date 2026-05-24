import smtplib
import logging
from email.mime.text import MIMEText
from typing import Optional
from sqlalchemy.orm import Session

from memolink_backend.domain.repositories.user_repository import UserRepository
from memolink_backend.domain.interfaces.i_user_repository import IUserRepository
from memolink_backend.contracts.auth_dtos import RegisterDTO, LoginDTO, TokenResponse, ChangePasswordDTO, ForgotPasswordDTO, ResetPasswordDTO
from memolink_backend.business.interfaces.i_auth_service import IAuthService
from memolink_backend.core.security import hash_password, verify_password, create_access_token, create_reset_token, verify_reset_token
from memolink_backend.core.config import settings

logger = logging.getLogger(__name__)


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
        level = getattr(user, "access_level", "regular") or "regular"
        token = create_access_token(user.id, user.email, is_admin=getattr(user, "is_admin", False), access_level=level)
        return TokenResponse(access_token=token, id=user.id, email=user.email, is_admin=getattr(user, "is_admin", False), access_level=level)

    def login(self, dto: LoginDTO) -> TokenResponse:
        user = self.repo.get_by_email(dto.email)
        if not user or not verify_password(dto.password, user.password):
            raise ValueError("Invalid email or password")
        level = getattr(user, "access_level", "regular") or "regular"
        token = create_access_token(user.id, user.email, is_admin=getattr(user, "is_admin", False), access_level=level)
        return TokenResponse(access_token=token, id=user.id, email=user.email, is_admin=getattr(user, "is_admin", False), access_level=level)

    def change_password(self, user_id: int, dto: ChangePasswordDTO) -> None:
        user = self.repo.get_by_id(user_id)
        if not user or not verify_password(dto.current_password, user.password):
            raise ValueError("Current password is incorrect")
        if len(dto.new_password) < 8:
            raise ValueError("New password must be at least 8 characters")
        self.repo.update_password(user_id, hash_password(dto.new_password))

    def forgot_password(self, dto: ForgotPasswordDTO) -> None:
        user = self.repo.get_by_email(dto.email)
        if not user:
            return  # Silent — don't reveal whether email exists
        token = create_reset_token(dto.email)
        reset_url = f"{settings.frontend_url}?reset_token={token}"
        self._send_reset_email(dto.email, reset_url)

    def reset_password(self, dto: ResetPasswordDTO) -> None:
        email = verify_reset_token(dto.token)  # raises HTTPException on failure
        if len(dto.new_password) < 8:
            raise ValueError("Password must be at least 8 characters")
        user = self.repo.get_by_email(email)
        if not user:
            raise ValueError("User not found")
        self.repo.update_password(user.id, hash_password(dto.new_password))

    def _send_reset_email(self, to_email: str, reset_url: str) -> None:
        body = (
            f"Hi,\n\nClick the link below to reset your MemoLink password.\n"
            f"This link expires in 1 hour.\n\n{reset_url}\n\n"
            f"If you didn't request this, you can ignore this email."
        )
        if not settings.smtp_host:
            logger.info("SMTP not configured — reset link: %s", reset_url)
            return
        msg = MIMEText(body)
        msg["Subject"] = "MemoLink — Reset your password"
        msg["From"] = settings.smtp_from or settings.smtp_user
        msg["To"] = to_email
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                server.starttls()
                server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(msg["From"], [to_email], msg.as_string())
        except Exception:
            logger.exception("Failed to send password reset email to %s", to_email)
