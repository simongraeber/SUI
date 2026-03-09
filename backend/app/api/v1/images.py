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


def _get_gemini_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini API key is not configured",
        )
    return genai.Client(api_key=settings.gemini_api_key)


@router.get("/{image_id}")
async def get_image(image_id: str):
    """Serve a previously saved image by its ID."""
    # Sanitise: only allow uuid-shaped filenames
    path = IMAGES_DIR / f"{image_id}.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path, media_type="image/png")


@router.post("/generate")
async def generate_image(
    image: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    """
    Accept a user-uploaded image and transform it using the globally
    configured prompt via Google Gemini image generation.

    The prompt is set globally in the GEMINI_IMAGE_PROMPT env var / config.
    """
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
    prompt = settings.gemini_image_prompt.replace(
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
    except Exception as exc:
        logger.exception("Gemini API call failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Image generation failed: {exc}",
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
