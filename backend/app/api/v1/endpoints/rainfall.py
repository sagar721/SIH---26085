from typing import Any, Dict, Optional
from fastapi import APIRouter, Query, status
from app.services.rainfall_service import rainfall_service
from app.schemas.rainfall import RainfallResponse

router = APIRouter()


@router.get(
    "/current",
    summary="Current Rainfall Observation / Forecast",
    description="Returns current corridor rainfall rate derived from validated weather feeds. Strictly classified as FORECAST / OBSERVED without fabrication.",
)
async def get_current_rainfall(
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lon: Optional[float] = Query(default=None, ge=-180, le=180)
) -> Dict[str, Any]:
    return await rainfall_service.get_current_rainfall(lat=lat, lon=lon)


@router.get(
    "/forecast",
    summary="Rainfall Forecast & Accumulation Timeline",
    description="Returns 24-hour hourly precipitation accumulation and projected peak intensity for the Mithi corridor.",
)
async def get_rainfall_forecast(
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lon: Optional[float] = Query(default=None, ge=-180, le=180)
) -> Dict[str, Any]:
    return await rainfall_service.get_forecast_rainfall(lat=lat, lon=lon)
