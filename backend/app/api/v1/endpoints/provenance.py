from typing import Any, Dict
from fastapi import APIRouter
from app.services.provenance_service import provenance_service

router = APIRouter()


@router.get(
    "",
    summary="Data Lineage & Scientific Provenance",
    description="Returns complete data provenance, integrated provider metadata, model formulations, and prototype assumptions.",
)
async def get_provenance() -> Dict[str, Any]:
    return provenance_service.get_system_provenance()
