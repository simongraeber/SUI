import json
import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.sql import assert_group_membership, execute_readonly_sql

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


# ── Gemini client (singleton) ──────────────────────────────
_gemini_client: genai.Client | None = None


def _get_gemini_client() -> genai.Client:
    global _gemini_client
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features are not configured",
        )
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=settings.gemini_api_key)
    return _gemini_client


# ── Prompts ─────────────────────────────────────────────────
_SCHEMA_DESCRIPTION = """\
You have access to a foosball (Tischkicker) tracking database with these tables \
(already filtered to the user's group):

games: id (uuid), state (text: setup/active/paused/completed/cancelled), \
score_a (int), score_b (int), elapsed (int, total game duration in seconds), \
winner (text: 'a' or 'b' or null), goal_count (int), \
created_by (uuid, FK→users.id), created_at (timestamp), started_at (timestamp)

game_players: id (uuid), game_id (uuid, FK→games.id), \
user_id (uuid, FK→users.id), side (text: 'a' or 'b')

game_goals: id (uuid), game_id (uuid, FK→games.id), \
scored_by (uuid, FK→users.id), side (text: 'a' or 'b'), \
friendly_fire (boolean), elapsed_at (int, seconds into the game when the goal was scored), \
created_at (timestamp)

users: id (uuid), name (text), image_url (text)

player_ratings: id (uuid), group_id (uuid), user_id (uuid, FK→users.id), \
elo (float, current Elo rating, starts at 1000), \
games_played (int), provisional (boolean, true if <10 games), \
updated_at (timestamp)

elo_history: id (uuid), game_id (uuid, FK→games.id), \
group_id (uuid), user_id (uuid, FK→users.id), \
elo_before (float), elo_after (float), delta (float, change in Elo for that game), \
created_at (timestamp)

Key concepts:
- friendly_fire = true means the player scored against their OWN team (own goal).
- A game has two sides: 'a' and 'b'. Each player is assigned to one side via game_players.
- winner is 'a' or 'b' for completed games, null otherwise.
- elapsed is the total game duration in seconds.
- elapsed_at is the time within a game (in seconds) when a goal was scored.
- Only use completed games (state = 'completed') for statistics unless asked otherwise.
- A regular goal is where friendly_fire = false. Always separate regular goals from friendly fire.
- Each game can have multiple players per side (e.g. 2v2).
- player_ratings holds the CURRENT Elo for each player in the group.
- elo_history records the Elo change for each player per game — use it for \
Elo trends, rating history, biggest gains/drops, etc.
- Elo is a skill rating system: every player starts at 1000. When you win, \
you gain Elo; when you lose, you lose Elo. The amount depends on the opponent's \
strength (beating a stronger player gains more) and the margin of victory. \
A player with fewer than 10 games is "provisional" (rating is less reliable). \
Higher Elo = better player.
- When the user mentions a player by name (or partial name / nickname), \
use ILIKE with '%name%' to match flexibly. Refer to the player list \
provided to find the correct full name.\
"""

