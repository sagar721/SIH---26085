from typing import Any, Dict, List, Optional
from app.simulation.risk import compute_flood_risk_score, classify_flood_hazard
from app.simulation.time_to_critical import compute_time_to_critical
from app.schemas.common import DataSourceTypeEnum


class RiskService:
    def evaluate_risk(self, depth_m: float, velocity_m_s: float = 0.5, critical_infra_count: int = 0) -> Dict[str, Any]:
        score = compute_flood_risk_score(
            depth_m=depth_m,
            velocity_m_s=velocity_m_s,
            vulnerable_population_density=30000.0,
            critical_facilities_count=critical_infra_count
        )
        level = classify_flood_hazard(depth_m, velocity_m_s)
        return {
            "risk_score": score,
            "risk_level": level,
            "depth_m": depth_m,
            "data_classification": DataSourceTypeEnum.DERIVED.value
        }

    def evaluate_time_to_critical(
        self,
        current_depth_m: float,
        filling_rate_m_per_h: float,
        critical_threshold_m: float = 0.30
    ) -> Dict[str, Any]:
        return compute_time_to_critical(
            current_depth_m=current_depth_m,
            filling_rate_m_per_h=filling_rate_m_per_h,
            critical_threshold_m=critical_threshold_m
        )


risk_service = RiskService()
