import base64
import io
import logging
import random
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
import httpx

from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image

from app.api.deps import get_current_user
from app.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

IMAGES_DIR = Path("/data/images")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

_ASSETS_DIR = Path(__file__).parent.parent.parent / "assets"
_STYLE_REFERENCE_PATHS = [_ASSETS_DIR / f"style_reference_{i}.png" for i in range(1, 7)]
_style_reference_bytes: list[bytes] | None = None


def _get_style_reference_bytes() -> list[bytes]:
    global _style_reference_bytes
    if _style_reference_bytes is None:
        refs = []
        for path in _STYLE_REFERENCE_PATHS:
            if path.is_file():
                img = Image.open(path).convert("RGBA")
                img.thumbnail((768, 768), Image.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                refs.append(buf.getvalue())
            else:
                logger.warning("Style reference image not found at %s", path)
        _style_reference_bytes = refs
    return _style_reference_bytes


router = APIRouter(prefix="/images", tags=["images"])

_IMAGE_PROMPT = (
    "You have 3 reference images. "
    "The first two images define ONLY the toy style, materials, rendering, and composition. They MUST NOT influence facial identity, age, or personal appearance. "
    "The third image defines ONLY the person's identity (face, precise hair, body, exact clothing). It MUST be followed precisely. "
    "Preserve exact face proportions, eye spacing and shape, nose width and length, lip shape, jawline and chin structure from the third image. "
    "- solid {bg_color} background"
)

BG_COLORS = [
    "bright red", "vivid blue", "lime green", "sunny yellow",
    "hot pink", "orange", "cyan", "purple", "teal", "magenta",
    "bright green", "bright blue", "bright yellow", "bright magenta",
    "dark red", "dark blue", "dark green", "dark yellow", "dark magenta",
]


@router.get("/{image_id}")
async def get_image(image_id: str):
    """Serve a previously saved image by its ID."""
    try:
        uuid.UUID(image_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid image ID")
    path = IMAGES_DIR / f"{image_id}.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path, media_type="image/png")


@router.post("/generate")
async def generate_image(
    image: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    """Accept a user-uploaded image and transform it into a foosball figure."""
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PNG, JPEG, and WebP images are supported",
        )

    try:
        image_bytes = await image.read()
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        # Center-crop to 1:1
        w, h = pil_img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        pil_img = pil_img.crop((left, top, left + side, top + side))
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        user_image_bytes = buf.getvalue()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read uploaded image",
        )

    if not settings.xai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image generation is not configured",
        )

    prompt = _IMAGE_PROMPT.format(bg_color=random.choice(BG_COLORS))

    style_refs = _get_style_reference_bytes()
    selected_refs = random.sample(style_refs, min(2, len(style_refs))) if style_refs else []

    # Build ImageUrl objects: style refs first, user image last
    images_b64 = [
        {"url": "data:image/png;base64," + base64.b64encode(ref).decode()}
        for ref in selected_refs
    ] + [{"url": "data:image/png;base64," + base64.b64encode(user_image_bytes).decode()}]

    try:
        async with httpx.AsyncClient(timeout=120.0) as http:
            resp = await http.post(
                "https://api.x.ai/v1/images/edits",
                headers={"Authorization": f"Bearer {settings.xai_api_key}"},
                json={
                    "model": "grok-imagine-image",
                    "prompt": prompt,
                    "n": 1,
                    "aspect_ratio": "auto",
                    "resolution": "1k",
                    "images": images_b64,
                },
            )
        resp.raise_for_status()
        response_data = resp.json()
    except Exception as exc:
        logger.exception("xAI image edit failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Profile picture generation failed. Please try again.",
        )

    try:
        item = response_data["data"][0]
        if "b64_json" in item:
            image_data = base64.b64decode(item["b64_json"])
        elif "url" in item:
            async with httpx.AsyncClient(timeout=60.0) as http:
                img_resp = await http.get(item["url"])
            img_resp.raise_for_status()
            image_data = img_resp.content
        else:
            raise KeyError("No b64_json or url in response")
    except Exception:
        logger.error("Unexpected xAI response: %s", response_data)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Profile picture generation failed. Please try again.",
        )
    pil_result = Image.open(io.BytesIO(image_data))

    image_id = str(uuid.uuid4())
    file_path = IMAGES_DIR / f"{image_id}.png"
    pil_result.save(str(file_path), format="PNG")

    buf = io.BytesIO()
    pil_result.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"X-Image-Id": image_id},
    )
