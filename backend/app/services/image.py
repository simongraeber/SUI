"""Shared xAI image generation service."""

import base64
import io
import logging
import random
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

# ── Style references (profile pics) ─────────────────────────────────────────

_ASSETS_DIR = Path(__file__).parent.parent / "assets"
_STYLE_REFERENCE_PATHS = [_ASSETS_DIR / f"style_reference_{i}.png" for i in range(1, 7)]
_style_reference_bytes: list[bytes] | None = None


def get_style_reference_bytes() -> list[bytes]:
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
    """Call xAI image-edit, save result as PNG, return (image_id, raw_bytes)."""
    images_b64 = [
        {"url": "data:image/png;base64," + base64.b64encode(img).decode()}
        for img in input_images
    ]

    async with httpx.AsyncClient(timeout=120.0) as http:
        resp = await http.post(
            "https://api.x.ai/v1/images/edits",
            headers={"Authorization": f"Bearer {settings.xai_api_key}"},
            json={
                "model": "grok-imagine-image",
                "prompt": prompt,
                "n": 1,
                "aspect_ratio": aspect_ratio,
                "resolution": "1k",
                "images": images_b64,
            },
        )
    resp.raise_for_status()
    data = resp.json()

    item = data["data"][0]
    if "b64_json" in item:
        image_bytes = base64.b64decode(item["b64_json"])
    elif "url" in item:
        async with httpx.AsyncClient(timeout=60.0) as http:
            img_resp = await http.get(item["url"])
        img_resp.raise_for_status()
        image_bytes = img_resp.content
    else:
        raise KeyError("No b64_json or url in response")

    image_id = str(uuid.uuid4())
    Image.open(io.BytesIO(image_bytes)).save(str(save_dir / f"{image_id}.png"), format="PNG")
    return image_id, image_bytes
