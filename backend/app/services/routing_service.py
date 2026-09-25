from typing import Any, Dict, List, Optional
from app.routing.pathfinding import safe_router
from app.services.runtime_store import runtime_store


class RoutingService:
    async def compute_safe_route(
        self,
        start_lat: float,
        start_lon: float,
        dest_lat: float,
        dest_lon: float,
        simulation_id: Optional[str] = None,
        vehicle_type: str = "emergency"
    ) -> Dict[str, Any]:
        sim = None
        if simulation_id:
            sim = runtime_store.get_simulation(simulation_id)
        else:
            sim = runtime_store.get_latest_simulation()

        road_flood_depths = {}
        if sim and "affected_roads" in sim:
            for road in sim["affected_roads"]:
                props = road.get("properties", {})
                road_id = str(props.get("osm_id", ""))
                depth = float(props.get("flood_depth_m", 0.0))
                road_flood_depths[road_id] = depth

        result = safe_router.route(
            start_lat=start_lat,
            start_lon=start_lon,
            dest_lat=dest_lat,
            dest_lon=dest_lon,
            road_flood_depths=road_flood_depths,
            vehicle_type=vehicle_type
        )
        return result


routing_service = RoutingService()
