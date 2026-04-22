import io
import logging
import random
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image

from app.api.deps import get_current_user
from app.config import settings
from app.models.user import User
from app.services.image import BG_COLORS, IMAGES_DIR, generate_image, get_style_reference_bytes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/images", tags=["images"])

_IMAGE_PROMPT = (
    "A high-quality studio photograph of a custom foosball figurine. "
    "IDENTITY (FOLLOW IMAGE 2 EXACTLY): Utilize the precise facial structure, eye shape, hair color, torso proportions, "
    "and clothing style, fit, cut, and color for the entire torso from Image 2. "
    "The figurine must look exactly like the person in Image 2. "
    "STYLE & MATERIAL (FOLLOW IMAGE 1 ONLY): Apply the physical manufacturing properties from Image 1 to the character. This includes: "
    "- Semi-gloss, injection-molded plastic skin texture with subtle mold lines. "
    "- Distressed 'weathered' paint effects, including white scuffs and chipped paint flecks on the hair, face, and torso. "
    "- The structural mounting: a horizontal brushed-metal rod passing through the figurine's torso. "
    "ENVIRONMENT: Solid {bg_color} background with soft studio lighting. "
    "CRITICAL: Do *not* use the facial features, eye paint style, clothing style, torso shape, or hairstyle from Image 1. "
    "Use Image 2 for all anatomical, proportions and personal identity details, like accessories and colors, but translated into the new medium."
)


@router.get("/{image_id}")
async def get_image(image_id: str):
    try:
        uuid.UUID(image_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid image ID")
    path = IMAGES_DIR / f"{image_id}.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path, media_type="image/png")


@router.post("/upload")
async def upload_profile_image(
    image: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    """Save a profile image as-is (no AI). Returns JSON with image_url."""
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WebP images are supported")

    try:
        image_bytes = await image.read()
        if len(image_bytes) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Image too large (max 5 MB)")
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        image_bytes = buf.getvalue()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read uploaded image")

    image_id = str(uuid.uuid4())
    (IMAGES_DIR / f"{image_id}.png").write_bytes(image_bytes)
    return {"image_url": f"/api/v1/images/{image_id}"}


@router.post("/generate")
async def generate_profile_image(
    image: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WebP images are supported")

    try:
        image_bytes = await image.read()
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        w, h = pil_img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        pil_img = pil_img.crop((left, top, left + side, top + side))
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        user_image_bytes = buf.getvalue()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read uploaded image")

    if not settings.xai_api_key:
        raise HTTPException(status_code=503, detail="Image generation is not configured")

    style_refs = get_style_reference_bytes()
    selected_refs = [random.choice(style_refs)] if style_refs else []

    try:
        image_id, image_data = await generate_image(
            prompt=_IMAGE_PROMPT.format(bg_color=random.choice(BG_COLORS)),
            input_images=selected_refs + [user_image_bytes],
            save_dir=IMAGES_DIR,
            aspect_ratio="1:1",
        )
    except Exception as exc:
        logger.exception("xAI image edit failed: %s", exc)
        raise HTTPException(status_code=502, detail="Profile picture generation failed. Please try again.")

    return StreamingResponse(
        io.BytesIO(image_data),
        media_type="image/png",
        headers={"X-Image-Id": image_id},
    )
