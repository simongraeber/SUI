"""
Shared game logic used by both group-scoped and standalone game routes.
"""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.game import Game, GameGoal
from app.schemas.game import (
    GameGoalCreate,
    GameGoalResponse,
    GamePlayerResponse,
    GameResponse,
    GameUpdate,
)
from app.services.elo import update_elo_for_game
from app.services.tournament import resolve_match_from_game


async def load_game(
    game_id: uuid.UUID,
    db: AsyncSession,
    *,
    group_id: uuid.UUID | None = None,
) -> Game:
    """Fetch a game with players and goals eagerly loaded.

    When *group_id* is given the query is scoped to that group.
    Raises 404 if not found.
    """
    stmt = (
        select(Game)
        .options(selectinload(Game.players), selectinload(Game.goals))
        .where(Game.id == game_id)
    )
    if group_id is not None:
        stmt = stmt.where(Game.group_id == group_id)

    game = (await db.execute(stmt)).scalar_one_or_none()
    if game is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")
    return game


def build_game_response(game: Game) -> GameResponse:
    players = [
        GamePlayerResponse(
            user_id=gp.user_id,
            name=(
                gp.user.name
                if gp.user and gp.user.name is not None
                else gp.player_name
                if gp.player_name is not None
                else "Guest"
            ),
            image_url=gp.user.image_url if gp.user else None,
            side=gp.side,
        )
        for gp in game.players
    ]
    goals = [
        GameGoalResponse(
            id=g.id,
            scored_by=g.scored_by,
            scorer_name=g.scorer.name if g.scorer else (g.scorer_name or "Unknown"),
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
        tournament_match_id=game.tournament_match_id,
        state=game.state,
        score_a=game.score_a,
        score_b=game.score_b,
        elapsed=game.computed_elapsed,
        winner=game.winner,
        goal_count=game.goal_count,
        goals_to_win=game.goals_to_win,
        win_by=game.win_by,
        created_by=game.created_by,
        created_at=game.created_at,
        updated_at=game.updated_at,
        players=players,
        goals=goals,
    )


async def apply_game_update(game: Game, body: GameUpdate, db: AsyncSession) -> None:
    """Apply state transition and handle completion side-effects.

    Does NOT commit — the caller is responsible for committing.
    """
    if game.state in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot update a finished game")

    if body.state is not None:
        valid_transitions = {
            "setup": ["active", "cancelled"],
            "active": ["paused", "completed", "cancelled"],
            "paused": ["active", "completed", "cancelled"],
        }
        allowed = valid_transitions.get(game.state, [])
        if body.state not in allowed:
            raise HTTPException(
                status_code=400,
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

        if body.state == "active":
            game.started_at = now

        game.state = body.state

    await _on_completed(game, db)


async def apply_goal(game: Game, body: GameGoalCreate, db: AsyncSession) -> None:
    """Record a goal, update scores, check for win, and handle completion.

    Does NOT commit — the caller is responsible for committing.
    """
    if game.state != "active":
        raise HTTPException(status_code=400, detail="Goals can only be recorded while the game is active")

    goal = GameGoal(
        game_id=game.id,
        scored_by=body.scored_by,
        scorer_name=body.scorer_name,
        side=body.side,
        friendly_fire=body.friendly_fire,
        elapsed_at=body.elapsed_at,
    )
    db.add(goal)

    if body.side == "a":
        game.score_a += 1
    else:
        game.score_b += 1
    game.goal_count += 1

    # Check for win (first to goals_to_win, win by win_by)
    threshold = game.goals_to_win
    margin = game.win_by
    if game.score_a >= threshold and game.score_a - game.score_b >= margin:
        game.winner = "a"
    elif game.score_b >= threshold and game.score_b - game.score_a >= margin:
        game.winner = "b"

    if game.winner is not None:
        now = datetime.now(timezone.utc)
        if game.started_at is not None:
            sa = game.started_at
            if sa.tzinfo is None:
                sa = sa.replace(tzinfo=timezone.utc)
            game.elapsed += int((now - sa).total_seconds())
            game.started_at = None
        game.state = "completed"

    await _on_completed(game, db)


async def remove_goal(game: Game, goal_id: uuid.UUID, db: AsyncSession) -> None:
    """Undo a goal: remove record and adjust score.

    Does NOT commit — the caller is responsible for committing.
    """
    if game.state not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Goals can only be removed while the game is active or paused")

    goal = next((g for g in game.goals if g.id == goal_id), None)
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    if goal.side == "a":
        game.score_a = max(0, game.score_a - 1)
    else:
        game.score_b = max(0, game.score_b - 1)
    game.goal_count = max(0, game.goal_count - 1)

    await db.delete(goal)


async def _on_completed(game: Game, db: AsyncSession) -> None:
    """Elo + tournament hooks when a game completes."""
    if game.state == "completed" and game.winner is not None:
        if game.group_id:
            await update_elo_for_game(game, db)
        if game.tournament_match_id:
            await resolve_match_from_game(game.id, db)
