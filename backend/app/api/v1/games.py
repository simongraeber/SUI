import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.game import Game, GameGoal, GamePlayer
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.game import (
    GameCreate,
    GameGoalCreate,
    GameGoalResponse,
    GamePlayerResponse,
    GameResponse,
    GameSummary,
    GameUpdate,
)

router = APIRouter(prefix="/groups/{group_id}/games", tags=["games"])


# ── helpers ──────────────────────────────────────────────────
async def _assert_group_membership(
    group_id: uuid.UUID, user: User, db: AsyncSession
) -> GroupMember:
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user.id
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this group",
        )
    return member


async def _get_game_or_404(
    game_id: uuid.UUID, group_id: uuid.UUID, db: AsyncSession
) -> Game:
    result = await db.execute(
        select(Game)
        .options(selectinload(Game.players), selectinload(Game.goals))
        .where(Game.id == game_id, Game.group_id == group_id)
    )
    game = result.scalar_one_or_none()
    if game is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Game not found"
        )
    return game


def _build_response(game: Game) -> GameResponse:
    players = [
        GamePlayerResponse(
            user_id=gp.user.id,
            name=gp.user.name,
            image_url=gp.user.image_url,
            side=gp.side,
        )
        for gp in game.players
    ]
    goals = [
        GameGoalResponse(
            id=g.id,
            scored_by=g.scored_by,
            scorer_name=g.scorer.name if g.scorer else "Unknown",
            scorer_image_url=g.scorer.image_url if g.scorer else None,
            side=g.side,
            friendly_fire=g.friendly_fire,
            elapsed_at=g.elapsed_at,
            created_at=g.created_at,
        )
        for g in game.goals
    ]
    return GameResponse(
        id=game.id,
        group_id=game.group_id,
        state=game.state,
        score_a=game.score_a,
        score_b=game.score_b,
        elapsed=game.computed_elapsed,
        winner=game.winner,
        goal_count=game.goal_count,
        created_by=game.created_by,
        created_at=game.created_at,
        updated_at=game.updated_at,
        players=players,
        goals=goals,
    )


# ── endpoints ────────────────────────────────────────────────


@router.post("", response_model=GameResponse, status_code=status.HTTP_201_CREATED)
async def create_game(
    group_id: uuid.UUID,
    body: GameCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new game with player assignments for Side A and Side B."""
    await _assert_group_membership(group_id, user, db)

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
    game = await _get_game_or_404(game.id, group_id, db)
    return _build_response(game)


@router.get("", response_model=list[GameSummary])
async def list_games(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all games for a group (most recent first)."""
    await _assert_group_membership(group_id, user, db)

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
            elapsed=g.elapsed,
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
    await _assert_group_membership(group_id, user, db)

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
    return [_build_response(g) for g in games]


@router.get("/active", response_model=GameResponse | None)
async def get_active_game(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the currently active (or setup/paused) game for the group, if any."""
    await _assert_group_membership(group_id, user, db)

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
    return _build_response(game)


@router.get("/{game_id}", response_model=GameResponse)
async def get_game(
    group_id: uuid.UUID,
    game_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full game state (used for live polling)."""
    await _assert_group_membership(group_id, user, db)
    game = await _get_game_or_404(game_id, group_id, db)
    return _build_response(game)


@router.patch("/{game_id}", response_model=GameResponse)
async def update_game(
    group_id: uuid.UUID,
    game_id: uuid.UUID,
    body: GameUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update game state (score, status, elapsed, winner)."""
    await _assert_group_membership(group_id, user, db)
    game = await _get_game_or_404(game_id, group_id, db)

    if game.state in ("completed", "cancelled"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update a finished game",
        )

    if body.state is not None:
        valid_transitions = {
            "setup": ["active", "cancelled"],
            "active": ["paused", "completed", "cancelled"],
            "paused": ["active", "completed", "cancelled"],
        }
        allowed = valid_transitions.get(game.state, [])
        if body.state not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot transition from '{game.state}' to '{body.state}'",
            )

        now = datetime.now(timezone.utc)

        # Accumulate elapsed when leaving active state
        if game.state == "active" and body.state != "active":
            if game.started_at is not None:
                sa = game.started_at
                if sa.tzinfo is None:
                    sa = sa.replace(tzinfo=timezone.utc)
                game.elapsed += int((now - sa).total_seconds())
            game.started_at = None

        # Set started_at when entering active state
        if body.state == "active":
            game.started_at = now

        game.state = body.state

    if body.score_a is not None:
        game.score_a = body.score_a
    if body.score_b is not None:
        game.score_b = body.score_b
    if body.elapsed is not None:
        game.elapsed = body.elapsed
    if body.winner is not None:
        game.winner = body.winner

    await db.commit()
    await db.refresh(game)

    # Re-fetch with relationships
    game = await _get_game_or_404(game_id, group_id, db)
    return _build_response(game)


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
    await _assert_group_membership(group_id, user, db)
    game = await _get_game_or_404(game_id, group_id, db)

    if game.state != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goals can only be recorded while the game is active",
        )

    # Create goal event
    goal = GameGoal(
        game_id=game.id,
        scored_by=body.scored_by,
        side=body.side,
        friendly_fire=body.friendly_fire,
        elapsed_at=body.elapsed_at,
    )
    db.add(goal)

    # Update scores
    if body.side == "a":
        game.score_a += 1
    else:
        game.score_b += 1

    game.goal_count += 1

    # Check for win (first to SCORE_THRESHOLD, win by WIN_MARGIN)
    score_threshold = 10
    win_margin = 2
    if (
        game.score_a >= score_threshold
        and game.score_a - game.score_b >= win_margin
    ):
        game.state = "completed"
        game.winner = "a"
    elif (
        game.score_b >= score_threshold
        and game.score_b - game.score_a >= win_margin
    ):
        game.state = "completed"
        game.winner = "b"

    await db.commit()

    # Re-fetch with relationships
    game = await _get_game_or_404(game_id, group_id, db)
    return _build_response(game)