_SQL_INSTRUCTIONS = """\
Given a natural language question, write a single PostgreSQL SELECT query to answer it.

Rules:
- Output ONLY the SQL query, no explanation, no markdown fences.
- Do NOT use semicolons.
- Do NOT use WITH or CTE clauses — CTEs are already provided for you.
- Do NOT reference schema-qualified tables (e.g., public.games). \
Use table names directly (games, game_players, game_goals, users).
- Keep it simple and efficient.
- Limit results to at most 50 rows.
- Use descriptive column aliases.
- Convert elapsed seconds to minutes for display where appropriate.
- For percentage calculations, use ROUND(..., 1) and cast appropriately.
- Use the current date/time provided above for any time-based filtering.

- When querying per-player statistics, ALWAYS include u.image_url in the SELECT \
so avatars can be displayed. Use MIN(u.image_url) or MAX(u.image_url) for grouped queries.
- For team queries (2+ players), return SEPARATE image_url columns for each player \
(e.g. image_url_1, image_url_2) so the frontend can show multiple avatars.

Examples:

Question: "Who scored the most goals?"
SELECT u.name, MIN(u.image_url) AS image_url, COUNT(*) AS goals
FROM game_goals gg
JOIN users u ON u.id = gg.scored_by
JOIN games g ON g.id = gg.game_id
WHERE g.state = 'completed' AND gg.friendly_fire = false
GROUP BY u.name
ORDER BY goals DESC
LIMIT 10

Question: "Who has the most friendly fire goals?"
SELECT u.name, MIN(u.image_url) AS image_url, COUNT(*) AS own_goals
FROM game_goals gg
JOIN users u ON u.id = gg.scored_by
JOIN games g ON g.id = gg.game_id
WHERE g.state = 'completed' AND gg.friendly_fire = true
GROUP BY u.name
ORDER BY own_goals DESC
LIMIT 10

Question: "What is the best team combination?"
SELECT p1.name || ' & ' || p2.name AS team,
       MIN(p1.image_url) AS image_url_1,
       MIN(p2.image_url) AS image_url_2,
       COUNT(*) AS games_played,
       SUM(CASE WHEN g.winner = gp1.side THEN 1 ELSE 0 END) AS wins,
       ROUND(100.0 * SUM(CASE WHEN g.winner = gp1.side THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_pct
FROM game_players gp1
JOIN game_players gp2 ON gp1.game_id = gp2.game_id
     AND gp1.side = gp2.side AND gp1.user_id < gp2.user_id
JOIN users p1 ON p1.id = gp1.user_id
JOIN users p2 ON p2.id = gp2.user_id
JOIN games g ON g.id = gp1.game_id
WHERE g.state = 'completed'
GROUP BY p1.name, p2.name
HAVING COUNT(*) >= 2
ORDER BY win_pct DESC, games_played DESC
LIMIT 10

Question: "What's the longest game ever played?"
SELECT g.score_a || ' - ' || g.score_b AS score,
       g.elapsed / 60 AS duration_minutes,
       g.goal_count AS goals,
       g.created_at::date AS date
FROM games g
WHERE g.state = 'completed'
ORDER BY g.elapsed DESC
LIMIT 5

Question: "Who wins most often on side A?"
SELECT u.name, MIN(u.image_url) AS image_url,
       COUNT(*) AS games,
       SUM(CASE WHEN g.winner = 'a' THEN 1 ELSE 0 END) AS wins,
       ROUND(100.0 * SUM(CASE WHEN g.winner = 'a' THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_pct
FROM game_players gp
JOIN users u ON u.id = gp.user_id
JOIN games g ON g.id = gp.game_id
WHERE g.state = 'completed' AND gp.side = 'a'
GROUP BY u.name
HAVING COUNT(*) >= 2
ORDER BY win_pct DESC
LIMIT 10

Question: "How many games were played this week?"
SELECT COUNT(*) AS games_this_week
FROM games
WHERE state = 'completed'
  AND started_at >= date_trunc('week', CURRENT_TIMESTAMP)\
"""

