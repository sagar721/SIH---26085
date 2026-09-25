import time
from typing import Any, Dict, List, Optional
import httpx

from app.core.config import settings
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus


class BmcGisSource(BaseDataSource):
    def __init__(self):
        super().__init__(
            name="BMC_GIS",
            source_type=DataSourceType.STATIC_GIS,
            attribution="Brihanmumbai Municipal Corporation (BMC/MCGM) GIS Portal"
        )
        self.base_url = settings.BMC_GIS_URL

    async def health_check(self) -> ProviderStatus:
        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(f"{self.base_url}?f=pjson")
                duration_ms = (time.perf_counter() - start) * 1000
                if res.status_code == 200 and "layers" in res.text:
                    self._mark_success(duration_ms)
                    return ProviderStatus.CONNECTED
                else:
                    self._mark_error(f"HTTP {res.status_code}", ProviderStatus.UNAVAILABLE)
                    return ProviderStatus.UNAVAILABLE
        except Exception as e:
            self._mark_error(str(e), ProviderStatus.UNAVAILABLE)
            return ProviderStatus.UNAVAILABLE

    async def fetch_layers_metadata(self) -> Dict[str, Any]:
        """Fetch all layer definitions from the BMC MapServer."""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.get(f"{self.base_url}?f=pjson")
                if res.status_code == 200:
                    return res.json()
        except Exception as e:
            self._mark_error(str(e), ProviderStatus.UNAVAILABLE)
        return {}

    async def query_layer(
        self,
        layer_id: int,
        bbox: Dict[str, float],
        out_fields: str = "*",
        where: str = "1=1"
    ) -> Dict[str, Any]:
        """
        Query an ArcGIS layer by geographic bounding box and return GeoJSON.
        """
        query_url = f"{self.base_url}/{layer_id}/query"
        # Bounding box in minx, miny, maxx, maxy (lon, lat)
        geometry = f"{bbox['min_lon']},{bbox['min_lat']},{bbox['max_lon']},{bbox['max_lat']}"
        params = {
            "where": where,
            "geometry": geometry,
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "inSR": "4326",
            "outSR": "4326",
            "outFields": out_fields,
            "f": "geojson",
            "returnGeometry": "true"
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(query_url, params=params)
                if res.status_code == 200:
                    self._mark_success(0.0)
                    return {"status": "CONNECTED", "data": res.json()}
                self._mark_error(f"HTTP {res.status_code}", ProviderStatus.UNAVAILABLE)
                return {"status": "UNAVAILABLE", "error": f"HTTP {res.status_code}", "data": None}
        except Exception as e:
            self._mark_error(str(e), ProviderStatus.UNAVAILABLE)
            return {"status": "UNAVAILABLE", "error": str(e), "data": None}

    async def fetch(self, **kwargs) -> Dict[str, Any]:
        status = await self.health_check()
        return {
            "provider": self.name,
            "status": status.value,
            "source_type": self.source_type.value,
            "attribution": self.attribution,
            "data": None
        }
