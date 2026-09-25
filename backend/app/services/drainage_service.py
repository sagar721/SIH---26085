"""Drainage access that preserves source attributes and never invents hydraulics."""
from typing import Any, Dict, Optional

from app.services.gis_service import gis_service
from app.simulation.overflow import calculate_drainage_overflow
from app.simulation.runoff import calculate_rational_runoff


CAPACITY_FIELDS = ("capacity_m3s", "capacity", "design_capacity_m3s")
CATCHMENT_FIELDS = ("catchment_area_ha", "catchment_hectares")
COEFFICIENT_FIELDS = ("runoff_coefficient", "rational_coefficient")


def _numeric(props: Dict[str, Any], fields: tuple[str, ...]) -> Optional[float]:
    for field in fields:
        value = props.get(field)
        if value is not None:
            try:
                parsed = float(value)
                if parsed >= 0:
                    return parsed
            except (TypeError, ValueError):
                continue
    return None


class DrainageService:
    def __init__(self) -> None:
        self._drains_cache: Dict[str, Dict[str, Any]] = {}

    def get_drainage_network(self) -> Dict[str, Any]:
        source = gis_service.get_drains()
        if source.get("status") != "AVAILABLE":
            return source
        output = []
        self._drains_cache = {}
        for index, feature in enumerate(source.get("features", [])):
            props = dict(feature.get("properties") or {})
            drain_id = str(props.get("OBJECTID") or props.get("id") or feature.get("id") or index)
            capacity = _numeric(props, CAPACITY_FIELDS)
            props.update({
                "drain_id": drain_id,
                "capacity_m3s": capacity,
                "capacity_type": "SOURCE_ATTRIBUTE" if capacity is not None else "UNAVAILABLE",
            })
            item = {"type": "Feature", "id": drain_id, "properties": props, "geometry": feature.get("geometry")}
            output.append(item)
            self._drains_cache[drain_id] = item
        return {
            "status": "AVAILABLE",
            "type": "FeatureCollection",
            "crs": source.get("crs"),
            "features": output,
            "metadata": {**source.get("metadata", {}), "capacity_note": "Only source-supplied capacity attributes are returned."},
        }

    def get_drain_by_id(self, drain_id: str) -> Optional[Dict[str, Any]]:
        if not self._drains_cache:
            self.get_drainage_network()
        return self._drains_cache.get(drain_id)

    def calculate_network_utilization(
        self, rainfall_mm_hr: float, runoff_coefficient: Optional[float] = None
    ) -> Dict[str, Any]:
        network = self.get_drainage_network()
        if network.get("status") != "AVAILABLE":
            return {"status": network.get("status", "UNAVAILABLE"), "error": network.get("error"), "segments": []}
        results = []
        unavailable = 0
        for feature in network["features"]:
            props = feature["properties"]
            capacity = props["capacity_m3s"]
            area = _numeric(props, CATCHMENT_FIELDS)
            coefficient = runoff_coefficient if runoff_coefficient is not None else _numeric(props, COEFFICIENT_FIELDS)
            if capacity is None or area is None or coefficient is None:
                unavailable += 1
                continue
            runoff = calculate_rational_runoff(rainfall_mm_hr, area, coefficient)
            result = calculate_drainage_overflow(runoff["runoff_m3s"], capacity)
            results.append({"drain_id": props["drain_id"], **result, "result_type": "DERIVED", "capacity_type": "SOURCE_ATTRIBUTE"})
        return {
            "status": "AVAILABLE" if results else "UNAVAILABLE",
            "rainfall_mm_hr": rainfall_mm_hr,
            "segments": results,
            "unavailable_segments": unavailable,
            "limitations": "Utilization is calculated only where source capacity, catchment area, and a coefficient are supplied.",
            "result_type": "DERIVED" if results else None,
        }


drainage_service = DrainageService()
