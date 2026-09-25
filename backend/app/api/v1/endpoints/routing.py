from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.routing.pathfinding import safe_router
from app.services.simulation_service import simulation_service

router = APIRouter()


class Coordinate(BaseModel):
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")


class RouteRequest(BaseModel):
    start: Coordinate
    destination: Coordinate
    simulation_id: Optional[str] = Field(
        default=None,
        description="Optional simulation ID to incorporate derived road water depths. Pass 'baseline' for dry baseline routing.",
    )


@router.post(
    "/safe-route",
    summary="Compute Safe Flood-Aware Route",
    description="Calculates shortest viable route between start and destination, dynamically penalizing or severing flooded segments.",
)
async def safe_route(request: RouteRequest) -> Dict[str, Any]:
    flooded_segments = {}

    if request.simulation_id and request.simulation_id.lower() != "baseline":
        simulation = simulation_service.get(request.simulation_id)
        if simulation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Simulation '{request.simulation_id}' not found",
            )
        if simulation.get("status") != "COMPLETED":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "status": simulation.get("status"),
                    "error": simulation.get("error", "Simulation has not completed successfully"),
                },
            )
        # Extract any road depths recorded by the completed simulation
        flooded_segments = simulation.get("flooded_roads", {})

    result = safe_router.compute_safe_route(
        start_lon=request.start.lon,
        start_lat=request.start.lat,
        dest_lon=request.destination.lon,
        dest_lat=request.destination.lat,
        flooded_segments=flooded_segments,
    )

    if result.get("status") == "IMPASSABLE":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result,
        )

    return result


@router.get(
    "/network-status",
    summary="Road Network Graph Status",
    description="Returns topological graph size, edge count, and routing engine readiness.",
)
async def network_status() -> Dict[str, Any]:
    graph = safe_router._ensure_graph()
    return {
        "status": "AVAILABLE" if graph.number_of_nodes() > 0 else "UNAVAILABLE",
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "crs": "EPSG:32643 (UTM Zone 43N projected metric)",
        "source_type": "DERIVED",
    }
