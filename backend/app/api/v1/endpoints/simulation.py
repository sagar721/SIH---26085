from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.auth import get_client_ip, require_roles
from app.core.audit_log import log_auth_event
from app.schemas.simulation import SimulationRequest, SimulationStatusResponse, SimulationSubmitResponse, SimulationTimelineResponse
from app.services.simulation_service import simulation_service

router = APIRouter()


@router.post("/run", response_model=SimulationSubmitResponse, status_code=status.HTTP_202_ACCEPTED, summary="Submit Asynchronous Simulation Job")
async def run_simulation(
    request: SimulationRequest,
    http_request: Request,
    _user: Dict[str, Any] = Depends(require_roles("admin", "operator")),
) -> SimulationSubmitResponse:
    try:
        job = await simulation_service.submit(
            horizon_minutes=request.horizon_minutes,
            timestep_minutes=request.timestep_minutes,
            mode=request.mode,
            scenario_rainfall_mm_hr=request.scenario_rainfall_mm_hr,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    log_auth_event(
        "SIMULATION_TRIGGERED",
        username=_user.get("sub"),
        role=_user.get("role"),
        simulation_id=job["simulation_id"],
        detail=f"mode={job.get('mode')}",
        ip_address=get_client_ip(http_request),
    )
    return {
        "simulation_id": job["simulation_id"],
        "status": job["status"],
        "created_at": job["created_at"],
        "horizon_minutes": job["horizon_minutes"],
        "timestep_minutes": job["timestep_minutes"],
        "result_type": "DERIVED",
    }


@router.get("/{simulation_id}/status", response_model=SimulationStatusResponse, summary="Simulation Job Status")
async def simulation_status(simulation_id: str) -> SimulationStatusResponse:
    record = simulation_service.get(simulation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return {
        "id": simulation_id,
        "simulation_id": simulation_id,
        "status": record.get("status"),
        "created_at": record.get("created_at"),
        "started_at": record.get("started_at"),
        "finished_at": record.get("finished_at"),
        "peak_flood_depth_m": record.get("peak_flood_depth_m"),
        "error": record.get("error"),
        "provenance": record.get("provenance"),
        "result_type": "DERIVED",
    }


@router.get("/{simulation_id}/timeline", response_model=SimulationTimelineResponse, summary="3D-Ready Simulation Timeline")
async def simulation_timeline(simulation_id: str) -> SimulationTimelineResponse:
    """
    Returns time-indexed spatial steps for 3D CesiumJS rendering.
    Each timestep includes flood water depth polygon extrusions, affected road segments,
    and exposed critical infrastructure.
    """
    record = simulation_service.get(simulation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if record["status"] != "COMPLETED":
        raise HTTPException(status_code=409, detail={"status": record["status"], "error": record["error"]})

    grid_features = record.get("grid_cells", [])
    affected_roads = record.get("affected_roads", {}).get("features", [])
    critical_locs = record.get("critical_locations", {}).get("features", [])

    # Format 3D-ready timestep snapshots for CesiumJS timeline animation
    cesium_timesteps = []
    for step in record.get("timeline", []):
        t_min = step["timestep_minutes"]
        scale = min(1.0, (t_min + 15) / max(1, record["horizon_minutes"]))

        # Time-scaled flood polygons with extruded height for 3D water visualization
        step_flood_features = []
        for feat in grid_features:
            depth = feat["properties"]["depth_m"] * scale
            elev = feat["properties"]["elevation_m"]
            step_flood_features.append({
                "type": "Feature",
                "geometry": feat["geometry"],
                "properties": {
                    "cell_id": feat["properties"]["cell_id"],
                    "water_depth_m": round(depth, 3),
                    "surface_elevation_m": round(elev + depth, 2),
                    "extruded_height_m": round(depth, 2),
                    "risk_level": feat["properties"]["risk_level"],
                },
            })

        cesium_timesteps.append({
            "timestep_minutes": t_min,
            "timestamp": step["timestamp"],
            "rainfall_mm_hr": step["rainfall_mm_hr"],
            "max_depth_m": round(step["max_depth_m"] * scale, 3),
            "risk_level": step["risk_level"],
            "flood_features": step_flood_features,
            "water_polygons": step_flood_features,
            "affected_roads_count": len(affected_roads),
            "critical_locations_count": len(critical_locs),
        })

    return {
        "simulation_id": simulation_id,
        "format": "CESIUM_3D_COMPLIANT",
        "horizon_minutes": record["horizon_minutes"],
        "timestep_minutes": record["timestep_minutes"],
        "result_type": "DERIVED",
        "timesteps": cesium_timesteps,
        "steps": cesium_timesteps,
    }
