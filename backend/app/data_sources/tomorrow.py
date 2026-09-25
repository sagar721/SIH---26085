from typing import Any, Dict
from app.core.config import settings
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus


class TomorrowIOSource(BaseDataSource):
    def __init__(self):
        super().__init__(
            name="Tomorrow.io",
            source_type=DataSourceType.NOWCAST,
            attribution="Tomorrow.io Weather API"
        )

    async def health_check(self) -> ProviderStatus:
        if not settings.TOMORROW_API_KEY:
            self._last_status = ProviderStatus.NOT_CONFIGURED
            self._last_error = "TOMORROW_API_KEY is not configured in environment"
            return ProviderStatus.NOT_CONFIGURED
        return ProviderStatus.UNAVAILABLE

    async def fetch(self, **kwargs) -> Dict[str, Any]:
        if not settings.TOMORROW_API_KEY:
            return {
                "provider": self.name,
                "status": "NOT_CONFIGURED",
                "error": "TOMORROW_API_KEY is not configured",
                "source_type": self.source_type.value,
                "data": None
            }
        return {
            "provider": self.name,
            "status": "UNAVAILABLE",
            "error": "Service call not completed",
            "source_type": self.source_type.value,
            "data": None
        }
