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
