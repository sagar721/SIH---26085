from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from app.schemas.common import GeoJsonGeometry, DataSourceTypeEnum


class LatLng(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)


class SafeRouteRequest(BaseModel):
    start: LatLng
    destination: LatLng
    simulation_id: Optional[str] = Field(default=None, description="Active simulation ID to evaluate flood hazard")
    time_step_min: Optional[int] = Field(default=60, description="Time step in simulation to route through")
    vehicle_type: Optional[str] = Field(default="emergency", description="Vehicle profile: emergency, car, pedestrian")


class RouteSegment(BaseModel):
    name: str
    length_m: float
    flood_depth_m: float
    hazard_multiplier: float
    is_flooded: bool


class SafeRouteResponse(BaseModel):
    route_found: bool
    status: str
    origin: LatLng
    destination: LatLng
    total_distance_m: float
    estimated_travel_time_s: float
    max_flood_depth_m: float
    hazard_score: float
    impassable_segments_avoided: int
    geometry: GeoJsonGeometry
    segments: List[RouteSegment] = Field(default_factory=list)
    label: str = "DERIVED SAFE ROUTING ESTIMATE"
    data_classification: DataSourceTypeEnum = DataSourceTypeEnum.DERIVED
