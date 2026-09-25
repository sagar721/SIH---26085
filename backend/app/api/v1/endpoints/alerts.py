from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException, Query, status

from app.services.alert_service import alert_service

router = APIRouter()


@router.get(
    "",
    summary="Active Operational Alerts",
    description="Returns active derived flood alerts. Labeled: 'System-generated derived flood-risk alert'.",
)
async def get_alerts() -> Dict[str, Any]:
    alerts_list = alert_service.get_all_alerts()
    return {
        "status": "AVAILABLE",
        "alerts": alerts_list,
        "count": len(alerts_list),
        "label": "System-generated derived flood-risk alert",
        "result_type": "DERIVED",
    }


@router.get(
    "/critical",
    summary="Critical Flood Alerts",
    description="Returns only high-priority CRITICAL alerts where predicted depth exceeds 0.30m or threatens critical infrastructure.",
)
async def get_critical_alerts() -> Dict[str, Any]:
    crit_list = alert_service.get_critical_alerts()
    return {
        "status": "AVAILABLE",
        "alerts": crit_list,
        "count": len(crit_list),
        "label": "System-generated derived flood-risk alert",
        "result_type": "DERIVED",
    }


@router.get(
    "/{alert_id}",
    summary="Alert Details by ID",
    description="Returns detailed telemetry and location coordinates for an individual alert.",
)
async def get_alert_detail(alert_id: str) -> Dict[str, Any]:
    alert = alert_service.get_alert_by_id(alert_id)
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID '{alert_id}' not found",
        )
    return alert
