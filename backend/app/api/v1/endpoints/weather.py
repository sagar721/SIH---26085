from typing import Any, Dict, Optional
from fastapi import APIRouter, Query, status

from app.core.config import settings
from app.data_sources import PROVIDERS

router = APIRouter()


@router.get(
    "/current",
    summary="Current Weather & Precipitation",
    description="Fetches Open-Meteo current weather for the configured study area. It is classified as FORECAST/current provider output, not radar or gauge observation.",
)
async def get_current_weather(
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lon: Optional[float] = Query(default=None, ge=-180, le=180)
) -> Dict[str, Any]:
    open_meteo = PROVIDERS.get("open_meteo")
    if not open_meteo:
        return {
            "status": "UNAVAILABLE",
            "provider": "Open-Meteo",
            "error": "Open-Meteo adapter not initialized",
            "data": None
        }

    data = await open_meteo.fetch(lat=lat, lon=lon)
    if data.get("status") != "CONNECTED":
        return {
            "status": data.get("status", "UNAVAILABLE"),
            "provider": open_meteo.name,
            "error": data.get("error", "Unable to retrieve weather data"),
            "data": None
        }

    return {
        "status": "ok",
        "provider": open_meteo.name,
        "source_type": open_meteo.source_type.value,
        "attribution": open_meteo.attribution,
        "retrieved_at": data.get("retrieved_at"),
        "location": data.get("location"),
        "current": data.get("current"),
        "cached": data.get("cached", False),
    }


@router.get(
    "/forecast",
    summary="Precipitation & Weather Forecast",
    description="Returns hourly precipitation forecast for the study area from Open-Meteo. Classified as FORECAST (not radar).",
)
async def get_weather_forecast(
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lon: Optional[float] = Query(default=None, ge=-180, le=180)
) -> Dict[str, Any]:
    open_meteo = PROVIDERS.get("open_meteo")
    if not open_meteo:
        return {
            "status": "UNAVAILABLE",
            "provider": "Open-Meteo",
            "error": "Open-Meteo adapter not initialized",
            "data": None
        }

    data = await open_meteo.fetch(lat=lat, lon=lon)
    if data.get("status") != "CONNECTED":
        return {
            "status": data.get("status", "UNAVAILABLE"),
            "provider": open_meteo.name,
            "error": data.get("error", "Unable to retrieve forecast data"),
            "data": None
        }

    return {
        "status": "ok",
        "provider": open_meteo.name,
        "source_type": open_meteo.source_type.value,
        "attribution": open_meteo.attribution,
        "retrieved_at": data.get("retrieved_at"),
        "location": data.get("location"),
        "hourly_forecast": data.get("hourly"),
        "cached": data.get("cached", False),
    }
