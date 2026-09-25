import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import httpx

from app.core.config import settings

from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus


class OpenMeteoSource(BaseDataSource):
    def __init__(self):
        super().__init__(
            name="Open-Meteo",
            source_type=DataSourceType.FORECAST,
            attribution="Weather data by Open-Meteo.com (CC-BY 4.0)"
        )
        self.base_url = "https://api.open-meteo.com/v1/forecast"
        self._cache_ttl_seconds = 900

    async def health_check(self) -> ProviderStatus:
        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                center = settings.load_study_area()["center"]
                res = await client.get(
                    self.base_url,
                    params={
                        "latitude": center["lat"],
                        "longitude": center["lon"],
                        "current": "temperature_2m",
                        "forecast_days": 1
                    }
                )
                duration_ms = (time.perf_counter() - start) * 1000
                if res.status_code == 200:
                    self._mark_success(duration_ms)
                    return ProviderStatus.CONNECTED
                else:
                    self._mark_error(f"HTTP {res.status_code}: {res.text[:100]}", ProviderStatus.ERROR)
                    return ProviderStatus.ERROR
        except httpx.RequestError as e:
            self._mark_error(str(e), ProviderStatus.UNAVAILABLE)
            return ProviderStatus.UNAVAILABLE

    async def fetch(self, lat: Optional[float] = None, lon: Optional[float] = None, **kwargs) -> Dict[str, Any]:
        center = settings.load_study_area()["center"]
        lat = center["lat"] if lat is None else lat
        lon = center["lon"] if lon is None else lon
        # Check cache validity
        now = datetime.now(timezone.utc)
        cache_key = f"{lat}_{lon}"
        if (
            cache_key in self._cache
            and self._cache_timestamp
            and (now - self._cache_timestamp).total_seconds() < self._cache_ttl_seconds
        ):
            cached_data = dict(self._cache[cache_key])
            cached_data["cached"] = True
            cached_data["cache_timestamp"] = self._cache_timestamp.isoformat()
            return cached_data

        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    self.base_url,
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current": "temperature_2m,precipitation,rain,weather_code,wind_speed_10m",
                        "hourly": "temperature_2m,precipitation,rain,precipitation_probability",
                        "forecast_days": 2,
                        "timezone": "auto"
                    }
                )
                duration_ms = (time.perf_counter() - start) * 1000
                if res.status_code != 200:
                    self._mark_error(f"HTTP {res.status_code}: {res.text[:100]}")
                    return {
                        "provider": self.name,
                        "status": "ERROR",
                        "error": f"HTTP {res.status_code}",
                        "source_type": self.source_type.value,
                        "data": None
                    }

                data = res.json()
                self._mark_success(duration_ms)

                result = {
                    "provider": self.name,
                    "status": "CONNECTED",
                    "source_type": self.source_type.value,
                    "attribution": self.attribution,
                    "retrieved_at": now.isoformat(),
                    "valid_time": data.get("current", {}).get("time"),
                    "url": str(res.url),
                    "temporal_resolution": "hourly forecast; provider current conditions",
                    "limitations": "Open-Meteo output is FORECAST/current weather data, not radar or an observed rain gauge.",
                    "location": {"latitude": lat, "longitude": lon},
                    "current": data.get("current", {}),
                    "hourly": data.get("hourly", {}),
                    "cached": False,
                }
                self._cache[cache_key] = result
                self._cache_timestamp = now
                return result

        except Exception as e:
            self._mark_error(str(e), ProviderStatus.UNAVAILABLE)
            return {
                "provider": self.name,
                "status": "UNAVAILABLE",
                "error": str(e),
                "source_type": self.source_type.value,
                "data": None
            }
