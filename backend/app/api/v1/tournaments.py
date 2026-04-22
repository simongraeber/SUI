import io
import logging
import math
import random
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
import httpx
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.game import Game, GamePlayer
from app.models.tournament import Tournament, TournamentMatch, TournamentTeam, TournamentTeamPlayer
from app.models.user import User
from app.schemas.tournament import (
    LaunchGameResponse,
    RoundSettingsUpdate,
    TournamentCreate,
    TournamentMatchResponse,
    TournamentResponse,
    TournamentSummary,
    TournamentTeamCreate,
    TournamentTeamPlayerCreate,
    TournamentTeamPlayerResponse,
    TournamentTeamResponse,
)
from fastapi.responses import StreamingResponse
from app.services.image import BG_COLORS, IMAGES_DIR, TEAM_IMAGES_DIR, generate_image, get_team_style_reference_bytes
from app.services.tournament import apply_match_result, generate_bracket

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_options():
    return [
        selectinload(Tournament.admin),
        selectinload(Tournament.teams).selectinload(TournamentTeam.user),
        selectinload(Tournament.teams).selectinload(TournamentTeam.players).selectinload(TournamentTeamPlayer.user),
        selectinload(Tournament.matches),
    ]


async def _get_tournament_or_404(slug: str, db: AsyncSession) -> Tournament:
    result = await db.execute(
        select(Tournament).options(*_load_options()).where(Tournament.slug == slug)
    )
    t = result.scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return t


async def _reload_tournament(tournament_id: uuid.UUID, db: AsyncSession) -> Tournament:
    result = await db.execute(
        select(Tournament).options(*_load_options()).where(Tournament.id == tournament_id)
    )
    return result.scalar_one()


def _assert_admin(tournament: Tournament, user: User) -> None:
    if tournament.admin_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


def _num_rounds(n: int) -> int | None:
    if n < 2:
        return None
    p = 1
    while p < n:
        p <<= 1
    return int(math.log2(p))


def _build_player_response(p: TournamentTeamPlayer) -> TournamentTeamPlayerResponse:
    return TournamentTeamPlayerResponse(
        id=p.id,
        team_id=p.team_id,
        name=p.name,
        user_id=p.user_id,
        user_image_url=p.user.image_url if p.user else None,
    )


def _build_team_response(team: TournamentTeam) -> TournamentTeamResponse:
    return TournamentTeamResponse(
        id=team.id,
        tournament_id=team.tournament_id,
        name=team.name,
        user_id=team.user_id,
        user_name=team.user.name if team.user else None,
        user_image_url=team.user.image_url if team.user else None,
        image_url=team.image_url or None,
        seed=team.seed,
        created_at=team.created_at,
        players=[_build_player_response(p) for p in (team.players or [])],
    )


def _build_match_response(match: TournamentMatch) -> TournamentMatchResponse:
    return TournamentMatchResponse(
        id=match.id,
        tournament_id=match.tournament_id,
        round=match.round,
        position=match.position,
        team_a=_build_team_response(match.team_a) if match.team_a else None,
        team_b=_build_team_response(match.team_b) if match.team_b else None,
        score_a=match.score_a,
        score_b=match.score_b,
        winner_id=match.winner_id,
        status=match.status,
        is_bye=match.is_bye,
        game_id=match.game_id,
        goals_to_win=match.goals_to_win,
        win_by=match.win_by,
    )


def _build_response(t: Tournament) -> TournamentResponse:
    nr = _num_rounds(len(t.teams)) if t.status != "registration" else None
    return TournamentResponse(
        id=t.id,
        name=t.name,
        slug=t.slug,
        admin_user_id=t.admin_user_id,
        admin_name=t.admin.name if t.admin else "",
        status=t.status,
        games_per_match=t.games_per_match,
        goals_per_game=t.goals_per_game,
        num_rounds=nr,
        created_at=t.created_at,
        updated_at=t.updated_at,
        teams=[_build_team_response(team) for team in t.teams],
        matches=[_build_match_response(m) for m in t.matches],
    )



# ── endpoints ────────────────────────────────────────────────────────────────

