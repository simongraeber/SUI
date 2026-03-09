from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


# ── Request schemas ──
class GameCreate(BaseModel):
    """Create a new game for a group with player assignments."""
    side_a: list[UUID]  # user_ids for side A
    side_b: list[UUID]  # user_ids for side B


class GameUpdate(BaseModel):
    """Partial update for game state (score, status, etc.)."""
    state: str | None = None  # active | paused | completed | cancelled
    score_a: int | None = None
    score_b: int | None = None
    elapsed: int | None = None
    winner: str | None = None


class GameGoalCreate(BaseModel):
    """Record a goal with scorer info."""
    scored_by: UUID        # user_id of the player who scored
    side: str              # which side gets the point ("a" | "b")
    friendly_fire: bool = False
    elapsed_at: int        # elapsed seconds when goal was scored


# ── Response schemas ──
class GamePlayerResponse(BaseModel):
    user_id: UUID
    name: str
    image_url: str | None = None
    side: str  # "a" | "b"

    model_config = {"from_attributes": True}


class GameGoalResponse(BaseModel):
    id: UUID
    scored_by: UUID
    scorer_name: str
    scorer_image_url: str | None = None
    side: str
    friendly_fire: bool
    elapsed_at: int
    created_at: datetime

    model_config = {"from_attributes": True}


class GameResponse(BaseModel):
    id: UUID
    group_id: UUID
    state: str
    score_a: int
    score_b: int
    elapsed: int
    winner: str | None = None
    goal_count: int = 0
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    players: list[GamePlayerResponse] = []
    goals: list[GameGoalResponse] = []

    model_config = {"from_attributes": True}


class GameSummary(BaseModel):
    """Lightweight game summary for list endpoints."""
    id: UUID
    state: str
    score_a: int
    score_b: int
    elapsed: int
    winner: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
