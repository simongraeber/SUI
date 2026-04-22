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

# ── Style references ─────────────────────────────────────────────────────────

_ASSETS_DIR = Path(__file__).parent.parent / "assets"
_PROFILE_REF_DIR = _ASSETS_DIR / "style_reference_Profile"
_TEAM_REF_DIR = _ASSETS_DIR / "style_reference_Team"

_profile_reference_bytes: list[bytes] | None = None
_team_reference_bytes: list[bytes] | None = None


def _load_refs(directory: Path) -> list[bytes]:
    refs = []
    for path in sorted(directory.glob("*.png")):
        if path.is_file():
            refs.append(path.read_bytes())
    logger.info("Loaded %d style reference images from %s", len(refs), directory)
    return refs


def get_style_reference_bytes() -> list[bytes]:
    """Profile style references."""
    global _profile_reference_bytes
    if _profile_reference_bytes is None:
        _profile_reference_bytes = _load_refs(_PROFILE_REF_DIR)
    return _profile_reference_bytes


def get_team_style_reference_bytes() -> list[bytes]:
    """Team style references."""
    global _team_reference_bytes
    if _team_reference_bytes is None:
        _team_reference_bytes = _load_refs(_TEAM_REF_DIR)
    return _team_reference_bytes


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
