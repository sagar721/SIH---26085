from datetime import datetime, timezone
from typing import Any, Dict, Optional
from app.data_sources import PROVIDERS
from app.schemas.common import DataSourceTypeEnum, ProviderStatusEnum


class WeatherService:
    def __init__(self):
        self.primary_provider = "open_meteo"

    async def get_current(self, lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
        provider = PROVIDERS.get(self.primary_provider)
        if not provider:
            return {
                "status": ProviderStatusEnum.UNAVAILABLE.value,
                "provider": "Open-Meteo",
                "error": "Open-Meteo adapter not initialized",
                "data": None
            }

        data = await provider.fetch(lat=lat, lon=lon)
        if data.get("status") != "CONNECTED":
            return {
                "status": data.get("status", ProviderStatusEnum.UNAVAILABLE.value),
                "provider": provider.name,
                "error": data.get("error", "Unable to retrieve weather data"),
                "data": None
            }

        return {
            "status": "ok",
            "provider": provider.name,
            "source_type": provider.source_type.value,
            "attribution": provider.attribution,
            "retrieved_at": data.get("retrieved_at"),
            "location": data.get("location"),
            "current": data.get("current"),
            "cached": data.get("cached", False),
        }

    async def get_forecast(self, lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
        provider = PROVIDERS.get(self.primary_provider)
        if not provider:
            return {
                "status": ProviderStatusEnum.UNAVAILABLE.value,
                "provider": "Open-Meteo",
                "error": "Open-Meteo adapter not initialized",
                "data": None
            }

        data = await provider.fetch(lat=lat, lon=lon)
        if data.get("status") != "CONNECTED":
            return {
                "status": data.get("status", ProviderStatusEnum.UNAVAILABLE.value),
                "provider": provider.name,
                "error": data.get("error", "Unable to retrieve forecast data"),
                "data": None
            }

        return {
            "status": "ok",
            "provider": provider.name,
            "source_type": provider.source_type.value,
            "attribution": provider.attribution,
            "retrieved_at": data.get("retrieved_at"),
            "location": data.get("location"),
            "hourly_forecast": data.get("hourly"),
            "cached": data.get("cached", False),
        }


weather_service = WeatherService()
