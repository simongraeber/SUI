import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, assert_group_membership
from app.database import get_db
from app.models.game import Game, GamePlayer
from app.models.group import Group, GroupMember
from app.models.user import User
from app.schemas.group import (
    GroupCreate,
    GroupDetailResponse,
    GroupJoin,
    GroupMemberResponse,
    GroupResponse,
    GroupStatsResponse,
)
from app.services.stats import compute_group_stats

router = APIRouter(prefix="/groups", tags=["groups"])


# ── helpers ──────────────────────────────────────────────────
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
    await assert_group_membership(group_id, user, db)

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
    member = await assert_group_membership(group_id, user, db)
    await db.delete(member)
    await db.commit()


@router.get("/{group_id}/membership", status_code=status.HTTP_200_OK)
async def check_membership(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if the current user is a member of the group. Returns 200 if yes, 403 if no."""
    await assert_group_membership(group_id, user, db)
    return {"member": True}


@router.get("/{group_id}/stats", response_model=GroupStatsResponse)
async def get_group_stats(
    group_id: uuid.UUID,
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get leaderboard — reads Elo from player_ratings / elo_history."""
    await assert_group_membership(group_id, user, db)
    await _get_group_or_404(group_id, db)
    return await compute_group_stats(group_id, db, start_date, end_date)
