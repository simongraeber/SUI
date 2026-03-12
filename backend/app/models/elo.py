import uuid

from sqlalchemy import DateTime, Float, ForeignKey, Integer, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models import Base


class PlayerRating(Base):
    """Current Elo rating per player per group."""
    __tablename__ = "player_ratings"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_player_rating_group_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    elo: Mapped[float] = mapped_column(Float, nullable=False, default=1000.0)
    games_played: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provisional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # relationships
    user = relationship("User", lazy="joined")


class EloHistory(Base):
    """Elo snapshot per player per game — enables progression queries."""
    __tablename__ = "elo_history"
    __table_args__ = (
        UniqueConstraint("game_id", "user_id", name="uq_elo_history_game_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("games.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        index=True,
    )
    elo_before: Mapped[float] = mapped_column(Float, nullable=False)
    elo_after: Mapped[float] = mapped_column(Float, nullable=False)
    delta: Mapped[float] = mapped_column(Float, nullable=False)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
