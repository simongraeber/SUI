"""Elo rating computation and persistence.

Extracted from the on-the-fly calculation in groups.py so it can be
called both at game-completion time and during backfill.
"""

import uuid
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.elo import EloHistory, PlayerRating
from app.models.game import Game, GamePlayer


# ── Constants ───────────────────────────────────────────────
INITIAL_ELO = 1000.0
PROVISIONAL_THRESHOLD = 10  # games before rating is non-provisional


def _k_factor(games_played: int) -> int:
    if games_played < 10:
        return 40
    if games_played < 20:
        return 32
    return 24


def compute_elo_deltas(
    game: Game,
    ratings: dict[uuid.UUID, tuple[float, int]],
) -> dict[uuid.UUID, tuple[float, float, float]]:
    """Compute Elo changes for every player in a completed game.

    Args:
        game: A completed Game with players loaded.
        ratings: {user_id: (current_elo, games_played)} for each participant.

    Returns:
        {user_id: (elo_before, elo_after, delta)} for each participant.
    """
    side_a = [gp for gp in game.players if gp.side == "a"]
    side_b = [gp for gp in game.players if gp.side == "b"]

    team_avg_a = (
        sum(ratings[p.user_id][0] for p in side_a) / len(side_a)
    ) if side_a else INITIAL_ELO
    team_avg_b = (
        sum(ratings[p.user_id][0] for p in side_b) / len(side_b)
    ) if side_b else INITIAL_ELO

    e_a = 1.0 / (1.0 + 10 ** ((team_avg_b - team_avg_a) / 400.0))
    e_b = 1.0 - e_a

    if game.winner == "a":
        s_a, s_b = 1.0, 0.0
    elif game.winner == "b":
        s_a, s_b = 0.0, 1.0
    else:
        s_a, s_b = 0.5, 0.5

    goal_diff = abs(game.score_a - game.score_b)
    mov = 1.0 + 0.5 * (goal_diff / (goal_diff + 3.0)) if goal_diff > 0 else 1.0

    result: dict[uuid.UUID, tuple[float, float, float]] = {}

    for gp in side_a:
        elo_before, gp_count = ratings[gp.user_id]
        k = _k_factor(gp_count)
        delta = k * mov * (s_a - e_a)
        result[gp.user_id] = (elo_before, elo_before + delta, delta)

    for gp in side_b:
        elo_before, gp_count = ratings[gp.user_id]
        k = _k_factor(gp_count)
        delta = k * mov * (s_b - e_b)
        result[gp.user_id] = (elo_before, elo_before + delta, delta)

    return result


async def update_elo_for_game(
    game: Game,
    db: AsyncSession,
) -> dict[uuid.UUID, tuple[float, float, float]]:
    """Compute and persist Elo updates after a game completes.

    Reads current PlayerRating rows (creates new ones at INITIAL_ELO for
    first-time players), writes EloHistory entries, and updates
    PlayerRating.elo / games_played / provisional.

    Returns {user_id: (elo_before, elo_after, delta)}.
    """
    player_ids = [gp.user_id for gp in game.players]

    # Guard: prevent double Elo updates for the same game
    existing_history = await db.execute(
        select(EloHistory.id).where(EloHistory.game_id == game.id).limit(1)
    )
    if existing_history.scalar_one_or_none() is not None:
        return {}

    # Fetch existing ratings
    result = await db.execute(
        select(PlayerRating).where(
            PlayerRating.group_id == game.group_id,
            PlayerRating.user_id.in_(player_ids),
        )
    )
    existing: dict[uuid.UUID, PlayerRating] = {
        pr.user_id: pr for pr in result.scalars().all()
    }

    # Ensure every player has a PlayerRating row
    for uid in player_ids:
        if uid not in existing:
            pr = PlayerRating(
                group_id=game.group_id,
                user_id=uid,
                elo=INITIAL_ELO,
                games_played=0,
                provisional=True,
            )
            db.add(pr)
            existing[uid] = pr

    await db.flush()  # ensure PRs have IDs

    # Build ratings dict for computation
    ratings = {
        uid: (pr.elo, pr.games_played) for uid, pr in existing.items()
    }

    deltas = compute_elo_deltas(game, ratings)

    # Persist EloHistory + update PlayerRating
    for uid, (elo_before, elo_after, delta) in deltas.items():
        db.add(EloHistory(
            game_id=game.id,
            group_id=game.group_id,
            user_id=uid,
            elo_before=elo_before,
            elo_after=elo_after,
            delta=delta,
        ))
        pr = existing[uid]
        pr.elo = elo_after
        pr.games_played += 1
        pr.provisional = pr.games_played < PROVISIONAL_THRESHOLD

    return deltas


async def backfill_elo_for_group(
    group_id: uuid.UUID,
    db: AsyncSession,
) -> int:
    """Replay all completed games for a group and populate Elo tables.

    Deletes any existing player_ratings and elo_history for the group
    first, then replays chronologically.

    Returns the number of games processed.
    """
    from app.models.elo import EloHistory, PlayerRating  # avoid circular at module level

    # Clear existing data for this group
    await db.execute(
        delete(EloHistory).where(EloHistory.group_id == group_id)
    )
    await db.execute(
        delete(PlayerRating).where(PlayerRating.group_id == group_id)
    )

    await db.flush()

    # Fetch all completed games chronologically
    result = await db.execute(
        select(Game)
        .options(selectinload(Game.players))
        .where(Game.group_id == group_id, Game.state == "completed")
        .order_by(Game.created_at.asc())
    )
    games = result.scalars().all()

    for game in games:
        await update_elo_for_game(game, db)

    return len(games)
