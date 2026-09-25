import asyncio
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

from app.core.logging import get_logger
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus

logger = get_logger("osm")


class OsmSource(BaseDataSource):
    def __init__(self):
        super().__init__(
            name="OpenStreetMap",
            source_type=DataSourceType.STATIC_GIS,
            attribution="OpenStreetMap contributors (ODbL)"
        )
        self.overpass_url = "https://overpass-api.de/api/interpreter"

    @staticmethod
    def _validate_bbox(bbox: Dict[str, Any]) -> Tuple[float, float, float, float]:
        """Validate and sanitize bounding box bounds."""
        try:
            min_lat = float(bbox["min_lat"])
            min_lon = float(bbox["min_lon"])
            max_lat = float(bbox["max_lat"])
            max_lon = float(bbox["max_lon"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Invalid bounding box structure: {exc}")

        if not (-90 <= min_lat <= max_lat <= 90 and -180 <= min_lon <= max_lon <= 180):
            raise ValueError(f"Bounding box coordinates out of valid range: {bbox}")

        return min_lat, min_lon, max_lat, max_lon

    async def _post_overpass_with_retry(self, query: str, max_retries: int = 2) -> Optional[Dict[str, Any]]:
        """Executes Overpass API query with exponential backoff for transient failures."""
        headers = {"User-Agent": "M-FLOOD-Nowcaster/0.1 (Research & Emergency Prototype)"}
        delay = 1.0

        for attempt in range(max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
                    res = await client.post(self.overpass_url, data={"data": query})
                    if res.status_code == 200:
                        return res.json()
                    elif res.status_code in (429, 502, 503, 504) and attempt < max_retries:
                        logger.warning(f"Overpass HTTP {res.status_code}, retrying in {delay}s...")
                        await asyncio.sleep(delay)
                        delay *= 2
                    else:
                        logger.error(f"Overpass API returned status {res.status_code}: {res.text[:100]}")
                        self._mark_error(f"HTTP {res.status_code}", ProviderStatus.UNAVAILABLE)
                        return None
            except httpx.RequestError as exc:
                if attempt < max_retries:
                    logger.warning(f"Overpass connection error: {exc}, retrying in {delay}s...")
                    await asyncio.sleep(delay)
                    delay *= 2
                else:
                    logger.error(f"Overpass API unreachable after {max_retries + 1} attempts: {exc}")
                    self._mark_error(str(exc), ProviderStatus.UNAVAILABLE)
                    return None
        return None

    async def health_check(self) -> ProviderStatus:
        start = time.perf_counter()
        headers = {"User-Agent": "M-FLOOD-Nowcaster/0.1 (Research & Emergency Prototype)"}
        try:
            async with httpx.AsyncClient(timeout=8.0, headers=headers) as client:
                res = await client.get("https://overpass-api.de/api/status")
                duration_ms = (time.perf_counter() - start) * 1000
                if res.status_code == 200:
                    self._mark_success(duration_ms)
                    return ProviderStatus.CONNECTED
                else:
                    self._mark_error(f"HTTP {res.status_code}", ProviderStatus.UNAVAILABLE)
                    return ProviderStatus.UNAVAILABLE
        except Exception as e:
            self._mark_error(str(e), ProviderStatus.UNAVAILABLE)
            return ProviderStatus.UNAVAILABLE

    async def fetch_roads(self, bbox: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Query Overpass API for road geometries with bounds validation."""
        try:
            min_lat, min_lon, max_lat, max_lon = self._validate_bbox(bbox)
        except ValueError as err:
            logger.error(f"Cannot fetch roads: {err}")
            return []

        # Overpass bbox order: south, west, north, east
        query = f"""
        [out:json][timeout:25];
        (
          way["highway"]({min_lat},{min_lon},{max_lat},{max_lon});
        );
        out body geom;
        """
        data = await self._post_overpass_with_retry(query)
        if data:
            return data.get("elements", [])
        return []

    async def fetch_waterways(self, bbox: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Query Overpass API for waterways (e.g. Mithi River) with bounds validation."""
        try:
            min_lat, min_lon, max_lat, max_lon = self._validate_bbox(bbox)
        except ValueError as err:
            logger.error(f"Cannot fetch waterways: {err}")
            return []

        query = f"""
        [out:json][timeout:25];
        (
          way["waterway"]({min_lat},{min_lon},{max_lat},{max_lon});
          relation["waterway"]({min_lat},{min_lon},{max_lat},{max_lon});
        );
        out body geom;
        """
        data = await self._post_overpass_with_retry(query)
        if data:
            return data.get("elements", [])
        return []

    async def fetch(self, **kwargs) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "status": self._last_status.value,
            "source_type": self.source_type.value,
            "attribution": self.attribution,
            "url": self.overpass_url,
            "limitations": "Live OSM queries via Overpass API are subject to public rate limits and server availability.",
            "data": None
        }
