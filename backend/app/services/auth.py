from datetime import datetime, timedelta, timezone

import httpx
from jose import JWTError, jwt

from app.config import settings

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


async def verify_google_token(token: str) -> dict | None:
    """Verify a Google token and return user info, or None if invalid.

    Supports both ID tokens (from Google Sign-In button) and access tokens
    (from useGoogleLogin implicit flow).
    """
    async with httpx.AsyncClient() as client:
        # First try as an ID token
        resp = await client.get(f"{GOOGLE_TOKENINFO_URL}?id_token={token}")
        if resp.status_code == 200:
            data = resp.json()
            if data.get("aud") != settings.google_client_id:
                return None
            return {
                "google_id": data["sub"],
                "email": data["email"],
                "name": data.get("name", data["email"]),
                "image_url": data.get("picture"),
            }

        # Fall back to treating it as an access token
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return {
            "google_id": data["sub"],
            "email": data["email"],
            "name": data.get("name", data["email"]),
            "image_url": data.get("picture"),
        }


async def exchange_google_code(code: str, redirect_uri: str) -> dict | None:
    """Exchange an authorization code for user info via Google OAuth2."""
    async with httpx.AsyncClient() as client:
        # Exchange code for tokens
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if resp.status_code != 200:
            return None
        tokens = resp.json()
        access_token = tokens.get("access_token")
        if not access_token:
            return None

        # Use the access token to get user info
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return {
            "google_id": data["sub"],
            "email": data["email"],
            "name": data.get("name", data["email"]),
            "image_url": data.get("picture"),
        }


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        return payload.get("sub")
    except JWTError:
        return None
