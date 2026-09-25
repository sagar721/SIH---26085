from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ProviderStatusEnum(str, Enum):
    CONNECTED = "CONNECTED"
    DELAYED = "DELAYED"
    UNAVAILABLE = "UNAVAILABLE"
    NOT_CONFIGURED = "NOT_CONFIGURED"
    ERROR = "ERROR"


class DataSourceTypeEnum(str, Enum):
    OBSERVED = "OBSERVED"
    FORECAST = "FORECAST"
    NOWCAST = "NOWCAST"
    SATELLITE_ESTIMATE = "SATELLITE_ESTIMATE"
    STATIC_GIS = "STATIC_GIS"
    DERIVED = "DERIVED"
    SIMULATION = "SIMULATION"
    ASSUMED_FOR_PROTOTYPE = "ASSUMED_FOR_PROTOTYPE"


class GeoJsonGeometry(BaseModel):
    type: str = Field(..., description="Geometry type: Point, LineString, Polygon, MultiPolygon")
    coordinates: Any = Field(..., description="Coordinate array")


class GeoJsonFeature(BaseModel):
    type: str = Field(default="Feature")
    geometry: GeoJsonGeometry
    properties: Dict[str, Any] = Field(default_factory=dict)


class GeoJsonFeatureCollection(BaseModel):
    type: str = Field(default="FeatureCollection")
    features: List[GeoJsonFeature] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None


class BaseProvenance(BaseModel):
    provider: str
    source_type: DataSourceTypeEnum
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    valid_time: Optional[datetime] = None
    attribution: str
    limitations: Optional[str] = None
