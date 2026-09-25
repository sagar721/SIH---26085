from typing import Any, Dict, Optional
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus


class DemSource(BaseDataSource):
    def __init__(self):
        super().__init__(
            name="Copernicus_DEM_GLO30",
            source_type=DataSourceType.STATIC_GIS,
            attribution="Copernicus DEM GLO-30 Public Open Access (ESA/Airbus). Note: This is a 30m Digital Surface Model (DSM), not a bare-earth DTM."
        )
        self.is_dsm = True
        self.resolution_m = 30.0

    async def health_check(self) -> ProviderStatus:
        self._last_status = ProviderStatus.CONNECTED
        return ProviderStatus.CONNECTED

    async def fetch(self, **kwargs) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "status": self._last_status.value,
            "source_type": self.source_type.value,
            "resolution_m": self.resolution_m,
            "surface_model_type": "DSM (Digital Surface Model)",
            "limitations": "DSM includes tree canopies and building heights; not certified bare-earth DTM.",
            "attribution": self.attribution,
        }
