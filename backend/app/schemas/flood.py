from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from app.schemas.common import GeoJsonFeatureCollection, DataSourceTypeEnum


class FloodDepthSummary(BaseModel):
    simulation_id: str
    time_step_min: int
    peak_depth_m: float
    flooded_cells_count: int
    total_inundated_area_m2: float
    total_surface_water_volume_m3: float
    data_classification: DataSourceTypeEnum


class FloodRiskResponse(BaseModel):
    simulation_id: str
    time_step_min: int
    risk_level: str = Field(..., description="LOW, MODERATE, HIGH, CRITICAL")
    risk_score: float = Field(..., ge=0.0, le=1.0)
    peak_depth_m: float
    flooded_area_m2: float
    classification_counts: Dict[str, int] = Field(default_factory=dict)
    critical_threshold_exceeded: bool
    data_classification: DataSourceTypeEnum


class AffectedRoadsResponse(BaseModel):
    simulation_id: str
    affected_count: int
    severely_flooded_count: int
    data_classification: DataSourceTypeEnum
    roads: GeoJsonFeatureCollection


class CriticalLocationsResponse(BaseModel):
    simulation_id: str
    exposed_count: int
    hospitals_at_risk: int
    fire_stations_at_risk: int
    data_classification: DataSourceTypeEnum
    locations: GeoJsonFeatureCollection
