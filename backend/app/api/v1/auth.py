from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.auth import GoogleTokenRequest, GoogleCodeRequest, TokenResponse
from app.services.auth import create_access_token, verify_google_token, exchange_google_code

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/google", response_model=TokenResponse)
async def google_login(body: GoogleTokenRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a Google ID token for a JWT access token."""
    google_user = await verify_google_token(body.token)
    if google_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token"
        )

    # Find or create user
    result = await db.execute(
        select(User).where(User.google_id == google_user["google_id"])
    )
    user = result.scalar_one_or_none()

    if user is None:
        user = User(**google_user)
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return TokenResponse(access_token=create_access_token(str(user.id)))


@router.post("/google/code", response_model=TokenResponse)
async def google_code_login(body: GoogleCodeRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a Google authorization code for a JWT access token."""
    google_user = await exchange_google_code(body.code, body.redirect_uri)
    if google_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google authorization code"
        )

    # Find or create user
    result = await db.execute(
        select(User).where(User.google_id == google_user["google_id"])
    )
    user = result.scalar_one_or_none()

    if user is None:
        user = User(**google_user)
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return TokenResponse(access_token=create_access_token(str(user.id)))
