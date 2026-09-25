from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from app.schemas.common import DataSourceTypeEnum, ProviderStatusEnum


class WeatherCurrentResponse(BaseModel):
    provider: str
    source_type: DataSourceTypeEnum
    status: ProviderStatusEnum
    retrieved_at: datetime
    location: Dict[str, float] = Field(..., description="Latitude and longitude coordinates")
    temperature_c: Optional[float] = None
    relative_humidity_pct: Optional[float] = None
    precipitation_mm: Optional[float] = None
    wind_speed_kmh: Optional[float] = None
    weather_code: Optional[int] = None
    attribution: str
    limitations: Optional[str] = None


class WeatherForecastStep(BaseModel):
    time: str
    precipitation_mm: float
    rain_probability_pct: Optional[float] = None
    temperature_c: Optional[float] = None


class WeatherForecastResponse(BaseModel):
    provider: str
    source_type: DataSourceTypeEnum
    status: ProviderStatusEnum
    retrieved_at: datetime
    location: Dict[str, float]
    forecast_steps: List[WeatherForecastStep] = Field(default_factory=list)
    attribution: str
    limitations: Optional[str] = None
