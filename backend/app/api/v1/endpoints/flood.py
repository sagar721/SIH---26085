from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Query, status

from app.services.simulation_service import simulation_service
from app.simulation.risk import classify_flood_risk

router = APIRouter()


def get_completed_simulation(simulation_id: str) -> Dict[str, Any]:
    record = simulation_service.get(simulation_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Simulation '{simulation_id}' not found",
        )
    if record.get("status") != "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "status": record.get("status"),
                "error": record.get("error", "Simulation has not completed successfully"),
            },
        )
    return record


@router.get(
    "/depth",
    summary="Derived Flood Water Depth",
    description="Returns GeoJSON FeatureCollection of inundated terrain grid cells with simulated water depths.",
)
async def flood_depth(simulation_id: str = Query(..., description="Completed simulation UUID")) -> Dict[str, Any]:
    record = get_completed_simulation(simulation_id)
    return {
        "simulation_id": simulation_id,
        "type": "FeatureCollection",
        "features": record.get("grid_cells", []),
        "result_type": "DERIVED",
        "peak_flood_depth_m": record.get("peak_flood_depth_m", 0.0),
        "timeline": record.get("timeline", []),
    }


@router.get(
    "/risk",
    summary="Flood Risk Assessment Summary",
    description="Returns classified risk levels, peak water depths, and risk distribution across the study area.",
)
async def flood_risk(simulation_id: str = Query(..., description="Completed simulation UUID")) -> Dict[str, Any]:
    record = get_completed_simulation(simulation_id)
    peak_depth = record.get("peak_flood_depth_m", 0.0)
    risk_info = classify_flood_risk(peak_depth)
    grid_cells = record.get("grid_cells", [])

    risk_counts = {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0}
    for cell in grid_cells:
        level = cell.get("properties", {}).get("risk_level", "LOW")
        if level in risk_counts:
            risk_counts[level] += 1

    return {
        "simulation_id": simulation_id,
        "status": "AVAILABLE",
        "result_type": "DERIVED",
        "overall_risk_level": risk_info["risk_level"],
        "peak_flood_depth_m": peak_depth,
        "inundated_cells_count": len(grid_cells),
        "risk_breakdown": risk_counts,
        "affected_roads_count": len(record.get("affected_roads", {}).get("features", [])),
        "critical_facilities_exposed": len(record.get("critical_locations", {}).get("features", [])),
        "timeline": record.get("timeline", []),
    }


@router.get(
    "/affected-roads",
    summary="Inundated Road Network Segments",
    description="Returns road network segments intersecting derived flood water depths. Classified as DERIVED FLOOD-IMPACT ESTIMATE.",
)
async def affected_roads(simulation_id: str = Query(..., description="Completed simulation UUID")) -> Dict[str, Any]:
    record = get_completed_simulation(simulation_id)
    affected = record.get("affected_roads", {"type": "FeatureCollection", "features": []})
    return {
        "simulation_id": simulation_id,
        "type": "FeatureCollection",
        "features": affected.get("features", []),
        "result_type": "DERIVED",
        "label": "DERIVED FLOOD-IMPACT ESTIMATE",
        "count": len(affected.get("features", [])),
    }


@router.get(
    "/critical-locations",
    summary="Exposed Critical Infrastructure",
    description="Returns hospitals, police stations, and emergency facilities within derived flood hazard zones.",
)
async def critical_locations(simulation_id: str = Query(..., description="Completed simulation UUID")) -> Dict[str, Any]:
    record = get_completed_simulation(simulation_id)
    crit = record.get("critical_locations", {"type": "FeatureCollection", "features": []})
    return {
        "simulation_id": simulation_id,
        "type": "FeatureCollection",
        "features": crit.get("features", []),
        "result_type": "DERIVED",
        "count": len(crit.get("features", [])),
    }
