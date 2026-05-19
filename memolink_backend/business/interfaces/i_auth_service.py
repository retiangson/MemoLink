from typing import Protocol
from memolink_backend.contracts.auth_dtos import RegisterDTO, LoginDTO, TokenResponse


class IAuthService(Protocol):
    def register(self, dto: RegisterDTO) -> TokenResponse: ...
    def login(self, dto: LoginDTO) -> TokenResponse: ...
