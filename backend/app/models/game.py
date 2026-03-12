import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models import Base


class Game(Base):
    __tablename__ = "games"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    # idle | setup | active | paused | completed | cancelled
    state: Mapped[str] = mapped_column(String, nullable=False, default="setup")
    score_a: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score_b: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    elapsed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # accumulated seconds while paused
    winner: Mapped[str | None] = mapped_column(String, nullable=True)  # "a" | "b" | null
    goal_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at = mapped_column(DateTime(timezone=True), nullable=True)  # set when active, cleared on pause
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def computed_elapsed(self) -> int:
        """Total elapsed = accumulated + current active period (if active)."""
        if self.state == "active" and self.started_at is not None:
            sa = self.started_at
            if sa.tzinfo is None:
                sa = sa.replace(tzinfo=timezone.utc)
            delta = (datetime.now(timezone.utc) - sa).total_seconds()
            return self.elapsed + int(delta)
        return self.elapsed

    # relationships
    group = relationship("Group", lazy="select")
    players: Mapped[list["GamePlayer"]] = relationship(
        "GamePlayer", back_populates="game", cascade="all, delete-orphan", lazy="raise"
    )
    goals: Mapped[list["GameGoal"]] = relationship(
        "GameGoal", back_populates="game", cascade="all, delete-orphan",
        lazy="raise", order_by="GameGoal.created_at"
    )


class GamePlayer(Base):
    __tablename__ = "game_players"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("games.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    side: Mapped[str] = mapped_column(String, nullable=False)  # "a" | "b"

    # relationships
    game: Mapped["Game"] = relationship("Game", back_populates="players")
    user = relationship("User", lazy="joined")


class GameGoal(Base):
    __tablename__ = "game_goals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("games.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    scored_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    side: Mapped[str] = mapped_column(String, nullable=False)  # which side gets the point
    friendly_fire: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    elapsed_at: Mapped[int] = mapped_column(Integer, nullable=False)  # seconds when goal was scored
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())

    # relationships
    game: Mapped["Game"] = relationship("Game", back_populates="goals")
    scorer = relationship("User", lazy="joined")
