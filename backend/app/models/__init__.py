from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import all models so Base.metadata knows about them
from app.models.user import User  # noqa: E402, F401
from app.models.group import Group, GroupMember  # noqa: E402, F401
from app.models.game import Game, GameGoal, GamePlayer  # noqa: E402, F401
from app.models.elo import PlayerRating, EloHistory  # noqa: E402, F401
