from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.ask import router as ask_router
from app.api.v1.games import router as games_router
from app.api.v1.images import router as images_router
from app.api.v1.groups import router as groups_router
from app.api.v1.users import router as users_router

router = APIRouter(prefix="/api/v1")
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(images_router)
router.include_router(groups_router)
router.include_router(games_router)
router.include_router(ask_router)