# ── Shared component specification (used by both answer prompts) ──
_COMPONENT_SPEC = """\
COMPONENT TYPES — pick the best fit for the data:

1. ranked-list — Leaderboards, top-N rankings, any ordered list.
   {"type": "ranked-list", "icon": "<icon>", "title": "Top Scorers", "items": [
     {"label": "Alex", "value": "12 goals", "image_urls": ["https://..."]}
   ]}
   Fields: icon (required), title (required), items[] with label, value, image_urls.
   image_urls is an array: ["url"] for one player, ["url1", "url2"] for a team.

2. stat-highlight — A single impressive number, total, or record. Can show a player avatar.
   {"type": "stat-highlight", "icon": "<icon>", "label": "Total Games", "value": "347", "subtitle": "since January 2025"}
   Player-specific: {"type": "stat-highlight", "icon": "star", "label": "Most Goals", "value": "47 goals", "subtitle": "Alex leads them all", "image_urls": ["https://..."]}
   Fields: icon (required), label (required), value (required), subtitle (optional), image_urls (optional — shows player avatar instead of icon).

3. comparison — Two players or teams side-by-side with multiple stats.
   {"type": "comparison", "title": "Alex vs Jordan", "sides": [
     {"name": "Alex", "image_urls": ["https://..."], "stats": [{"label": "Wins", "value": "23"}]},
     {"name": "Jordan", "image_urls": ["https://..."], "stats": [{"label": "Wins", "value": "19"}]}
   ]}
   Fields: title (required), sides[] with name, image_urls, stats[].

4. bar-chart — Visual bars comparing numeric values across players/teams.
   {"type": "bar-chart", "title": "Goals per Player", "bars": [
     {"label": "Alex", "value": 42, "image_urls": ["https://..."]}
   ]}
   Fields: title (required), bars[] with label, value (MUST be a number), image_urls.

5. table — Multi-column data (game lists, match history, detailed stats).
   {"type": "table", "title": "Recent Games", "columns": ["Date", "Score", "Duration"], "rows": [
     {"Date": "Mar 5", "Score": "10-7", "Duration": "8 min"}
   ]}
   Fields: title (required), columns[] (required), rows[] as objects keyed by column name.

6. callout — Fun facts, streaks, surprising insights, extra context.
   {"type": "callout", "emoji": "🔥", "text": "Alex is on a 7-game win streak!"}
   Fields: emoji (required), text (required).

7. head-to-head — Direct matchup between exactly two players.
   {"type": "head-to-head",
    "player_a": {"name": "Alex", "image_urls": ["https://..."]},
    "player_b": {"name": "Jordan", "image_urls": ["https://..."]},
    "stats": [{"label": "Wins", "a": "12", "b": "8"}]}
   Fields: player_a, player_b (each with name, image_urls), stats[] with label, a, b.

ICON CHOICES (for ranked-list and stat-highlight — ignored when image_urls is provided on stat-highlight):
goal, flame, crown, trophy, gamepad, target, users, trending-up, clock, star

IMAGE URLS:
- image_urls is ALWAYS an array, never a single string.
- Single player: ["<url>"]. Team of two: ["<url1>", "<url2>"].
- Collect ALL image_url columns from query results (image_url, image_url_1, image_url_2).
- Omit the field if no image URLs are available in the data.

COMPOSITION — use 1-3 components per response. Combine types for richer answers:
- Rankings → ranked-list, or ranked-list + callout
- Single number → stat-highlight, or stat-highlight + callout
- Player comparison → head-to-head or comparison, optionally + callout
- Distribution → bar-chart, or bar-chart + stat-highlight
- Match history → table, or table + stat-highlight
- Use a callout to add a fun fact, streak, or surprising insight alongside the main component.
- 1 component is perfectly fine for simple questions. Use 2-3 when extra context adds value.\
"""

# The answer prompt allows the LLM to either produce a final answer or
# request one follow-up query if the first results are insufficient.
_ANSWER_INSTRUCTIONS = f"""\
Given a question and query results, respond with ONLY a JSON object.

OPTION A — Results answer the question:
{{"action": "answer", "components": [<component>, ...]}}
- "components": Array of 1-3 UI components (see types below). The components ARE the answer.

OPTION B — You need different data to answer:
{{"action": "query", "sql": "SELECT ..."}}
- Only if the current results genuinely cannot answer the question.
- The SQL must follow the same rules (no semicolons, no CTEs, LIMIT 50).

{_COMPONENT_SPEC}

If results are empty: {{"action": "answer", "components": [{{"type": "callout", "emoji": "🤷", "text": "No data found for that question."}}]}}

Output ONLY valid JSON. No markdown fences. No explanation.\
"""

# Final answer prompt — no more follow-up queries allowed.
_FINAL_ANSWER_INSTRUCTIONS = f"""\
Given a question and query results, respond with ONLY a JSON object:
{{"action": "answer", "components": [<component>, ...]}}

- "components": Array of 1-3 UI components (see types below). The components ARE the answer.

{_COMPONENT_SPEC}

If results are empty: {{"action": "answer", "components": [{{"type": "callout", "emoji": "🤷", "text": "No data found for that question."}}]}}

Output ONLY valid JSON. No markdown fences. No explanation.\
"""

_ASSISTANT_INTRO = (
    'You are a stats assistant for "SIU — Someone Is Unbeatable", a foosball '
    "(Tischkicker) tracking app. Users play foosball in groups and the app "
    "tracks goals, wins, win streaks, and friendly fire (own goals).\n\n"
)


def _format_members(member_names: list[str]) -> str:
    if not member_names:
        return "Players in this group: (none)"
    return "Players in this group: " + ", ".join(member_names)


def _build_sql_system_prompt(
    current_time: str, member_names: list[str], asking_user: str,
) -> str:
    return (
        f"{_SCHEMA_DESCRIPTION}\n\n"
        f"{_format_members(member_names)}\n\n"
        f"The user asking is: {asking_user}\n"
        f"Current date/time: {current_time}\n\n"
        f"{_SQL_INSTRUCTIONS}"
    )


