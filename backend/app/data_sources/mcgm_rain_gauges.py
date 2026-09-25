"""MCGM ward rain-gauge adapter with transparent unavailable states."""

import time
from typing import Any, Dict

import httpx

from app.core.config import settings
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus


class McgmRainGaugeSource(BaseDataSource):
    def __init__(self) -> None:
        super().__init__(
            name="MCGM_WARD_RAIN_GAUGES",
            source_type=DataSourceType.OBSERVED,
            attribution="Municipal Corporation of Greater Mumbai",
        )
        self.base_url = settings.MCGM_RAIN_GAUGE_URL

    async def health_check(self) -> ProviderStatus:
        if not self.base_url:
            self._mark_error("MCGM_RAIN_GAUGE_URL is not configured", ProviderStatus.NOT_CONFIGURED)
            return ProviderStatus.NOT_CONFIGURED
        try:
            start = time.perf_counter()
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(self.base_url)
            if response.is_success:
                self._mark_success((time.perf_counter() - start) * 1000)
                return ProviderStatus.CONNECTED
            self._mark_error(f"HTTP {response.status_code}", ProviderStatus.UNAVAILABLE)
        except httpx.HTTPError as exc:
            self._mark_error(str(exc), ProviderStatus.UNAVAILABLE)
        return ProviderStatus.UNAVAILABLE

    async def fetch(self, **kwargs: Any) -> Dict[str, Any]:
        if not self.base_url:
            return {"provider": self.name, "status": "NOT_CONFIGURED", "data": None, "error": "MCGM_RAIN_GAUGE_URL is not configured"}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(self.base_url, params=kwargs)
            if not response.is_success:
                return {"provider": self.name, "status": "UNAVAILABLE", "data": None, "error": f"HTTP {response.status_code}"}
            self._mark_success(0.0)
            return {"provider": self.name, "status": "CONNECTED", "source_type": self.source_type.value, "data": response.json()}
        except (httpx.HTTPError, ValueError) as exc:
            self._mark_error(str(exc), ProviderStatus.UNAVAILABLE)
            return {"provider": self.name, "status": "UNAVAILABLE", "data": None, "error": str(exc)}
