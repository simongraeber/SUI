"""
Tournament bracket generation service.

Single-elimination with byes.  Given N teams (sorted by seed), find the
smallest power-of-two P ≥ N.  The bracket for round 1 is built by
*interleaving* real matches and bye slots so that bye teams are spread
evenly, matching the pattern expected by the frontend:

  N=6:  R1 = [T1vT2, T5(bye), T3vT4, T6(bye)]
          R2 = [W1 vs T5,  W2 vs T6]
  N=7:  R1 = [T1vT2, T7(bye), T3vT4, T5vT6]
          R2 = [W1 vs T7,  W2 vs W3]

Winner of a match at (round=r, position=p) advances to:
  next_round   = r + 1
  next_position = ceil(p / 2)  ==  (p + 1) // 2
  next_side    = 'a' if p is odd else 'b'
"""

import math
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game import Game
from app.models.tournament import Tournament, TournamentMatch, TournamentTeam


def _next_power_of_two(n: int) -> int:
    if n <= 1:
        return 1
    p = 1
    while p < n:
        p <<= 1
    return p


def _build_r1_slots(
    teams: list[TournamentTeam],
) -> list[tuple[TournamentTeam | None, TournamentTeam | None]]:
    """
    Return an ordered list of (team_a, team_b) for every R1 position.
    team_b is None  →  bye (team_a advances automatically).
    Both None       →  should not happen.
    """
    n = len(teams)
    p = _next_power_of_two(n)
    byes = p - n
    r1_matches = (n - byes) // 2  # real matches in round 1

    # playing teams: the first (n-byes) seeds  → paired as (T1,T2),(T3,T4)...
    # bye teams:     the last  byes  seeds
    playing = teams[: n - byes]  # seeds 1 .. (n-byes)
    bye_teams = teams[n - byes :]  # seeds (n-byes+1) .. n

    r2_count = p // 4  # total R2 match positions
    slots: list[tuple[TournamentTeam | None, TournamentTeam | None]] = []

    real_idx = 0
    bye_idx = 0

    for _ in range(r2_count):
        # ── odd R1 position (feeds R2 side 'a') ─────────────────────────
        if real_idx < r1_matches:
            slots.append((playing[2 * real_idx], playing[2 * real_idx + 1]))
            real_idx += 1
        elif bye_idx < byes:
            slots.append((bye_teams[bye_idx], None))
            bye_idx += 1

        # ── even R1 position (feeds R2 side 'b') ────────────────────────
        if bye_idx < byes:
            slots.append((bye_teams[bye_idx], None))
            bye_idx += 1
        elif real_idx < r1_matches:
            slots.append((playing[2 * real_idx], playing[2 * real_idx + 1]))
            real_idx += 1

    return slots


def generate_bracket(
    tournament: Tournament,
    teams: list[TournamentTeam],
) -> list[TournamentMatch]:
    """
    Build the full match-slot list for the tournament and return the
    TournamentMatch objects (not yet added to the session).

    Byes are marked as completed immediately (winner = team_a).
    Empty future-round slots are created as pending.
    """
    n = len(teams)
    if n < 2:
        raise ValueError("Need at least 2 teams to start a tournament")

    p = _next_power_of_two(n)
    num_rounds = int(math.log2(p))

    # Special case: exactly 2 teams → one single final, no byes
    if p == 2:
        match = TournamentMatch(
            tournament_id=tournament.id,
            round=1,
            position=1,
            team_a_id=teams[0].id,
            team_b_id=teams[1].id,
            status="pending",
        )
        return [match]

    r1_slots = _build_r1_slots(teams)
    # r1_slots has exactly p//2 entries
    assert len(r1_slots) == p // 2, f"Expected {p // 2} R1 slots, got {len(r1_slots)}"

    matches: list[TournamentMatch] = []
    # (round, position) → TournamentMatch for quick lookup when propagating byes
    slot_map: dict[tuple[int, int], TournamentMatch] = {}

    # ── Round 1 ──────────────────────────────────────────────────────────
    for pos, (ta, tb) in enumerate(r1_slots, start=1):
        is_bye = ta is not None and tb is None
        m = TournamentMatch(
            tournament_id=tournament.id,
            round=1,
            position=pos,
            team_a_id=ta.id if ta else None,
            team_b_id=tb.id if tb else None,
            winner_id=ta.id if is_bye else None,
            status="completed" if is_bye else "pending",
        )
        matches.append(m)
        slot_map[(1, pos)] = m

    # ── Rounds 2 .. num_rounds (empty slots) ─────────────────────────────
    for r in range(2, num_rounds + 1):
        round_slots = p // (2**r)
        for pos in range(1, round_slots + 1):
            m = TournamentMatch(
                tournament_id=tournament.id,
                round=r,
                position=pos,
                status="pending",
            )
            matches.append(m)
            slot_map[(r, pos)] = m

    # ── Propagate byes into round 2 ───────────────────────────────────────
    # Any R1 match that is already completed (bye) feeds its winner into R2.
    for m in list(matches):
        if m.round == 1 and m.status == "completed" and m.winner_id:
            _advance_winner(m, slot_map)

    return matches


