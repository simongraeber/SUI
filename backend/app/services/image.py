"""Shared OpenAI image generation service."""

import io
import logging
import uuid
from pathlib import Path

import httpx
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

IMAGES_DIR = Path("/data/images")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

TEAM_IMAGES_DIR = Path("/data/team_images")
TEAM_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

BG_COLORS = [
    "bright red", "vivid blue", "lime green", "sunny yellow",
    "hot pink", "orange", "cyan", "purple", "teal", "magenta",
    "bright green", "bright blue", "bright yellow", "bright magenta",
    "dark red", "dark blue", "dark green", "dark yellow", "dark magenta",
]

# ── Style references (shared) ───────────────────────────────────────────────

_ASSETS_DIR = Path(__file__).parent.parent / "assets"
_STYLE_REFERENCE_PATHS = [_ASSETS_DIR / f"style_reference_{i}.png" for i in range(1, 7)]
_style_reference_bytes: list[bytes] | None = None


def get_style_reference_bytes() -> list[bytes]:
    """Load and cache the shared toy-style references used across image endpoints."""
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


# ── Single entry point ──────────────────────────────────────────────────────

async def generate_image(
    *,
    prompt: str,
    input_images: list[bytes],
    save_dir: Path,
    aspect_ratio: str = "auto",
) -> tuple[str, bytes]:
    """Call OpenAI image edits, save result as PNG, return (image_id, raw_bytes)."""
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is not configured")
    timeout_seconds = float(settings.openai_image_timeout_seconds)

    # OpenAI accepts fixed sizes; map requested aspect ratio to closest supported preset.
    size = "1024x1024"
    if aspect_ratio == "16:9":
        size = "1536x1024"

    files = [
        ("image[]", (f"input_{idx}.png", img, "image/png"))
        for idx, img in enumerate(input_images, start=1)
    ]

    data = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": size,
        "output_format": "png",
    }

    async with httpx.AsyncClient(timeout=timeout_seconds) as http:
        resp = await http.post(
            "https://api.openai.com/v1/images/edits",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            data=data,
            files=files,
        )
    resp.raise_for_status()
    data = resp.json()

    item = data["data"][0]
    if "b64_json" in item:
        import base64

        image_bytes = base64.b64decode(item["b64_json"])
    elif "url" in item:
        async with httpx.AsyncClient(timeout=timeout_seconds) as http:
            img_resp = await http.get(item["url"])
        img_resp.raise_for_status()
        image_bytes = img_resp.content
    else:
        raise KeyError("No b64_json or url in response")

    image_id = str(uuid.uuid4())
    Image.open(io.BytesIO(image_bytes)).save(str(save_dir / f"{image_id}.png"), format="PNG")
    return image_id, image_bytes
