from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional


class ProviderStatus(str, Enum):
    CONNECTED = "CONNECTED"
    DELAYED = "DELAYED"
    UNAVAILABLE = "UNAVAILABLE"
    NOT_CONFIGURED = "NOT_CONFIGURED"
    ERROR = "ERROR"


class DataSourceType(str, Enum):
    OBSERVED = "OBSERVED"
    FORECAST = "FORECAST"
    NOWCAST = "NOWCAST"
    SATELLITE_ESTIMATE = "SATELLITE_ESTIMATE"
    STATIC_GIS = "STATIC_GIS"
    DERIVED = "DERIVED"
    SIMULATION = "SIMULATION"
    ASSUMED_FOR_PROTOTYPE = "ASSUMED_FOR_PROTOTYPE"


class BaseDataSource(ABC):
    def __init__(self, name: str, source_type: DataSourceType, attribution: str):
        self.name = name
        self.source_type = source_type
        self.attribution = attribution
        self._last_status: ProviderStatus = ProviderStatus.NOT_CONFIGURED
        self._last_success: Optional[datetime] = None
        self._last_error: Optional[str] = None
        self._last_retrieval_duration_ms: Optional[float] = None
        self._cache: Dict[str, Any] = {}
        self._cache_timestamp: Optional[datetime] = None

    @abstractmethod
    async def health_check(self) -> ProviderStatus:
        """Perform a live check to determine provider availability."""
        pass

    @abstractmethod
    async def fetch(self, **kwargs) -> Dict[str, Any]:
        """Fetch real data from the provider."""
        pass

    def metadata(self) -> Dict[str, Any]:
        """Return provider metadata, status, and caching info."""
        return {
            "name": self.name,
            "source_type": self.source_type.value,
            "status": self._last_status.value,
            "attribution": self.attribution,
            "last_success": self._last_success.isoformat() if self._last_success else None,
            "last_error": self._last_error,
            "last_duration_ms": self._last_retrieval_duration_ms,
            "cached": self._cache_timestamp is not None,
            "cache_timestamp": self._cache_timestamp.isoformat() if self._cache_timestamp else None,
            "url": getattr(self, "base_url", getattr(self, "overpass_url", None)),
            "limitations": "Provider status is process-local until a persistent refresh-log store is configured.",
        }

    def _mark_success(self, duration_ms: float):
        self._last_status = ProviderStatus.CONNECTED
        self._last_success = datetime.now(timezone.utc)
        self._last_error = None
        self._last_retrieval_duration_ms = duration_ms

    def _mark_error(self, error_message: str, status: ProviderStatus = ProviderStatus.ERROR):
        self._last_status = status
        self._last_error = error_message
