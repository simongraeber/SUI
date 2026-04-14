"""
Standalone game endpoints — no group context required.
Used by tournament match games where there is no linked group.
"""
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.game import (
    GameGoalCreate,
    GameResponse,
    GameUpdate,
)
from app.services.game import (
    apply_game_update,
    apply_goal,
    build_game_response,
    load_game,
    remove_goal,
)

router = APIRouter(prefix="/games", tags=["games"])


@router.get("/{game_id}", response_model=GameResponse)
async def get_game(
    game_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return build_game_response(await load_game(game_id, db))


@router.patch("/{game_id}", response_model=GameResponse)
async def update_game(
    game_id: uuid.UUID,
    body: GameUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await load_game(game_id, db)
    await apply_game_update(game, body, db)
    await db.commit()
    return build_game_response(await load_game(game_id, db))


@router.post("/{game_id}/goals", response_model=GameResponse, status_code=201)
async def record_goal(
    game_id: uuid.UUID,
    body: GameGoalCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await load_game(game_id, db)
    await apply_goal(game, body, db)
    await db.commit()
    return build_game_response(await load_game(game_id, db))


@router.delete("/{game_id}/goals/{goal_id}", response_model=GameResponse)
async def delete_goal(
    game_id: uuid.UUID,
    goal_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await load_game(game_id, db)
    await remove_goal(game, goal_id, db)
    await db.commit()
    return build_game_response(await load_game(game_id, db))
