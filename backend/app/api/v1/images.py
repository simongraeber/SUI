import io
import logging
import random
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from google import genai
from google.genai import types
from PIL import Image

from app.api.deps import get_current_user
from app.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

IMAGES_DIR = Path("/data/images")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/images", tags=["images"])

_IMAGE_PROMPT = (
    "Close-up macro photograph of a real foosball table player figure "
    ", shot from the shoulders up like an ID card photo. "
    "The figure is a complete full-body foosball player but the camera is zoomed in on the face. "
    "Match the person's hair color, hair style, skin tone, eye color, and clothing style. "
    "Entire figure is rigid, molded, glossy hard plastic with visible paint strokes, chips, and scratches. "
    "Nose is a small rounded plastic bump. Ears are small molded bumps. "
    "Hair is a solid molded plastic shape painted to match original color. "
    "Background is pure solid white. "
    "Extreme macro photography, high-contrast studio lighting. --ar 1:1"
)


_gemini_client: genai.Client | None = None


def _get_gemini_client() -> genai.Client:
    global _gemini_client
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini API key is not configured",
        )
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=settings.gemini_api_key)
    return _gemini_client


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
    """Accept a user-uploaded image and transform it via Gemini image generation."""
    # Validate uploaded file is an image
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PNG, JPEG, and WebP images are supported",
        )

    try:
        image_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(image_bytes))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read uploaded image",
        )

    client = _get_gemini_client()

    # Pick a random background colour so players are easy to tell apart
    BG_COLORS = [
        "bright red", "vivid blue", "lime green", "sunny yellow",
        "hot pink", "orange", "cyan", "purple", "teal", "magenta",
        "bright green", "bright blue", "bright yellow", "bright magenta",
        "dark red", "dark blue", "dark green", "dark yellow", "dark magenta"
    ]
    prompt = _IMAGE_PROMPT.replace(
        "pure solid white", f"pure solid {random.choice(BG_COLORS)}"
    )

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=[
                prompt,
                pil_image,
            ],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio="1:1",
                ),
            ),
        )
    except Exception as exca:
        logger.exception("Gemini API call failed %s", exca)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image generation failed. Please try again.",
        )

    # Extract the generated image from the response
    for part in response.parts:
        if part.inline_data is not None and part.inline_data.mime_type.startswith("image/"):
            pil_img = Image.open(io.BytesIO(part.inline_data.data))

            # Save to persistent storage
            image_id = str(uuid.uuid4())
            file_path = IMAGES_DIR / f"{image_id}.png"
            pil_img.save(str(file_path), format="PNG")

            # Also stream it back to the client
            buf = io.BytesIO()
            pil_img.save(buf, format="PNG")
            buf.seek(0)
            return StreamingResponse(
                buf,
                media_type="image/png",
                headers={"X-Image-Id": image_id},
            )

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Gemini returned no image in its response",
    )
