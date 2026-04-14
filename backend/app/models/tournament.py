import secrets
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models import Base


class TournamentTeamPlayer(Base):
    """An individual player belonging to a tournament team.

    ``user_id`` is null for guest players (no account).
    """

    __tablename__ = "tournament_team_players"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tournament_teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # relationships
    team = relationship("TournamentTeam", back_populates="players")
    user = relationship("User", lazy="joined")


class Tournament(Base):
    __tablename__ = "tournaments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('registration', 'active', 'completed')",
            name="ck_tournament_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(
        String, unique=True, nullable=False, default=lambda: secrets.token_urlsafe(8)
    )
    admin_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    linked_group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="SET NULL"), nullable=True
    )
    # registration | active | completed
    status: Mapped[str] = mapped_column(String, nullable=False, default="registration")
    games_per_match: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    goals_per_game: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # relationships
    teams: Mapped[list["TournamentTeam"]] = relationship(
        "TournamentTeam", back_populates="tournament", cascade="all, delete-orphan",
        order_by="TournamentTeam.seed",
    )
    matches: Mapped[list["TournamentMatch"]] = relationship(
        "TournamentMatch", back_populates="tournament", cascade="all, delete-orphan",
        order_by="TournamentMatch.round, TournamentMatch.position",
    )
    admin = relationship("User", lazy="raise")


class TournamentTeam(Base):
    __tablename__ = "tournament_teams"
    __table_args__ = (
        UniqueConstraint("tournament_id", "name", name="uq_tournament_team_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # relationships
    tournament: Mapped["Tournament"] = relationship("Tournament", back_populates="teams")
    user = relationship("User", lazy="joined")
    players: Mapped[list["TournamentTeamPlayer"]] = relationship(
        "TournamentTeamPlayer", back_populates="team", cascade="all, delete-orphan",
        lazy="selectin",
    )


class TournamentMatch(Base):
    __tablename__ = "tournament_matches"
    __table_args__ = (
        UniqueConstraint("tournament_id", "round", "position", name="uq_match_slot"),
        CheckConstraint(
            "status IN ('pending', 'active', 'completed')",
            name="ck_match_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-indexed within round
    team_a_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tournament_teams.id", ondelete="SET NULL"), nullable=True
    )
    team_b_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tournament_teams.id", ondelete="SET NULL"), nullable=True
    )
    score_a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_b: Mapped[int | None] = mapped_column(Integer, nullable=True)
    winner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tournament_teams.id", ondelete="SET NULL"), nullable=True
    )
    # pending | active | completed
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    game_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("games.id", ondelete="SET NULL"), nullable=True
    )
    goals_to_win: Mapped[int | None] = mapped_column(Integer, nullable=True)
    win_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # relationships
    tournament: Mapped["Tournament"] = relationship("Tournament", back_populates="matches")
    team_a = relationship("TournamentTeam", foreign_keys=[team_a_id], lazy="joined")
    team_b = relationship("TournamentTeam", foreign_keys=[team_b_id], lazy="joined")
    winner = relationship("TournamentTeam", foreign_keys=[winner_id], lazy="joined")

    @property
    def is_bye(self) -> bool:
        """True when one side is empty (team gets a free pass)."""
        return self.team_a_id is not None and self.team_b_id is None
