"""Ask AI endpoint — natural language queries over group game data."""

import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, assert_group_membership
from app.database import get_db
from app.models.user import User
from app.services.ai import (
    format_results,
    generate_answer,
    generate_sql,
    get_gemini_client,
    retry_sql,
)
from app.services.sql import execute_readonly_sql

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/groups/{group_id}/ask", tags=["ask"])

# ── Rate limiting (in-memory) ───────────────────────────────
_RATE_LIMIT = 5
_RATE_WINDOW = 3600  # seconds (1 hour)
_user_timestamps: dict[uuid.UUID, list[float]] = defaultdict(list)


def _check_rate_limit(user_id: uuid.UUID) -> int:
    """Raise 429 if the user exceeded the limit. Returns remaining requests."""
    now = time.time()
    cutoff = now - _RATE_WINDOW
    _user_timestamps[user_id] = [
        t for t in _user_timestamps[user_id] if t > cutoff
    ]
    used = len(_user_timestamps[user_id])
    if used >= _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded — 5 questions per hour. Try again later.",
        )
    return _RATE_LIMIT - used


def _record_usage(user_id: uuid.UUID) -> None:
    _user_timestamps[user_id].append(time.time())


# ── Schemas ─────────────────────────────────────────────────
class AskRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


class AskResponse(BaseModel):
    answer: str
    components: list[dict]
    remaining: int  # remaining requests this hour


# ── Endpoint ────────────────────────────────────────────────
_VALID_COMPONENT_TYPES = {
    "ranked-list", "stat-highlight", "comparison",
    "bar-chart", "table", "callout", "head-to-head",
}


def _parse_answer(data: dict) -> tuple[str, list[dict]]:
    """Extract answer text and components from the LLM's JSON response."""
    answer = data.get("answer", "Here are the results:")
    components: list[dict] = []
    for c in data.get("components", []):
        if isinstance(c, dict) and c.get("type") in _VALID_COMPONENT_TYPES:
            components.append(c)
    # Fallback: support legacy "cards" format
    if not components and "cards" in data:
        for c in data["cards"]:
            components.append({"type": "ranked-list", **c})
    return answer, components


@router.post("", response_model=AskResponse)
async def ask_question(
    group_id: uuid.UUID,
    body: AskRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Ask a natural language question about your group's game data.
    AI generates a SQL query, executes it read-only, and returns a
    friendly answer with optional data cards.
    The LLM may run up to two queries if the first result is insufficient.
    Limited to 5 requests per hour per user.
    """
    # 1. Auth + rate limit
    await assert_group_membership(group_id, user, db)
    remaining = _check_rate_limit(user.id)

    client = get_gemini_client()
    current_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # 2. Fetch group member names for context
    try:
        _, name_rows = await execute_readonly_sql(
            "SELECT name FROM users ORDER BY name", group_id,
        )
        member_names = [str(r[0]) for r in name_rows]
    except Exception:
        member_names = []

    # 3. Generate SQL from the question
    try:
        generated_sql = generate_sql(client, body.question, current_time, member_names, user.name)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Gemini SQL generation failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI service unavailable. Try again later.",
        )

    # 3. Execute the SQL (with one retry on failure)
    try:
        columns, rows = await execute_readonly_sql(generated_sql, group_id)
    except Exception as exc:
        logger.warning("Generated SQL failed: %s — SQL: %s", exc, generated_sql)
        # Retry: feed the error back to the LLM so it can self-correct
        try:
            generated_sql = retry_sql(
                client, body.question, generated_sql, str(exc), current_time,
                member_names, user.name,
            )
            columns, rows = await execute_readonly_sql(generated_sql, group_id)
        except Exception as retry_exc:
            logger.warning("SQL retry also failed: %s", retry_exc)
            _record_usage(user.id)
            return AskResponse(
                answer="Sorry, I couldn't find an answer to that question. "
                       "Try rephrasing it.",
                components=[],
                remaining=remaining - 1,
            )

    # 4. Ask LLM to answer (it may request one follow-up query)
    results_text = format_results(columns, rows)
    answer_text = "Here are the results:"
    components: list[dict] = []

    try:
        response = generate_answer(
            client, body.question, results_text, current_time,
            member_names, user.name, allow_followup=True,
        )

        # 5. Handle follow-up query if the LLM requests one
        if response.get("action") == "query" and response.get("sql"):
            followup_sql = response["sql"]
            try:
                cols2, rows2 = await execute_readonly_sql(followup_sql, group_id)
                results_text_2 = format_results(cols2, rows2)
                combined = (
                    f"First query results:\n{results_text}\n\n"
                    f"Second query results:\n{results_text_2}"
                )
                response = generate_answer(
                    client, body.question, combined, current_time,
                    member_names, user.name, allow_followup=False,
                )
            except Exception as exc:
                logger.warning(
                    "Follow-up SQL failed: %s — SQL: %s", exc, followup_sql,
                )
                # Fall back: force answer with first results only
                response = generate_answer(
                    client, body.question, results_text, current_time,
                    member_names, user.name, allow_followup=False,
                )

        answer_text, components = _parse_answer(response)
    except Exception:
        logger.exception("Gemini answer generation failed")
        answer_text = "Sorry, I had trouble formatting the answer. Please try again."
        components = [{"type": "callout", "emoji": "⚠️", "text": answer_text}]

    # Guard against empty response (e.g. all components filtered out)
    if not components and answer_text == "Here are the results:":
        answer_text = "I found some data but couldn't format it properly. Try rephrasing your question."
        components = [{"type": "callout", "emoji": "🤔", "text": answer_text}]

    # 6. Record usage and respond
    _record_usage(user.id)

    return AskResponse(answer=answer_text, components=components, remaining=remaining - 1)
