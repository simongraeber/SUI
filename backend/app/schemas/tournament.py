from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, field_validator


# ── Request schemas ──────────────────────────────────────────
class TournamentCreate(BaseModel):
    name: str
    games_per_match: int = 1
    goals_per_game: int = 10

    @field_validator("games_per_match")
    @classmethod
    def validate_games(cls, v: int) -> int:
        if v < 1:
            raise ValueError("games_per_match must be at least 1")
        return v

    @field_validator("goals_per_game")
    @classmethod
    def validate_goals(cls, v: int) -> int:
        if v < 1:
            raise ValueError("goals_per_game must be at least 1")
        return v


class TournamentTeamCreate(BaseModel):
    name: str
    user_id: UUID | None = None


class TournamentTeamPlayerCreate(BaseModel):
    name: str
    user_id: UUID | None = None


class RoundSettingsUpdate(BaseModel):
    goals_to_win: int | None = None
    win_by: int | None = None

    @field_validator("goals_to_win")
    @classmethod
    def validate_goals_to_win(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("goals_to_win must be at least 1")
        return v

    @field_validator("win_by")
    @classmethod
    def validate_win_by(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("win_by must be at least 1")
        return v


class LaunchGameResponse(BaseModel):
    game_id: UUID


# ── Response schemas ─────────────────────────────────────────
class TournamentTeamPlayerResponse(BaseModel):
    id: UUID
    team_id: UUID
    name: str
    user_id: UUID | None = None
    user_image_url: str | None = None

    model_config = {"from_attributes": True}


class TournamentTeamResponse(BaseModel):
    id: UUID
    tournament_id: UUID
    name: str
    user_id: UUID | None = None
    user_name: str | None = None
    user_image_url: str | None = None
    image_url: str | None = None
    seed: int
    created_at: datetime
    players: list[TournamentTeamPlayerResponse] = []

    model_config = {"from_attributes": True}


class TournamentMatchResponse(BaseModel):
    id: UUID
    tournament_id: UUID
    round: int
    position: int
    team_a: TournamentTeamResponse | None = None
    team_b: TournamentTeamResponse | None = None
    score_a: int | None = None
    score_b: int | None = None
    winner_id: UUID | None = None
    status: str
    is_bye: bool
    game_id: UUID | None = None
    goals_to_win: int | None = None
    win_by: int | None = None

    model_config = {"from_attributes": True}


class TournamentResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    admin_user_id: UUID
    admin_name: str
    status: str
    games_per_match: int
    goals_per_game: int
    num_rounds: int | None = None
    created_at: datetime
    updated_at: datetime
    teams: list[TournamentTeamResponse] = []
    matches: list[TournamentMatchResponse] = []

    model_config = {"from_attributes": True}


class TournamentSummary(BaseModel):
    id: UUID
    name: str
    slug: str
    admin_user_id: UUID
    status: str
    team_count: int
    created_at: datetime

    model_config = {"from_attributes": True}
