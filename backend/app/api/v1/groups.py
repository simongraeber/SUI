import uuid
from datetime import datetime, timezone
from typing import Optional

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.game import Game, GameGoal, GamePlayer
from app.models.group import Group, GroupMember
from app.models.user import User
from app.models.elo import PlayerRating, EloHistory
from app.schemas.group import (
    PlayerStatsResponse,
    GroupCreate,
    GroupDetailResponse,
    GroupJoin,
    GroupMemberResponse,
    GroupResponse,
    GroupStatsResponse,
    LeaderboardSummary,
    PeriodInfo,
)

router = APIRouter(prefix="/groups", tags=["groups"])


# ── helpers ──────────────────────────────────────────────────
async def _assert_membership(
    group_id: uuid.UUID, user: User, db: AsyncSession
) -> GroupMember:
    """Return the GroupMember row or raise 403."""
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


async def _get_group_or_404(group_id: uuid.UUID, db: AsyncSession) -> Group:
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )
    return group


# ── endpoints ────────────────────────────────────────────────
@router.post("", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new group and add the creator as a member."""
    group = Group(name=body.name, created_by=user.id)
    db.add(group)
    await db.flush()  # get group.id

    membership = GroupMember(group_id=group.id, user_id=user.id)
    db.add(membership)
    await db.commit()
    await db.refresh(group)

    return GroupResponse(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        created_by=group.created_by,
        created_at=group.created_at,
        member_count=1,
    )


@router.get("", response_model=list[GroupResponse])
async def list_my_groups(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all groups the current user belongs to."""
    stmt = (
        select(
            Group,
            func.count(GroupMember.id).label("member_count"),
        )
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            Group.id.in_(
                select(GroupMember.group_id).where(GroupMember.user_id == user.id)
            )
        )
        .group_by(Group.id)
    )
    result = await db.execute(stmt)
    rows = result.all()
    return [
        GroupResponse(
            id=group.id,
            name=group.name,
            invite_code=group.invite_code,
            created_by=group.created_by,
            created_at=group.created_at,
            member_count=count,
        )
        for group, count in rows
    ]


@router.get("/{group_id}", response_model=GroupDetailResponse)
async def get_group(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get group details (members-only)."""
    await _assert_membership(group_id, user, db)

    result = await db.execute(
        select(Group)
        .options(selectinload(Group.members))
        .where(Group.id == group_id)
    )
    group = result.scalar_one()

    # Fetch each member's most recent game in this group
    lp_result = await db.execute(
        select(
            GamePlayer.user_id,
            func.max(Game.updated_at).label("last_played_at"),
        )
        .join(Game, GamePlayer.game_id == Game.id)
        .where(Game.group_id == group_id, Game.state != "cancelled")
        .group_by(GamePlayer.user_id)
    )
    last_played_map = {row.user_id: row.last_played_at for row in lp_result.all()}

    members = [
        GroupMemberResponse(
            user_id=m.user.id,
            name=m.user.name,
            email=m.user.email,
            image_url=m.user.image_url,
            joined_at=m.joined_at,
            last_played_at=last_played_map.get(m.user_id),
        )
        for m in group.members
    ]

    return GroupDetailResponse(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        created_by=group.created_by,
        created_at=group.created_at,
        member_count=len(members),
        members=members,
    )


@router.post("/{group_id}/join", response_model=GroupResponse)
async def join_group(
    group_id: uuid.UUID,
    body: GroupJoin,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Join a group using its invite code."""
    group = await _get_group_or_404(group_id, db)

    if group.invite_code != body.invite_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invite code"
        )

    # check existing membership
    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user.id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already a member of this group",
        )

    membership = GroupMember(group_id=group.id, user_id=user.id)
    db.add(membership)
    await db.commit()

    count_result = await db.execute(
        select(func.count(GroupMember.id)).where(GroupMember.group_id == group_id)
    )
    member_count = count_result.scalar()

    return GroupResponse(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        created_by=group.created_by,
        created_at=group.created_at,
        member_count=member_count,
    )