def _advance_winner(
    match: TournamentMatch,
    slot_map: dict[tuple[int, int], TournamentMatch],
) -> None:
    """Fill the winner into the appropriate slot of the next round."""
    next_round = match.round + 1
    next_pos = (match.position + 1) // 2  # ceil(position / 2)
    next_match = slot_map.get((next_round, next_pos))
    if next_match is None:
        return  # already the final — no next match

    if match.position % 2 == 1:  # odd → feeds side 'a'
        next_match.team_a_id = match.winner_id
    else:  # even → feeds side 'b'
        next_match.team_b_id = match.winner_id

    # If both sides are filled (two byes in a row), immediately resolve
    if next_match.team_a_id and next_match.team_b_id:
        return  # normal match, not a bye
    if next_match.team_a_id and next_match.team_b_id is None:
        # A fresh bye in this next-round match: check if we already assigned only one side
        # (it's a bye only if team_b will never be set, i.e. this next_match slot itself
        # has no other feeder match).  We skip further auto-completion here — it will be
        # handled when the bracket is fully built.
        pass


async def apply_match_result(
    match: TournamentMatch,
    winner_side: str,  # "a" | "b"
    score_a: int | None,
    score_b: int | None,
    session: AsyncSession,
) -> TournamentMatch | None:
    """
    Record the result of a match and advance the winner to the next slot.
    Returns the next-round match if one exists, otherwise None.
    """
    winner_id = match.team_a_id if winner_side == "a" else match.team_b_id
    if winner_id is None:
        raise ValueError("Winner side has no team assigned")

    match.winner_id = winner_id
    match.score_a = score_a
    match.score_b = score_b
    match.status = "completed"

    # Find next-round match
    next_round = match.round + 1
    next_pos = (match.position + 1) // 2

    result = await session.execute(
        select(TournamentMatch).where(
            TournamentMatch.tournament_id == match.tournament_id,
            TournamentMatch.round == next_round,
            TournamentMatch.position == next_pos,
        )
    )
    next_match = result.scalar_one_or_none()

    if next_match is not None:
        if match.position % 2 == 1:
            next_match.team_a_id = winner_id
        else:
            next_match.team_b_id = winner_id

    return next_match


async def resolve_match_from_game(game_id: uuid.UUID, session: AsyncSession) -> None:
    """Called after a game completes — auto-resolve the linked tournament match."""
    match = (await session.execute(
        select(TournamentMatch).where(TournamentMatch.game_id == game_id)
    )).scalar_one_or_none()
    if match is None or match.status == "completed":
        return
    game = (await session.execute(select(Game).where(Game.id == game_id))).scalar_one_or_none()
    if game is None or game.winner is None:
        return
    await apply_match_result(match, game.winner, game.score_a, game.score_b, session)
    # Check if the whole tournament is done
    all_real = (await session.execute(
        select(TournamentMatch).where(
            TournamentMatch.tournament_id == match.tournament_id,
            TournamentMatch.team_a_id.is_not(None),
            TournamentMatch.team_b_id.is_not(None),
        )
    )).scalars().all()
    if all_real and all(m.status == "completed" for m in all_real):
        t = (await session.execute(
            select(Tournament).where(Tournament.id == match.tournament_id)
        )).scalar_one_or_none()
        if t:
            t.status = "completed"
