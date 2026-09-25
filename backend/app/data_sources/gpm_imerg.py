from typing import Any, Dict
from app.core.config import settings
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus


class NasaGpmSource(BaseDataSource):
    def __init__(self):
        super().__init__(
            name="NASA_GPM_IMERG",
            source_type=DataSourceType.SATELLITE_ESTIMATE,
            attribution="NASA Global Precipitation Measurement (GPM) Mission"
        )

    async def health_check(self) -> ProviderStatus:
        if not settings.EARTHDATA_TOKEN:
            self._last_status = ProviderStatus.NOT_CONFIGURED
            self._last_error = "EARTHDATA_TOKEN is not configured in environment"
            return ProviderStatus.NOT_CONFIGURED
        return ProviderStatus.UNAVAILABLE

    async def fetch(self, **kwargs) -> Dict[str, Any]:
        if not settings.EARTHDATA_TOKEN:
            return {
                "provider": self.name,
                "status": "NOT_CONFIGURED",
                "error": "EARTHDATA_TOKEN is not configured",
                "source_type": self.source_type.value,
                "data": None
            }
        return {
            "provider": self.name,
            "status": "UNAVAILABLE",
            "error": "NASA EarthData service token not validated",
            "source_type": self.source_type.value,
            "data": None
        }
