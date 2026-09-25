"""Configurable IMD radar nowcast adapter."""

import time
from typing import Any, Dict

import httpx

from app.core.config import settings
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus


class ImdRadarSource(BaseDataSource):
    def __init__(self) -> None:
        super().__init__(
            name="IMD_RADAR",
            source_type=DataSourceType.NOWCAST,
            attribution="India Meteorological Department, Ministry of Earth Sciences",
        )
        self.base_url = settings.IMD_RADAR_URL

    async def health_check(self) -> ProviderStatus:
        if not self.base_url or not settings.IMD_API_KEY:
            self._mark_error("IMD_RADAR_URL and IMD_API_KEY are required", ProviderStatus.NOT_CONFIGURED)
            return ProviderStatus.NOT_CONFIGURED
        try:
            started = time.perf_counter()
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(self.base_url, headers={"Authorization": f"Bearer {settings.IMD_API_KEY}"})
            if response.is_success:
                self._mark_success((time.perf_counter() - started) * 1000)
                return ProviderStatus.CONNECTED
            self._mark_error(f"HTTP {response.status_code}", ProviderStatus.UNAVAILABLE)
        except httpx.HTTPError as exc:
            self._mark_error(str(exc), ProviderStatus.UNAVAILABLE)
        return ProviderStatus.UNAVAILABLE

    async def fetch(self, **kwargs: Any) -> Dict[str, Any]:
        if not self.base_url or not settings.IMD_API_KEY:
            return {"provider": self.name, "status": "NOT_CONFIGURED", "source_type": self.source_type.value, "data": None, "error": "IMD_RADAR_URL and IMD_API_KEY are required"}
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(self.base_url, params=kwargs, headers={"Authorization": f"Bearer {settings.IMD_API_KEY}"})
            if not response.is_success:
                return {"provider": self.name, "status": "UNAVAILABLE", "source_type": self.source_type.value, "data": None, "error": f"HTTP {response.status_code}"}
            self._mark_success(0.0)
            return {"provider": self.name, "status": "CONNECTED", "source_type": self.source_type.value, "data": response.json()}
        except (httpx.HTTPError, ValueError) as exc:
            self._mark_error(str(exc), ProviderStatus.UNAVAILABLE)
            return {"provider": self.name, "status": "UNAVAILABLE", "source_type": self.source_type.value, "data": None, "error": str(exc)}
