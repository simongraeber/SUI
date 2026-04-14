import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, assert_group_membership
from app.database import get_db
from app.models.game import Game, GamePlayer
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.game import (
    GameCreate,
    GameGoalCreate,
    GameResponse,
    GameSummary,
    GameUpdate,
)
from app.services.game import (
    apply_game_update,
    apply_goal,
    build_game_response,
    load_game,
    remove_goal,
)

router = APIRouter(prefix="/groups/{group_id}/games", tags=["games"])


# ── endpoints ────────────────────────────────────────────────


@router.post("", response_model=GameResponse, status_code=status.HTTP_201_CREATED)
async def create_game(
    group_id: uuid.UUID,
    body: GameCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new game with player assignments for Side A and Side B."""
    await assert_group_membership(group_id, user, db)

    if not body.side_a or not body.side_b:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both sides must have at least one player",
        )

    # Verify all players are group members
    all_player_ids = set(body.side_a + body.side_b)
    result = await db.execute(
        select(GroupMember.user_id).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id.in_(all_player_ids),
        )
    )
    member_ids = {row[0] for row in result.all()}
    missing = all_player_ids - member_ids
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Some players are not group members: {missing}",
        )

    game = Game(group_id=group_id, state="setup", created_by=user.id)
    db.add(game)
    await db.flush()

    for uid in body.side_a:
        db.add(GamePlayer(game_id=game.id, user_id=uid, side="a"))
    for uid in body.side_b:
        db.add(GamePlayer(game_id=game.id, user_id=uid, side="b"))

    await db.commit()

    # Re-fetch with relationships loaded
    game = await load_game(game.id, db, group_id=group_id)
    return build_game_response(game)


@router.get("", response_model=list[GameSummary])
async def list_games(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all games for a group (most recent first)."""
    await assert_group_membership(group_id, user, db)

    result = await db.execute(
        select(Game)
        .where(Game.group_id == group_id)
        .order_by(Game.created_at.desc())
        .limit(50)
    )
    games = result.scalars().all()
    return [
        GameSummary(
            id=g.id,
            state=g.state,
            score_a=g.score_a,
            score_b=g.score_b,
            elapsed=g.computed_elapsed,
            winner=g.winner,
            created_at=g.created_at,
        )
        for g in games
    ]


@router.get("/player/{player_id}", response_model=list[GameResponse])
async def list_player_games(
    group_id: uuid.UUID,
    player_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List recent completed games for a specific player in a group."""
    await assert_group_membership(group_id, user, db)

    # Find game IDs where this player participated
    player_game_ids = select(GamePlayer.game_id).where(
        GamePlayer.user_id == player_id
    ).scalar_subquery()

    result = await db.execute(
        select(Game)
        .options(selectinload(Game.players), selectinload(Game.goals))
        .where(
            Game.group_id == group_id,
            Game.state == "completed",
            Game.id.in_(player_game_ids),
        )
        .order_by(Game.created_at.desc())
        .limit(20)
    )
    games = result.scalars().all()
    return [build_game_response(g) for g in games]


@router.get("/active", response_model=GameResponse | None)
async def get_active_game(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the currently active (or setup/paused) game for the group, if any."""
    await assert_group_membership(group_id, user, db)

    result = await db.execute(
        select(Game)
        .options(selectinload(Game.players), selectinload(Game.goals))
        .where(
            Game.group_id == group_id,
            Game.state.in_(["setup", "active", "paused"]),
        )
        .order_by(Game.created_at.desc())
        .limit(1)
    )
    game = result.scalar_one_or_none()
    if game is None:
        return None
    return build_game_response(game)


@router.get("/{game_id}", response_model=GameResponse)
async def get_game(
    group_id: uuid.UUID,
    game_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full game state (used for live polling)."""
    await assert_group_membership(group_id, user, db)
    game = await load_game(game_id, db, group_id=group_id)
    return build_game_response(game)


@router.patch("/{game_id}", response_model=GameResponse)
async def update_game(
    group_id: uuid.UUID,
    game_id: uuid.UUID,
    body: GameUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update game state (score, status, elapsed, winner)."""
    await assert_group_membership(group_id, user, db)
    game = await load_game(game_id, db, group_id=group_id)
    await apply_game_update(game, body, db)
    await db.commit()
    game = await load_game(game_id, db, group_id=group_id)
    return build_game_response(game)


@router.post(
    "/{game_id}/goals",
    response_model=GameResponse,
    status_code=status.HTTP_201_CREATED,
)
async def record_goal(
    group_id: uuid.UUID,
    game_id: uuid.UUID,
    body: GameGoalCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a goal, update scores, and check for win."""
    await assert_group_membership(group_id, user, db)
    game = await load_game(game_id, db, group_id=group_id)
    await apply_goal(game, body, db)
    await db.commit()
    game = await load_game(game_id, db, group_id=group_id)
    return build_game_response(game)


@router.delete(
    "/{game_id}/goals/{goal_id}",
    response_model=GameResponse,
)
async def delete_goal(
    group_id: uuid.UUID,
    game_id: uuid.UUID,
    goal_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Undo a goal: remove the GameGoal record and adjust score/goal_count."""
    await assert_group_membership(group_id, user, db)
    game = await load_game(game_id, db, group_id=group_id)
    await remove_goal(game, goal_id, db)
    await db.commit()
    game = await load_game(game_id, db, group_id=group_id)
    return build_game_response(game)