@router.delete("/{group_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_group(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Leave a group."""
    member = await _assert_membership(group_id, user, db)
    await db.delete(member)
    await db.commit()


@router.get("/{group_id}/membership", status_code=status.HTTP_200_OK)
async def check_membership(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if the current user is a member of the group. Returns 200 if yes, 403 if no."""
    await _assert_membership(group_id, user, db)
    return {"member": True}


@router.get("/{group_id}/stats", response_model=GroupStatsResponse)
async def get_group_stats(
    group_id: uuid.UUID,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get leaderboard — reads Elo from player_ratings / elo_history."""
    await _assert_membership(group_id, user, db)
    await _get_group_or_404(group_id, db)

    # Parse date filters
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    period_label = "All Time"

    if start_date:
        try:
            period_start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if end_date:
        try:
            period_end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    if period_start or period_end:
        period_label = "Custom"

    is_period = period_start is not None or period_end is not None

    # ── Read current Elo ratings from player_ratings ──
    ratings_result = await db.execute(
        select(PlayerRating).where(PlayerRating.group_id == group_id)
    )
    elo_map: dict[uuid.UUID, tuple[float, int, bool]] = {}
    for pr in ratings_result.scalars().all():
        elo_map[pr.user_id] = (pr.elo, pr.games_played, pr.provisional)

    # ── Compute elo_delta for period from elo_history ──
    elo_delta_map: dict[uuid.UUID, float] = {}
    if is_period:
        # Sum deltas for games within the period
        delta_query = (
            select(EloHistory.user_id, func.sum(EloHistory.delta))
            .join(Game, Game.id == EloHistory.game_id)
            .where(
                EloHistory.group_id == group_id,
                Game.state == "completed",
            )
        )
        if period_start:
            delta_query = delta_query.where(Game.created_at >= period_start)
        if period_end:
            delta_query = delta_query.where(Game.created_at <= period_end)
        delta_query = delta_query.group_by(EloHistory.user_id)

        delta_result = await db.execute(delta_query)
        for uid, total_delta in delta_result.all():
            elo_delta_map[uid] = total_delta or 0.0

    # ── Seed player info from group members ──
    members_result = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id)
    )
    player_info: dict[uuid.UUID, dict] = {}
    for tm in members_result.scalars().all():
        player_info[tm.user_id] = {
            "name": tm.user.name,
            "image_url": tm.user.image_url,
        }

    # ── Build base filter for completed games ──
    games_filter = [Game.group_id == group_id, Game.state == "completed"]
    if period_start:
        games_filter.append(Game.created_at >= period_start)
    if period_end:
        games_filter.append(Game.created_at <= period_end)

    # ── Total games count ──
    total_result = await db.execute(
        select(func.count()).select_from(Game).where(*games_filter)
    )
    total_period_games = total_result.scalar() or 0

    # ── Per-player wins / losses / games / goals_conceded (SQL aggregation) ──
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

    # ── Goals scored / own goals (SQL aggregation) ──
    goals_result = await db.execute(
        select(
            GameGoal.scored_by,
            func.sum(case((GameGoal.friendly_fire == False, 1), else_=0)).label("goals_scored"),
            func.sum(case((GameGoal.friendly_fire == True, 1), else_=0)).label("own_goals"),
        )
        .join(Game, Game.id == GameGoal.game_id)
        .where(*games_filter)
        .group_by(GameGoal.scored_by)
    )
    for row in goals_result.all():
        if row.scored_by in stats:
            stats[row.scored_by]["goals_scored"] = int(row.goals_scored or 0)
            stats[row.scored_by]["own_goals"] = int(row.own_goals or 0)

    # ── Form & streak from last 100 games (bounded) ──
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

    # ── Fetch info for players in stats but not in member list ──
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

    # ── Build final player list ──
    players = []
    for uid, s in stats.items():
        gp_count = s["games_played"]
        win_rate = round(s["wins"] / gp_count * 100, 1) if gp_count > 0 else 0.0
        g_diff = s["goals_scored"] - s["goals_conceded"]
        gpg = round(s["goals_scored"] / gp_count, 1) if gp_count > 0 else 0.0

        # Form: last 5 results sorted by date desc
        recent = sorted(recent_per_player.get(uid, []), key=lambda x: x[0], reverse=True)
        form = [r[1] for r in recent[:5]]

        # Streak
        streak = None
        if recent:
            first = recent[0][1]
            count = 0
            for _, game_result in recent:
                if game_result == first:
                    count += 1
                else:
                    break
            streak = {"type": first, "count": count}

        # Elo from player_ratings table
        elo_data = elo_map.get(uid)
        player_elo = round(elo_data[0]) if elo_data else 1000
        provisional = elo_data[2] if elo_data else True

        # Elo delta: for period view use elo_history sum; for all-time use total change from 1000
        if is_period:
            elo_delta = round(elo_delta_map.get(uid, 0.0))
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

    # Default sort: Elo desc for all-time, Elo delta desc for period
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
