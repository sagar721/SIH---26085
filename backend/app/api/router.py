from fastapi import APIRouter
from app.api.v1.api import api_router as api_v1_router
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(api_v1_router, prefix=settings.API_V1_STR)

__all__ = ["api_router"]