@router.post("", response_model=TournamentResponse, status_code=status.HTTP_201_CREATED)
async def create_tournament(body: TournamentCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tournament = Tournament(
        name=body.name,
        admin_user_id=user.id,
        games_per_match=body.games_per_match,
        goals_per_game=body.goals_per_game,
    )
    db.add(tournament)
    await db.commit()
    return _build_response(await _reload_tournament(tournament.id, db))


@router.get("", response_model=list[TournamentSummary])
async def list_my_tournaments(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Tournaments where the user is admin OR is linked as a team player
    player_tournament_ids = (
        select(Tournament.id)
        .join(TournamentTeam, TournamentTeam.tournament_id == Tournament.id)
        .join(TournamentTeamPlayer, TournamentTeamPlayer.team_id == TournamentTeam.id)
        .where(TournamentTeamPlayer.user_id == user.id)
    )
    rows = (await db.execute(
        select(Tournament, func.count(TournamentTeam.id).label("team_count"))
        .outerjoin(TournamentTeam, TournamentTeam.tournament_id == Tournament.id)
        .where(
            (Tournament.admin_user_id == user.id) | (Tournament.id.in_(player_tournament_ids))
        )
        .group_by(Tournament.id)
        .order_by(Tournament.created_at.desc())
    )).all()
    return [
        TournamentSummary(
            id=t.id, name=t.name, slug=t.slug, admin_user_id=t.admin_user_id,
            status=t.status,
            team_count=count, created_at=t.created_at,
        )
        for t, count in rows
    ]


@router.get("/{slug}", response_model=TournamentResponse)
async def get_tournament(slug: str, db: AsyncSession = Depends(get_db)):
    return _build_response(await _get_tournament_or_404(slug, db))


# ── Team ─────────────────────────────────────────────────────

@router.post("/{slug}/teams", response_model=TournamentTeamResponse, status_code=201)
async def register_team(slug: str, body: TournamentTeamCreate, db: AsyncSession = Depends(get_db)):
    tournament = await _get_tournament_or_404(slug, db)
    if tournament.status != "registration":
        raise HTTPException(status_code=409, detail="Registration is closed")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Team name is required")
    if body.user_id:
        if (await db.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="User not found")
        if (await db.execute(select(TournamentTeam).where(
            TournamentTeam.tournament_id == tournament.id,
            TournamentTeam.user_id == body.user_id,
        ))).scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="You have already registered a team")
    max_seed = (await db.execute(
        select(func.max(TournamentTeam.seed)).where(TournamentTeam.tournament_id == tournament.id)
    )).scalar() or 0
    team = TournamentTeam(tournament_id=tournament.id, name=name, user_id=body.user_id, seed=max_seed + 1)
    db.add(team)
    await db.flush()
    if body.user_id:
        user_row = (await db.execute(select(User).where(User.id == body.user_id))).scalar_one()
        db.add(TournamentTeamPlayer(team_id=team.id, user_id=body.user_id, name=user_row.name))
    await db.commit()
    result = await db.execute(
        select(TournamentTeam)
        .options(selectinload(TournamentTeam.user), selectinload(TournamentTeam.players).selectinload(TournamentTeamPlayer.user))
        .where(TournamentTeam.id == team.id)
    )
    return _build_team_response(result.scalar_one())


@router.delete("/{slug}/teams/{team_id}", status_code=204)
async def remove_team(slug: str, team_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tournament = await _get_tournament_or_404(slug, db)
    _assert_admin(tournament, user)
    if tournament.status != "registration":
        raise HTTPException(status_code=409, detail="Cannot remove teams after start")
    team = (await db.execute(
        select(TournamentTeam).where(TournamentTeam.id == team_id, TournamentTeam.tournament_id == tournament.id)
    )).scalar_one_or_none()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    await db.delete(team)
    remaining = (await db.execute(
        select(TournamentTeam).where(TournamentTeam.tournament_id == tournament.id).order_by(TournamentTeam.seed)
    )).scalars().all()
    for i, t in enumerate(remaining, start=1):
        t.seed = i
    await db.commit()


# ── Team players ─────────────────────────────────────────────

@router.post("/{slug}/teams/{team_id}/players", response_model=TournamentTeamPlayerResponse, status_code=201)
async def add_team_player(slug: str, team_id: uuid.UUID, body: TournamentTeamPlayerCreate, db: AsyncSession = Depends(get_db)):
    tournament = await _get_tournament_or_404(slug, db)
    if tournament.status != "registration":
        raise HTTPException(status_code=409, detail="Registration is closed")
    team = (await db.execute(
        select(TournamentTeam).where(TournamentTeam.id == team_id, TournamentTeam.tournament_id == tournament.id)
    )).scalar_one_or_none()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Player name is required")
    if body.user_id:
        if (await db.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="User not found")
        if (await db.execute(
            select(TournamentTeamPlayer).where(TournamentTeamPlayer.team_id == team_id, TournamentTeamPlayer.user_id == body.user_id)
        )).scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="Player already in team")
    player = TournamentTeamPlayer(team_id=team_id, user_id=body.user_id, name=name)
    db.add(player)
    await db.commit()
    result = await db.execute(
        select(TournamentTeamPlayer).options(selectinload(TournamentTeamPlayer.user)).where(TournamentTeamPlayer.id == player.id)
    )
    return _build_player_response(result.scalar_one())


@router.delete("/{slug}/teams/{team_id}/players/{player_id}", status_code=204)
async def remove_team_player(slug: str, team_id: uuid.UUID, player_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tournament = await _get_tournament_or_404(slug, db)
    if tournament.status != "registration":
        raise HTTPException(status_code=409, detail="Registration is closed")
    if tournament.admin_user_id != user.id:
        # also allow team owner
        team = (await db.execute(select(TournamentTeam).where(TournamentTeam.id == team_id))).scalar_one_or_none()
        if team is None or team.user_id != user.id:
            raise HTTPException(status_code=403, detail="Not authorized")
    player = (await db.execute(
        select(TournamentTeamPlayer).where(TournamentTeamPlayer.id == player_id, TournamentTeamPlayer.team_id == team_id)
    )).scalar_one_or_none()
    if player is None:
        raise HTTPException(status_code=404, detail="Player not found")
    await db.delete(player)
    await db.commit()


# ── Lifecycle ─────────────────────────────────────────────────

@router.post("/{slug}/start", response_model=TournamentResponse)
async def start_tournament(slug: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tournament = await _get_tournament_or_404(slug, db)
    _assert_admin(tournament, user)
    if tournament.status != "registration":
        raise HTTPException(status_code=409, detail="Tournament already started")
    teams = sorted(tournament.teams, key=lambda t: t.seed)
    if len(teams) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 teams to start")
    tournament.status = "active"
    for m in generate_bracket(tournament, teams):
        db.add(m)
    await db.commit()
    return _build_response(await _reload_tournament(tournament.id, db))


@router.post("/{slug}/matches/{match_id}/game", response_model=LaunchGameResponse)
async def start_match_game(slug: str, match_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Create (or resume) a live game for this bracket match.

    The game is created without a group_id — tournament games are self-contained.
    Team players are pre-assigned to sides A and B from the match rosters.
    """
    tournament = await _get_tournament_or_404(slug, db)
    if tournament.status != "active":
        raise HTTPException(status_code=409, detail="Tournament is not active")
    match = (await db.execute(
        select(TournamentMatch).where(TournamentMatch.id == match_id, TournamentMatch.tournament_id == tournament.id)
    )).scalar_one_or_none()
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status == "completed":
        raise HTTPException(status_code=409, detail="Match already completed")
    if match.team_a_id is None or match.team_b_id is None:
        raise HTTPException(status_code=409, detail="Both team slots must be filled")

    # Return existing active/setup/paused game if already launched
    if match.game_id is not None:
        g = (await db.execute(select(Game).where(Game.id == match.game_id))).scalar_one_or_none()
        if g is not None and g.state not in ("cancelled", "completed"):
            return LaunchGameResponse(game_id=g.id)

    # Load team rosters (already eager-loaded via _load_options → teams → players)
    team_a = next((t for t in tournament.teams if t.id == match.team_a_id), None)
    team_b = next((t for t in tournament.teams if t.id == match.team_b_id), None)
    if team_a is None or team_b is None:
        raise HTTPException(status_code=404, detail="Team not found")

    # Create a tournament-native game (no group_id)
    # Use match-level settings if set, otherwise fall back to tournament defaults
    goals_to_win = match.goals_to_win if match.goals_to_win is not None else tournament.goals_per_game
    win_by = match.win_by if match.win_by is not None else 2
    game = Game(
        group_id=None,
        tournament_match_id=match.id,
        state="setup",
        created_by=user.id,
        goals_to_win=goals_to_win,
        win_by=win_by,
    )
    db.add(game)
    await db.flush()

    # Pre-assign team players to sides
    for player in team_a.players:
        db.add(GamePlayer(
            game_id=game.id,
            user_id=player.user_id,
            player_name=player.name,
            side="a",
        ))
    for player in team_b.players:
        db.add(GamePlayer(
            game_id=game.id,
            user_id=player.user_id,
            player_name=player.name,
            side="b",
        ))

    match.game_id = game.id
    await db.commit()
    return LaunchGameResponse(game_id=game.id)


@router.patch("/{slug}/rounds/{round_num}", response_model=TournamentResponse)
async def update_round_settings(
    slug: str,
    round_num: int,
    body: RoundSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update goals_to_win and win_by for all matches in a given round."""
    tournament = await _get_tournament_or_404(slug, db)
    _assert_admin(tournament, user)
    matches = [m for m in tournament.matches if m.round == round_num]
    if not matches:
        raise HTTPException(status_code=404, detail="Round not found")
    for m in matches:
        if body.goals_to_win is not None:
            m.goals_to_win = body.goals_to_win
        if body.win_by is not None:
            m.win_by = body.win_by
    await db.commit()
    return _build_response(await _reload_tournament(tournament.id, db))


@router.post("/{slug}/teams/{team_id}/image", response_model=TournamentTeamResponse)
async def upload_team_image(
    slug: str,
    team_id: uuid.UUID,
    image: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a team picture (landscape recommended)."""
    tournament = await _get_tournament_or_404(slug, db)
    team = next((t for t in tournament.teams if t.id == team_id), None)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if tournament.admin_user_id != user.id and team.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WebP images are supported")
    image_bytes = await image.read()
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 5 MB)")
    image_id = str(uuid.uuid4())
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(image.content_type, ".png")
    path = TEAM_IMAGES_DIR / f"{image_id}{ext}"
    path.write_bytes(image_bytes)
    team.image_url = f"/api/v1/tournaments/team-images/{image_id}{ext}"
    await db.commit()
    result = await db.execute(
        select(TournamentTeam)
        .options(selectinload(TournamentTeam.user), selectinload(TournamentTeam.players).selectinload(TournamentTeamPlayer.user))
        .where(TournamentTeam.id == team.id)
    )
    return _build_team_response(result.scalar_one())


@router.patch("/{slug}/teams/{team_id}/image-url", response_model=TournamentTeamResponse)
async def set_team_image_url(
    slug: str,
    team_id: uuid.UUID,
    image_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set a team's image_url to a previously generated team image."""
    try:
        uuid.UUID(image_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid image ID")
    path = TEAM_IMAGES_DIR / f"{image_id}.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    tournament = await _get_tournament_or_404(slug, db)
    team = next((t for t in tournament.teams if t.id == team_id), None)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if tournament.admin_user_id != user.id and team.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    team.image_url = f"/api/v1/tournaments/team-images/{image_id}.png"
    await db.commit()

    result = await db.execute(
        select(TournamentTeam)
        .options(selectinload(TournamentTeam.user), selectinload(TournamentTeam.players).selectinload(TournamentTeamPlayer.user))
        .where(TournamentTeam.id == team.id)
    )
    return _build_team_response(result.scalar_one())


@router.get("/team-images/{filename}")
async def get_team_image(filename: str):
    from pathlib import PurePosixPath
    from fastapi.responses import FileResponse
    safe = PurePosixPath(filename).name
    if safe != filename:
        raise HTTPException(status_code=400, detail="Invalid image filename")
    path = TEAM_IMAGES_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


# ── AI team image from upload ────────────────────────────────

_TEAM_UPLOAD_PROMPT = (
    "Image 1 defines ONLY the toy style, materials, rendering, and composition. It MUST NOT influence the subject identity. "
    "Image 2 is the team image to restyle in the toy aesthetic. "
    "Preserve the composition, number of subjects, and subjects details of Image 2. "
    "Render it in the same toy-figure style as Image 1. "
    "- landscape 16:9 aspect ratio "
    "- solid {bg_color} background"
)


@router.post("/{slug}/teams/{team_id}/generate-image-upload")
async def generate_team_image_from_upload(
    slug: str,
    team_id: uuid.UUID,
    image: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a team image, AI-refine it, and return the result as a streaming image (same UX as profile pics)."""
    tournament = await _get_tournament_or_404(slug, db)
    team = next((t for t in tournament.teams if t.id == team_id), None)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if tournament.admin_user_id != user.id and team.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WebP images are supported")

    image_bytes = await image.read()
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 5 MB)")

    if not settings.xai_api_key:
        raise HTTPException(status_code=503, detail="Image generation is not configured")

    # Prepare the uploaded image
    try:
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        pil_img.thumbnail((1024, 1024), Image.LANCZOS)
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        user_image_bytes = buf.getvalue()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read uploaded image")

    style_refs = get_team_style_reference_bytes()
    selected_refs = [random.choice(style_refs)] if style_refs else []

    bg_color = random.choice(BG_COLORS)
    try:
        image_id, image_data = await generate_image(
            prompt=_TEAM_UPLOAD_PROMPT.format(bg_color=bg_color),
            input_images=selected_refs + [user_image_bytes],
            save_dir=TEAM_IMAGES_DIR,
            aspect_ratio="16:9",
        )
    except Exception as exc:
        logger.exception("xAI team image generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Team image generation failed. Please try again.")

    return StreamingResponse(
        io.BytesIO(image_data),
        media_type="image/png",
        headers={"X-Image-Id": image_id},
    )


# ── AI team image generation ─────────────────────────────────

_TEAM_IMAGE_PROMPT = (
    "Combine the characters on the same metal table football metal rod, "
    "add a solid {bg_color} background."
)


@router.post("/{slug}/teams/{team_id}/generate-image")
async def generate_team_image(
    slug: str,
    team_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Combine player profile images via AI into a single team image (16:9).
    Returns the generated image as a streaming response with X-Image-Id header.
    """
    tournament = await _get_tournament_or_404(slug, db)
    team = next((t for t in tournament.teams if t.id == team_id), None)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    if tournament.admin_user_id != user.id and team.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not settings.xai_api_key:
        raise HTTPException(status_code=503, detail="Image generation is not configured")

    # Collect profile images from players that have linked user accounts with generated images
    player_images: list[bytes] = []
    for p in team.players:
        if p.user and p.user.image_url:
            img_url = p.user.image_url
            try:
                # Image is stored locally at /data/images/{id}.png
                if img_url.startswith("/api/v1/images/"):
                    image_id = img_url.split("/")[-1]
                    img_path = IMAGES_DIR / f"{image_id}.png"
                    if img_path.is_file():
                        player_images.append(img_path.read_bytes())
                else:
                    # External URL (e.g. Google profile pic)
                    async with httpx.AsyncClient(timeout=15.0) as http:
                        resp = await http.get(img_url)
                    resp.raise_for_status()
                    player_images.append(resp.content)
            except Exception:
                logger.warning("Failed to load image for player %s", p.name)

    if not player_images:
        raise HTTPException(status_code=422, detail="No player profile images available. Players need accounts with profile pictures.")

    # Combine images side by side on a single canvas
    pil_images = []
    for img_bytes in player_images:
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        pil_images.append(pil_img)

    # Normalize heights, then place side by side
    target_h = 512
    resized = []
    for img in pil_images:
        ratio = target_h / img.height
        new_w = int(img.width * ratio)
        resized.append(img.resize((new_w, target_h), Image.LANCZOS))

    total_w = sum(r.width for r in resized)
    combined = Image.new("RGBA", (total_w, target_h), (255, 255, 255, 0))
    x_offset = 0
    for r in resized:
        combined.paste(r, (x_offset, 0))
        x_offset += r.width

    buf = io.BytesIO()
    combined.save(buf, format="PNG")
    combined_bytes = buf.getvalue()

    bg_color = random.choice(BG_COLORS)
    prompt = _TEAM_IMAGE_PROMPT.format(bg_color=bg_color)

    try:
        image_id, image_data = await generate_image(
            prompt=prompt,
            input_images=[combined_bytes],
            save_dir=TEAM_IMAGES_DIR,
            aspect_ratio="16:9",
        )
    except Exception as exc:
        logger.exception("xAI team image generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Team image generation failed. Please try again.")

    return StreamingResponse(
        io.BytesIO(image_data),
        media_type="image/png",
        headers={"X-Image-Id": image_id},
    )
