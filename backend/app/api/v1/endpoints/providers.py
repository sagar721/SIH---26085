from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import require_roles
from app.data_sources import PROVIDERS

router = APIRouter(dependencies=[Depends(require_roles("admin", "operator"))])


@router.get(
    "/status",
    summary="Status of all External Data Providers",
    description="Returns connectivity status, metadata, latency, and cache timestamp for all integrated external providers.",
)
async def get_all_providers_status() -> Dict[str, Any]:
    statuses = {}
    for key, provider in PROVIDERS.items():
        # Trigger health check if not yet checked
        await provider.health_check()
        statuses[key] = provider.metadata()
    return {
        "status": "ok",
        "providers": statuses
    }


@router.get(
    "/{provider_name}",
    summary="Specific Provider Status",
    description="Returns the status and metadata for a specific data provider.",
)
async def get_provider_status(provider_name: str) -> Dict[str, Any]:
    if provider_name not in PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider '{provider_name}' not found. Available providers: {list(PROVIDERS.keys())}"
        )
    provider = PROVIDERS[provider_name]
    await provider.health_check()
    return provider.metadata()
