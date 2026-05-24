from pydantic import BaseModel


class RegisterDTO(BaseModel):
    email: str
    password: str


class LoginDTO(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    email: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    id: int
    email: str
    is_admin: bool = False
    access_level: str = "regular"


class ChangePasswordDTO(BaseModel):
    current_password: str
    new_password: str


class ForgotPasswordDTO(BaseModel):
    email: str


class ResetPasswordDTO(BaseModel):
    token: str
    new_password: str
