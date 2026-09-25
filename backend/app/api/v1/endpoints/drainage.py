from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.services.drainage_service import drainage_service

router = APIRouter()


@router.get("", summary="Drainage Network", description="Returns source attributes only; no capacity is invented.")
async def get_drainage() -> Dict[str, Any]:
    return drainage_service.get_drainage_network()


@router.get("/utilization", summary="Drainage Network Utilization", description="Requires an explicitly supplied rainfall intensity and source hydraulic attributes.")
async def get_drainage_utilization(
    rainfall_mm_hr: float = Query(..., ge=0.0, description="Traceable rainfall intensity in mm/hr"),
    runoff_coefficient: Optional[float] = Query(default=None, ge=0.0, le=1.0, description="Explicit scenario/model coefficient")
) -> Dict[str, Any]:
    return drainage_service.calculate_network_utilization(rainfall_mm_hr=rainfall_mm_hr, runoff_coefficient=runoff_coefficient)


@router.get("/overloaded", summary="Overloaded Drainage Segments", description="Requires an explicitly supplied rainfall intensity and source hydraulic attributes.")
async def get_overloaded_drains(
    rainfall_mm_hr: float = Query(..., ge=0.0, description="Traceable rainfall intensity in mm/hr"),
    runoff_coefficient: Optional[float] = Query(default=None, ge=0.0, le=1.0)
) -> Dict[str, Any]:
    res = drainage_service.calculate_network_utilization(rainfall_mm_hr=rainfall_mm_hr, runoff_coefficient=runoff_coefficient)
    segments = res.get("segments", [])
    overloaded = [item for item in segments if item.get("status") in {"OVERLOADED", "CRITICAL"}]
    return {
        "status": res.get("status", "UNAVAILABLE"),
        "rainfall_mm_hr": rainfall_mm_hr,
        "result_type": "DERIVED",
        "overloaded_count": len(overloaded),
        "overloaded_segments": overloaded,
        "error": res.get("error"),
    }


@router.get("/{drain_id}", summary="Drain Details by ID", description="Returns attributes and capacity for an individual drainage segment.")
async def get_drain_detail(drain_id: str) -> Dict[str, Any]:
    drain = drainage_service.get_drain_by_id(drain_id)
    if not drain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Drain with ID '{drain_id}' not found."
        )
    return drain
