import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.query import QueryRequest, QueryResponse
from app.services.sql import assert_group_membership, execute_readonly_sql

router = APIRouter(prefix="/groups/{group_id}/query", tags=["query"])


@router.post("", response_model=QueryResponse)
async def run_query(
    group_id: uuid.UUID,
    body: QueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Execute a read-only SQL query scoped to the caller's group.

    Available tables (already filtered to your group):
    - **games** — id, state, score_a, score_b, elapsed, winner, goal_count, created_by, created_at, started_at
    - **game_players** — id, game_id, user_id, side
    - **game_goals** — id, game_id, scored_by, side, friendly_fire, elapsed_at, created_at
    - **users** — id, name, image_url

    Example queries:
    ```sql
    SELECT u.name, COUNT(*) AS friendly_fires
    FROM game_goals gg
    JOIN users u ON u.id = gg.scored_by
    WHERE gg.friendly_fire = true
    GROUP BY u.name
    ORDER BY friendly_fires DESC
    ```
    """
    # 1. Verify group membership.
    await assert_group_membership(group_id, user, db)

    # 2. Execute via the shared read-only helper (validates + prepends CTE).
    try:
        columns, rows = await execute_readonly_sql(
            body.sql, group_id, max_rows=1000,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query rejected: {exc}",
        )
    except Exception as exc:
        detail = str(exc).split("\n")[0]  # first line only — hide internals
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query error: {detail}",
        )

    return QueryResponse(columns=columns, rows=rows)
