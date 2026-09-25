from typing import Any, Dict, List, Optional
from app.services.runtime_store import runtime_store
from app.schemas.common import DataSourceTypeEnum


class FloodService:
    async def get_flood_depth_geojson(self, sim_id: Optional[str] = None) -> Dict[str, Any]:
        sim = self._get_simulation(sim_id)
        if not sim:
            return {"type": "FeatureCollection", "features": [], "metadata": {"status": "NO_SIMULATION_AVAILABLE"}}
        polygons = sim.get("water_polygons", [])
        return {
            "type": "FeatureCollection",
            "features": polygons,
            "metadata": {
                "simulation_id": sim.get("id"),
                "scenario": sim.get("scenario"),
                "peak_depth_m": sim.get("max_depth_m", 0.0),
                "flooded_cells_count": len(polygons),
                "data_classification": DataSourceTypeEnum.DERIVED.value
            }
        }

    async def get_flood_risk_summary(self, sim_id: Optional[str] = None) -> Dict[str, Any]:
        sim = self._get_simulation(sim_id)
        if not sim:
            return {
                "status": "NO_SIMULATION_AVAILABLE",
                "risk_level": "LOW",
                "risk_score": 0.0,
                "peak_depth_m": 0.0,
                "data_classification": DataSourceTypeEnum.DERIVED.value
            }
        risk_summary = sim.get("risk_summary", {})
        return {
            "simulation_id": sim.get("id"),
            "status": sim.get("status"),
            "risk_level": risk_summary.get("risk_level", "MODERATE"),
            "risk_score": risk_summary.get("risk_score", 0.4),
            "peak_depth_m": sim.get("max_depth_m", 0.0),
            "critical_threshold_exceeded": sim.get("max_depth_m", 0.0) >= 0.30,
            "data_classification": DataSourceTypeEnum.DERIVED.value
        }

    async def get_affected_roads(self, sim_id: Optional[str] = None) -> Dict[str, Any]:
        sim = self._get_simulation(sim_id)
        if not sim:
            return {"type": "FeatureCollection", "features": [], "metadata": {"affected_count": 0}}
        roads = sim.get("affected_roads", [])
        return {
            "type": "FeatureCollection",
            "features": roads,
            "metadata": {
                "simulation_id": sim.get("id"),
                "affected_count": len(roads),
                "data_classification": DataSourceTypeEnum.DERIVED.value,
                "label": "DERIVED FLOOD-IMPACT ESTIMATE"
            }
        }

    async def get_critical_locations(self, sim_id: Optional[str] = None) -> Dict[str, Any]:
        sim = self._get_simulation(sim_id)
        if not sim:
            return {"type": "FeatureCollection", "features": [], "metadata": {"exposed_count": 0}}
        locations = sim.get("critical_locations", [])
        return {
            "type": "FeatureCollection",
            "features": locations,
            "metadata": {
                "simulation_id": sim.get("id"),
                "exposed_count": len(locations),
                "data_classification": DataSourceTypeEnum.DERIVED.value
            }
        }

    def _get_simulation(self, sim_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        if sim_id:
            return runtime_store.get_simulation(sim_id)
        return runtime_store.get_latest_simulation()


flood_service = FloodService()
