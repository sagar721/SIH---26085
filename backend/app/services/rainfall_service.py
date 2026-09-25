from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from app.services.weather_service import weather_service
from app.schemas.common import DataSourceTypeEnum, ProviderStatusEnum


class RainfallService:
    def __init__(self):
        self.corridor_name = "Mithi River / Kurla / Saki Naka Corridor"

    async def get_current_rainfall(self, lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
        weather_res = await weather_service.get_current(lat=lat, lon=lon)
        if weather_res.get("status") != "ok":
            return {
                "status": weather_res.get("status", "UNAVAILABLE"),
                "provider": weather_res.get("provider", "Open-Meteo"),
                "source_type": DataSourceTypeEnum.FORECAST.value,
                "error": weather_res.get("error"),
                "corridor": self.corridor_name,
                "current_intensity_mm_per_hr": 0.0,
                "precipitation_mm": 0.0,
                "data": None
            }

        current = weather_res.get("current", {})
        precip = float(current.get("precipitation_mm", 0.0) or 0.0)

        return {
            "status": "ok",
            "provider": weather_res.get("provider"),
            "source_type": DataSourceTypeEnum.FORECAST.value,
            "corridor": self.corridor_name,
            "location": weather_res.get("location"),
            "retrieved_at": weather_res.get("retrieved_at"),
            "current_intensity_mm_per_hr": precip,
            "weather_description": current.get("weather_code_desc", "Clear/Overcast"),
            "attribution": weather_res.get("attribution"),
        }

    async def get_forecast_rainfall(self, lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
        forecast_res = await weather_service.get_forecast(lat=lat, lon=lon)
        if forecast_res.get("status") != "ok":
            return {
                "status": forecast_res.get("status", "UNAVAILABLE"),
                "provider": forecast_res.get("provider", "Open-Meteo"),
                "source_type": DataSourceTypeEnum.FORECAST.value,
                "error": forecast_res.get("error"),
                "corridor": self.corridor_name,
                "forecast_steps": [],
            }

        hourly = forecast_res.get("hourly_forecast", {})
        times = hourly.get("time", [])
        precip = hourly.get("precipitation_mm", [])

        steps = []
        cumulative = 0.0
        for t, p in zip(times[:24], precip[:24]):
            val = float(p or 0.0)
            cumulative += val
            steps.append({
                "timestamp": str(t),
                "intensity_mm_per_hr": val,
                "cumulative_mm": round(cumulative, 2)
            })

        return {
            "status": "ok",
            "provider": forecast_res.get("provider"),
            "source_type": DataSourceTypeEnum.FORECAST.value,
            "corridor": self.corridor_name,
            "total_24h_projected_mm": round(cumulative, 2),
            "peak_intensity_mm_per_hr": max([s["intensity_mm_per_hr"] for s in steps]) if steps else 0.0,
            "forecast_steps": steps,
            "attribution": forecast_res.get("attribution")
        }


rainfall_service = RainfallService()
