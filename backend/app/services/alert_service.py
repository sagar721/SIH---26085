"""M-FLOOD Alert Service (Phase 23).

Generates and manages system-generated derived flood-risk alerts from actual
simulation outputs and real-time precipitation thresholds.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.core.logging import get_logger
from app.services.runtime_store import runtime_store
from app.simulation.risk import classify_flood_risk

logger = get_logger("alert_service")


class AlertService:
    """Manages operational flood-risk alerts."""

    @staticmethod
    def now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    async def create_alert(
        self,
        severity: str,
        location: str,
        predicted_depth_m: float,
        time_to_critical_min: Optional[int] = None,
        affected_road: Optional[str] = None,
        basis: Optional[str] = None,
        coordinates: Optional[List[float]] = None,
        simulation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Creates a standardized derived operational alert."""
        severity_norm = severity.upper()
        if severity_norm not in ("LOW", "MODERATE", "HIGH", "CRITICAL"):
            severity_norm = classify_flood_risk(predicted_depth_m)["risk_level"]

        alert_id = f"ALERT_{uuid4().hex[:8]}"
        alert = {
            "alert_id": alert_id,
            "simulation_id": simulation_id,
            "severity": severity_norm,
            "location": location,
            "predicted_depth_m": round(float(predicted_depth_m), 3),
            "time_to_critical_min": time_to_critical_min,
            "affected_road": affected_road,
            "timestamp": self.now_iso(),
            "basis": basis or f"Predicted flood depth of {predicted_depth_m}m in {location}",
            "source": "M-FLOOD Coupled Simulation",
            "result_type": "DERIVED",
            "label": "System-generated derived flood-risk alert",
            "coordinates": coordinates,
        }

        await runtime_store.add_alert(alert)
        await runtime_store.publish("critical_alert" if severity_norm == "CRITICAL" else "alert_generated", alert)
        logger.info(f"Alert generated [{severity_norm}] for {location}: {predicted_depth_m}m")
        return alert

    def get_all_alerts(self) -> List[Dict[str, Any]]:
        """Return all active operational alerts."""
        return list(runtime_store.alerts)

    def get_critical_alerts(self) -> List[Dict[str, Any]]:
        """Return only critical severity operational alerts."""
        return [a for a in runtime_store.alerts if a.get("severity") == "CRITICAL"]

    def get_alert_by_id(self, alert_id: str) -> Optional[Dict[str, Any]]:
        for a in runtime_store.alerts:
            if a.get("alert_id") == alert_id:
                return a
        return None


alert_service = AlertService()
