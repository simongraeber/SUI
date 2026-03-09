from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    image_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    name: str | None = None
    image_url: str | None = None
