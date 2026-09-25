from typing import Any, Dict, List, Optional
from app.core.config import settings
from app.simulation.risk import classify_flood_risk


def calculate_time_to_critical(
    timeline_steps: List[Dict[str, Any]],
    threshold_depth_m: Optional[float] = None
) -> Dict[str, Any]:
    """
    Examines simulation timeline to identify the first future timestep
    at which water depth exceeds the critical flooding threshold.

    Returns:
    - time_to_critical_minutes: int (or None if never critical)
    - first_critical_time: ISO timestamp
    - predicted_depth_m: depth at that timestep
    - risk: risk category
    - result_type: 'DERIVED'
    """
    if threshold_depth_m is None:
        thresholds = settings.load_thresholds()
        threshold_depth_m = thresholds.get("critical_time_threshold_m", 0.30)

    if not timeline_steps:
        return {"time_to_critical_minutes": None, "predicted_depth_m": None, "threshold_depth_m": threshold_depth_m, "risk_level": None, "status": "UNAVAILABLE", "result_type": "DERIVED"}
    for step in sorted(timeline_steps, key=lambda item: item.get("timestep_minutes", 0)):
        if "depth_m" not in step:
            return {"time_to_critical_minutes": None, "predicted_depth_m": None, "threshold_depth_m": threshold_depth_m, "risk_level": None, "status": "UNAVAILABLE", "result_type": "DERIVED"}
        depth = step["depth_m"]
        minutes = step.get("timestep_minutes", 0)

        if depth >= threshold_depth_m:
            risk_info = classify_flood_risk(depth)
            return {
                "time_to_critical_minutes": minutes,
                "first_critical_timestamp": step.get("timestamp"),
                "predicted_depth_m": depth,
                "threshold_depth_m": threshold_depth_m,
                "risk_level": risk_info["risk_level"],
                "status": "CRITICAL_THRESHOLD_EXCEEDED",
                "result_type": "DERIVED"
            }

    # If never exceeded within the horizon
    return {
        "time_to_critical_minutes": None,
        "first_critical_timestamp": None,
        "predicted_depth_m": timeline_steps[-1]["depth_m"],
        "threshold_depth_m": threshold_depth_m,
        "risk_level": classify_flood_risk(timeline_steps[-1]["depth_m"])["risk_level"],
        "status": "NOT_CRITICAL_WITHIN_HORIZON",
        "result_type": "DERIVED"
    }


def compute_time_to_critical(
    current_depth_m: float,
    filling_rate_m_per_h: float,
    critical_threshold_m: float = 0.30
) -> Dict[str, Any]:
    """
    Computes time-to-critical based on current flood depth and filling rate.
    """
    d = max(float(current_depth_m), 0.0)
    rate = max(float(filling_rate_m_per_h), 0.0)

    if d >= critical_threshold_m:
        return {
            "time_to_critical_minutes": 0,
            "is_critical": True,
            "current_depth_m": d,
            "threshold_m": critical_threshold_m,
            "result_type": "DERIVED"
        }

    if rate <= 0.0:
        return {
            "time_to_critical_minutes": None,
            "is_critical": False,
            "current_depth_m": d,
            "threshold_m": critical_threshold_m,
            "status": "DEPTH_STABLE_OR_RECEDING",
            "result_type": "DERIVED"
        }

    hours = (critical_threshold_m - d) / rate
    minutes = round(hours * 60.0, 1)

    return {
        "time_to_critical_minutes": minutes,
        "is_critical": False,
        "current_depth_m": d,
        "threshold_m": critical_threshold_m,
        "filling_rate_m_per_h": rate,
        "result_type": "DERIVED"
    }
