import pytest

from memolink_backend.business.services.auth_service import AuthService
from memolink_backend.contracts.auth_dtos import ChangePasswordDTO, LoginDTO, RegisterDTO
from memolink_backend.core.security import verify_password
from tests.fakes.user_repository import FakeUserRepository


def test_register_hashes_password_and_returns_token(fake):
    repo = FakeUserRepository()
    service = AuthService(user_repo=repo)
    password = fake.password(length=12)

    result = service.register(RegisterDTO(email=fake.email(), password=password))

    user = repo.get_by_id(result.id)
    assert result.access_token
    assert user.password != password
    assert verify_password(password, user.password)


def test_login_rejects_invalid_password(fake):
    repo = FakeUserRepository()
    service = AuthService(user_repo=repo)
    service.register(RegisterDTO(email=fake.email(), password="CorrectPass123"))

    with pytest.raises(ValueError, match="Invalid email or password"):
        service.login(LoginDTO(email=next(iter(repo.users_by_email)), password="wrong"))


def test_change_password_updates_hash(fake):
    repo = FakeUserRepository()
    service = AuthService(user_repo=repo)
    user = service.register(RegisterDTO(email=fake.email(), password="CurrentPass123"))

    service.change_password(
        user.id,
        ChangePasswordDTO(current_password="CurrentPass123", new_password="NewPass123"),
    )

    assert verify_password("NewPass123", repo.get_by_id(user.id).password)