def _build_answer_system_prompt(
    current_time: str, member_names: list[str], asking_user: str,
) -> str:
    return (
        f"{_ASSISTANT_INTRO}"
        f"{_SCHEMA_DESCRIPTION}\n\n"
        f"{_format_members(member_names)}\n\n"
        f"The user asking is: {asking_user}\n"
        f"Current date/time: {current_time}\n\n"
        f"{_ANSWER_INSTRUCTIONS}"
    )


def _build_final_answer_system_prompt(
    current_time: str, member_names: list[str], asking_user: str,
) -> str:
    return (
        f"{_ASSISTANT_INTRO}"
        f"{_SCHEMA_DESCRIPTION}\n\n"
        f"{_format_members(member_names)}\n\n"
        f"The user asking is: {asking_user}\n"
        f"Current date/time: {current_time}\n\n"
        f"{_FINAL_ANSWER_INSTRUCTIONS}"
    )


# ── Helpers ─────────────────────────────────────────────────
def _strip_fences(text: str) -> str:
    """Remove markdown code fences and surrounding text, extract JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = "\n".join(text.split("\n")[1:])
    if text.endswith("```"):
        text = text[: text.rfind("```")]
    text = text.strip()
    # If there's extra text before the JSON object, extract it
    if not text.startswith("{") and "{" in text:
        text = text[text.index("{"):]
    return text.strip()


def _format_results(columns: list[str], rows: list[list]) -> str:
    """Format query results as a readable string for the LLM."""
    out = f"Columns: {columns}\n"
    for row in rows[:30]:
        out += f"{row}\n"
    if len(rows) > 30:
        out += f"... and {len(rows) - 30} more rows\n"
    if not rows:
        out += "(no rows returned)\n"
    return out


def _generate_sql(
    client: genai.Client, question: str, current_time: str,
    member_names: list[str], asking_user: str,
) -> str:
    """Ask the LLM to generate a SQL query for the question."""
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=question,
        config=types.GenerateContentConfig(
            system_instruction=_build_sql_system_prompt(current_time, member_names, asking_user),
            temperature=0.1,
        ),
    )
    return _strip_fences(response.text)


def _retry_sql(
    client: genai.Client,
    question: str,
    failed_sql: str,
    error: str,
    current_time: str,
    member_names: list[str],
    asking_user: str,
) -> str:
    """Ask the LLM to fix a failed SQL query."""
    contents = (
        f"Question: {question}\n\n"
        f"Your previous query failed:\n{failed_sql}\n\n"
        f"Error: {error}\n\n"
        "Write a corrected query."
    )
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=_build_sql_system_prompt(current_time, member_names, asking_user),
            temperature=0.1,
        ),
    )
    return _strip_fences(response.text)


def _generate_answer(
    client: genai.Client,
    question: str,
    results: str,
    current_time: str,
    member_names: list[str],
    asking_user: str,
    *,
    allow_followup: bool = True,
) -> dict:
    """Ask the LLM to produce a JSON answer (or request a follow-up query)."""
    if allow_followup:
        prompt = _build_answer_system_prompt(current_time, member_names, asking_user)
    else:
        prompt = _build_final_answer_system_prompt(current_time, member_names, asking_user)

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=f"Question: {question}\n\nQuery results:\n{results}",
        config=types.GenerateContentConfig(
            system_instruction=prompt,
            temperature=0.3,
            response_mime_type="application/json",
        ),
    )
    raw = _strip_fences(response.text)
    return json.loads(raw)


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

    client = _get_gemini_client()
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
        generated_sql = _generate_sql(client, body.question, current_time, member_names, user.name)
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
            generated_sql = _retry_sql(
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
    results_text = _format_results(columns, rows)
    answer_text = "Here are the results:"
    components: list[dict] = []

    try:
        response = _generate_answer(
            client, body.question, results_text, current_time,
            member_names, user.name, allow_followup=True,
        )

        # 5. Handle follow-up query if the LLM requests one
        if response.get("action") == "query" and response.get("sql"):
            followup_sql = response["sql"]
            try:
                cols2, rows2 = await execute_readonly_sql(followup_sql, group_id)
                results_text_2 = _format_results(cols2, rows2)
                combined = (
                    f"First query results:\n{results_text}\n\n"
                    f"Second query results:\n{results_text_2}"
                )
                response = _generate_answer(
                    client, body.question, combined, current_time,
                    member_names, user.name, allow_followup=False,
                )
            except Exception as exc:
                logger.warning(
                    "Follow-up SQL failed: %s — SQL: %s", exc, followup_sql,
                )
                # Fall back: force answer with first results only
                response = _generate_answer(
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
