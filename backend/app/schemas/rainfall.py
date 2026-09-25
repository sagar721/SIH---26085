from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from app.schemas.common import DataSourceTypeEnum, ProviderStatusEnum


class RainfallObservation(BaseModel):
    station_id: Optional[str] = None
    station_name: str
    latitude: float
    longitude: float
    rainfall_1h_mm: float
    rainfall_24h_mm: Optional[float] = None
    source_type: DataSourceTypeEnum
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RainfallForecastStep(BaseModel):
    timestamp: str
    intensity_mm_per_hr: float
    cumulative_mm: float


class RainfallResponse(BaseModel):
    provider: str
    status: ProviderStatusEnum
    source_type: DataSourceTypeEnum
    corridor: str
    current_intensity_mm_per_hr: float
    forecast_timeline: List[RainfallForecastStep] = Field(default_factory=list)
    scenario_active: bool = False
    scenario_name: Optional[str] = None
    attribution: str
