from pydantic import BaseModel


class GoogleTokenRequest(BaseModel):
    token: str


class GoogleCodeRequest(BaseModel):
    code: str
    redirect_uri: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
