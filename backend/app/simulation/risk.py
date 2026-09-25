from typing import Any, Dict, Optional
from app.core.config import settings


def classify_flood_risk(depth_m: float) -> Dict[str, Any]:
    """
    Classify flood depth into operational risk categories based on configured thresholds.
    LOW: < 0.15m
    MODERATE: 0.15m - 0.30m
    HIGH: 0.30m - 0.60m
    CRITICAL: >= 0.60m
    """
    thresholds = settings.load_thresholds()
    levels = thresholds.get("risk_levels", {})

    d = max(float(depth_m), 0.0)

    if d < levels.get("MODERATE", {}).get("min_depth_m", 0.15):
        level = "LOW"
    elif d < levels.get("HIGH", {}).get("min_depth_m", 0.30):
        level = "MODERATE"
    elif d < levels.get("CRITICAL", {}).get("min_depth_m", 0.60):
        level = "HIGH"
    else:
        level = "CRITICAL"

    desc = levels.get(level, {}).get("description", "Flood risk assessment")

    return {
        "depth_m": round(d, 3),
        "risk_level": level,
        "description": desc,
        "result_type": "DERIVED"
    }


def classify_flood_hazard(depth_m: float, velocity_m_s: float = 0.0) -> str:
    """
    Multi-criteria hazard classification combining depth and velocity.
    """
    d = max(float(depth_m), 0.0)
    v = max(float(velocity_m_s), 0.0)
    dv_product = d * v

    if d >= 0.60 or dv_product >= 0.8:
        return "CRITICAL"
    elif d >= 0.30 or dv_product >= 0.3:
        return "HIGH"
    elif d >= 0.15 or dv_product >= 0.1:
        return "MODERATE"
    return "LOW"


def compute_flood_risk_score(
    depth_m: float,
    velocity_m_s: float = 0.0,
    vulnerable_population_density: float = 0.0,
    critical_facilities_count: int = 0
) -> float:
    """
    Calculate normalized risk index [0.0 - 1.0] using weighted factors:
    Hazard (depth + velocity) = 60%, Vulnerability (population) = 20%, Exposure (facilities) = 20%
    """
    d = max(float(depth_m), 0.0)
    v = max(float(velocity_m_s), 0.0)

    hazard_norm = min((d / 1.0) * 0.7 + (v / 2.0) * 0.3, 1.0)
    pop_norm = min(max(float(vulnerable_population_density), 0.0) / 50000.0, 1.0)
    fac_norm = min(max(int(critical_facilities_count), 0) / 5.0, 1.0)

    score = 0.60 * hazard_norm + 0.20 * pop_norm + 0.20 * fac_norm
    return round(float(min(max(score, 0.0), 1.0)), 4)
