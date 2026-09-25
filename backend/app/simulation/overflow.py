from typing import Any, Dict, Optional
from app.core.config import settings


def calculate_drainage_overflow(
    runoff_m3s: float,
    capacity_m3s: float,
    thresholds: Optional[Dict[str, float]] = None,
    capacity_type: str = "SOURCE_ATTRIBUTE",
) -> Dict[str, Any]:
    """
    Calculate drainage utilization ratio and surface water overflow:
    overflow = max(runoff - capacity, 0)
    utilization = runoff / capacity
    """
    if runoff_m3s < 0:
        raise ValueError("Runoff must be non-negative")
    if capacity_m3s < 0:
        raise ValueError("Capacity must be non-negative")

    if thresholds is None:
        thresholds = settings.load_thresholds()["drainage_utilization"]

    overflow_m3s = max(runoff_m3s - capacity_m3s, 0.0)

    if capacity_m3s > 0:
        utilization = runoff_m3s / capacity_m3s
    else:
        utilization = 999.0 if runoff_m3s > 0 else 0.0

    if utilization <= thresholds["NORMAL"]:
        status = "NORMAL"
    elif utilization <= thresholds["STRESSED"]:
        status = "STRESSED"
    elif utilization <= thresholds["OVERLOADED"]:
        status = "OVERLOADED"
    else:
        status = "CRITICAL"

    return {
        "runoff_m3s": round(runoff_m3s, 4),
        "capacity_m3s": round(capacity_m3s, 4),
        "overflow_m3s": round(overflow_m3s, 4),
        "overflow_m3_s": round(overflow_m3s, 4),
        "utilization_ratio": round(utilization, 3),
        "status": status,
        "result_type": "DERIVED",
        "capacity_type": capacity_type,
    }


def compute_drainage_overflow(runoff_m3_s: float, capacity_m3_s: float) -> Dict[str, Any]:
    """Convenience wrapper for calculating overflow and overflow status."""
    res = calculate_drainage_overflow(runoff_m3s=runoff_m3_s, capacity_m3s=capacity_m3_s)
    res["is_overflowing"] = res["overflow_m3s"] > 0.0
    return res
