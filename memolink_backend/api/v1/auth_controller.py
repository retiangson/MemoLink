from fastapi import APIRouter, HTTPException, Depends
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.contracts.auth_dtos import RegisterDTO, LoginDTO, TokenResponse, ChangePasswordDTO
from memolink_backend.core.security import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(dto: RegisterDTO, c: RequestContainer = Depends(get_request_container)):
    try:
        return c.auth().register(dto)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login", response_model=TokenResponse)
def login(dto: LoginDTO, c: RequestContainer = Depends(get_request_container)):
    try:
        return c.auth().login(dto)
    except ValueError:
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
