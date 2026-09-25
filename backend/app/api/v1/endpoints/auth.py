from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from app.core.auth import (
    authenticate,
    auth_enabled,
    create_access_token,
    create_refresh_token,
    get_client_ip,
    get_current_user,
    revoke_token,
    rotate_refresh_token,
    verify_oidc_identity,
    _decode_token,
)
from app.core.config import settings
from app.core.audit_log import log_auth_event

router = APIRouter()
token_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/token")


class TokenRequest(BaseModel):
    username: str
    password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class OidcLoginRequest(BaseModel):
    id_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in: int
    role: str


@router.post("/token", response_model=TokenResponse, summary="Issue a JWT access token and refresh token")
async def issue_token(request: TokenRequest, http_request: Request) -> TokenResponse:
    if not auth_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT authentication is not configured",
        )
    user = authenticate(request.username, request.password)
    if user is None:
        log_auth_event(
            "AUTH_FAILED",
            username=request.username,
            success=False,
            detail="invalid_credentials",
            ip_address=get_client_ip(http_request),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    access_token = create_access_token(user["sub"], user["role"])
    refresh_token = create_refresh_token(user["sub"], user["role"])
    log_auth_event(
        "TOKEN_ISSUED",
        username=user["sub"],
        role=user["role"],
        jti=_decode_token(access_token).get("jti"),
        ip_address=get_client_ip(http_request),
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_MINUTES * 60,
        role=user["role"],
    )


@router.post("/refresh", response_model=TokenResponse, summary="Rotate refresh token and issue fresh token pair")
async def refresh_access_token(request: RefreshTokenRequest, http_request: Request) -> TokenResponse:
    if not auth_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT authentication is not configured",
        )
    tokens = rotate_refresh_token(request.refresh_token)
    log_auth_event(
        "TOKEN_REFRESHED",
        username=_decode_token(tokens["access_token"]).get("sub"),
        role=tokens["role"],
        jti=_decode_token(tokens["access_token"]).get("jti"),
        ip_address=get_client_ip(http_request),
    )
    return TokenResponse(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
        token_type="bearer",
        expires_in=tokens["expires_in"],
        role=tokens["role"],
    )


@router.post("/oidc/login", response_model=TokenResponse, summary="Authenticate via external OIDC ID token")
async def oidc_login(request: OidcLoginRequest, http_request: Request) -> TokenResponse:
    if not auth_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT authentication is not configured",
        )
    oidc_user = verify_oidc_identity(request.id_token)
    access_token = create_access_token(oidc_user["sub"], oidc_user["role"])
    refresh_token = create_refresh_token(oidc_user["sub"], oidc_user["role"])
    log_auth_event(
        "OIDC_LOGIN",
        username=oidc_user["sub"],
        role=oidc_user["role"],
        jti=_decode_token(access_token).get("jti"),
        detail=f"provider={oidc_user.get('provider')}",
        ip_address=get_client_ip(http_request),
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_MINUTES * 60,
        role=oidc_user["role"],
    )


@router.post("/revoke", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke the current JWT")
async def revoke_current_token(
    http_request: Request,
    token: str = Depends(token_scheme),
    _user: dict = Depends(get_current_user),
) -> None:
    revoke_token(token)
    payload = _decode_token(token, verify_exp=False)
    log_auth_event(
        "TOKEN_REVOKED",
        username=_user.get("sub"),
        role=_user.get("role"),
        jti=payload.get("jti"),
        detail="current_token",
        ip_address=get_client_ip(http_request),
    )
