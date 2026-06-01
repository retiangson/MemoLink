from fastapi import APIRouter, HTTPException, Depends
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.contracts.auth_dtos import RegisterDTO, LoginDTO, TokenResponse, ChangePasswordDTO, ForgotPasswordDTO, ResetPasswordDTO
from memolink_backend.core.security import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(dto: RegisterDTO, c: RequestContainer = Depends(get_request_container)):
    try:
        result = c.auth().register(dto)
        c.logs().info("auth.register", f"New user registered: {dto.email}")
        return result
    except ValueError as e:
        c.logs().warning("auth.register", f"Registration failed for {dto.email}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login", response_model=TokenResponse)
def login(dto: LoginDTO, c: RequestContainer = Depends(get_request_container)):
    try:
        result = c.auth().login(dto)
        c.logs().info("auth.login", f"User logged in: {dto.email}")
        return result
    except ValueError:
        c.logs().warning("auth.login", f"Failed login attempt for {dto.email}")
        raise HTTPException(status_code=401, detail="Invalid email or password")


@router.post("/change-password")
def change_password(
    dto: ChangePasswordDTO,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    try:
        c.auth().change_password(user_id, dto)
        return {"message": "Password changed successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/forgot-password")
def forgot_password(dto: ForgotPasswordDTO, c: RequestContainer = Depends(get_request_container)):
    c.auth().forgot_password(dto)
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(dto: ResetPasswordDTO, c: RequestContainer = Depends(get_request_container)):
    try:
        c.auth().reset_password(dto)
        return {"message": "Password reset successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
