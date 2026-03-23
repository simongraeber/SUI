"""Shared SQL execution utilities for group-scoped read-only queries."""

import re
import uuid
import logging

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import ro_engine

logger = logging.getLogger(__name__)

# ── CTE Preamble (single source of truth) ──────────────────
# Shadows real table names so queries can only see rows belonging to
# the requested group.  The :group_id bind parameter is injected safely
# via SQLAlchemy.
CTE_PREAMBLE = """\
WITH
  games AS (
    SELECT id, state, score_a, score_b, elapsed, winner, goal_count,
           created_by, created_at, started_at
    FROM   public.games
    WHERE  group_id = :group_id
  ),
  game_players AS (
    SELECT gp.id, gp.game_id, gp.user_id, gp.side
    FROM   public.game_players gp
    JOIN   public.games g ON gp.game_id = g.id
    WHERE  g.group_id = :group_id
  ),
  game_goals AS (
    SELECT gg.id, gg.game_id, gg.scored_by, gg.side,
           gg.friendly_fire, gg.elapsed_at, gg.created_at
    FROM   public.game_goals gg
    JOIN   public.games g ON gg.game_id = g.id
    WHERE  g.group_id = :group_id
  ),
  users AS (
    SELECT u.id, u.name, u.image_url
    FROM   public.users u
    JOIN   public.group_members gm ON u.id = gm.user_id
    WHERE  gm.group_id = :group_id
  ),
  player_ratings AS (
    SELECT id, user_id, elo, games_played, provisional, updated_at
    FROM   public.player_ratings
    WHERE  group_id = :group_id
  ),
  elo_history AS (
    SELECT eh.id, eh.game_id, eh.user_id,
           eh.elo_before, eh.elo_after, eh.delta, eh.created_at
    FROM   public.elo_history eh
    WHERE  eh.group_id = :group_id
  )
"""

STATEMENT_TIMEOUT_MS = 5_000

# ── SQL Validation ──────────────────────────────────────────
# Prevent queries from escaping the CTE sandbox.

_FORBIDDEN_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bpublic\s*\.', re.IGNORECASE),
     "Schema-qualified table references are not allowed"),
    (re.compile(r'\binformation_schema\b', re.IGNORECASE),
     "Access to information_schema is not allowed"),
    (re.compile(r'\bpg_catalog\b', re.IGNORECASE),
     "Access to pg_catalog is not allowed"),
    (re.compile(r'\bpg_shadow\b', re.IGNORECASE),
     "Access to system catalogs is not allowed"),
    (re.compile(r'\bpg_authid\b', re.IGNORECASE),
     "Access to system catalogs is not allowed"),
    (re.compile(r'\bpg_roles\b', re.IGNORECASE),
     "Access to system catalogs is not allowed"),
    (re.compile(r'\bpg_user\b', re.IGNORECASE),
     "Access to system catalogs is not allowed"),
    (re.compile(r'\bpg_stat\w*\b', re.IGNORECASE),
     "Access to system statistics is not allowed"),
    (re.compile(r';'),
     "Multiple statements are not allowed"),
]

_FORBIDDEN_KEYWORDS = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COPY)\b',
    re.IGNORECASE,
)


def validate_sql(sql: str) -> None:
    """Raise ValueError if the SQL tries to escape the CTE sandbox."""
    for pattern, message in _FORBIDDEN_PATTERNS:
        if pattern.search(sql):
            raise ValueError(message)
    match = _FORBIDDEN_KEYWORDS.search(sql)
    if match:
        raise ValueError(f"Statement type '{match.group().upper()}' is not allowed")


async def execute_readonly_sql(
    sql: str,
    group_id: uuid.UUID,
    *,
    max_rows: int = 50,
) -> tuple[list[str], list[list]]:
    """Validate and execute a read-only SQL query scoped to the group.

    The CTE preamble is prepended automatically.
    Raises ValueError for validation failures, other exceptions for DB errors.
    """
    validate_sql(sql)
    full_sql = CTE_PREAMBLE + sql
    async with ro_engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(f"SET LOCAL statement_timeout = {int(STATEMENT_TIMEOUT_MS)}")
            )
            result = await conn.execute(
                text(full_sql), {"group_id": group_id},
            )
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchmany(max_rows)]
    return columns, rows

