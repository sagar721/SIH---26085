from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from app.schemas.common import GeoJsonFeatureCollection, DataSourceTypeEnum


class GisLayerResponse(BaseModel):
    layer_name: str
    feature_count: int
    source: str
    source_type: DataSourceTypeEnum
    crs: str = "EPSG:4326"
    projected_crs: str = "EPSG:32643"
    geojson: GeoJsonFeatureCollection
    attribution: str
    limitations: Optional[str] = None
