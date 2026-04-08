"""Group statistics computation."""

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.elo import EloHistory, PlayerRating
from app.models.game import Game, GameGoal, GamePlayer
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.group import (
    GroupStatsResponse,
    LeaderboardSummary,
    PeriodInfo,
    PlayerStatsResponse,
)


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


async def compute_group_stats(
    group_id: uuid.UUID,
    db: AsyncSession,
    start_date: str | None = None,
    end_date: str | None = None,
) -> GroupStatsResponse:
    """Compute full leaderboard / stats for a group, optionally filtered by date."""

    period_start = _parse_date(start_date)
    period_end = _parse_date(end_date)
    period_label = "Custom" if (period_start or period_end) else "All Time"
    is_period = period_start is not None or period_end is not None

    # ── Current Elo ratings ──
    ratings_result = await db.execute(
        select(PlayerRating).where(PlayerRating.group_id == group_id)
    )
    elo_map: dict[uuid.UUID, tuple[float, int, bool]] = {}
    for pr in ratings_result.scalars().all():
        elo_map[pr.user_id] = (pr.elo, pr.games_played, pr.provisional)

    # ── Elo delta for period ──
    elo_delta_map: dict[uuid.UUID, float] = {}
    if is_period:
        delta_query = (
            select(EloHistory.user_id, func.sum(EloHistory.delta))
            .join(Game, Game.id == EloHistory.game_id)
            .where(EloHistory.group_id == group_id, Game.state == "completed")
        )
        if period_start:
            delta_query = delta_query.where(Game.created_at >= period_start)
        if period_end:
            delta_query = delta_query.where(Game.created_at <= period_end)
        delta_query = delta_query.group_by(EloHistory.user_id)
        for uid, total_delta in (await db.execute(delta_query)).all():
            elo_delta_map[uid] = total_delta or 0.0

    # ── Player info from group members ──
    members_result = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id)
    )
    player_info: dict[uuid.UUID, dict] = {}
    for tm in members_result.scalars().all():
        player_info[tm.user_id] = {
            "name": tm.user.name,
            "image_url": tm.user.image_url,
        }

    # ── Base filter for completed games ──
    games_filter = [Game.group_id == group_id, Game.state == "completed"]
    if period_start:
        games_filter.append(Game.created_at >= period_start)
    if period_end:
        games_filter.append(Game.created_at <= period_end)

    # ── Total games ──
    total_result = await db.execute(
        select(func.count()).select_from(Game).where(*games_filter)
    )
    total_period_games = total_result.scalar() or 0

    # ── Per-player wins / losses / games / goals_conceded ──
    wl_result = await db.execute(
        select(
            GamePlayer.user_id,
            func.count().label("games_played"),
            func.sum(case((Game.winner == GamePlayer.side, 1), else_=0)).label("wins"),
            func.sum(case(
                (and_(Game.winner.isnot(None), Game.winner != GamePlayer.side), 1),
                else_=0,
            )).label("losses"),
            func.sum(
                case((GamePlayer.side == "a", Game.score_b), else_=Game.score_a)
            ).label("goals_conceded"),
        )
        .join(Game, Game.id == GamePlayer.game_id)
        .where(*games_filter)
        .group_by(GamePlayer.user_id)
    )
    stats: dict[uuid.UUID, dict] = {}
    for row in wl_result.all():
        stats[row.user_id] = {
            "games_played": row.games_played,
            "wins": int(row.wins or 0),
            "losses": int(row.losses or 0),
            "goals_conceded": int(row.goals_conceded or 0),
            "goals_scored": 0,
            "own_goals": 0,
        }

    # ── Goals scored / own goals ──
    goals_result = await db.execute(
        select(
            GameGoal.scored_by,
            func.sum(case((GameGoal.friendly_fire == False, 1), else_=0)).label("goals_scored"),  # noqa: E712
            func.sum(case((GameGoal.friendly_fire == True, 1), else_=0)).label("own_goals"),  # noqa: E712
        )
        .join(Game, Game.id == GameGoal.game_id)
        .where(*games_filter)
        .group_by(GameGoal.scored_by)
    )
    for row in goals_result.all():
        if row.scored_by in stats:
            stats[row.scored_by]["goals_scored"] = int(row.goals_scored or 0)
            stats[row.scored_by]["own_goals"] = int(row.own_goals or 0)

    # ── Form & streak from last 100 games ──
    recent_game_ids = (
        select(Game.id)
        .where(*games_filter)
        .order_by(Game.created_at.desc())
        .limit(100)
    )
    recent_result = await db.execute(
        select(
            GamePlayer.user_id,
            GamePlayer.side,
            Game.winner,
            Game.created_at,
        )
        .join(Game, Game.id == GamePlayer.game_id)
        .where(Game.id.in_(recent_game_ids))
        .order_by(Game.created_at.desc())
    )
    recent_per_player: dict[uuid.UUID, list] = defaultdict(list)
    for uid, side, winner, created_at in recent_result.all():
        if winner is None:
            game_result = "D"
        elif winner == side:
            game_result = "W"
        else:
            game_result = "L"
        recent_per_player[uid].append((created_at, game_result))

    # ── Fetch info for players not in member list ──
    missing_ids = set(stats.keys()) - set(player_info.keys())
    if missing_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(missing_ids))
        )
        for u in users_result.scalars().all():
            player_info[u.id] = {"name": u.name, "image_url": u.image_url}
        for uid in missing_ids:
            if uid not in player_info:
                player_info[uid] = {"name": "Former member", "image_url": None}

    # ── Build player list ──
    players = []
    for uid, s in stats.items():
        gp_count = s["games_played"]
        win_rate = round(s["wins"] / gp_count * 100, 1) if gp_count > 0 else 0.0
        g_diff = s["goals_scored"] - s["goals_conceded"]
        gpg = round(s["goals_scored"] / gp_count, 1) if gp_count > 0 else 0.0

        recent = sorted(recent_per_player.get(uid, []), key=lambda x: x[0], reverse=True)
        form = [r[1] for r in recent[:5]]

        streak = None
        if recent:
            first = recent[0][1]
            count = 0
            for _, gr in recent:
                if gr == first:
                    count += 1
                else:
                    break
            streak = {"type": first, "count": count}

        elo_data = elo_map.get(uid)
        player_elo = elo_data[0] if elo_data else 1000.0
        provisional = elo_data[2] if elo_data else True

        if is_period:
            elo_delta = elo_delta_map.get(uid, 0.0)
        else:
            elo_delta = player_elo - 1000

        info = player_info.get(uid, {"name": "Unknown", "image_url": None})

        players.append(PlayerStatsResponse(
            user_id=uid,
            name=info["name"],
            image_url=info["image_url"],
            elo=player_elo,
            elo_delta=elo_delta,
            provisional=provisional,
            games_played=gp_count,
            wins=s["wins"],
            losses=s["losses"],
            win_rate=win_rate,
            goals_scored=s["goals_scored"],
            goals_conceded=s["goals_conceded"],
            goal_diff=g_diff,
            goals_per_game=gpg,
            own_goals=s["own_goals"],
            form=form,
            streak=streak,
        ))

    if is_period:
        players.sort(key=lambda p: (p.elo_delta, p.win_rate, p.goal_diff), reverse=True)
    else:
        players.sort(key=lambda p: (p.elo, p.win_rate, p.goal_diff), reverse=True)

    # ── Summary cards ──
    highest_rated = None
    top_scorer = None
    hot_streak = None

    eligible = [p for p in players if p.games_played >= 5]
    if not eligible:
        eligible = [p for p in players if p.games_played > 0]

    if eligible:
        best = max(eligible, key=lambda p: (p.elo, -p.games_played))
        highest_rated = {"user_id": str(best.user_id), "name": best.name, "elo": best.elo}

    scorers = [p for p in players if p.goals_scored > 0]
    if scorers:
        best = max(scorers, key=lambda p: (p.goals_scored, -p.games_played))
        top_scorer = {"user_id": str(best.user_id), "name": best.name, "goals": best.goals_scored}

    streakers = [p for p in players if p.streak and p.streak["type"] == "W" and p.streak["count"] >= 2]
    if streakers:
        best = max(streakers, key=lambda p: (p.streak["count"], -p.games_played))
        hot_streak = {
            "user_id": str(best.user_id),
            "name": best.name,
            "type": "W",
            "count": best.streak["count"],
        }

    return GroupStatsResponse(
        period=PeriodInfo(
            start=start_date,
            end=end_date,
            label=period_label,
        ),
        total_games=total_period_games,
        summary=LeaderboardSummary(
            highest_rated=highest_rated,
            top_scorer=top_scorer,
            hot_streak=hot_streak,
        ),
        players=players,
    )
