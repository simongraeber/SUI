from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


# ── Request schemas ──
class GroupCreate(BaseModel):
    name: str


class GroupJoin(BaseModel):
    invite_code: str


# ── Response schemas ──
class GroupMemberResponse(BaseModel):
    user_id: UUID
    name: str
    email: str
    image_url: str | None = None
    joined_at: datetime
    last_played_at: datetime | None = None

    model_config = {"from_attributes": True}


class GroupResponse(BaseModel):
    id: UUID
    name: str
    invite_code: str
    created_by: UUID
    created_at: datetime
    member_count: int = 0

    model_config = {"from_attributes": True}


class GroupDetailResponse(GroupResponse):
    members: list[GroupMemberResponse] = []


# ── Stats schemas ──
class PlayerStatsResponse(BaseModel):
    user_id: UUID
    name: str
    image_url: str | None = None
    elo: int = 1000
    elo_delta: int = 0
    provisional: bool = True
    games_played: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    goals_scored: int = 0
    goals_conceded: int = 0
    goal_diff: int = 0
    goals_per_game: float = 0.0
    own_goals: int = 0
    form: list[str] = []
    streak: dict | None = None

    model_config = {"from_attributes": True}


class LeaderboardSummary(BaseModel):
    highest_rated: dict | None = None
    top_scorer: dict | None = None
    hot_streak: dict | None = None


class PeriodInfo(BaseModel):
    start: str | None = None
    end: str | None = None
    label: str = "All Time"


class GroupStatsResponse(BaseModel):
    period: PeriodInfo = PeriodInfo()
    total_games: int = 0
    summary: LeaderboardSummary = LeaderboardSummary()
    players: list[PlayerStatsResponse] = []

    model_config = {"from_attributes": True}
