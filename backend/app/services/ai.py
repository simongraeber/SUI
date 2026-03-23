"""Gemini AI client, prompts, and generation helpers for the ask feature."""

import json
import logging

from google import genai
from google.genai import types
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)

# ── Gemini client (singleton) ──────────────────────────────
_gemini_client: genai.Client | None = None


def get_gemini_client() -> genai.Client:
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
created_by (uuid, FK→users.id), \
created_at (timestamp, you should use this for any time-based queries), \
started_at (timestamp) \

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

Question: "Did anyone play yesterday?"
SELECT u.name, MIN(u.image_url) AS image_url, COUNT(*) AS games_played
FROM game_players gp
JOIN users u ON u.id = gp.user_id
JOIN games g ON g.id = gp.game_id
WHERE g.state = 'completed'
  AND g.created_at >= '2026-03-17'
  AND g.created_at < '2026-03-18'
GROUP BY u.name
ORDER BY games_played DESC

Question: "How many games were played this week?"
SELECT COUNT(*) AS games_this_week
FROM games
WHERE state = 'completed'
  AND created_at >= '2026-03-16'

Question: "Who played the most last month?"
SELECT u.name, MIN(u.image_url) AS image_url, COUNT(*) AS games
FROM game_players gp
JOIN users u ON u.id = gp.user_id
JOIN games g ON g.id = gp.game_id
WHERE g.state = 'completed'
  AND g.created_at >= '2026-02-01'
  AND g.created_at < '2026-03-01'
GROUP BY u.name
ORDER BY games DESC
LIMIT 10
"""

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
def strip_fences(text: str) -> str:
    """Remove markdown code fences and surrounding text, extract JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = "\n".join(text.split("\n")[1:])
    if text.endswith("```"):
        text = text[: text.rfind("```")]
    text = text.strip()
    if not text.startswith("{") and "{" in text:
        text = text[text.index("{"):]
    return text.strip()


def format_results(columns: list[str], rows: list[list]) -> str:
    """Format query results as a readable string for the LLM."""
    out = f"Columns: {columns}\n"
    for row in rows[:30]:
        out += f"{row}\n"
    if len(rows) > 30:
        out += f"... and {len(rows) - 30} more rows\n"
    if not rows:
        out += "(no rows returned)\n"
    return out


def generate_sql(
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
    return strip_fences(response.text)


def retry_sql(
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
    return strip_fences(response.text)


def generate_answer(
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
        model="gemini-3-flash-preview",
        contents=f"Question: {question}\n\nQuery results:\n{results}",
        config=types.GenerateContentConfig(
            system_instruction=prompt,
            temperature=0.3,
            response_mime_type="application/json",
        ),
    )
    raw = strip_fences(response.text)
    return json.loads(raw)
