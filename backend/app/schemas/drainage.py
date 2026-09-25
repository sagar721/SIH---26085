from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from app.schemas.common import GeoJsonFeatureCollection, DataSourceTypeEnum


class DrainageSection(BaseModel):
    drain_id: str
    corridor: str
    capacity_m3_s: float
    current_runoff_m3_s: float
    utilization_pct: float
    overflow_m3_s: float
    is_overloaded: bool
    status_label: DataSourceTypeEnum


class DrainageUtilizationResponse(BaseModel):
    corridor: str
    total_sections: int
    overloaded_sections: int
    avg_utilization_pct: float
    max_utilization_pct: float
    critical_drain_ids: List[str] = Field(default_factory=list)
    sections: List[DrainageSection] = Field(default_factory=list)
    limitations: str
